// Phase 2 테스트: 특성·기분·create_player·logic_update (PLAN §12.1, §14.1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createWorld, advance, tick, hashWorld, serialize, deserialize,
  DEFAULT_LOGIC, logicHash, validateLogic, migrateWorld,
} from '../sim/index.js';
import { Storage } from '../db/storage.js';
import { Engine } from '../server/engine.js';

const SEED = 4242;
const PLAYER = {
  name: '동인', gender: 'M', age: 30,
  mbti: { EI: 25, SN: 75, TF: 25, JP: 75 }, occupation: 'freelancer',
};
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'deepsims-p2-')); }

test('P2-1. 특성 생성 결정성 + 나이-직업 제약', () => {
  const a = createWorld(SEED), b = createWorld(SEED);
  assert.deepEqual(a.sims.map((s) => s.traits), b.sims.map((s) => s.traits));
  for (const s of a.sims) {
    if (s.traits.occupation === 'retired') assert.ok(s.traits.age >= 60);
    if (s.traits.occupation === 'student') assert.ok(s.traits.age <= 25);
  }
});

test('P2-2. persFactor 방향: 극단 E가 극단 I보다 socialize를 선호', () => {
  const w = createWorld(SEED);
  const [e, i] = w.sims;
  e.traits = { ...e.traits, mbti: { EI: 0, SN: 50, TF: 50, JP: 50 }, occupation: 'freelancer', age: 40 };
  i.traits = { ...i.traits, mbti: { EI: 100, SN: 50, TF: 50, JP: 50 }, occupation: 'freelancer', age: 40 };
  for (const s of [e, i]) { s.needs = { hunger: 9000, energy: 9000, social: 6000, fun: 6000 }; s.money = 10000; s.mood = 0; } // 돈 걱정 제거
  for (const s of w.sims.slice(2)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  // 같은 위치에서 비교
  i.x = e.x; i.y = e.y;
  tick(w, []);
  assert.equal(e.state.action, 'socialize', 'E는 수다');
  assert.equal(i.state.action, 'play', 'I는 혼자 놀기');
});

test('P2-3. retired는 work 불가, 직업별 근무 창 적용', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.traits = { ...s.traits, age: 65, occupation: 'retired' };
  s.money = 0;
  const evs = tick(w, [{ sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'work' } }]);
  assert.ok(evs.some((e) => e.type === 'input_rejected' && e.payload.reason === 'no_valid_target'));
  // barista는 07:00(420)에 근무 가능, office_worker는 불가
  const w2 = createWorld(SEED);
  w2.worldTick = 419;
  const [ba, of2] = w2.sims;
  ba.traits = { ...ba.traits, age: 40, occupation: 'barista' };
  of2.traits = { ...of2.traits, age: 40, occupation: 'office_worker' };
  const evs2 = tick(w2, [
    { sequence: 0, command: 'assign', payload: { simId: ba.id, actionType: 'work' } },
    { sequence: 1, command: 'assign', payload: { simId: of2.id, actionType: 'work' } },
  ]);
  assert.equal(ba.state.action, 'work');
  assert.ok(evs2.some((e) => e.type === 'input_rejected' && e.simId === of2.id));
});

test('P2-4. create_player: 생성·중복 거부·범위 거부·결정적 홈 선택', () => {
  const w = createWorld(SEED);
  const evs = tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  assert.ok(evs.some((e) => e.type === 'player_created'));
  const p = w.sims[10];
  assert.equal(p.isPlayer, true);
  assert.equal(p.needs.hunger, 7000 - w.logic.decay.hunger); // 생성(1단계) 후 같은 틱 감쇠(4단계) 반영
  assert.equal(p.money, 1000); // freelancer 고정분
  assert.equal(w.affinity.length, 11);
  assert.equal(w.affinity[0].length, 11);
  // 중복
  const evs2 = tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  assert.ok(evs2.some((e) => e.type === 'input_rejected' && e.payload.reason === 'player_exists'));
  // 범위 위반 (학생 30세)
  const w2 = createWorld(SEED);
  const evs3 = tick(w2, [{ sequence: 0, command: 'create_player', payload: { ...PLAYER, occupation: 'student' } }]);
  assert.ok(evs3.some((e) => e.type === 'input_rejected'));
  // 결정성: 같은 입력 → 같은 해시
  const wa = createWorld(SEED), wb = createWorld(SEED);
  const inp = { 1: [{ sequence: 0, command: 'create_player', payload: PLAYER }] };
  advance(wa, inp, 500); advance(wb, inp, 500);
  assert.equal(hashWorld(wa), hashWorld(wb));
});

