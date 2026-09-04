import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize,tick,advance,migrateWorld} from '../sim/index.js';
import {collectCandidates} from '../sim/tick.js';
import {updateEmployment,employerAllows} from '../sim/employer-assignment.js';
import {TILE} from '../sim/map.js';
import {makeRng} from '../sim/prng.js';
import {pfStats} from '../sim/pathfind.js';
import {Storage} from '../db/storage.js';

function fixture(){
  const w=createWorld(32),s=w.sims[0];w.sims=[s];
  w.map={w:40,h:12,tiles:Array(480).fill(TILE.GRASS),reachVersion:0,facilities:[]};
  const f=(id,type,x)=>({id,type,door:{x,y:4},resources:[{id:`${id}:seat`,x,y:4}]});
  w.map.facilities=[f('home','house',1),f('near','cafe',4),f('far','cafe',30)];
  s.homeId='home';s.traits.age=25;s.traits.occupation='barista';s.education.course=null;
  s.employment=null;s.employmentSearch=null;w.rngSim=makeRng(1);
  return {w,s};
}
test('employment uses one inverse home-distance draw per facility and then stays fixed',()=>{
  const {w,s}=fixture(),events=[];
  updateEmployment(w,1,(...e)=>events.push(e));
  const row=events[0][2];
  assert.equal(row.candidateCount,2);assert.equal(row.totalWeight,283333);
  assert.equal(row.weight,row.facilityId==='far'?33333:250000);
  assert.equal(row.distance,row.facilityId==='far'?29:3);
  assert.equal(typeof row.draw,'number');
  const employer=s.employment.facilityId,rng={...w.rngSim};
  s.x=30;s.y=4;w.map.facilities.find(f=>f.id!==employer&&f.type==='cafe').revenue=1000000;
  for(let day=1;day<5;day++)updateEmployment(w,day*1440,()=>assert.fail('employment must persist'));
  assert.equal(s.employment.facilityId,employer);assert.deepEqual(w.rngSim,rng);
  assert.equal(employerAllows(w,s,employer),true);
  assert.equal(employerAllows(w,s,employer==='near'?'far':'near'),false);
});
test('facility order and duplicated seats do not change employer or RNG',()=>{
  const {w}=fixture(),copy=deserialize(serialize(w));
  copy.map.facilities.reverse();copy.map.facilities.find(f=>f.id==='far').resources.push(...Array(100).fill({id:'extra',x:30,y:4}));
  const a=[],b=[];updateEmployment(w,1,(...e)=>a.push(e));updateEmployment(copy,1,(...e)=>b.push(e));
  assert.deepEqual(a,b);assert.deepEqual(w.rngSim,copy.rngSim);
});
test('students and minors have no employer; removed jobs reassign and unreachable jobs cannot win',()=>{
  const {w,s}=fixture();updateEmployment(w,1,()=>{});
  s.traits.occupation='student';updateEmployment(w,2,()=>{});assert.equal(s.employment,null);
  s.traits.occupation='barista';s.education.course='masters';s.education.completed=false;
  updateEmployment(w,3,()=>{});assert.equal(s.employment,null);
  s.education.course=null;s.traits.age=18;updateEmployment(w,4,()=>{});assert.equal(s.employment,null);
  s.traits.age=19;
  for(let y=0;y<12;y++)w.map.tiles[y*40+15]=TILE.WATER;
  w.map.reachVersion++;
  const rng={...w.rngSim};updateEmployment(w,5,()=>{});
  assert.equal(s.employment.facilityId,'near');assert.deepEqual(w.rngSim,rng);
  w.map.facilities=w.map.facilities.filter(f=>f.id!=='near');updateEmployment(w,6,()=>{});
  assert.equal(s.employment,null);
});
test('employment and no-vacancy search retry survive serialization without consuming migration draws',()=>{
  const {w}=fixture(),copy=deserialize(serialize(w));
  updateEmployment(w,1,()=>{});updateEmployment(copy,1,()=>{});
  assert.equal(serialize(w),serialize(copy));
  const resumed=deserialize(serialize(w));
  updateEmployment(w,1440,()=>{});updateEmployment(resumed,1440,()=>{});
  assert.equal(serialize(w),serialize(resumed));
});

test('actual work candidates and completed wages stay at the employer across save replay',()=>{
  const {w,s}=fixture();w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;
  s.x=1;s.y=4;s.money=0;s.needs={hunger:10000,energy:10000,social:10000,fun:10000};
  for(const f of w.map.facilities)f.revenue=100000;
  const first=tick(w),employer=s.employment.facilityId;
  const candidates=collectCandidates(w,s,['work'],w.worldTick,true);
  assert.ok(candidates.length);assert.ok(candidates.every(c=>c.facilityId===employer));
  const resumed=deserialize(serialize(w));
  const a=advance(w,{},360),b=advance(resumed,{},360);
  assert.deepEqual(a,b);assert.equal(serialize(w),serialize(resumed));
  const work=[...first,...a].filter(e=>e.type==='action_completed'&&e.payload.action==='work');
  assert.ok(work.length,'must complete real work, not only assign a label');
  assert.ok(work.every(e=>e.payload.facilityId===employer));
  assert.ok(s.money>0,'actual paid work must use the existing wage path');
});

