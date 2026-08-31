// 세계관 확장(§16) 테스트: 신규 시설·행동·동적 오브젝트·날씨
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld } from '../sim/index.js';
import { migrateWorld } from '../sim/migrate.js';
import { serialize, deserialize } from '../sim/serialize.js';

const SEED = 6161;

function idleAll(w, except = []) {
  for (const s of w.sims) {
    if (!except.includes(s.id)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 9999, pairedTicks: 0 };
  }
}
function resetIdle(s) {
  s.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
}

test('W-1. 신규 시설 존재 + 낚시터 물 타일 비보행', () => {
  const w = createWorld(SEED);
  for (const id of ['library', 'market', 'pond']) {
    assert.ok(w.map.facilities.some((f) => f.id === id), id);
  }
  assert.equal(w.map.tiles[43 * w.map.w + 41], 5, '연못 내부 WATER');
});

test('W-2. 날씨: day 0은 드로우 없이 sunny, 이후 하루 1회 결정적 추첨', () => {
  const w = createWorld(SEED);
  assert.deepEqual(w.weather, { day: 0, kind: 'sunny' });
  const evs = advance(w, {}, 3 * 1440);
  const changes = evs.filter((e) => e.type === 'weather_changed');
  assert.equal(changes.length, 3, 'day 1·2·3 각 1회');
  // 결정성
  const w2 = createWorld(SEED);
  const evs2 = advance(w2, {}, 3 * 1440);
  assert.deepEqual(
    changes.map((e) => e.payload.kind),
    evs2.filter((e) => e.type === 'weather_changed').map((e) => e.payload.kind));
});

test('W-3. 분실 동전: 스폰 → 습득(돈·기분·기억) 또는 만료', () => {
  const w = createWorld(SEED);
  const evs = advance(w, {}, 5 * 1440);
  const spawned = evs.filter((e) => e.type === 'item_spawned');
  assert.ok(spawned.length >= 5, `스폰 발생 (${spawned.length})`);
  const found = evs.filter((e) => e.type === 'item_found');
  // 5일이면 누군가는 줍는다 (심들이 계속 돌아다님)
  assert.ok(found.length >= 1, `습득 발생 (${found.length})`);
  assert.ok(found.every((e) => e.payload.amount >= w.logic.items.amountMin));
});

test('W-4. 집밥 경제: 장보기 → groceries → cook_eat 소비', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  s.traits = { ...s.traits, age: 40, occupation: 'freelancer' };
  s.needs = { hunger: 3000, energy: 9500, social: 9500, fun: 9500 };
  s.money = 1000; s.mood = 0; s.groceries = 0;
  // 시장이 카페보다 가까운 위치 (도서관/시장 블록 근처)
  s.x = 15; s.y = 16;
  // shop 또는 eat 중 선택 — groceries 0이니 shop 후보 존재. 완주시켜 groceries 확인
  for (let i = 0; i < 200 && s.groceries === 0; i++) tick(w, []);
  assert.ok(s.groceries > 0, '장을 봄');
  // 이제 배고프면 cook_eat이 후보 (자기 집) — 강제로 배고프게
  s.needs.hunger = 2500;
  resetIdle(s);
  let cooked = false;
  for (let i = 0; i < 300; i++) {
    const evs = tick(w, []);
    if (evs.some((e) => e.type === 'action_completed' && e.simId === 0 && e.payload.action === 'cook_eat')) { cooked = true; break; }
  }
  assert.ok(cooked, '집밥을 해먹음');
});

test('W-5. 낚시: 완료 시 단일 드로우 — 어획 또는 허탕, 결정적', () => {
  const run = () => {
    const w = createWorld(SEED);
    const s = w.sims[0];
    idleAll(w, []);
    const pond = w.map.facilities.find((f) => f.id === 'pond');
    s.state = { kind: 'performing', action: 'fish', facilityId: 'pond', resourceId: 'spot0', path: [], ticksLeft: 1, pairedTicks: 0 };
    s.x = pond.resources[0].x; s.y = pond.resources[0].y;
    w.reservations['pond:spot0'] = 0;
    const before = s.money;
    const evs = tick(w, []);
    const caught = evs.find((e) => e.type === 'fish_caught');
    return { delta: s.money - before, caught: caught?.payload.amount ?? 0 };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, '결정적');
  assert.equal(a.delta, a.caught);
});

test('W-6. v6→v7 마이그레이션: 시설 주입·상태 추가·결정성', () => {
  const v6 = createWorld(SEED);
  v6.schemaVersion = 6;
  v6.map.facilities = v6.map.facilities.filter((f) => !['library', 'market', 'pond'].includes(f.id));
  delete v6.weather; delete v6.lostItems; delete v6.itemCounter;
  for (const s of v6.sims) delete s.groceries;
  const m1 = migrateWorld(deserialize(serialize(v6)));
  const m2 = migrateWorld(deserialize(serialize(v6)));
  assert.equal(hashWorld(m1), hashWorld(m2));
  assert.ok(m1.map.facilities.some((f) => f.id === 'pond'));
  assert.deepEqual(m1.weather, { day: 0, kind: 'sunny' });
  assert.equal(m1.schemaVersion, 9);
  // 마이그레이션 직후 진행 정상
  advance(m1, {}, 100);
});

test('W-7. 비 오는 날 야외 페널티: 공원 후보가 실내 대비 불리해짐', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  s.traits = { ...s.traits, age: 40, occupation: 'freelancer', mbti: { EI: 50, SN: 100, TF: 50, JP: 50 } }; // N형: 비 오면 독서가 유효 대안
  s.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 3000 };
  s.money = 10000; s.mood = 0;
  s.x = 24; s.y = 20; // 공원이 도서관보다 가까운 지점
  w.weather = { day: 0, kind: 'sunny' };
  tick(w, []);
  const sunnyChoice = s.state.facilityId;
  // 같은 조건, 비
  const w2 = createWorld(SEED);
  const s2 = w2.sims[0];
  idleAll(w2, []);
  resetIdle(s2);
  w2.reservations = {};
  s2.traits = { ...s2.traits, age: 40, occupation: 'freelancer', mbti: { EI: 50, SN: 100, TF: 50, JP: 50 } };
  s2.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 3000 };
  s2.money = 10000; s2.mood = 0;
  s2.x = 24; s2.y = 20;
  w2.weather = { day: 0, kind: 'rain' };
  tick(w2, []);
  assert.equal(sunnyChoice, 'park', '맑은 날엔 공원');
  assert.notEqual(s2.state.facilityId, 'park', `비 오면 야외 회피 (실제: ${s2.state.facilityId})`);
});

test('W-8. 전 기능 분할 불변성 (10일, §16 포함)', () => {
  const a = createWorld(SEED);
  advance(a, {}, 10 * 1440);
  const b = createWorld(SEED);
  for (const n of [3000, 1, 8000, 3399]) advance(b, {}, n); // 합 14400
  assert.equal(hashWorld(a), hashWorld(b));
});
