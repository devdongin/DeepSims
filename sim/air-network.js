import {airDistance, flightServiceAt} from './flight-schedule.js';

const idOrder=(a,b)=>a<b?-1:a>b?1:0;
const nonnegative=(n,name)=>{
  if(!Number.isSafeInteger(n)||n<0)throw new RangeError(name);
  return n;
};
const identifier=(id,name)=>{
  if(typeof id!=='string'||!id.length)throw new RangeError(name);
};

export function makeAirNetwork(){return {airports:[],links:[],nextId:0};}

// Completed residence-to-service visits only; attempts/cancellations and airport
// transfers are not arrivals. Includes today + previous13 days, not14 + today.
export function recentAirportDemand(transportStats,from,to,day){
  nonnegative(day,'day');
  let total=0;
  for(const row of [...(transportStats?.history??[]),transportStats?.today]){
    if(!row||row.day<day-13||row.day>day)continue;
    for(const visit of Object.values(row.municipalVisits??{})){
      if(visit.from===from&&visit.to===to||visit.from===to&&visit.to===from)
        total=nonnegative(total+nonnegative(visit.arrivals,'arrivals'),'demand overflow');
    }
  }
  return total;
}

// Called ONLY after paid project labor completes. This layer does not charge a
// second fee, unlock construction, or invent a facility. The world integration
// must provide the actual completed airport and the immutable project identity.
// Replaying the same completion is idempotent. No per-tick topology redraw.
export function commissionAirport(network,facility,projectId,tick,config,transportStats){
  identifier(facility?.id,'airport ID');identifier(facility?.villageId,'municipality');
  identifier(projectId,'completed project ID');nonnegative(tick,'tick');
  if(facility.type!=='airport')throw new RangeError('completed airport required');
  const existing=network.airports.find(a=>a.id===facility.id);
  if(existing){
    if(existing.projectId!==projectId)throw new RangeError('airport belongs to another completed project');
    return null;
  }
  if(network.airports.some(a=>a.projectId===projectId))throw new RangeError('project already commissioned');
  if(network.airports.some(a=>a.villageId===facility.villageId&&!a.removed))
    throw new RangeError('municipality already has an airport');
  // Validate even the first airport, before mutating authoritative state.
  airDistance(facility.door,facility.door);
  for(const key of ['speed','dwellTicks','capacity']){
    nonnegative(config[key],key);if(!config[key])throw new RangeError(key);
  }
  const airport={id:facility.id,villageId:facility.villageId,projectId,openedTick:tick,
    door:{...facility.door},removed:false};
  const candidates=network.airports.filter(a=>!a.removed).map(a=>({airport:a,
    demand:recentAirportDemand(transportStats,airport.villageId,a.villageId,Math.floor(tick/1440)),
    distance:airDistance(airport.door,a.door)})).filter(a=>a.distance>0)
    .sort((a,b)=>b.demand-a.demand||a.distance-b.distance||idOrder(a.airport.id,b.airport.id));
  let link=null;
  if(candidates.length){
    const parent=candidates[0].airport,id=`air:${nonnegative(network.nextId,'nextId')}`;
    nonnegative(network.nextId+1,'nextId overflow');
    link={id,from:parent.id,to:airport.id,fromPoint:{...parent.door},toPoint:{...airport.door},
      openedTick:tick,pausedTicks:0,speed:config.speed,dwellTicks:config.dwellTicks,
      capacity:config.capacity,blocked:false,aircraft:{x:parent.door.x,y:parent.door.y,passengers:[]}};
    flightServiceAt(link,tick); // Validate geometry/timing before either push.
  }else if(network.airports.some(a=>!a.removed))throw new RangeError('no distinct parent position');
  network.airports.push(airport);
  if(link){network.links.push(link);network.nextId++;}
  return {airportId:airport.id,linkId:link?.id??null};
}

// Closure is operational, not new capital investment. Removed records and their
// aircraft remain persisted; no automatic re-parenting or free replacement fleet.
export function unavailableAirports(network,facilities,incidents){
  const live=new Map(facilities.filter(f=>f.type==='airport').map(f=>[f.id,f]));
  const incidentIds=new Set(incidents.map(i=>i.facilityId));
  return network.airports.filter(a=>a.removed||!live.has(a.id)||incidentIds.has(a.id))
    .map(a=>a.id).sort(idOrder);
}
