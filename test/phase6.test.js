// 로드맵(§15.1) 테스트: 대처 행동·건설·사고 흐름
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld, DEFAULT_LOGIC } from '../sim/index.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import { migrateWorld } from '../sim/migrate.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { recordFact, runReflection } from '../sim/cognition.js';

const SEED = 3131;
const L = DEFAULT_LOGIC;

function idleAll(w, except = []) {
  for (const s of w.sims) {
    if (!except.includes(s.id)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 9999, pairedTicks: 0 };
  }
}

test('R-A1. coping 게이트: 기분 정상이면 후보 아님, 나쁘면 대처 행동 선택', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, [0]);
  s.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 9500 };
  s.money = 10000;
  s.mood = 0;
  tick(w, []);
  assert.ok(!['drink', 'binge_eat', 'hole_up', 'exercise'].includes(s.state.action), '기분 정상 → coping 없음');
  // 기분 최악으로
  const w2 = createWorld(SEED);
  const s2 = w2.sims[0];
  idleAll(w2, [0]);
  s2.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 9500 };
  s2.money = 10000;
  s2.mood = -8000;
  tick(w2, []);
  assert.ok(['drink', 'binge_eat', 'hole_up', 'exercise'].includes(s2.state.action),
    `기분 최악 → 대처 행동 (실제: ${s2.state.action})`);
});

test('R-A2. 대처 성향: 극단 E는 음주, 극단 I는 은둔 쪽으로', () => {
  const setup = (EI) => {
    const w = createWorld(SEED);
    const s = w.sims[0];
    idleAll(w, [0]);
    s.traits = { ...s.traits, age: 40, occupation: 'freelancer', mbti: { EI, SN: 50, TF: 50, JP: 50 } };
    s.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 9500 };
    s.money = 10000;
    s.mood = -8000;
    tick(w, []);
    return s.state.action;
  };
  assert.equal(setup(0), 'drink', '극단 E → 음주');
  assert.equal(setup(100), 'hole_up', '극단 I → 은둔');
});

test('R-A3. 숙취: 음주 완료 후 다음날까지 energy 감쇠 가산 + 이벤트', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, [0]);
  const bar = w.map.facilities.find((f) => f.id === 'bar');
  s.state = { kind: 'performing', action: 'drink', facilityId: 'bar', resourceId: 'seat0', path: [], ticksLeft: 1, pairedTicks: 0 };
  s.x = bar.resources[0].x; s.y = bar.resources[0].y;
  w.reservations['bar:seat0'] = 0;
  s.money = 1000; s.mood = -5000;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'hangover' && e.simId === 0));
  assert.ok(s.hangoverUntil > w.worldTick);
  // 숙취 중 energy 감쇠 = 기본 + 나이보정 + 숙취보정
  const before = s.needs.energy;
  s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 999, pairedTicks: 0 };
  tick(w, []);
  const ageAdd = s.traits.age >= L.ageDecay.oldMin ? L.ageDecay.oldEnergyAdd : 0;
  assert.equal(before - s.needs.energy, L.decay.energy + ageAdd + L.coping.hangoverEnergyDecay);
});

test('R-A4. 중독 루프: 반복 음주 → habit[drink:bar] 형성 (창발)', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.memories = []; s.memorySeq = 0;
  // 하루에 술 3회 마신 기억 주입 후 회고
  for (let i = 0; i < 3; i++) recordFact(s, 100, w.logic, 'drank', { placeId: 'bar', tags: ['drink', 'facility:bar'] });
  runReflection(w, s, 500, () => {});
  assert.ok((s.habit['drink:bar'] ?? 0) > 0, '음주 습관 형성');
});

test('R-B1. 도로화: 같은 잔디 타일을 임계만큼 밟으면 ROAD 전환 + 이벤트', () => {
  const w = createWorld(SEED);
  // wear 임계 직전으로 세팅한 타일 위로 심을 걷게 함
  const tx = 10, ty = 20; // 잔디
  const ti = ty * w.map.w + tx;
  assert.equal(w.map.tiles[ti], 0, '잔디 확인');
  w.wear[ti] = w.logic.build.wearThreshold - 1;
  const s = w.sims[0];
  idleAll(w, [0]);
  s.x = tx - 1; s.y = ty;
  s.state = { kind: 'walking', action: 'play', facilityId: 'park', resourceId: 'spot0', path: [{ x: tx, y: ty }, { x: tx + 1, y: ty }], ticksLeft: 60, pairedTicks: 0 };
  w.reservations['park:spot0'] = 0;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'road_formed' && e.payload.x === tx && e.payload.y === ty));
  assert.equal(w.map.tiles[ti], 1, 'ROAD 전환');
});

