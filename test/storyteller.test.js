import { test } from 'node:test';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { dailyDiseaseDraws, dailyFireDraws, naturalRecovery, fireSelfOut } from '../sim/society.js';
import { makeStoryteller, resolveStoryCandidates } from '../sim/storyteller.js';

const emit = () => {};
const candidate = (kind, targetId, apply = () => {}) => ({ kind, targetId, apply });

test('#89 minimum gap includes the boundary and chooses at most one candidate', () => {
  const w = createWorld(89); let count = 0;
  const pool = [candidate('illness', 0, () => count++), candidate('fire', 'house0', () => count++)];
  assert.equal(resolveStoryCandidates(w, 0, pool, emit).reason, 'applied');
  assert.equal(count, 1);
  assert.equal(resolveStoryCandidates(w, 1440, pool, emit).reason, 'minimum_gap');
  assert.equal(count, 1);
  assert.equal(resolveStoryCandidates(w, 2880, pool, emit).reason, 'applied');
  assert.equal(count, 2);
});

test('#89 unresolved prior illness delays new hazards until actual recovery', () => {
  const w = createWorld(89), patient = w.sims[0];
  w.storyteller.lastEvent = { day: 0, kind: 'illness', targetId: patient.id };
  patient.sick = { kind: 'cold', untilTick: 5000 };
  const pool = [candidate('fire', 'house0')];
  assert.equal(resolveStoryCandidates(w, 2880, pool, emit).reason, 'recovering');
  assert.ok(patient.sick, 'director does not heal');
  naturalRecovery(w, patient, 5000, emit);
  assert.equal(resolveStoryCandidates(w, 5760, pool, emit).reason, 'applied');
});

test('#89 unresolved fire waits for existing natural/response resolution', () => {
  const w = createWorld(89); w.storyteller.lastEvent = { day: 0, kind: 'fire', targetId: 'house0' };
  w.incidents.push({ type: 'fire', facilityId: 'house0', sinceTick: 2500 });
  const pool = [candidate('illness', 0)];
  assert.equal(resolveStoryCandidates(w, 2880, pool, emit).reason, 'recovering');
  assert.equal(w.incidents.length, 1);
  fireSelfOut(w, 5000, emit);
  assert.equal(resolveStoryCandidates(w, 5760, pool, emit).reason, 'applied');
});

test('#89 recent density uses a bounded day window and resumes when the oldest event expires', () => {
  const w = createWorld(89); w.logic.storyteller.minGapDays = 1;
  const pool = [candidate('illness', 0)];
  for (const day of [0, 1, 2]) assert.equal(resolveStoryCandidates(w, day * 1440, pool, emit).reason, 'applied');
  assert.equal(resolveStoryCandidates(w, 6 * 1440, pool, emit).reason, 'recent_density');
  assert.equal(resolveStoryCandidates(w, 7 * 1440, pool, emit).reason, 'applied');
  assert.equal(w.storyteller.recent.length, 3);
});

test('#89 hash ordering ignores candidate input order, treasury and population wealth', () => {
  const a = createWorld(89), b = createWorld(89), rng = serialize(a.rngSim);
  b.treasury = 999999999; for (const s of b.sims) s.money = 999999;
  const pool = [candidate('illness', 0), candidate('fire', 'house0'), candidate('illness', 4)];
  assert.deepEqual(resolveStoryCandidates(a, 1440, pool, emit), resolveStoryCandidates(b, 1440, [...pool].reverse(), emit));
  assert.equal(serialize(a.rngSim), rng); assert.equal(serialize(b.rngSim), rng);
});

test('#89 candidate collection retains every original disease/fire RNG draw without applying hazards', () => {
  const a = createWorld(89), b = deserialize(serialize(a));
  for (const w of [a, b]) { w.logic.disease.basePermille = 1000; w.logic.incidents.fireBasePermille = 1000; }
  dailyDiseaseDraws(a, 1, emit); dailyFireDraws(a, 1, emit);
  const pool = []; dailyDiseaseDraws(b, 1, emit, c => pool.push(c)); dailyFireDraws(b, 1, emit, c => pool.push(c));
  assert.equal(serialize(a.rngSim), serialize(b.rngSim));
  assert.equal(b.sims.some(s => s.sick), false); assert.equal(b.incidents.length, 0);
  assert.ok(pool.some(c => c.kind === 'illness') && pool.some(c => c.kind === 'fire'));
  resolveStoryCandidates(b, 1, pool, emit);
  assert.equal(b.sims.filter(s => s.sick).length + b.incidents.length, 1);
  assert.equal(serialize(a.rngSim), serialize(b.rngSim));
});

test('#89 empty pools do not fabricate events, and decision history is capped at 14 days', () => {
  const w = createWorld(89);
  for (let day = 0; day < 20; day++) assert.equal(resolveStoryCandidates(w, day * 1440, [], emit).reason, 'empty_pool');
  assert.equal(w.storyteller.lastEvent, null); assert.equal(w.storyteller.history.length, 14);
  assert.equal(w.storyteller.history[0].day, 6);
});

test('#89 v61 migration installs empty pacing state and logic defaults without RNG', () => {
  const w = createWorld(89), rng = serialize(w.rngSim); w.schemaVersion = 61;
  w.logic.logicSchemaVersion = 57; delete w.logic.storyteller; delete w.storyteller;
  migrateWorld(w);
  assert.equal(w.schemaVersion,65); assert.equal(w.logic.logicSchemaVersion, DEFAULT_LOGIC.logicSchemaVersion);
  assert.deepEqual(w.storyteller, makeStoryteller()); assert.equal(serialize(w.rngSim), rng);
});

test('#89 split execution preserves hazard pacing, events and the complete world hash', () => {
  const a = createWorld(89); for (let i = 0; i < 1441; i++) tick(a);
  const b = deserialize(serialize(a));
  for (let i = 0; i < 1500; i++) assert.deepEqual(tick(a), tick(b));
  assert.equal(hashWorld(a), hashWorld(b)); assert.equal(a.storyteller.history.length, 3);
});
