import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize,hashWorld} from '../sim/index.js';
import {maybeDeaths,maybeEmigration} from '../sim/society.js';
import {newGovernment,publicBalance} from '../sim/government.js';

const money=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
for(const removal of ['death','emigration'])test(`${removal} records departing cash exactly once without changing survivor funds or RNG`,()=>{
  for(const cash of [0,267,10000]){
    const w=createWorld(32);
    w.villages.push({id:'village:1',name:'새솔',center:{x:80,y:80},government:newGovernment()});
    for(const s of w.sims){s.traits.age=20;s.sick=null;s.hungerZeroTicks=0;s.mood=0;s.memories=[];}
    const subject=w.sims[0];subject.money=cash;subject.villageId='village:1';subject.isPlayer=false;
    if(removal==='death'){subject.traits.age=200;subject.sick={kind:'fixture'};subject.hungerZeroTicks=1000000;}
    else{subject.traits.occupation='jobless';subject.mood=-10000;subject.memories=Array.from({length:3},()=>({kind:'unmet',tags:[]}));}
    const before=money(w),out=w.externalOutflow,rng=serialize(w.rngSim),publicCash=publicBalance(w);
    const survivors=w.sims.slice(1).map(s=>({id:s.id,money:s.money})),replay=deserialize(serialize(w)),events=[];
    const fn=removal==='death'?maybeDeaths:maybeEmigration;
    for(let day=1;day<=200;day++){
      const a=[],b=[];fn(w,day*1440,day,(type,simId,payload)=>a.push({type,simId,payload}));
      fn(replay,day*1440,day,(type,simId,payload)=>b.push({type,simId,payload}));
      assert.deepEqual(a,b);assert.equal(money(w),before);events.push(...a);
    }
    const removed=events.filter(e=>e.type===(removal==='death'?'died':'emigrated'));
    assert.equal(removed.length,1);assert.equal(removed[0].simId,subject.id);assert.equal(removed[0].payload.cashOutflow,cash);
    assert.equal(w.externalOutflow,out+cash);assert.equal(publicBalance(w),publicCash);
    assert.deepEqual(w.sims.map(s=>({id:s.id,money:s.money})),survivors);
    assert.equal(serialize(w.rngSim),rng);assert.equal(hashWorld(w),hashWorld(replay));
  }
});