test('P2-5. 호감도 비대칭(TF 계수) + 부호 보존 스케일', () => {
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  a.traits = { ...a.traits, mbti: { ...a.traits.mbti, TF: 100 } }; // F: 1.5배
  b.traits = { ...b.traits, mbti: { ...b.traits.mbti, TF: 0 } };   // T: 0.5배
  const park = w.map.facilities.find((f) => f.type === 'park');
  const setup = (sim, spot) => {
    sim.state = { kind: 'performing', action: 'socialize', facilityId: 'park', resourceId: spot.id, path: [], ticksLeft: 30, pairedTicks: 0 };
    sim.x = spot.x; sim.y = spot.y;
    w.reservations[`park:${spot.id}`] = sim.id;
  };
  setup(a, park.resources[0]); setup(b, park.resources[1]);
  for (const s of w.sims.slice(2)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  advance(w, {}, 20);
  const ab = w.affinity[a.id][b.id], ba = w.affinity[b.id][a.id];
  assert.notEqual(ab, 0);
  assert.ok(Math.abs(ab) > Math.abs(ba), `F쪽 변동(${ab})이 T쪽(${ba})보다 커야 함`);
  assert.equal(Math.sign(ab), Math.sign(ba), '부호는 같아야 함 (같은 델타 스트림)');
});

test('P2-6. 기분: starving 델타가 같은 틱 감쇠보다 먼저 적용', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.needs.hunger = 3; s.money = 0; s.mood = 0; // 이번 틱 감쇠(6)로 0 도달 → starving
  s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'starving' && e.simId === 0));
  // -1000 적용 후 감쇠 +5 → -995
  assert.equal(s.mood, -1000 + w.logic.mood.decayPerTick);
});

test('P2-7. logic_update: A→B→A revision 멱등키 + 같은 틱 assign보다 먼저 적용', () => {
  const dir = tmpDir();
  const st = new Storage(path.join(dir, 't.db'));
  st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const A = DEFAULT_LOGIC;
  const B = { ...DEFAULT_LOGIC, mood: { ...DEFAULT_LOGIC.mood, decayPerTick: 9 } };
  const reg = (rev, params, tick_) => st.addInput({
    clientInputId: `logic:${rev}:${logicHash(params)}`, command: 'logic_update',
    payload: { params, hash: logicHash(params), revision: rev }, targetTick: tick_,
  });
  const r1 = reg(1, B, 1);
  const r2 = reg(2, A, 2); // A로 복귀 — revision 덕에 새 입력으로 등록됨
  assert.equal(r1.duplicate, false);
  assert.equal(r2.duplicate, false, 'A 복귀가 중복으로 오인되면 안 됨');
  st.close();

  // 같은 틱에서 logic_update가 assign보다 먼저: eat cost를 5000으로 올리는 로직 + eat assign
  const w = createWorld(SEED);
  const expensive = { ...DEFAULT_LOGIC, actions: { ...DEFAULT_LOGIC.actions, eat: { ...DEFAULT_LOGIC.actions.eat, cost: 5000 } } };
  const s = w.sims[0];
  s.money = 1000; s.needs.hunger = 100;
  const evs = tick(w, [
    { sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'eat' } },
    { sequence: 1, command: 'logic_update', payload: { params: expensive, hash: logicHash(expensive), revision: 1 } },
  ]);
  // 새 로직(cost 5000 > money 1000)으로 검증되어 거부되어야 함
  assert.ok(evs.some((e) => e.type === 'logic_changed'));
  assert.ok(evs.some((e) => e.type === 'input_rejected' && e.payload.reason === 'no_valid_target'),
    '첫 틱의 기존 입력도 새 로직으로 검증');
});

