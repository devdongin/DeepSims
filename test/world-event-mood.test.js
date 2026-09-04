import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../sim/world.js';
import {tick,moodBaseline} from '../sim/tick.js';
import {serialize,deserialize} from '../sim/serialize.js';
import {applyWorldEvent,validateWorldEvent} from '../sim/world-events.js';
import {emptyState} from '../sim/simfactory.js';
const event=(delta,durationTicks=10)=>({effect:'mood',delta,durationTicks});

test('mood shock uses a bounded signed value and same-channel replacement applies only the difference',()=>{
  for(const p of [event(3001),event(-3001),event(NaN),event(1.5),{...event(1),percent:100}])
    assert.equal(validateWorldEvent(p).ok,false);
  const w=createWorld(32),s=w.sims[0];s.mood=0;s.pendingMood=100;
  const original=serialize(w.logic),rng=serialize(w.rngSim);
  const baseline=moodBaseline(s,w,w.logic,1);
  applyWorldEvent(w,event(-2000),1,()=>{});
  assert.equal(s.mood,-2000);assert.equal(s.pendingMood,-1900);
  assert.equal(moodBaseline(s,w,w.logic,1),baseline-2000);
  applyWorldEvent(w,event(-2000),2,()=>{});
  assert.equal(s.mood,-2000);
  applyWorldEvent(w,event(1000),3,()=>{});
  assert.equal(s.mood,1000);assert.equal(s.pendingMood,1100);
  assert.equal(moodBaseline(s,w,w.logic,13),baseline);
  assert.equal(serialize(w.logic),original);assert.equal(serialize(w.rngSim),rng);
});

test('mood shock tick execution and exclusive expiry replay identically through a save',()=>{
  const w=createWorld(32);
  const events=tick(w,[{sequence:0,command:'world_event',payload:event(-2000,10)}]);
  assert.ok(events.some(e=>e.type==='world_event_started'&&e.payload.delta===-2000));
  const copy=deserialize(serialize(w));
  let expired=0;
  for(let i=0;i<15;i++){
    const a=tick(w),b=tick(copy);assert.deepEqual(a,b);
    expired+=a.filter(e=>e.type==='world_event_expired').length;
    assert.ok(w.sims.every(s=>s.mood>=-10000&&s.mood<=10000));
  }
  assert.equal(expired,1);assert.deepEqual(w.worldEvents,[]);
  assert.equal(serialize(copy),serialize(w));
});

test('mood shock changes an actual autonomous action from volunteering to coping',()=>{
  const base=createWorld(32),s=base.sims[0];
  base.worldTick=600;base.lastDailyDay=0;base.lastPlanDay=0;
  s.traits.age=30;s.traits.occupation='office_worker';s.education.course=null;
  s.mood=0;s.money=10000;s.state=emptyState();
  s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  const affected=deserialize(serialize(base));
  const normal=tick(base,[{sequence:0,command:'world_event',payload:event(0,100)}]);
  const shock=tick(affected,[{sequence:0,command:'world_event',payload:event(-3000,100)}]);
  const action=events=>events.find(e=>e.simId===s.id&&e.type==='action_started')?.payload.action;
  assert.equal(action(normal),'volunteer');assert.equal(action(shock),'hole_up');
  const replay=deserialize(serialize(affected));
  for(let i=0;i<200;i++)assert.deepEqual(tick(replay),tick(affected));
  assert.equal(serialize(replay),serialize(affected));
});
