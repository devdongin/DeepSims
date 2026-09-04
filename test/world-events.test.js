import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorldEvent, expireWorldEvents, worldEventPercent, validateWorldEvent } from '../sim/world-events.js';
import { serialize, deserialize } from '../sim/serialize.js';

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
