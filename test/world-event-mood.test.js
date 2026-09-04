import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../sim/world.js';
import {tick,moodBaseline} from '../sim/tick.js';
import {serialize,deserialize} from '../sim/serialize.js';
import {applyWorldEvent,validateWorldEvent} from '../sim/world-events.js';
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
