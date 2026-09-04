import {makeAirNetwork} from './air-network.js';
import {airDistance,flightServiceAt} from './flight-schedule.js';
import {validateFlightPassengers} from './flight-validation.js';

const fail=name=>{throw new RangeError(`Invalid airport save: ${name}`);};
const integer=(n,name,min=0)=>{if(!Number.isSafeInteger(n)||n<min)fail(name);return n;};
const id=(s,name)=>{if(typeof s!=='string'||!s.length)fail(name);};
const point=(p,name)=>{integer(p?.x,`${name}.x`);integer(p?.y,`${name}.y`);};

// Load-time validation only. Airport saves first exist in schema77: missing
// paid-project identities or aircraft cannot be invented as a legacy migration.
// Only the monotonic counter is derivable from persisted link identities.
// Validation is pure; a failed load leaves its input available for recovery.
export function restoreAirNetwork(value,sims,tick){
  integer(tick,'world tick');
  const network=value??makeAirNetwork();
  if(!Array.isArray(network.airports)||!Array.isArray(network.links))fail('airport/link arrays');
  const airports=new Map(),projects=new Set(),municipalities=new Set(),links=new Set();
  for(const a of network.airports){
    id(a?.id,'airport identity');id(a.villageId,'municipality');id(a.projectId,'paid project identity');
    if(airports.has(a.id)||projects.has(a.projectId))fail('duplicate airport/project identity');
    if(typeof a.removed!=='boolean')fail('airport removed flag');
    if(!a.removed&&municipalities.has(a.villageId))fail('duplicate municipal airport');
    if(integer(a.openedTick,'airport opened tick')>tick)fail('future airport');
    point(a.door,'airport door');
    airports.set(a.id,a);projects.add(a.projectId);if(!a.removed)municipalities.add(a.villageId);
  }
  let minimumNextId=0;
  for(const l of network.links){
    const match=typeof l?.id==='string'&&/^air:(0|[1-9]\d*)$/.exec(l.id);
    if(!match||links.has(l.id))fail('unique commissioned link identity');
    minimumNextId=Math.max(minimumNextId,integer(Number(match[1])+1,'link counter overflow',1));
    links.add(l.id);
    const from=airports.get(l.from),to=airports.get(l.to);
    if(!from||!to||from===to)fail('link endpoints');
    if(airDistance(l.fromPoint,from.door)||airDistance(l.toPoint,to.door))fail('moved link endpoints');
    if(integer(l.openedTick,'link opened tick')>tick)fail('future link');
    if(l.serviceEpochTick!=null&&(integer(l.serviceEpochTick,'service epoch')>tick||l.serviceEpochTick<l.openedTick))fail('service epoch');
    integer(l.pausedTicks,'paused ticks');integer(l.capacity,'capacity',1);
    if(typeof l.blocked!=='boolean')fail('blocked flag');
    flightServiceAt(l,tick); // Same safe-integer geometry/timing contract as execution.
    point(l.aircraft,'aircraft');
    if(!Array.isArray(l.aircraft.passengers))fail('passenger array');
    for(const passenger of l.aircraft.passengers)integer(passenger,'passenger identity');
    const recovery=l.aircraft.disruption;
    if(l.blocked&&!recovery||!l.blocked&&recovery)fail('blocked recovery state');
    if(recovery){
      if(!['holding','diverting','landed','repositioning'].includes(recovery.kind))fail('recovery phase');
      if(recovery.intendedId!=null&&!airports.has(recovery.intendedId))fail('recovery intended airport');
      if(recovery.kind!=='holding'&&!airports.has(recovery.targetId))fail('recovery target airport');
      if(['diverting','repositioning'].includes(recovery.kind)){
        point(recovery.origin,'recovery origin');point(recovery.targetPoint,'recovery target');
        if(integer(recovery.startedTick,'recovery departure')>tick)fail('future recovery');
        integer(recovery.duration,'recovery duration',1);
      }
      if(['landed','repositioning'].includes(recovery.kind)&&l.aircraft.passengers.length)fail('occupied recovered aircraft');
    }
  }
  for(const sim of sims){
    if(!['flying','waiting_flight'].includes(sim.state?.kind))continue;
    const journey=sim.state.flight,leg=journey?.legs?.[journey.legIndex];
    if(!links.has(leg?.linkId))fail('active passenger has no aircraft link');
  }
  const occupancy=validateFlightPassengers(network.links,sims,tick),residents=new Map(sims.map(s=>[s.id,s]));
  for(const link of network.links){
    const saved=link.aircraft.passengers;
    if(new Set(saved).size!==saved.length)fail('duplicate passenger occupancy');
    for(const passenger of saved){
      // Death/emigration runs AFTER aircraft service and removes the resident.
      // Preserve such stale IDs until the normal next-tick cleanup, exactly as
      // uninterrupted execution does; never revive a removed resident at load.
      const sim=residents.get(passenger);if(!sim)continue;
      if(!occupancy.get(link.id).includes(passenger))fail('inconsistent live passenger occupancy');
      if(sim.x!==link.aircraft.x||sim.y!==link.aircraft.y)fail('passenger outside aircraft');
    }
    if(!link.blocked){
      const expected=flightServiceAt(link,tick)?.position;
      if(!expected||expected.x!==link.aircraft.x||expected.y!==link.aircraft.y)fail('aircraft outside scheduled position');
    }
  }
  if(network.lastServiceTick!=null&&integer(network.lastServiceTick,'last service tick')!==tick)
    fail('service clock differs from world clock');
  // Newly commissioned links have not run until the following world tick.
  if(network.links.length&&network.lastServiceTick==null&&network.links.some(l=>l.openedTick!==tick))
    fail('missing service clock');
  const nextId=network.nextId??minimumNextId;
  if(integer(nextId,'next link ID')<minimumNextId)fail('reused link counter');
  return network.nextId==null?{...network,nextId}:network;
}
