import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorldEvent, expireWorldEvents, worldEventPercent, validateWorldEvent } from '../sim/world-events.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { migrateWorld } from '../sim/migrate.js';
import { dailyDiseaseDraws, contagionDraw, maybeImmigration } from '../sim/society.js';
import { publicBalance } from '../sim/government.js';
import { addBuilding, plotBuildable } from '../sim/map.js';
import { SCHEMA_VERSION } from '../sim/constants.js';

const payload = { effect: 'disease', percent: 200, durationTicks: 10 };
test('world event allowlist rejects malformed and unbounded inputs without mutation', () => {
  for (const p of [null, [], {}, { ...payload, effect: '__proto__' },
    { ...payload, money: 100 }, { ...payload, percent: NaN },
    { ...payload, percent: -1 }, { ...payload, percent: 301 },
    { ...payload, durationTicks: 0 }, { ...payload, durationTicks: 43201 },
    { ...payload, durationTicks: 1.5 }]) {
    const world = {}, events = [];
    assert.equal(validateWorldEvent(p).ok, false);
    assert.equal(applyWorldEvent(world, p, 1, (...e) => events.push(e)), false);
    assert.deepEqual(world, {});
    assert.equal(events[0][0], 'input_rejected');
  }
});

test('event interval is start-inclusive/end-exclusive with bounded replacement and independent channels', () => {
  const world = {}, events = [], emit = (...e) => events.push(e);
  applyWorldEvent(world, payload, 5, emit);
  assert.equal(worldEventPercent(world, 'disease', 4), 100);
  assert.equal(worldEventPercent(world, 'disease', 5), 200);
  assert.equal(worldEventPercent(world, 'disease', 14), 200);
  assert.equal(worldEventPercent(world, 'disease', 15), 100);
  applyWorldEvent(world, { ...payload, percent: 0 }, 7, emit);
  applyWorldEvent(world, { ...payload, effect: 'immigration' }, 7, emit);
  assert.equal(world.worldEvents.length, 2);
  assert.equal(worldEventPercent(world, 'disease', 7), 0);
  assert.equal(worldEventPercent(world, 'immigration', 7), 200);
  const resumed = deserialize(serialize(world)), replay = [];
  expireWorldEvents(world, 17, emit);
  expireWorldEvents(resumed, 17, (...e) => replay.push(e));
  assert.deepEqual(resumed, world);
  assert.deepEqual(replay, events.slice(-2));
  expireWorldEvents(resumed, 18, (...e) => replay.push(e));
  assert.equal(replay.length, 2);
});

test('disease modifier changes actual infection without extra random draws and respects immunity', () => {
  const base=createWorld(32);
  base.logic.disease.basePermille=1000;
  base.logic.disease.contagionPermille=1000;
  base.sims.forEach(s=>{s.sick=null;s.immuneUntil=0;});
  base.sims[0].immuneUntil=100;
  const suppressed=deserialize(serialize(base));
  applyWorldEvent(suppressed,{...payload,percent:0},1,()=>{});
  dailyDiseaseDraws(base,2,()=>{});
  dailyDiseaseDraws(suppressed,2,()=>{});
  assert.equal(base.sims.filter(s=>s.sick).length,base.sims.length-1);
  assert.equal(suppressed.sims.filter(s=>s.sick).length,0);
  assert.deepEqual(base.rngSim,suppressed.rngSim);
  for(const w of [base,suppressed]){
    w.sims[0].immuneUntil=0;w.sims[0].sick=null;w.sims[1].sick={kind:'cold',untilTick:100};
    contagionDraw(w,w.sims[0],w.sims[1],3,()=>{});
  }
  assert.ok(base.sims[0].sick);assert.equal(suppressed.sims[0].sick,null);
  assert.deepEqual(base.rngSim,suppressed.rngSim);
  dailyDiseaseDraws(suppressed,11,()=>{});
  assert.ok(suppressed.sims[0].sick,'base disease returns at exclusive expiry');
});

test('immigration modifier uses existing bed eligibility and external-money accounting, not direct population creation', () => {
  const closed=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
    -(w.externalInflow??0)+(w.externalOutflow??0);
  const base=createWorld(32);
  const plot=base.plots.find(p=>plotBuildable(base.map,p,7,5));
  const house=addBuilding(base.map,'house',plot);house.villageId=base.villages[0].id;
  const normal=deserialize(serialize(base)), stopped=deserialize(serialize(base));
  const t=base.logic.society.immigrationIntervalDays*1440;
  const events=[];
  applyWorldEvent(stopped,{effect:'immigration',percent:0,durationTicks:10},t,()=>{});
  maybeImmigration(normal,t,t/1440,(...e)=>events.push(e));
  maybeImmigration(stopped,t,t/1440,()=>{});
  assert.ok(events.some(e=>e[0]==='immigrated'));
  assert.equal(stopped.sims.length,base.sims.length);
  assert.equal(closed(normal),closed(base));
  const full=deserialize(serialize(base));
  for(const f of full.map.facilities)if(['house','apartment'].includes(f.type))
    f.resources=f.resources.slice(0,full.sims.filter(s=>s.homeId===f.id).length);
  applyWorldEvent(full,{effect:'immigration',percent:300,durationTicks:10},t,()=>{});
  maybeImmigration(full,t,t/1440,()=>{});
  assert.equal(full.sims.length,base.sims.length);
});

test('tick applies sequence order, restores at expiry and resumes exactly through a saved active event', () => {
  const world=createWorld(32);
  const events=tick(world,[
    {sequence:2,command:'world_event',payload:{...payload,percent:0}},
    {sequence:1,command:'world_event',payload},
  ]);
  assert.equal(events.filter(e=>e.type==='world_event_started').length,2);
  assert.equal(worldEventPercent(world,'disease',1),0);
  const resumed=migrateWorld(deserialize(serialize(world)));
  for(let i=0;i<12;i++)assert.deepEqual(tick(resumed),tick(world));
  assert.deepEqual(serialize(resumed),serialize(world));
  assert.deepEqual(world.worldEvents,[]);
  const old=createWorld(32);old.schemaVersion=74;delete old.worldEvents;
  const before=serialize(old);migrateWorld(old);
  const expected=deserialize(before);expected.schemaVersion=SCHEMA_VERSION;expected.worldEvents=[];
  assert.equal(serialize(old),serialize(expected));
  for(const missing of [undefined,null]){
    const current=deserialize(serialize(old));current.worldEvents=missing;
    assert.deepEqual(migrateWorld(current).worldEvents,[]);
  }
});

test('world_event durable input is deduplicated and recovered before and after application',async()=>{
  const {Storage}=await import('../db/storage.js');
  const {Engine}=await import('../server/engine.js');
  const st=new Storage(':memory:');
  try{
    const engine=new Engine(st,{seed:32,now:()=>1000});
    const input={clientInputId:'world-event-once',command:'world_event',payload};
    const accepted=await engine.submitInput(input);
    assert.equal(accepted.duplicate,false);
    assert.equal((await engine.submitInput(input)).duplicate,true);
    const resumed=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(resumed.runLive(1).events.filter(e=>e.type==='world_event_started').length,1);
    const after=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(serialize(after.world),serialize(resumed.world));
    assert.equal(after.runLive(1).events.filter(e=>e.type==='world_event_started').length,0);
  }finally{st.close();}
});
