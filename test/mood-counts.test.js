import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,migrateWorld,findNonFinite} from '../sim/index.js';
import {logicHash} from '../sim/logic.js';
import {refreshMoodCounts} from '../sim/mood-counts.js';
import {recordFact,runReflection} from '../sim/cognition.js';
import {SCHEMA_VERSION} from '../sim/constants.js';

function check(w){
  for(const s of w.sims){
    const expected={relTiers:s.relTiers,habit:s.habit};refreshMoodCounts(expected,w.logic);
    for(const key of ['friendCount','rivalCount','habitCount'])assert.equal(s[key],expected[key],`${s.id}:${key}`);
  }
}
test('main schema68 and branch schema72 both migrate to complete municipal and cached mood state',()=>{
  for(const from of [68,72]){
    const w=createWorld(32),s=w.sims[0];w.schemaVersion=from;
    s.relTiers={1:'friend',2:'rival'};s.habit={'read:library':100000000000,'work:office':100000000000};
    delete s.friendCount;delete s.rivalCount;delete s.habitCount;
    if(from===68){delete w.founding;for(const v of w.villages)delete v.government;w.logic.logicSchemaVersion=66;}
    const map=serialize(w.map),rng=serialize(w.rngSim),funds=w.treasury;
    migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);assert.ok(w.founding);
    assert.equal(serialize(w.map),map);assert.equal(serialize(w.rngSim),rng);assert.equal(w.treasury,funds);check(w);
    const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
    tick(w);assert.deepEqual(findNonFinite(w),[]);
  }
});
test('accepted threshold changes refresh cached counts before the same tick; rejected changes do not',()=>{
  const w=createWorld(32),s=w.sims[0];w.lastDailyDay=0;w.lastPlanDay=0;
  s.habit={'read:library':10,'work:office':100};refreshMoodCounts(s,w.logic);
  const p=structuredClone(w.logic);p.club.habitMin=5;
  const input={sequence:0,command:'logic_update',payload:{params:p,hash:logicHash(p),revision:1}};
  const saved=deserialize(serialize(w));assert.deepEqual(tick(w,[input]),tick(saved,[input]));
  assert.equal(s.habitCount,1);check(w);assert.equal(hashWorld(w),hashWorld(saved));
  const bad=structuredClone(p);bad.club.habitMin=20;
  tick(w,[{...input,payload:{params:bad,hash:'invalid',revision:2}}]);assert.equal(s.habitCount,1);
  tick(w,[{...input,payload:{params:bad,hash:logicHash(bad),revision:2}}]);assert.equal(s.habitCount,0);check(w);
});
test('reflection counts downward cap crossings and zero-threshold new habits exactly once',()=>{
  for(const zero of [false,true]){
    const w=createWorld(32),s=w.sims[0],L=w.logic;
    L.club.habitMin=zero?0:5;L.social.habitCap=3;L.social.habitIncrement=1;
    s.habit=zero?{}:{'socialize:cafe':6};refreshMoodCounts(s,L);
    for(let i=0;i<L.social.habitMinRepeats;i++)recordFact(s,1440,L,'small_talk',{placeId:'cafe',tags:['socialize']});
    runReflection(w,s,1441,()=>{});check(w);assert.equal(s.habitCount,zero?1:0);
    runReflection(w,s,2880,()=>{});check(w);assert.equal(s.habitCount,zero?1:0);
  }
});
test('real relationship and habit transitions keep cached counts equal to dictionary scans for three days',()=>{
  const w=createWorld(32);
  for(let i=0;i<3*1440;i++){tick(w);check(w);}
});
