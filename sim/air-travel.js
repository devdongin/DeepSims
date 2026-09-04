import {advanceAirService} from './air-service.js';
import {airDistance} from './flight-schedule.js';
import {bfsPath} from './pathfind.js';
import {emptyState} from './simfactory.js';
import {recordAirStep,recordAirWait} from './transport-stats.js';

// World-owned activity boundary: an airport arrival is not a service visit.
// Run after access walking, before performing; egress starts next tick.
export function advanceAirTravel(world,t,emit,arrive,release){
  const before=new Map();
  if(!world.air.links.length)return;
  for(const sim of world.sims){
    if(sim.state.kind==='flying')before.set(sim.id,{x:sim.x,y:sim.y});
    if(sim.state.kind==='waiting_flight')recordAirWait(world,sim);
  }
  advanceAirService(world.air,world.sims,world.map.facilities,world.incidents,t,world.logic.transport.airTransferTicks,emit);
  for(const sim of world.sims){
    const origin=before.get(sim.id);if(origin)recordAirStep(world,sim,t,airDistance(origin,sim));
    const s=sim.state;
    if(!['flight_arrived','flight_diverted_arrival','flight_route_unavailable','flight_cancelled'].includes(s.kind))continue;
    const facility=world.map.facilities.find(f=>f.id===s.facilityId);
    const resource=facility?.resources.find(r=>r.id===s.resourceId);
    let reason=s.flight.cancelOnAlight||s.kind==='flight_cancelled'?'lifecycle_changed':null;
    if(!reason&&(!resource||world.incidents.some(i=>i.facilityId===s.facilityId)
      ||world.reservations[`${s.facilityId}:${s.resourceId}`]!==sim.id))reason='target_unavailable';
    // Revalidate actual terrain after normal landing too; a saved egress route
    // cannot authorize walking through newly built walls or a removed facility.
    const path=!reason?bfsPath(world.map,sim.x,sim.y,resource.x,resource.y):null;
    if(!reason&&path===null)reason='no_path';
    if(reason){
      release(world,sim);sim.state=emptyState();
      if(reason==='no_path')sim.noPathCool[`${s.facilityId}:${s.resourceId}`]=t+world.logic.construct.noPathCoolTicks;
      emit('action_failed',sim.id,{action:s.action,reason});
      continue;
    }
    s.flight.phase='egress';s.path=path;s.kind='walking';
    if(!path.length)arrive(sim);
  }
}
