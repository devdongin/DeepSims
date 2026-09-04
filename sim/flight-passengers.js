import {flightServiceAt} from './flight-schedule.js';

// Normal-service passenger executor. World integration must process access-walk
// arrivals before this function, and handle unavailable/diverting aircraft in a
// separate disruption phase. This function must not advance a disrupted link.
// Reservations, activity arrival, money and lifecycle cleanup remain world-owned.
export function advanceScheduledFlights(links,sims,tick,transferTicks,emit){
  if(!Number.isSafeInteger(transferTicks)||transferTicks<0)throw new RangeError('transferTicks');
  const ordered=[...links].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const byId=new Map(sims.map(s=>[s.id,s]));
  const operations=[];
  // Validate the entire batch first; a closure cannot silently freeze airborne
  // passengers under this normal-service executor.
  for(const link of ordered){
    if(link.blocked)throw new RangeError('disrupted link requires disruption executor');
    if(!Number.isSafeInteger(link.capacity)||link.capacity<1)throw new RangeError('capacity');
    const service=flightServiceAt(link,tick);
    if(service)operations.push({link,service});
  }
  for(const sim of sims)if(sim.state?.kind==='waiting_flight'&&sim.state.flight?.cancelOnAlight)
    sim.state.kind='flight_cancelled';
  // All aircraft move/alight before any gate boards: a zero-dwell connection is
  // independent of link storage order, and a traveller is never in two aircraft.
  for(const {link,service} of operations){
    const aircraft=link.aircraft;
    aircraft.x=service.position.x;aircraft.y=service.position.y;
    aircraft.passengers=aircraft.passengers.filter(id=>{
      const sim=byId.get(id),j=sim?.state?.flight;
      return sim?.state.kind==='flying'&&j?.legs[j.legIndex]?.linkId===link.id;
    });
    for(const id of [...aircraft.passengers]){
      const sim=byId.get(id),j=sim.state.flight,leg=j.legs[j.legIndex];
      sim.x=aircraft.x;sim.y=aircraft.y;
      if(service.kind!=='docked'||service.airportId!==leg.to||tick<=j.boardedTick)continue;
      aircraft.passengers=aircraft.passengers.filter(p=>p!==id);
      emit('flight_alighted',id,{linkId:link.id,airportId:leg.to,rideTicks:tick-j.boardedTick});
      j.airportId=leg.to;j.legIndex++;j.boardedTick=null;
      if(j.cancelOnAlight){sim.state.kind='flight_cancelled';continue;}
      if(j.legIndex===j.legs.length){sim.state.kind='flight_arrived';continue;}
      const next=j.legs[j.legIndex];
      if(next.from!==leg.to)throw new Error('noncontiguous flight itinerary');
      sim.state.kind='waiting_flight';j.waitingSince=tick;j.readyTick=tick+transferTicks;
      emit('flight_transfer',id,{airportId:leg.to,nextLinkId:next.linkId,readyTick:j.readyTick});
    }
  }
  for(const {link,service} of operations){
    if(service.kind!=='docked'||!service.departure)continue;
    const queue=sims.filter(sim=>{
      const j=sim.state?.flight,leg=j?.legs[j.legIndex];
      return sim.state?.kind==='waiting_flight'&&leg?.linkId===link.id
        &&leg.from===service.airportId&&j.airportId===service.airportId
        &&j.readyTick<=tick&&sim.x===service.position.x&&sim.y===service.position.y;
    }).sort((a,b)=>a.state.flight.waitingSince-b.state.flight.waitingSince||a.id-b.id);
    for(const sim of queue){
      if(link.aircraft.passengers.length>=link.capacity)break;
      const j=sim.state.flight,leg=j.legs[j.legIndex];
      link.aircraft.passengers.push(sim.id);sim.state.kind='flying';j.boardedTick=tick;
      emit('flight_boarded',sim.id,{linkId:link.id,from:leg.from,to:leg.to,waitTicks:tick-j.waitingSince});
    }
  }
}
