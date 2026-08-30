// Phase 4 테스트: 하루 계획·정보 확산·announce (PLAN §7 21, 23, 24)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld, DEFAULT_LOGIC } from '../sim/index.js';
import { buildDailyPlan, planFactorFor } from '../sim/planning.js';

const SEED = 777;
const L = DEFAULT_LOGIC;
const PLAYER = {
  name: '동인', gender: 'M', age: 30,
  mbti: { EI: 25, SN: 75, TF: 25, JP: 75 }, occupation: 'freelancer',
};

test('P4-21a. 계획 생성: 기상 시 하루 1회, 우선순위 식사>근무>여가', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.traits = { ...s.traits, age: 40, occupation: 'office_worker', mbti: { EI: 25, SN: 50, TF: 50, JP: 0 } };
  const plan = buildDailyPlan(s, L);
  s.plan = plan;
  // 저녁 식사 창(1050~1170)과 근무 창(540~1080)이 겹치는 1060: eat이 우선
  const eatAt1060 = planFactorFor(w, s, 'eat', 'cafe', 1060, L);
  const workAt1060 = planFactorFor(w, s, 'work', 'office', 1060, L);
  assert.ok(eatAt1060.factor > 100, '식사 슬롯 우선');
  assert.equal(workAt1060.factor, 100, '겹치는 근무는 보너스 없음');
  // J(JP=0) → 최대 편향 150
  assert.equal(eatAt1060.factor, 150);
  // 근무 단독 창(600): work 보너스
  assert.ok(planFactorFor(w, s, 'work', 'office', 600, L).factor > 100);
});

test('P4-21b. 30일 실행에서 계획이 실제 생성되고 하루 1회 갱신', () => {
  const w = createWorld(SEED);
  advance(w, {}, 5 * 1440);
  const planned = w.sims.filter((s) => Array.isArray(s.plan));
  assert.ok(planned.length > 5, '대부분의 심이 계획 보유');
  for (const s of planned) assert.ok(s.lastPlannedDay >= 0);
});

test('P4-23. 확산 결정성: 분할 실행에도 토큰·전파·rng 소비 동일', () => {
  const a = createWorld(SEED);
  advance(a, {}, 6 * 1440); // 토큰 생성 주기(3일) 2회 포함
  const b = createWorld(SEED);
  for (const n of [700, 4000, 1, 2500, 1435, 4]) advance(b, {}, n); // 합 8640 = 6일
  assert.equal(hashWorld(a), hashWorld(b));
  assert.ok(a.tokenCounter >= 2, '토큰이 생성됨');
});

test('P4-24. 파티 참석 재현성: 같은 시드 → 같은 gathering 카운트', () => {
  const run = () => {
    const w = createWorld(SEED);
    const evs = advance(w, {}, 6 * 1440);
    return evs.filter((e) => e.type === 'gathering').map((e) => `${e.tick}:${e.payload.placeId}:${e.payload.count}`);
  };
  const g1 = run(), g2 = run();
  assert.ok(g1.length >= 1, 'gathering 이벤트 발생');
  assert.deepEqual(g1, g2);
});

test('P4-D7. announce: 검증·플레이어 필요·확산 시작', () => {
  const w = createWorld(SEED);
  // 플레이어 없이 → 거부
  const evs0 = tick(w, [{ sequence: 0, command: 'announce', payload: { placeId: 'park', hoursFromNow: 2 } }]);
  assert.ok(evs0.some((e) => e.type === 'input_rejected' && e.payload.reason === 'no_player'));
  // 플레이어 생성 후 공지
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  const evs1 = tick(w, [
    { sequence: 0, command: 'announce', payload: { placeId: 'park', hoursFromNow: 2 } },
    { sequence: 1, command: 'announce', payload: { placeId: 'moon', hoursFromNow: 2 } },
    { sequence: 2, command: 'announce', payload: { placeId: 'park', hoursFromNow: 9999 } },
  ]);
  assert.equal(evs1.filter((e) => e.type === 'token_created').length, 1);
  assert.equal(evs1.filter((e) => e.type === 'input_rejected').length, 2);
  const player = w.sims.find((s) => s.isPlayer);
  assert.equal(player.knownTokens.length, 1, '공지자는 토큰을 안다');
  assert.equal(w.tokens.length, 1);
});

test('P4-만료: 토큰이 world와 모든 knownTokens에서 제거됨', () => {
  const w = createWorld(SEED);
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  tick(w, [{ sequence: 0, command: 'announce', payload: { placeId: 'park', hoursFromNow: 1 } }]);
  advance(w, {}, 60 + L.diffusion.expireAfter + 2);
  assert.equal(w.tokens.length, 0, '만료 토큰 제거');
  for (const s of w.sims) assert.equal(s.knownTokens.length, 0);
});

test('P4-경계: expiresTick 당일까지 전파·끌림 유효, 제거는 다음 틱 (Codex 15차)', () => {
  const w = createWorld(SEED);
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  tick(w, [{ sequence: 0, command: 'announce', payload: { placeId: 'park', hoursFromNow: 1 } }]);
  const token = w.tokens[0];
  const player = w.sims.find((s) => s.isPlayer);
  // expiresTick 시점: 토큰 유지 + party pull 적용 가능
  advance(w, {}, token.expiresTick - w.worldTick);
  assert.equal(w.tokens.length, 1, 'expiresTick 틱엔 아직 유지');
  const pf = planFactorFor(w, player, 'socialize', 'park', token.expiresTick, L);
  assert.equal(pf.factor, L.plan.partyPullFactor, 'expiresTick 포함 폐구간');
  // 다음 틱: 제거
  advance(w, {}, 1);
  assert.equal(w.tokens.length, 0);
});
