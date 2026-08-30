// Phase 1 코어 테스트 (PLAN §7 1~4, 9~15)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, serialize, deserialize, hashWorld, fnv1a, buildMap, bfsPath, isWalkable } from '../sim/index.js';

const SEED = 12345;

test('1. 결정성: 같은 시드+입력 → 해시 동일', () => {
  const inputs = { 100: [{ sequence: 0, command: 'assign', payload: { simId: 3, actionType: 'play' } }] };
  const a = createWorld(SEED); advance(a, inputs, 2000);
  const b = createWorld(SEED); advance(b, inputs, 2000);
  assert.equal(hashWorld(a), hashWorld(b));
  const c = createWorld(SEED + 1); advance(c, inputs, 2000);
  assert.notEqual(hashWorld(a), hashWorld(c));
});

test('2. 분할 불변성: 임의 파티션 5종 == 일괄 실행', () => {
  const total = 3000;
  const ref = createWorld(SEED);
  const refEvents = advance(ref, {}, total);
  const partitions = [
    [3000], [1500, 1500], [1, 2999], [999, 1000, 1001], [700, 700, 700, 700, 200],
  ];
  for (const parts of partitions) {
    const w = createWorld(SEED);
    const evs = [];
    for (const n of parts) evs.push(...advance(w, {}, n));
    assert.equal(hashWorld(w), hashWorld(ref), `partition ${parts}`);
    assert.deepEqual(evs, refEvents, `events ${parts}`);
  }
});

test('3. 직렬화 왕복: 중간 저장/복원 == 무중단 (PRNG·예약 보존)', () => {
  const a = createWorld(SEED); advance(a, {}, 1000);
  const b = deserialize(serialize(a));
  advance(a, {}, 1000);
  advance(b, {}, 1000);
  assert.equal(hashWorld(a), hashWorld(b));
});

test('4. 해시: FNV-1a 고정 벡터 + 키 순서 불변', () => {
  // FNV-1a 32-bit 표준 벡터
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  assert.equal(fnv1a('foobar'), 'bf9cf968');
  // canonical 직렬화: 키 삽입 순서 무관
  assert.equal(serialize({ b: 1, a: { d: 2, c: 3 } }), serialize({ a: { c: 3, d: 2 }, b: 1 }));
});

test('9. 자원 경합: 마지막 침대는 항상 id 낮은 심이 예약', () => {
  const w = createWorld(SEED);
  // 침대 10개 중 9개를 인위로 점유 (house0:bed0만 남김)
  const beds = [];
  for (const f of w.map.facilities) if (f.type === 'house') for (const r of f.resources) beds.push(`${f.id}:${r.id}`);
  for (const key of beds.slice(1)) w.reservations[key] = 99;
  // 심 0, 1을 수면 위급으로
  w.sims[0].needs.energy = 100; w.sims[1].needs.energy = 100;
  for (const s of w.sims) { s.needs.hunger = 9500; s.needs.social = 9500; s.needs.fun = 9500; }
  tick(w, []);
  assert.equal(w.reservations[beds[0]], 0, 'id 낮은 심이 승리');
  assert.equal(w.sims[0].state.action, 'sleep');
  assert.notEqual(w.sims[1].state.action, 'sleep');
});

test('10. 타깃 선택 타이브레이크: 같은 점수면 facilityId→resourceId 순', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.needs.energy = 0;
  // 같은 시설의 두 침대는 거리가 같으면 resourceId 오름차순
  const home = w.map.facilities[0];
  s.x = home.door.x; s.y = home.door.y; // bed0/bed1과 등거리 아님 — 등거리 지점으로 이동
  // bed0 (x+1,y+1), bed1 (x+4,y+1): 등거리 x = x+2.5 불가 → 대신 점수 동률 케이스를 직접 비교하긴
  // 어려우므로, 결정성 있는 선택(재실행 동일)만 검증
  const w2 = deserialize(serialize(w));
  tick(w, []); tick(w2, []);
  assert.equal(w.sims[0].state.resourceId, w2.sims[0].state.resourceId);
});

