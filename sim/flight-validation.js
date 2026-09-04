// Pure preflight validation/occupancy normalization: callers apply the returned
// lists only after every link and passenger has passed, before emitting events.
export function validateFlightPassengers(links,sims,tick){
  const byId=new Map(),byLink=new Map(),occupancy=new Map();
  const validTick=n=>Number.isSafeInteger(n)&&n>=0;
  if(!validTick(tick))throw new RangeError('tick');
  for(const s of sims){
    if(!validTick(s.id)||byId.has(s.id))throw new RangeError('unique integer resident IDs required');
    byId.set(s.id,s);
  }
  for(const l of links){
    if(byLink.has(l.id))throw new RangeError('duplicate aircraft link');
    byLink.set(l.id,l);
    if(!Number.isSafeInteger(l.capacity)||l.capacity<1)throw new RangeError('capacity');
    const ids=[...new Set(l.aircraft.passengers)].filter(id=>{
      const s=byId.get(id),j=s?.state?.flight;
      return s?.state.kind==='flying'&&j?.legs?.[j.legIndex]?.linkId===l.id;
    });
    if(ids.length>l.capacity)throw new RangeError('aircraft over capacity');
    occupancy.set(l.id,ids);
  }
  for(const s of sims){
    if(!['flying','waiting_flight'].includes(s.state?.kind))continue;
    const j=s.state.flight;
    if(!j||!Array.isArray(j.legs)||!validTick(j.legIndex)||j.legIndex>=j.legs.length)
      throw new RangeError('invalid active flight leg');
    for(let i=0;i<j.legs.length;i++){
      const leg=j.legs[i];
      if(!leg||typeof leg.linkId!=='string'||typeof leg.from!=='string'||typeof leg.to!=='string'
        ||leg.from===leg.to||i&&j.legs[i-1].to!==leg.from)throw new RangeError('invalid contiguous itinerary');
    }
    const leg=j.legs[j.legIndex],l=byLink.get(leg.linkId);
    if(!l)continue; // Another executor owns this disrupted/otherwise excluded link.
    if(!(leg.from===l.from&&leg.to===l.to||leg.from===l.to&&leg.to===l.from))
      throw new RangeError('flight direction does not match link');
    if(!validTick(j.waitingSince)||!validTick(j.readyTick)||j.waitingSince>j.readyTick)
      throw new RangeError('invalid gate timing');
    if(s.state.kind==='flying'&&(!validTick(j.boardedTick)||j.boardedTick>tick||!occupancy.get(l.id).includes(s.id)))
      throw new RangeError('invalid flying occupancy or timing');
  }
  return occupancy;
}