test('R-B2. 증축: 게이트(과밀+자금) 통과 시 build 완료 → 침대 추가, 상한 재검증', () => {
  const w = createWorld(SEED);
  const PLAYER = { name: '동', gender: 'X', age: 30, mbti: { EI: 50, SN: 50, TF: 50, JP: 50 }, occupation: 'freelancer' };
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]); // house0 3명 → 과밀
  const s = w.sims[0]; // house0 거주자
  idleAll(w, [0]);
  const home = w.map.facilities.find((f) => f.id === 'house0');
  s.money = 5000;
  s.state = { kind: 'performing', action: 'build', facilityId: 'house0', resourceId: 'bed0', path: [], ticksLeft: 1, pairedTicks: 0 };
  s.x = home.resources[0].x; s.y = home.resources[0].y;
  w.reservations['house0:bed0'] = 0;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'bed_built' && e.payload.facilityId === 'house0'));
  assert.equal(home.resources.length, 3);
  assert.equal(home.resources[2].id, 'bed2');
  assert.equal(home.resources[2].x, home.extraBedSlots[0].x);
  assert.equal(s.money, 5000 - w.logic.actions.build.cost);
  // 자율 결정으로도 build가 뜨는지 (기분 정상·욕구 넉넉·돈 있음·아직 과밀: 3명 > 3침대? 아님 →
  // not_needed. 4명이면 다시 과밀이지만 여기선 재검증 로직만 확인)
});

test('R-B3. 자율 build: 과밀+자금이면 심이 스스로 침대를 짓는다', () => {
  const w = createWorld(SEED);
  const PLAYER = { name: '동', gender: 'X', age: 30, mbti: { EI: 50, SN: 50, TF: 50, JP: 50 }, occupation: 'freelancer' };
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  const s = w.sims[0];
  idleAll(w, []);
  s.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
  w.reservations = {}; // 첫 틱 결정의 예약 정리 (테스트 격리)
  s.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 9500 };
  s.money = 10000; s.mood = 0;
  tick(w, []);
  assert.equal(s.state.action, 'build', `과밀+자금 → 증축 (실제: ${s.state.action})`);
});

test('R-C1. 사고 흐름: 돈 없는 배고픈 심의 chain에 eat=no_money 기록', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, [0]);
  s.traits = { ...s.traits, age: 40, occupation: 'freelancer' };
  s.needs = { hunger: 2500, energy: 9500, social: 9500, fun: 9500 }; // 배고픈데 (위급 아님)
  s.money = 0; // 돈 없음
  s.mood = 0;
  w.worldTick = 599; // 다음 틱 600 — freelancer 근무 가능
  const evs = tick(w, []);
  const started = evs.find((e) => e.type === 'action_started' && e.simId === 0);
  assert.ok(started, '행동 시작');
  assert.equal(started.payload.action, 'work', '대신 일하러 감');
  const chain = started.payload.reason?.chain ?? [];
  assert.ok(chain.some((c) => c.a === 'eat' && c.b === 'no_money'),
    `chain에 eat:no_money 있어야 (실제: ${JSON.stringify(chain)})`);
});

test('R-D1. 전 기능 통합 분할 불변성 (12일) + 마이그레이션 v5→v6', () => {
  const a = createWorld(SEED);
  advance(a, {}, 12 * 1440);
  const b = createWorld(SEED);
  for (const n of [5000, 1, 7000, 5279]) advance(b, {}, n); // 합 17280 = 12일
  assert.equal(hashWorld(a), hashWorld(b));
  // v5 형태로 강등 후 마이그레이션 결정성
  const v5 = createWorld(SEED);
  delete v5.wear;
  v5.schemaVersion = 5;
  v5.map.facilities = v5.map.facilities.filter((f) => f.id !== 'bar');
  for (const sim of v5.sims) delete sim.hangoverUntil;
  const m1 = migrateWorld(deserialize(serialize(v5)));
  const m2 = migrateWorld(deserialize(serialize(v5)));
  assert.equal(hashWorld(m1), hashWorld(m2));
  assert.ok(m1.map.facilities.some((f) => f.id === 'bar'), '술집 주입');
  assert.equal(m1.schemaVersion, SCHEMA_VERSION);
});
