import {governmentFor} from './government.js';
import {airDistance} from './flight-schedule.js';
import {recentAirportDemand} from './air-network.js';
import {recentUnservedAirDemand} from './unserved-air-demand.js';

// Completed service trips and observed unserved intents remain separate. Either
// must independently meet the threshold; never add attempts to arrival counts.
export function airportConstructionEvidence(world,villageId){
  world=world.rootWorld??world;
  const village=world.villages.find(v=>v.id===villageId),T=world.logic.transport;
  const day=world.transportStats.today.day; // rollTransportDay runs before same-tick inputs.
  let completedTrips=0,unservedIntents=0;
  if(village)for(const other of world.villages){
    if(other.id===village.id||!world.sims.some(s=>s.villageId===other.id))continue;
    if(airDistance(village.center,other.center)<T.longTripMin)continue;
    completedTrips+=recentAirportDemand(world.transportStats,village.id,other.id,day);
    unservedIntents+=recentUnservedAirDemand(world.transportStats,village.id,other.id,day);
  }
  const pending=[...world.zoneOrders,...world.projects].some(p=>p.type==='airport'
    &&(world.plots.find(q=>q.plotId===p.plotId)?.villageId??'village:0')===villageId);
  let reason=null;
  if(!village||!world.sims.some(s=>s.villageId===villageId))reason='no_municipality';
  else if(governmentFor(world,villageId).cityTier<3)reason='tier_locked';
  else if(world.villages.length<2)reason='no_other_municipality';
  else if(world.map.facilities.some(f=>f.type==='airport'&&f.villageId===villageId)||pending)reason='airport_exists';
  else if(Math.max(completedTrips,unservedIntents)<T.airportTripsMin)reason='airport_demand_short';
  return {eligible:reason===null,reason,completedTrips,unservedIntents,threshold:T.airportTripsMin};
}
