// 상호작용 테스트: 대화(D8)·인사(D9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld, DEFAULT_LOGIC } from '../sim/index.js';

const SEED = 1212;
const L = DEFAULT_LOGIC;

function setupSocialPair(w, ids = [0, 1], ticks = 60) {
  const park = w.map.facilities.find((f) => f.type === 'park');
  ids.forEach((id, i) => {
    const s = w.sims[id];
    const spot = park.resources[i];
    s.state = { kind: 'performing', action: 'socialize', facilityId: 'park', resourceId: spot.id, path: [], ticksLeft: ticks, pairedTicks: 0 };
    s.x = spot.x; s.y = spot.y;
    w.reservations[`park:${spot.id}`] = id;
  });
  for (const s of w.sims) {
    if (!ids.includes(s.id)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 999, pairedTicks: 0 };
  }
}

test('D8-1. 대화: 발화 간격마다 구조화 이벤트, 60틱 socialize에 4회', () => {
  const w = createWorld(SEED);
  setupSocialPair(w);
  const evs = [];
  for (let i = 0; i < 60; i++) evs.push(...tick(w, []));
  const convs = evs.filter((e) => e.type === 'conversation');
  assert.equal(convs.length, 4, `발화 4회 (실제 ${convs.length})`);
  for (const c of convs) {
    assert.ok(['food', 'gossip', 'memory_share', 'weather', 'work_gripe', 'party_invite'].includes(c.payload.topic));
    assert.ok([0, 1].includes(c.simId) && [0, 1].includes(c.payload.withSimId));
  }
  // 화자 교대
  const speakers = convs.map((c) => c.simId);
  assert.ok(new Set(speakers).size > 1, '화자가 교대함');
});

test('D8-2. 대화 결정성: 같은 시드 → 같은 주제 시퀀스', () => {
  const run = () => {
    const w = createWorld(SEED);
    setupSocialPair(w);
    const evs = [];
    for (let i = 0; i < 60; i++) evs.push(...tick(w, []));
    return evs.filter((e) => e.type === 'conversation').map((c) => c.payload.topic).join(',');
  };
  assert.equal(run(), run());
});

test('D8-3. work_gripe는 retired 화자에게 나오지 않음', () => {
  const w = createWorld(SEED);
  w.sims[0].traits = { ...w.sims[0].traits, age: 70, occupation: 'retired' };
  w.sims[1].traits = { ...w.sims[1].traits, age: 70, occupation: 'retired' };
  setupSocialPair(w);
  const evs = [];
  for (let i = 0; i < 60; i++) evs.push(...tick(w, []));
  for (const c of evs.filter((e) => e.type === 'conversation')) {
    assert.notEqual(c.payload.topic, 'work_gripe');
  }
});

test('D9-1. 인사: 근접 walking 페어, 하루 1회, 호감도·사교 상승', () => {
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  // 인접 타일에서 서로를 향해 걷는 상태로 세팅
  a.state = { kind: 'walking', action: 'play', facilityId: 'park', resourceId: 'spot0', path: [{ x: 25, y: 24 }, { x: 26, y: 24 }], ticksLeft: 60, pairedTicks: 0 };
  a.x = 24; a.y = 24;
  b.state = { kind: 'walking', action: 'play', facilityId: 'park', resourceId: 'spot1', path: [{ x: 25, y: 25 }, { x: 26, y: 25 }], ticksLeft: 60, pairedTicks: 0 };
  b.x = 24; b.y = 25;
  w.reservations['park:spot0'] = 0; w.reservations['park:spot1'] = 1;
  for (const s of w.sims.slice(2)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 999, pairedTicks: 0 };
  const socialBefore = a.needs.social;
  const evs = tick(w, []);
  const greets = evs.filter((e) => e.type === 'greeting');
  assert.equal(greets.length, 1, '한 번만');
  assert.ok(w.affinity[0][1] > 0, '호감도 상승');
  assert.ok(a.needs.social >= socialBefore, '사교 회복(감쇠 상쇄 이상)');
  // 같은 날 재인사 없음
  const evs2 = tick(w, []);
  assert.equal(evs2.filter((e) => e.type === 'greeting').length, 0);
});

test('D9-2. 통합: 30일 자연 실행에서 대화·인사 발생 + 분할 불변성 유지', () => {
  const a = createWorld(SEED);
  const evsA = advance(a, {}, 10 * 1440);
  assert.ok(evsA.some((e) => e.type === 'conversation'), '대화 발생');
  assert.ok(evsA.some((e) => e.type === 'greeting'), '인사 발생');
  const b = createWorld(SEED);
  for (const n of [1440, 7000, 1, 5959]) advance(b, {}, n); // 합 14400 = 10일
  assert.equal(hashWorld(a), hashWorld(b), '분할 불변성');
});

test('D8-4. 호감도 0인 non-stranger도 험담 대상 가능 (Codex 19차)', async () => {
  const { default: assert2 } = await import('node:assert/strict');
  const mod = await import('../sim/interaction.js');
  // pickGossipTarget은 내부 함수 — maybeConverse 경유로 검증: 티어만 있고 호감도 0인 제3자 구성
  const w = createWorld(SEED);
  w.sims[0].relTiers[5] = 'acquaintance'; // 호감도는 0 그대로
  setupSocialPair(w, [0, 1]);
  // gossip만 남기고 전부 0 가중치
  w.logic = JSON.parse(JSON.stringify(w.logic));
  w.logic.conversation.topicWeights = { food: 0, gossip: 100, memory_share: 0, weather: 0, work_gripe: 0 };
  const evs = [];
  for (let i = 0; i < 60; i++) evs.push(...tick(w, []));
  const gossips = evs.filter((e) => e.type === 'conversation' && e.payload.topic === 'gossip' && e.simId === 0);
  assert2.ok(gossips.length >= 1, '호감도 0이어도 험담 소재가 됨');
  assert2.equal(gossips[0].payload.aboutSimId, 5);
});
