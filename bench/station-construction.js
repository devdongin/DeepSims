// Real seed world: no terrain/population/needs/treasury/demand edits and no
// forced labor. The sole input is one mayor zone order after actual unlock.
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,findNonFinite} from '../sim/index.js';
import {plotBuildable,zoneFootprint} from '../sim/map.js';
import {canWork} from '../sim/education.js';
import {publicBalance,governmentFor} from '../sim/government.js';

let w=createWorld(Number(process.argv[2]??32));
const resume=process.argv.includes('--resume');
const money=world=>publicBalance(world)+world.sims.reduce((n,s)=>n+s.money,0)
  +world.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+world.externalOutflow-world.externalInflow;
const initialMoney=money(w),fp=zoneFootprint('train_station',0);
let ordered=null,started=null,built=null,resumed=false,noPath=0,constructStarts=0,ineligibleWork=0;
for(let i=0;i<60*1440&&!built;i++){
  let inputs=[];
  if(!ordered&&w.transit.stationUnlocked){
    const busy=new Set([...w.projects,...w.zoneOrders].map(p=>p.plotId));
    const plot=[...w.plots].sort((a,b)=>a.plotId-b.plotId).find(p=>!p.used&&!busy.has(p.plotId)
      &&p.foundingPetitionId==null&&plotBuildable(w.map,p,fp.w,fp.h)
      &&governmentFor(w,p.villageId).treasury>=w.logic.zone.costs.train_station);
    if(plot)inputs=[{sequence:0,command:'zone',payload:{plotId:plot.plotId,type:'train_station',dir:0}}];
  }
  const events=tick(w,inputs);
  if(inputs.length)assert.ok(events.some(e=>e.type==='zoned'&&e.payload.type==='train_station'));
  for(const e of events){
    if(e.type==='zoned'&&e.payload.type==='train_station')ordered={tick:e.tick,...e.payload};
    if(e.type==='project_started'&&e.payload.type==='train_station')started={tick:e.tick,...e.payload};
    if(e.type==='facility_built'&&e.payload.type==='train_station')built={tick:e.tick,...e.payload};
    if(e.type==='action_failed'&&e.payload.reason==='no_path')noPath++;
    if(e.type==='action_started'&&e.payload.action==='construct'){
      constructStarts++;if(!canWork(w.sims.find(s=>s.id===e.simId)))ineligibleWork++;
    }
  }
  assert.equal(money(w),initialMoney,'every real tick conserves closed money');
  const project=w.projects.find(p=>p.type==='train_station');
  if(resume&&!resumed&&project&&project.progress>=Math.floor(project.required/2)){
    w=deserialize(serialize(w));resumed=true;
  }
}
assert.ok(ordered&&started&&built,'one demand-unlocked mayor order must finish within60 days');
assert.equal(ineligibleWork,0);assert.ok(started.required>=18000,'normal20000 labor minus at most the mayor discount');
if(resume)assert.ok(resumed,'resume occurs during real construction');
assert.deepEqual(findNonFinite(w),[]);
console.log(JSON.stringify({seed:w.seed,fixture:'unmodified seed world; one paid mayor station order after actual demand unlock',
  endTick:w.worldTick,unlockedDay:w.transit.unlockedDay,ordered,started,built,constructStarts,ineligibleWork,noPath,
  population:w.sims.length,closedMoney:initialMoney,hash:hashWorld(w)},null,2));
