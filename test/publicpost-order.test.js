import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize,hashWorld} from '../sim/index.js';
import {fillPublicPosts,trimOverQuotaPosts} from '../sim/publicposts.js';

for(const trim of [false,true])test(`public ${trim?'trimming':'hiring'} preserves priority across reversed keys and canonical save`,()=>{
  const w=createWorld(32);
  for(const [i,s] of w.sims.entries()){
    s.traits.age=30;s.education.course=null;
    s.traits.occupation=trim?(i%2?'doctor':'teacher'):'jobless';
  }
  for(const spec of Object.values(w.logic.economy.publicPosts)){spec.minPop=trim?1000:0;spec.per=100;}
  const saved=deserialize(serialize(w)),reversed=structuredClone(w);
  reversed.logic.economy.publicPosts=Object.fromEntries(Object.entries(reversed.logic.economy.publicPosts).reverse());
  const fn=trim?trimOverQuotaPosts:fillPublicPosts,results=[];
  for(const world of [w,saved,reversed]){
    const rng=serialize(world.rngSim),events=[];
    const count=fn(world,(type,simId,payload)=>events.push({type,simId,payload}));
    assert.ok(count>0);assert.equal(serialize(world.rngSim),rng);
    results.push({events,hash:hashWorld(world)});
  }
  assert.deepEqual(results[0],results[1]);assert.deepEqual(results[0],results[2]);
  if(!trim)assert.deepEqual(results[0].events.map(e=>e.payload.to),
    ['civil_servant','teacher','doctor','police','nurse','firefighter','politician']);
});
