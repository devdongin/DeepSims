import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../sim/index.js';
import {simView,simStatic,simVolatile,staticKey} from '../server/view.js';
import {resetSimCache,mergeSimBatch} from '../client/sim-stream.js';

test('static keys cover education, potential, personality and municipality changes',()=>{
  const sim=createWorld(32).sims[0],projection=simStatic(sim),key=staticKey(sim);
  const fields=[['villageId','village:other'],['potential',{...sim.potential,intellect:999}],
    ['homeId','other-home'],['householdId','other-household'],
    ['traits',{...sim.traits,mbti:'INFP'}],
    ...['universityEnrolled','universityGraduated','lastStage','tuitionPaid','course','highestDegree','completed']
      .map(k=>['education',{...sim.education,[k]:typeof sim.education[k]==='boolean'?!sim.education[k]:'changed'}])];
  for(const [field,value] of fields){
    const changed={...sim,[field]:value};
    if(JSON.stringify(simStatic(changed))===JSON.stringify(projection))continue;
    assert.notEqual(staticKey(changed),key,field+':'+JSON.stringify(value));
  }
  assert.equal(staticKey({...sim,x:sim.x+1,money:sim.money+1}),key,'volatile changes do not resend static data');
});

test('compact illness and need-tier views retain household statics without exposing internal counters',()=>{
  const sim=createWorld(32).sims[0];sim.sick={kind:'cold',untilTick:999};
  sim.needsTier={level:2,fulfilledTicks:100,deprivedTicks:20,culture:55,visits:{cafe:1}};
  sim.homeId='home-test';sim.householdId='household-test';
  for(const view of [simView(sim),simVolatile(sim)]){
    assert.equal(view.sick,true);assert.deepEqual(view.needsTier,{level:2});
  }
  const statics=simStatic(sim);assert.equal(statics.homeId,'home-test');assert.equal(statics.householdId,'household-test');
  assert.equal(simVolatile(sim).homeId,undefined);assert.equal(simVolatile(sim).householdId,undefined);
  assert.equal(sim.sick.untilTick,999);assert.equal(sim.needsTier.culture,55);
});

test('snapshot plus static/volatile batches reconstruct the full wire view through changes and departures',()=>{
  const world=createWorld(32),cache=new Map(),sent=new Map(),wire=value=>JSON.parse(JSON.stringify(value));
  resetSimCache(cache,wire(world.sims.map(simView)));
  function batch(){
    const statics=[];
    for(const sim of world.sims){const key=staticKey(sim);if(sent.get(sim.id)!==key){sent.set(sim.id,key);statics.push(simStatic(sim));}}
    const result=mergeSimBatch(cache,wire(world.sims.map(simVolatile)),wire(statics));
    assert.deepEqual(result,wire(world.sims.map(simView)));
    assert.equal(cache.size,world.sims.length);return statics;
  }
  assert.equal(batch().length,10);assert.equal(batch().length,0);
  const sim=world.sims[0];sim.villageId='village:other';sim.education.completed=!sim.education.completed;
  assert.equal(batch().length,1);assert.equal(batch().length,0);
  sim.money++;sim.x++;assert.equal(batch().length,0);
  const old=world.sims.pop();batch();assert.equal(cache.has(old.id),false);
  world.sims=[];batch();assert.equal(cache.size,0);
  resetSimCache(cache,[wire(simView(old))]);assert.deepEqual([...cache.keys()],[old.id]);
});

test('projected rail access retains the walking-not-driving flag without transferring a route',()=>{
  const sim=createWorld(32).sims[0];sim.hasCar=true;
  sim.state={kind:'walking',action:'work',facilityId:'office0',path:Array(100).fill({x:1,y:1}),rail:{path:Array(100).fill({x:2,y:2})}};
  for(const view of [simView(sim),simVolatile(sim)]){
    assert.equal(view.state.rail,true);assert.equal(view.state.path,undefined);
    assert.equal(JSON.stringify(view.state).includes('path'),false);
  }
});