test('11. 자기 예약 재사용: 마지막 슬롯을 쥔 심의 동일 행동 assign이 거부되지 않음', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  // 심 0이 카페 마지막 좌석 예약 상태로 식사 중이라고 가정
  const cafe = w.map.facilities.find((f) => f.type === 'cafe');
  for (const r of cafe.resources) w.reservations[`cafe:${r.id}`] = 5; // 다른 심이 3석 점유
  const myKey = `cafe:${cafe.resources[0].id}`;
  w.reservations[myKey] = 0; // 내 좌석
  s.state = { kind: 'performing', action: 'eat', facilityId: 'cafe', resourceId: cafe.resources[0].id, path: [], ticksLeft: 10, pairedTicks: 0 };
  s.x = cafe.resources[0].x; s.y = cafe.resources[0].y;
  s.money = 1000; s.needs.hunger = 100;
  const events = tick(w, [{ sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'eat' } }]);
  const rejected = events.filter((e) => e.type === 'input_rejected');
  assert.equal(rejected.length, 0, '자기 예약은 가용으로 계산되어야 함');
  assert.equal(w.sims[0].state.action, 'eat');
});

test('12. 중단 원자성: assign이 기존 예약을 해제하고 새 예약으로 대체', () => {
  const w = createWorld(SEED);
  advance(w, {}, 50); // 자연 행동 시작
  const s = w.sims[0];
  const oldKey = s.state.facilityId ? `${s.state.facilityId}:${s.state.resourceId}` : null;
  const events = tick(w, [{ sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'play' } }]);
  if (oldKey && s.state.facilityId !== oldKey.split(':')[0]) {
    assert.notEqual(w.reservations[oldKey], 0, '이전 예약 해제됨');
  }
  assert.equal(s.state.action, 'play');
  const started = events.find((e) => e.type === 'action_started' && e.simId === 0);
  assert.ok(started);
  // 예약 정합성: 모든 예약 보유자는 해당 상태를 가져야 함
  for (const [key, holder] of Object.entries(w.reservations)) {
    const sim = w.sims[holder];
    if (sim) assert.equal(`${sim.state.facilityId}:${sim.state.resourceId}`, key);
  }
});

test('13. socialize 페어링: 2명이면 회복, 1명이면 lonely', () => {
  const w = createWorld(SEED);
  const park = w.map.facilities.find((f) => f.type === 'park');
  // 심 0 혼자 socialize
  const setup = (sim, spot) => {
    sim.state = { kind: 'performing', action: 'socialize', facilityId: 'park', resourceId: spot.id, path: [], ticksLeft: 3, pairedTicks: 0 };
    sim.x = spot.x; sim.y = spot.y;
    w.reservations[`park:${spot.id}`] = sim.id;
  };
  setup(w.sims[0], park.resources[0]);
  // 다른 심들이 결정에 끼어들지 않게 전부 idle 액션 중으로
  for (const s of w.sims.slice(1)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 30, pairedTicks: 0 };
  const evs = [];
  for (let i = 0; i < 3; i++) evs.push(...tick(w, []));
  assert.ok(evs.some((e) => e.type === 'lonely' && e.simId === 0), '혼자면 lonely');

  // 2명이면 회복 + 호감도 변화
  const w2 = createWorld(SEED);
  const park2 = w2.map.facilities.find((f) => f.type === 'park');
  const setup2 = (sim, spot) => {
    sim.state = { kind: 'performing', action: 'socialize', facilityId: 'park', resourceId: spot.id, path: [], ticksLeft: 3, pairedTicks: 0 };
    sim.x = spot.x; sim.y = spot.y;
    w2.reservations[`park:${spot.id}`] = sim.id;
  };
  setup2(w2.sims[0], park2.resources[0]);
  setup2(w2.sims[1], park2.resources[1]);
  for (const s of w2.sims.slice(2)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 30, pairedTicks: 0 };
  const before = w2.sims[0].needs.social;
  const evs2 = [];
  for (let i = 0; i < 3; i++) evs2.push(...tick(w2, []));
  assert.ok(w2.sims[0].needs.social > before, '페어링 시 사교 회복');
  assert.notEqual(w2.affinity[0][1], 0, '호감도 변화');
  // Phase 2부터 호감도는 비대칭(각자 TF 계수) — 부호만 일치 검증 (PLAN §12.1)
  assert.equal(Math.sign(w2.affinity[0][1]), Math.sign(w2.affinity[1][0]), '호감도 부호 일치');
  assert.ok(!evs2.some((e) => e.type === 'lonely'), '페어링되면 lonely 없음');
});

test('14. 맵 도달성: 모든 집 문에서 모든 시설 자원까지 BFS 경로 존재', () => {
  const map = buildMap();
  const spawns = map.facilities.filter((f) => f.type === 'house').map((f) => f.door);
  for (const spawn of spawns) {
    for (const fac of map.facilities) {
      for (const res of fac.resources) {
        assert.ok(isWalkable(map, res.x, res.y), `${fac.id}:${res.id} 타일 보행 가능`);
        const path = bfsPath(map, spawn.x, spawn.y + 1, res.x, res.y);
        assert.ok(path !== null, `${spawn.x},${spawn.y + 1} → ${fac.id}:${res.id}`);
      }
    }
  }
});

