import { createWorld, advance } from './sim/index.js';
const [arm, seedS] = process.argv.slice(2);
const seed = Number(seedS);
const arms = {
  base: null,
  no_gossip: (L)=>{L.influence.gossipDelta=0;},
  no_memory: (L)=>{L.memory.posScale=0;L.memory.negScale=0;},
  no_gravity: (L)=>{L.social.gravityPullPct=0;},
  no_approach:(L)=>{L.social.approachBasePct=0;},
  coping_on: (L)=>{L.coping.threshold=0;},
};
const w = createWorld(seed);
const m = arms[arm]; if (m) m(w.logic);
const ev = advance(w, {}, 1440*50);
const t={}; for(const e of ev) t[e.type]=(t[e.type]||0)+1;
const acts={}; for(const e of ev) if(e.type==='action_started') acts[e.payload.action]=(acts[e.payload.action]||0)+1;
const friends=w.sims.reduce((n,s)=>n+Object.values(s.relTiers||{}).filter(x=>x==='friend').length,0);
const rivals=w.sims.reduce((n,s)=>n+Object.values(s.relTiers||{}).filter(x=>x==='rival').length,0);
console.log(JSON.stringify({arm,seed,pop:w.sims.length,friends,rivals,
 mood:Math.round(w.sims.reduce((n,s)=>n+s.mood,0)/w.sims.length),
 cash:w.sims.reduce((n,s)=>n+s.money,0), treasury:w.treasury,
 married:t.married||0, dating:t.started_dating||0, conv:t.conversation||0,
 lonely:t.lonely||0, helped:t.helped||0, shared:t.money_shared||0,
 starving:t.starving||0, built:t.facility_built||0, jobsw:t.job_changed||0,
 declined:t.invite_declined||0, coping:(acts.drink||0)+(acts.binge_eat||0)+(acts.hole_up||0)+(acts.exercise||0)}));