test('P2-8. 부팅 정합: snapshot A + pending B + 파일 A → 파일 A를 새 revision으로 등록', () => {
  const dir = tmpDir();
  const st = new Storage(path.join(dir, 't.db'));
  const B = { ...DEFAULT_LOGIC, mood: { ...DEFAULT_LOGIC.mood, decayPerTick: 9 } };
  const paramsPath = path.join(dir, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(DEFAULT_LOGIC)); // 파일 = A
  const engine = new Engine(st, { seed: SEED, now: () => 1000 });
  // pending B 주입 (스냅샷은 A)
  st.addInput({
    clientInputId: 'logic:99:x', command: 'logic_update',
    payload: { params: B, hash: logicHash(B), revision: 99 }, targetTick: engine.world.worldTick + 1,
  });
  const r = engine.reconcileLogic(paramsPath);
  assert.equal(r.registered, true, '유효 대기 로직(B) ≠ 파일(A)이므로 등록되어야 함');
  // 따라잡기 후 world.logic == 파일
  engine.runBatch(5);
  assert.equal(logicHash(engine.world.logic), logicHash(DEFAULT_LOGIC));
  assert.equal(engine.assertLogicSynced(paramsPath), true);
  st.close();
});

test('P2-9. v1 스냅샷 마이그레이션: traits/mood/logic 설치, 결정적', () => {
  const v1world = createWorld(SEED);
  // v1 형태로 강등
  delete v1world.logic;
  v1world.schemaVersion = 1;
  for (const s of v1world.sims) { delete s.traits; delete s.mood; delete s.isPlayer; }
  const m1 = migrateWorld(deserialize(serialize(v1world)));
  const m2 = migrateWorld(deserialize(serialize(v1world)));
  assert.equal(hashWorld(m1), hashWorld(m2), '마이그레이션 결정적');
  assert.equal(m1.schemaVersion, 4);
  assert.ok(m1.logic);
  for (const s of m1.sims) { assert.ok(s.traits); assert.equal(s.mood, 0); }
  // 마이그레이션 직후 첫 틱 정상 동작
  const evs = tick(m1, []);
  assert.ok(Array.isArray(evs));
});

test('P2-10. 잘못된 로직 파일은 등록되지 않고 ops_log에 기록', () => {
  const dir = tmpDir();
  const st = new Storage(path.join(dir, 't.db'));
  const engine = new Engine(st, { seed: SEED, now: () => 1000 });
  const paramsPath = path.join(dir, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify({ ...DEFAULT_LOGIC, decay: { ...DEFAULT_LOGIC.decay, hunger: 'many' } }));
  const r = engine.reconcileLogic(paramsPath);
  assert.equal(r.registered, false);
  assert.equal(r.reason, 'invalid');
  const ops = st.db.prepare("SELECT * FROM ops_log WHERE type = 'logic_file_invalid'").all();
  assert.equal(ops.length, 1);
  assert.ok(validateLogic(DEFAULT_LOGIC).ok);
  st.close();
});

test('P2-11. logic_update 적용 배치 도중 롤백 → 재실행 시 동일 결과', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 't.db');
  const st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const B = { ...DEFAULT_LOGIC, mood: { ...DEFAULT_LOGIC.mood, decayPerTick: 9 } };
  st.addInput({
    clientInputId: `logic:1:${logicHash(B)}`, command: 'logic_update',
    payload: { params: B, hash: logicHash(B), revision: 1 }, targetTick: 1,
  });
  // 커밋 없이 진행(크래시 시나리오) — 스냅샷은 tick 0 그대로
  const lost = deserialize(serialize(world));
  advance(lost, { 1: st.getPendingInputs(1)[1] }, 100);
  const lostHash = hashWorld(lost);
  // 재부팅 재생
  const reboot = st.loadOrCreate({ seed: SEED, nowUtcMs: 9999 });
  advance(reboot.world, { 1: st.getPendingInputs(1)[1] }, 100);
  assert.equal(hashWorld(reboot.world), lostHash);
  assert.equal(reboot.world.logic.mood.decayPerTick, 9, '재생에서도 로직 적용');
  st.close();
});

test('P2-12. 같은 틱 계약: logic_update가 그 틱의 감쇠·정산에도 즉시 적용', () => {
  const w = createWorld(SEED);
  const heavy = { ...DEFAULT_LOGIC, decay: { ...DEFAULT_LOGIC.decay, hunger: 100 } };
  const s = w.sims[0];
  s.needs.hunger = 5000;
  s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  tick(w, [{ sequence: 0, command: 'logic_update', payload: { params: heavy, hash: logicHash(heavy), revision: 1 } }]);
  assert.equal(s.needs.hunger, 4900, '새 감쇠(100)가 같은 틱에 적용되어야 함');
});

