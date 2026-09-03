// Controlled capacity/topology fixture, NOT a naturally saturated village.
// Keeps the existing population; no assign command, instant construction,
// shortened construction duration, or forced labor during the measured run.
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld } from '../sim/index.js';
import { evaluateFoundingPetitions, applyFoundingDecision } from '../sim/founding.js';
import { canWork } from '../sim/education.js';
import { TILE } from '../sim/map.js';
import { findNonFinite } from '../sim/serialize.js';

const w=createWorld(Number(process.argv[2]??32));
w.plots=[];w.projects=[];w.zoneOrders=[];
for(const f of w.map.facilities)if(['house','apartment'].includes(f.type)){
  const n=w.sims.filter(s=>s.homeId===f.id).length;f.resources=f.resources.slice(0,n);
}
for(const s of w.sims){s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;}
for(const t of [0,1440,2880])evaluateFoundingPetitions(w,t,()=>{});
w.map.tiles.fill(TILE.GRASS);w.map.reachVersion=(w.map.reachVersion??0)+1;
w.villages[0].center={x:20,y:20};w.plots=[{plotId:1,x:80,y:80,used:false}];
w.treasury=100000;w.worldTick=3000;w.lastDailyDay=2;w.lastPlanDay=2;
const population=w.sims.length,homes=w.sims.map(s=>s.homeId),startTick=w.worldTick;
assert.deepEqual(findNonFinite(w),[]);
applyFoundingDecision(w,{petitionId:0,decision:'approve',name:'새솔',homePlotIds:[1]},startTick,()=>{});
assert.equal(w.founding.petitions[0].status,'approved');
let starts=0,built=0,ineligibleWork=0;
for(let i=0;i<30*1440;i++){
  for(const e of tick(w)){
    if(e.type==='action_started'&&e.payload.action==='construct'){
      starts++;const sim=w.sims.find(s=>s.id===e.simId);if(!sim||!canWork(sim))ineligibleWork++;
    }
    if(e.type==='founding_homes_built')built++;
  }
  if(built||w.founding.petitions[0].status==='cancelled')break;
}
assert.equal(built,1,'existing residents must autonomously complete construction within 30 days');
assert.equal(ineligibleWork,0);assert.equal(w.sims.length,population);
assert.deepEqual(w.sims.map(s=>s.homeId),homes,'construction alone cannot teleport residents into the new home');
assert.equal(w.villages.length,1,'construction is not settlement establishment');
assert.deepEqual(findNonFinite(w),[]);
console.log(JSON.stringify({fixture:'controlled capacity and terrain',seed:w.seed,startTick,endTick:w.worldTick,
  elapsedDays:(w.worldTick-startTick)/1440,status:w.founding.petitions[0].status,starts,built,ineligibleWork,
  population:w.sims.length,workers:w.founding.petitions[0].plan.settlerIds,hash:hashWorld(w)},null,2));
