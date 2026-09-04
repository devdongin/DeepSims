import {airDistance,flightPosition} from './flight-schedule.js';
import {advanceFlightDiversion} from './flight-diversion.js';

// Reposition a recovered EMPTY aircraft. Passengers already landed remain at the
// diversion airport. Historical openedTick survives a fresh service clock epoch.
export function repositionEmptyAircraft(link,airports,closedIds,tick,emit){
  if(!Number.isSafeInteger(tick)||tick<link.openedTick)throw new RangeError('restart tick');
  if(link.aircraft.passengers.length)throw new RangeError('reposition requires an empty aircraft');
  if(!link.blocked)return 'ready';
  const aircraft=link.aircraft,recovery=aircraft.disruption;
  if(!recovery)throw new RangeError('reposition requires a known recovered position');
  const closed=new Set(closedIds),open=id=>airports.find(a=>a.id===id&&!a.removed&&!closed.has(id));
  if(['holding','diverting'].includes(recovery.kind))
    return advanceFlightDiversion(link,[],airports,closedIds,tick,emit);
  if(!['landed','repositioning'].includes(recovery.kind))throw new RangeError('invalid recovery phase');
  const from=open(link.from),to=open(link.to);
  if(recovery.kind==='repositioning'&&!from)
    return advanceFlightDiversion(link,[],airports,closedIds,tick,emit);
  if(recovery.kind==='landed'&&(!from||!to))return 'waiting';
  // Existing airport identities must not silently move their gate underneath a
  // saved route. A new facility/location requires a new funded commissioning path.
  if(from&&(from.door.x!==link.fromPoint.x||from.door.y!==link.fromPoint.y)
    ||to&&(to.door.x!==link.toPoint.x||to.door.y!==link.toPoint.y))throw new RangeError('route endpoint moved');
  if(recovery.kind==='landed'){
    const origin={x:aircraft.x,y:aircraft.y},distance=airDistance(origin,from.door);
    aircraft.disruption={kind:'repositioning',origin,targetId:from.id,targetPoint:{...from.door},
      startedTick:tick,duration:Math.max(1,Math.ceil(distance/link.speed))};
    if(distance)return 'repositioning';
  }
  const move=aircraft.disruption,elapsed=tick-move.startedTick;
  if(elapsed<0)throw new RangeError('reposition time reversed');
  const arrived=aircraft.x===link.fromPoint.x&&aircraft.y===link.fromPoint.y;
  if(!arrived){
    const p=flightPosition(move.origin,move.targetPoint,Math.min(elapsed,move.duration),move.duration);
    aircraft.x=p.x;aircraft.y=p.y;
    if(elapsed<move.duration)return 'repositioning';
  }
  if(!to){move.kind='landed';return 'waiting';}
  link.serviceEpochTick=tick;link.pausedTicks=0;link.blocked=false;delete aircraft.disruption;
  emit('flight_service_resumed',null,{linkId:link.id,airportId:link.from,serviceEpochTick:tick});
  return 'ready';
}
