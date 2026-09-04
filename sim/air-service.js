import {unavailableAirports} from './air-network.js';
import {validateFlightPassengers} from './flight-validation.js';
import {flightServiceAt} from './flight-schedule.js';
import {advanceScheduledFlights} from './flight-passengers.js';
import {advanceFlightDiversion} from './flight-diversion.js';
import {repositionEmptyAircraft} from './flight-reposition.js';

// One physical service update per simulation tick. The world owns access/egress,
// action reservations and paid construction; this combines the aircraft phases.
export function advanceAirService(network,sims,facilities,incidents,tick,transferTicks,emit){
  if(!network.links.length)return;
  if(!Number.isSafeInteger(tick)||tick<0||network.lastServiceTick!=null&&tick!==network.lastServiceTick+1)
    throw new RangeError('air service requires consecutive ticks');
  if(!Number.isSafeInteger(transferTicks)||transferTicks<0)throw new RangeError('transferTicks');
  const links=[...network.links].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const occupancy=validateFlightPassengers(links,sims,tick);
  const closed=unavailableAirports(network,facilities,incidents),closedSet=new Set(closed);
  const normal=[];
  for(const link of links){
    link.aircraft.passengers=occupancy.get(link.id);
    const unavailable=closedSet.has(link.from)||closedSet.has(link.to);
    if(unavailable&&!link.blocked){
      link.blocked=true;emit('flight_service_suspended',null,{linkId:link.id});
      const previous=(tick>0?flightServiceAt(link,tick-1):null)??flightServiceAt(link,tick);
      if(!link.aircraft.passengers.length&&previous?.kind==='docked'
        &&previous.position.x===link.aircraft.x&&previous.position.y===link.aircraft.y)
        link.aircraft.disruption={kind:'landed',targetId:previous.airportId};
    }
    if(link.blocked){
      const recovery=link.aircraft.disruption;
      if(!link.aircraft.passengers.length&&recovery)
        repositionEmptyAircraft(link,network.airports,closed,tick,emit);
      else advanceFlightDiversion(link,sims,network.airports,closed,tick,emit);
    }
    if(!link.blocked)normal.push(link);
  }
  // Gate residents never teleport when their route closes. The world must
  // re-plan from these coordinates or release their activity reservation.
  const blockedLinks=new Set(links.filter(l=>l.blocked).map(l=>l.id));
  for(const sim of sims){
    const j=sim.state?.flight;
    if(sim.state?.kind==='waiting_flight'&&blockedLinks.has(j?.legs[j.legIndex]?.linkId)){
      sim.state.kind=j.cancelOnAlight?'flight_cancelled':'flight_route_unavailable';
      emit('flight_route_unavailable',sim.id,{linkId:j.legs[j.legIndex].linkId,airportId:j.airportId});
    }
  }
  advanceScheduledFlights(normal,sims,tick,transferTicks,emit);
  network.lastServiceTick=tick;
}
