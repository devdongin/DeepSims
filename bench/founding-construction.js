// Controlled capacity/topology fixture, NOT a naturally saturated village.
// Keeps the existing population; no assign command, instant construction,
// shortened construction duration, or forced labor during the measured run.
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld } from '../sim/index.js';
import { evaluateFoundingPetitions, applyFoundingDecision } from '../sim/founding.js';
import { canWork } from '../sim/education.js';
import { TILE } from '../sim/map.js';
import { findNonFinite, serialize, deserialize } from '../sim/serialize.js';

const w=createWorld(Number(process.argv[2]??32));
const settle=process.argv.includes('--settle');
const family=process.argv.includes('--family');
w.plots=[];w.projects=[];w.zoneOrders=[];
if(family){
  const [a,b,child]=w.sims;
  for(const s of [b,child]){s.homeId=a.homeId;s.householdId=a.householdId;}
}
for(const f of w.map.facilities)if(['house','apartment'].includes(f.type)){
  const n=w.sims.filter(s=>s.homeId===f.id).length;
  f.resources=family?Array.from({length:n},(_,i)=>({...f.resources[i%f.resources.length],id:`fixture:${f.id}:${i}`})):f.resources.slice(0,n);
}
for(const s of w.sims){s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;}
if(family){w.sims[2].traits.age=12;w.sims[2].traits.occupation='student';}
for(const t of [0,1440,2880])evaluateFoundingPetitions(w,t,()=>{});
w.map.tiles.fill(TILE.GRASS);w.map.reachVersion=(w.map.reachVersion??0)+1;
w.villages[0].center={x:20,y:20};w.plots=[{plotId:1,x:80,y:80,used:false}];
w.treasury=100000;w.worldTick=3000;w.lastDailyDay=2;w.lastPlanDay=2;
const population=w.sims.length,homes=w.sims.map(s=>s.homeId),startTick=w.worldTick;
assert.deepEqual(findNonFinite(w),[]);
applyFoundingDecision(w,{petitionId:0,decision:'approve',name:'새솔',homePlotIds:[1]},startTick,()=>{});
assert.equal(w.founding.petitions[0].status,'approved');
let starts=0,built=0,founded=0,ineligibleWork=0;
let replay=null;
const replayedPhases=new Set();
for(let i=0;i<30*1440;i++){
  const phase=w.founding.petitions[0].plan.relocation?.phase;
  if(settle&&phase&&!replayedPhases.has(phase)){
    replay=deserialize(serialize(w));replayedPhases.add(phase);
  }
  const previous=new Map(w.sims.map(s=>[s.id,{x:s.x,y:s.y}]));
  const events=tick(w);
  if(replay)assert.deepEqual(events,tick(replay),'saved relocation must replay identical events');
  if(phase==='travelling')for(const r of w.founding.petitions[0].plan.residents){
    const s=w.sims.find(s=>s.id===r.simId),old=previous.get(s.id);
    assert.ok(Math.abs(s.x-old.x)+Math.abs(s.y-old.y)<=1,'relocation cannot teleport or drive ahead of children');
  }
  for(const e of events){
    if(e.type==='action_started'&&e.payload.action==='construct'){
      starts++;const sim=w.sims.find(s=>s.id===e.simId);if(!sim||!canWork(sim))ineligibleWork++;
    }
    if(e.type==='founding_homes_built')built++;
    if(e.type==='village_founded')founded++;
  }
  if((settle?founded:built)||w.founding.petitions[0].status==='cancelled')break;
}
assert.equal(built,1,`existing residents must autonomously complete construction within 30 days: ${JSON.stringify({tick:w.worldTick,petition:w.founding.petitions[0],projects:w.projects,residents:w.sims.map(s=>({id:s.id,homeId:s.homeId,householdId:s.householdId,age:s.traits.age,partner:w.partners[s.id],stage:w.partnerStage[s.id]}))})}`);
assert.equal(ineligibleWork,0);assert.equal(w.sims.length,population);
if(settle){
  assert.deepEqual([...replayedPhases],['gathering','travelling']);
  assert.equal(hashWorld(w),hashWorld(replay),'relocation replay must preserve the entire world');
  assert.equal(founded,1,'existing families must physically settle within 30 days');
  assert.equal(w.villages.length,2);
  for(const r of w.founding.petitions[0].plan.residents){
    const s=w.sims.find(s=>s.id===r.simId),home=w.map.facilities.find(f=>f.id===s.homeId);
    assert.equal(s.villageId,w.villages[1].id);
    assert.deepEqual({x:s.x,y:s.y},home.door);
  }
}else{
  assert.deepEqual(w.sims.map(s=>s.homeId),homes,'construction alone cannot teleport residents into the new home');
  assert.equal(w.villages.length,1,'construction is not settlement establishment');
}
assert.deepEqual(findNonFinite(w),[]);
console.log(JSON.stringify({fixture:'controlled capacity and terrain',seed:w.seed,startTick,endTick:w.worldTick,
  elapsedDays:(w.worldTick-startTick)/1440,status:w.founding.petitions[0].status,starts,built,founded,ineligibleWork,
  population:w.sims.length,workers:w.founding.petitions[0].plan.settlerIds,hash:hashWorld(w)},null,2));
