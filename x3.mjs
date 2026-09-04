import { createWorld, advance } from './sim/index.js';
function run(seed, mutate) {
  const w = createWorld(seed);
  if (mutate) mutate(w.logic);
  const ev = advance(w, {}, 1440*60);
  const t={}; for(const e of ev) t[e.type]=(t[e.type]||0)+1;
  const friends = w.sims.reduce((n,s)=>n+Object.values(s.relTiers||{}).filter(x=>x==='friend').length,0);
  const rivals = w.sims.reduce((n,s)=>n+Object.values(s.relTiers||{}).filter(x=>x==='rival').length,0);
  const mood = Math.round(w.sims.reduce((n,s)=>n+s.mood,0)/w.sims.length);
  const money = w.sims.reduce((n,s)=>n+s.money,0);
  return {pop:w.sims.length, friends, rivals, mood, money, married:t.married||0,
          conv:t.conversation||0, lonely:t.lonely||0, died:t.died||0, starving:t.starving||0,
          helped:t.helped||0, jobsw:t.job_changed||0, built:t.facility_built||0};
}
const arms = {
  base: null,
  no_gossip: (L)=>{L.influence.gossipDelta=0;},
  no_memory: (L)=>{L.memory.posScale=0;L.memory.negScale=0;},
  no_triad:  (L)=>{L.triad.perFriendBonus=0;},
  no_help:   (L)=>{L.social.approachBasePct=0;},
};
const seeds=Array.from({length:20},(_,i)=>i+1);
const res={};
for(const [name,m] of Object.entries(arms)){
  res[name]=seeds.map(s=>run(s,m));
  const keys=Object.keys(res[name][0]);
  const line=keys.map(k=>{
    const v=res[name].map(r=>r[k]); const mu=v.reduce((a,b)=>a+b,0)/v.length;
    const sd=Math.sqrt(v.reduce((a,b)=>a+(b-mu)**2,0)/(v.length-1));
    return `${k}=${mu.toFixed(1)}±${sd.toFixed(1)}`;
  }).join(' ');
  console.log(name.padEnd(10), line);
}
