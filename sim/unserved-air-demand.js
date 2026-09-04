import {sameRegion} from './map.js';
import {airDistance} from './flight-schedule.js';

// Observed failed ordinary trip intents, NEVER completed departures/arrivals.
// Caller has already applied action eligibility, funds, resource reservation,
// ground BFS and operational air routing. This observer adds no new choice/RNG.
const ACTIONS=new Set(['work','study','eat','socialize','play','drink','binge_eat','exercise','read',
  'shop','fish','stroll','volunteer','board_game','stock_food','visit_culture','see_doctor']);

export function recordUnservedAirTrip(world,sim,target,emit=()=>{}){
  if(!ACTIONS.has(target.action)||target.facilityId==='patrol')return false;
  const facility=world.map.facilities.find(f=>f.id===target.facilityId);
  const resource=facility?.resources.find(r=>r.id===target.resourceId);
  const home=world.map.facilities.find(f=>f.id===sim.homeId);
  const from=sim.villageId,to=facility?.villageId;
  if(!home||home.villageId!==from||!to||from===to||!resource
    ||resource.x!==target.res.x||resource.y!==target.res.y)return false;
  const source=world.villages.find(v=>v.id===from),destination=world.villages.find(v=>v.id===to);
  if(!source||!destination||!world.sims.some(s=>s.villageId===to))return false;
  if(airDistance(source.center,destination.center)<world.logic.transport.longTripMin)return false;
  // Flying cannot repair an inaccessible room or a resident stranded away from
  // their origin community. Only the inter-region gap is an airport demand.
  if(!sameRegion(world.map,sim.x,sim.y,home.door.x,home.door.y)
    ||!sameRegion(world.map,facility.door.x,facility.door.y,resource.x,resource.y)
    ||sameRegion(world.map,sim.x,sim.y,resource.x,resource.y))return false;
  const rows=world.transportStats.today.unservedAirTrips??={};
  const key=JSON.stringify([from,to]);
  const row=rows[key]??={from,to,residentIds:[]};
  if(row.residentIds.includes(sim.id))return false;
  row.residentIds.push(sim.id);
  emit('air_trip_unserved',sim.id,{from,to,action:target.action,facilityId:facility.id});
  return true;
}

// Daily history and public summaries need counts, not per-resident dedup IDs.
export function unservedAirSummary(rows){
  return Object.fromEntries(Object.entries(rows).map(([key,row])=>[key,
    {from:row.from,to:row.to,intents:row.intents??row.residentIds.length}]));
}

export function recentUnservedAirDemand(stats,from,to,day){
  if(!Number.isSafeInteger(day)||day<0)throw new RangeError('day');
  let total=0;
  for(const entry of [...(stats?.history??[]),stats?.today]){
    if(!entry||entry.day<day-13||entry.day>day)continue;
    for(const row of Object.values(entry.unservedAirTrips??{})){
      if(!(row.from===from&&row.to===to||row.from===to&&row.to===from))continue;
      const count=row.intents??row.residentIds?.length;
      if(!Number.isSafeInteger(count)||count<0)throw new RangeError('unserved air demand');
      total+=count;if(!Number.isSafeInteger(total))throw new RangeError('unserved air demand overflow');
    }
  }
  return total;
}
