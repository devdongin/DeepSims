import {airDistance,flightPosition} from './flight-schedule.js';
import {validateFlightPassengers} from './flight-validation.js';

// Interrupted-flight recovery, separate from normal schedule execution. A landed
// aircraft stays blocked until a later physical reposition/restart operation.
// Callers must not run the normal executor on this link in the same tick.
export function advanceFlightDiversion(link,sims,airports,closedIds,tick,emit){
  if(!Number.isSafeInteger(tick)||tick<0||!Number.isSafeInteger(link.speed)||link.speed<1)
    throw new RangeError('diversion timing');
  const aircraft=link.aircraft,byId=new Map(sims.map(s=>[s.id,s])),closed=new Set(closedIds);
  const available=airports.filter(a=>!a.removed&&!closed.has(a.id));
  const position=()=>({x:aircraft.x,y:aircraft.y});
  const occupancy=validateFlightPassengers([link],sims,tick);
  link.blocked=true;
  aircraft.passengers=occupancy.get(link.id);
  let recovery=aircraft.disruption;
  if(recovery?.kind==='landed')return 'landed';
  if(!recovery||recovery.kind==='holding'||!available.some(a=>a.id===recovery.targetId)){
    const first=byId.get(aircraft.passengers[0]),j=first?.state.flight;
    const intended=recovery?.intendedId??j?.legs[j.legIndex]?.to;
    const ranked=available.map(a=>({airport:a,distance:airDistance(position(),a.door)}))
      .sort((a,b)=>a.distance-b.distance||(a.airport.id<b.airport.id?-1:a.airport.id>b.airport.id?1:0));
    const target=available.find(a=>a.id===intended)??ranked[0]?.airport;
    if(!target){
      if(recovery?.kind!=='holding')emit('flight_holding',null,{linkId:link.id,x:aircraft.x,y:aircraft.y});
      aircraft.disruption={kind:'holding',intendedId:intended??null};
      return 'holding';
    }
    const origin=position(),distance=airDistance(origin,target.door);
    recovery=aircraft.disruption={kind:'diverting',intendedId:intended??null,
      origin,targetId:target.id,targetPoint:{...target.door},startedTick:tick,
      duration:Math.max(1,Math.ceil(distance/link.speed))};
    emit('flight_diverted',null,{linkId:link.id,airportId:target.id,x:origin.x,y:origin.y});
  }
  const elapsed=tick-recovery.startedTick;
  if(elapsed<0)throw new RangeError('diversion tick precedes departure');
  const p=flightPosition(recovery.origin,recovery.targetPoint,Math.min(elapsed,recovery.duration),recovery.duration);
  aircraft.x=p.x;aircraft.y=p.y;
  for(const id of aircraft.passengers){const sim=byId.get(id);sim.x=p.x;sim.y=p.y;}
  if(elapsed<recovery.duration)return 'diverting';
  for(const id of aircraft.passengers){
    const sim=byId.get(id),journey=sim.state.flight,leg=journey.legs[journey.legIndex];
    journey.airportId=recovery.targetId;journey.boardedTick=null;
    // Even if we reached the originally planned airport, the disrupted journey
    // needs fresh world-level egress/connection validation, never fake completion.
    journey.divertedFrom=leg.to;
    sim.state.kind=journey.cancelOnAlight?'flight_cancelled':'flight_diverted_arrival';
    emit('flight_diversion_landed',id,{linkId:link.id,airportId:recovery.targetId,intendedId:leg.to});
  }
  aircraft.passengers=[];recovery.kind='landed';
  return 'landed';
}