test('becoming a student cancels old work before movement or wages; migration consumes no RNG',()=>{
  const {w,s}=fixture();w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;updateEmployment(w,1,()=>{});
  s.state={...s.state,kind:'performing',action:'work',facilityId:s.employment.facilityId,
    resourceId:`${s.employment.facilityId}:seat`,ticksLeft:1};
  const money=s.money;s.traits.occupation='student';
  const events=tick(w);
  assert.equal(s.employment,null);assert.equal(s.money,money);
  assert.ok(!events.some(e=>e.type==='action_completed'&&e.payload.action==='work'));
  const legacy=deserialize(serialize(w));legacy.schemaVersion=75;
  delete legacy.sims[0].employment;delete legacy.sims[0].employmentSearch;
  const rng={...legacy.rngSim};migrateWorld(legacy);
  assert.equal(legacy.schemaVersion,76);assert.equal(legacy.sims[0].employment,null);
  assert.deepEqual(legacy.rngSim,rng);
});

test('first-tick work input finds the assigned employer without a warm-up tick',()=>{
  const {w,s}=fixture();w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;
  s.x=1;s.y=4;
  const events=tick(w,[{sequence:1,command:'assign',payload:{simId:s.id,actionType:'work'}}]);
  assert.ok(!events.some(e=>e.type==='input_rejected'));
  const started=events.find(e=>e.type==='action_started'&&e.payload.action==='work');
  assert.ok(started);assert.equal(started.payload.facilityId,s.employment.facilityId);
});

test('same-tick daily resignation cannot leave a stale employer in the save',()=>{
  const {w,s}=fixture();updateEmployment(w,1,()=>{});
  w.worldTick=1439;w.lastDailyDay=0;w.lastPlanDay=1;
  s.unpaidDays=3;
  const events=tick(w);
  assert.ok(events.some(e=>e.type==='job_changed'&&e.payload.to==='jobless'));
  assert.equal(s.traits.occupation,'jobless');assert.equal(s.employment,null);
  assert.ok(events.some(e=>e.type==='employment_ended'));
});

test('shared-home assignment measures each destination once and retained jobs never repeat BFS',()=>{
  const {w,s}=fixture();
  w.sims=Array.from({length:20},(_,id)=>({...deserialize(serialize(s)),id}));
  const before=pfStats.calls;updateEmployment(w,1,()=>{});
  assert.equal(pfStats.calls-before,2);
  w.map.reachVersion++;
  updateEmployment(w,1440,()=>{});updateEmployment(w,2880,()=>{});
  assert.equal(pfStats.calls-before,2,'a day/network version change does not rerun valid-employer searches');
});

test('retired residents never receive a fictional paid employer',()=>{
  const {w,s}=fixture();s.traits.occupation='retired';
  const rng={...w.rngSim};updateEmployment(w,1,()=>assert.fail('no employer for retirement'));
  assert.equal(s.employment,null);assert.deepEqual(w.rngSim,rng);
});

test('many candidate employers retain all choices while keeping real stored event payloads below 1KB',()=>{
  const {w}=fixture(),template=w.map.facilities.find(f=>f.id==='near');
  for(let i=0;i<100;i++)w.map.facilities.push({...template,id:`extra${i}`});
  const events=[];updateEmployment(w,1,(type,simId,payload)=>events.push({tick:1,ordinal:events.length,type,simId,payload}));
  assert.equal(events[0].payload.candidateCount,102);
  assert.ok(Buffer.byteLength(JSON.stringify(events[0].payload),'utf8')<=1024);
  w.worldTick=1;const st=new Storage(':memory:');
  try{
    st.loadOrCreate({seed:32,nowUtcMs:1000});
    st.commitBatch({world:w,events,appliedInputIds:[],epochUtcMs:1000});
    assert.equal(st.db.prepare('SELECT count(*) AS n FROM events').get().n,events.length);
  }finally{st.close();}
});

test('same-tick work commands assign only their targets in authoritative input sequence order',()=>{
  const {w,s}=fixture();w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;s.x=1;s.y=4;
  // Use an existing matrix index from createWorld; this test is about command
  // order, not dynamic population/matrix expansion.
  const other=structuredClone(s);other.id=1;w.sims.push(other);
  const inputs=[{sequence:2,command:'assign',payload:{simId:s.id,actionType:'work'}},
    {sequence:1,command:'assign',payload:{simId:other.id,actionType:'work'}}];
  const saved=deserialize(serialize(w)),events=tick(w,inputs);
  assert.deepEqual(events,tick(saved,inputs.toReversed()));assert.equal(serialize(w),serialize(saved));
  assert.deepEqual(events.filter(e=>e.type==='employment_started').map(e=>e.simId),[other.id,s.id]);
});