test('P2-13. 검증 적대 벡터: deltaSpan 0·음수 duration·해시 누락·revision 누락 전부 거부', () => {
  const bad1 = { ...DEFAULT_LOGIC, affinity: { ...DEFAULT_LOGIC.affinity, deltaSpan: 0 } };
  assert.equal(validateLogic(bad1).ok, false, 'deltaSpan 0');
  const bad2 = { ...DEFAULT_LOGIC, actions: { ...DEFAULT_LOGIC.actions, idle: { duration: -5 } } };
  assert.equal(validateLogic(bad2).ok, false, '음수 duration');
  const bad3 = { ...DEFAULT_LOGIC, mood: { ...DEFAULT_LOGIC.mood, reliefScale: 99999999999 } };
  assert.equal(validateLogic(bad3).ok, false, 'reliefScale 상한(§G 보존)');
  // 해시/revision 누락 → 결정적 input_rejected
  const w = createWorld(SEED);
  const evs = tick(w, [
    { sequence: 0, command: 'logic_update', payload: { params: DEFAULT_LOGIC } },
    { sequence: 1, command: 'logic_update', payload: { params: DEFAULT_LOGIC, hash: logicHash(DEFAULT_LOGIC) } },
    { sequence: 2, command: 'logic_update', payload: { params: DEFAULT_LOGIC, hash: 'wronghash!', revision: 3 } },
  ]);
  assert.equal(evs.filter((e) => e.type === 'input_rejected').length, 3);
  assert.equal(evs.filter((e) => e.type === 'logic_changed').length, 0);
});

test('P2-14. 마이그레이션 시 meta 영속화 (schemaVersion·behaviorVersion)', () => {
  const dir = tmpDir();
  const dbPath = path.join(dir, 't.db');
  let st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  // v1 스냅샷으로 강등해 저장
  delete world.logic; world.schemaVersion = 1;
  for (const s of world.sims) { delete s.traits; delete s.mood; delete s.isPlayer; }
  st.db.prepare('UPDATE snapshot SET state = ? WHERE id = 1').run(serialize(world));
  st.db.prepare("UPDATE meta SET value = '1' WHERE key = 'schemaVersion'").run();
  st.close();
  st = new Storage(dbPath);
  const loaded = st.loadOrCreate({ seed: SEED, nowUtcMs: 2000 });
  assert.equal(loaded.world.schemaVersion, 4);
  assert.equal(st.getMetaInt('schemaVersion'), 4);
  assert.equal(st.getMetaInt('behaviorVersion'), 4);
  // 스냅샷도 마이그레이션된 상태로 재저장됨
  const snap = deserialize(st.db.prepare('SELECT state FROM snapshot WHERE id = 1').get().state);
  assert.ok(snap.logic);
  st.close();
});

test('P2-15. revision 누락 pending은 정합을 억제하지 못함 (Codex 10차 재현 시나리오)', () => {
  const dir = tmpDir();
  const st = new Storage(path.join(dir, 't.db'));
  const B = { ...DEFAULT_LOGIC, mood: { ...DEFAULT_LOGIC.mood, decayPerTick: 9 } };
  const paramsPath = path.join(dir, 'params.json');
  fs.writeFileSync(paramsPath, JSON.stringify(B)); // 파일 = B
  const engine = new Engine(st, { seed: SEED, now: () => 1000 });
  // revision 없는 무효 pending B 주입 (tick에서 거부될 운명)
  st.addInput({
    clientInputId: 'logic:bad', command: 'logic_update',
    payload: { params: B, hash: logicHash(B) }, targetTick: engine.world.worldTick + 1,
  });
  const r = engine.reconcileLogic(paramsPath);
  assert.equal(r.registered, true, '무효 pending은 유효 대기 로직으로 취급되면 안 됨');
  engine.runBatch(5);
  assert.equal(logicHash(engine.world.logic), logicHash(B), '따라잡기 후 파일 로직이 활성');
  st.close();
});
