// Slow boundary operation, never the per-tick mood path. The dictionaries remain
// authoritative; loading a save or changing the habit threshold rebuilds caches.
export function refreshMoodCounts(sim,logic){
  let friends=0,rivals=0,habits=0;
  for(const tier of Object.values(sim.relTiers??{})){
    if(tier==='friend')friends++;else if(tier==='rival')rivals++;
  }
  for(const [key,value] of Object.entries(sim.habit??{}))
    if(!key.startsWith('work:')&&value>=logic.club.habitMin)habits++;
  sim.friendCount=friends;sim.rivalCount=rivals;sim.habitCount=habits;
}