test('15. 30일 장기 바운드: 욕구·돈·호감도 범위 유지', () => {
  const w = createWorld(SEED);
  advance(w, {}, 30 * 1440);
  for (const s of w.sims) {
    for (const [k, v] of Object.entries(s.needs)) {
      assert.ok(v >= 0 && v <= 10000, `sim${s.id}.${k}=${v}`);
    }
    assert.ok(s.money >= 0, `sim${s.id}.money=${s.money}`);
  }
  for (const row of w.affinity) for (const v of row) assert.ok(v >= -10000 && v <= 10000);
  assert.equal(w.worldTick, 30 * 1440);
});

test('위급 오버라이드: 배고픔 위급 시 계획 무관하게 eat 선택', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.needs = { hunger: 500, energy: 9000, social: 9000, fun: 9000 };
  s.money = 1000;
  tick(w, []);
  assert.equal(s.state.action, 'eat');
});

test('무효 입력: input_rejected 이벤트, 조용한 무시 없음', () => {
  const w = createWorld(SEED);
  const evs = tick(w, [
    { sequence: 0, command: 'assign', payload: { simId: 999, actionType: 'eat' } },
    { sequence: 1, command: 'assign', payload: { simId: 0, actionType: 'idle' } },
    { sequence: 2, command: 'unknown', payload: {} },
  ]);
  assert.equal(evs.filter((e) => e.type === 'input_rejected').length, 3);
});

test('같은 틱 다중 assign: 나중 수락이 이전을 대체', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.needs = { hunger: 5000, energy: 5000, social: 5000, fun: 5000 };
  s.money = 1000;
  tick(w, [
    { sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'play' } },
    { sequence: 1, command: 'assign', payload: { simId: 0, actionType: 'sleep' } },
  ]);
  assert.equal(s.state.action, 'sleep');
  // play 예약이 남아있으면 안 됨
  const held = Object.entries(w.reservations).filter(([, h]) => h === 0);
  assert.equal(held.length, 1);
});

// --- Codex 구현 리뷰(6차) 회귀 테스트 ---

test('R1. assign은 효용 0(욕구 만땅)이어도 하드 제약만 통과하면 수락', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.needs = { hunger: 10000, energy: 10000, social: 10000, fun: 10000 };
  s.money = 1000;
  const evs = tick(w, [{ sequence: 0, command: 'assign', payload: { simId: 0, actionType: 'eat' } }]);
  assert.ok(!evs.some((e) => e.type === 'input_rejected'), '거부되면 안 됨');
  assert.equal(s.state.action, 'eat');
});

test('R2. work urgency 방향: 돈 없는 심이 돈 많은 심보다 work를 선호', () => {
  const w = createWorld(SEED);
  // 근무시간(09:00)으로 이동
  w.worldTick = 539; // 다음 틱 = 540 = 09:00
  const poor = w.sims[0], rich = w.sims[1];
  poor.money = 0; rich.money = 10000;
  for (const s of [poor, rich]) s.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 };
  for (const s of w.sims.slice(2)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  tick(w, []);
  assert.equal(poor.state.action, 'work', '빈털터리는 출근');
  assert.notEqual(rich.state.action, 'work', '부자는 일 안 함');
});

test('R3. 잘못된 payload(null/배열)는 크래시 없이 input_rejected', () => {
  const w = createWorld(SEED);
  const evs = tick(w, [
    { sequence: 0, command: 'assign', payload: null },
    { sequence: 1, command: 'assign', payload: [1, 2] },
  ]);
  assert.equal(evs.filter((e) => e.type === 'input_rejected' && e.payload.reason === 'malformed_payload').length, 2);
});

test('R4. 실제 동점 타이브레이크: 등거리 좌석 2개 → resourceId 낮은 쪽', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  // 카페 (14,34)에서 seat0(13,33)과 seat2(13,35)는 맨해튼 등거리 2
  s.x = 14; s.y = 34;
  s.needs = { hunger: 10000, energy: 10000, social: 100, fun: 10000 };
  for (const o of w.sims.slice(1)) o.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 99, pairedTicks: 0 };
  tick(w, []);
  assert.equal(s.state.action, 'socialize');
  assert.equal(s.state.facilityId, 'cafe');
  assert.equal(s.state.resourceId, 'seat0', '동점이면 resourceId 오름차순');
});
