// Static records are full replacements; volatile records are a full live roster.
export function resetSimCache(cache,sims){
  cache.clear();
  for(const sim of sims??[])cache.set(sim.id,sim);
}
export function mergeSimBatch(cache,sims,statics=[]){
  for(const sim of statics)cache.set(sim.id,sim);
  const live=new Set(sims.map(sim=>sim.id));
  for(const id of cache.keys())if(!live.has(id))cache.delete(id);
  return sims.map(sim=>({...cache.get(sim.id),...sim}));
}
