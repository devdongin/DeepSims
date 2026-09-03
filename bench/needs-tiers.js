import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { canWork } from '../sim/education.js';
const seed=Number(process.argv[2]??9100),w=createWorld(seed);
let promotions=0,demotions=0,visits=0,studentWork=0;
for(let i=0;i<120*1440;i++){
  for(const e of tick(w)){
    if(e.type==='needs_tier_changed'){if(e.payload.to===1)promotions++;else demotions++;}
    if(e.type==='action_completed'&&e.payload.action==='visit_culture')visits++;
  }
  for(const s of w.sims)if(!canWork(s)&&['work','supply_groceries','grow_groceries'].includes(s.state.action))studentWork++;
  if(w.worldTick%(30*1440)===0)console.log(JSON.stringify({seed,day:w.worldTick/1440,pop:w.sims.length,
    citizens:w.sims.filter(s=>s.needsTier.level===1).length,promotions,demotions,visits,studentWork,
    maxFulfilled:Math.max(...w.sims.map(s=>s.needsTier.fulfilledTicks)),industryWant:w.industryWant}));
}
