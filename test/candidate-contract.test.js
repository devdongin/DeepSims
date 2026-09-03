import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateContract } from '../bench/candidate-contract.js';
import { createWorld } from '../sim/world.js';
import { collectCandidates } from '../sim/tick.js';

// Captured from unoptimized 328458d, not regenerated after the optimization.
for (const [pop, expected] of [
  [10, ['7e987d33', '478b3b6a', 'cfb70613', '2fa36c30']],
  [50, ['5c93dd7d', 'da40b3d7', '28f8b23c', '1c512401']],
  [200, ['ce050617', '9c7c4bba', 'a72b7412', 'c34ec4fd']],
]) {
  test(`#97 pre-optimization ordered candidates, choices, events and world: population ${pop}`, () => {
    assert.deepEqual(Object.values(candidateContract(pop)), expected);
  });
}

test('#97 full facilities never prepare irrelevant memories; self-held seats remain usable', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  for (const f of w.map.facilities) for (const r of f.resources) w.reservations[`${f.id}:${r.id}`] = 99999;
  const ctx = { urgency: true, get prep() { throw new Error('full facility prepared memories'); } };
  assert.deepEqual(collectCandidates(w, sim, ['eat'], 1, true, ctx), []);
  const cafe = w.map.facilities.find(f => f.type === 'cafe');
  const res = cafe.resources[0], key = `${cafe.id}:${res.id}`;
  w.reservations[key] = sim.id;
  assert.equal(collectCandidates(w, sim, ['eat'], 1, true).length, 1);
  sim.noPathCool[key] = 2;
  assert.equal(collectCandidates(w, sim, ['eat'], 1, true).length, 0);
  assert.equal(collectCandidates(w, sim, ['eat'], 2, true).length, 1);
  w.reservations[key] = 99999;
  assert.equal(collectCandidates(w, sim, ['eat'], 2, true).length, 0);
});

test('#97 mall resource-kind filters are not shared between actions', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  const source = w.map.facilities.find(f => f.type === 'cafe');
  w.map.facilities.push({ ...source, id: 'test-mall', type: 'mall', resources: [
    { id: 'till', kind: 'till', x: sim.x, y: sim.y },
    { id: 'seat', kind: 'seat', x: sim.x, y: sim.y },
  ] });
  for (const actions of [['shop', 'play'], ['play', 'shop']]) {
    const c = collectCandidates(w, sim, actions, 1, true).filter(c => c.facilityId === 'test-mall');
    assert.deepEqual(c.map(c => [c.action, c.resourceId]), actions.map(a => [a, a === 'shop' ? 'till' : 'seat']));
  }
});

test('#97 each real resource reservation is read once per decision, not once per action', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  const once = collectCandidates(w, sim, ['eat'], 1, true);
  const reads = new Map();
  w.reservations = new Proxy({}, { get(target, key) {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return target[key];
  } });
  const twice = collectCandidates(w, sim, ['eat', 'eat'], 1, true);
  assert.deepEqual(twice, [...once, ...once]);
  assert.ok(reads.size > 0);
  assert.ok([...reads.values()].every(n => n === 1));
});
