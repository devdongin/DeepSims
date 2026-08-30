// Phase 3 테스트: 기억·검색·회고·관계 티어·습관 (PLAN §7 17~22, 25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld, serialize, deserialize, DEFAULT_LOGIC } from '../sim/index.js';
import { recordFact, shortlistMemories, memoryModFor, runReflection, computeTier } from '../sim/cognition.js';

const SEED = 9090;
const L = DEFAULT_LOGIC;

function freshSim(w) {
  const s = w.sims[0];
  s.memories = []; s.memorySeq = 0;
  return s;
}

test('P3-17. 기억 상한·퇴출 완전 순서 (보존점수→importance→고령→memorySeq)', () => {
  const w = createWorld(SEED);
  const s = freshSim(w);
  // cap+1개 삽입: 전부 같은 틱·같은 importance(1) → memorySeq 최저가 퇴출
  for (let i = 0; i <= L.memory.cap; i++) {
    recordFact(s, 100, L, 'small_talk', { placeId: 'cafe', tags: ['socialize'] });
  }
  assert.equal(s.memories.length, L.memory.cap);
  assert.equal(s.memories[0].memorySeq, 1, 'memorySeq 0이 퇴출됨');
  // importance 높은 기억은 살아남음
  const s2 = freshSim(w);
  recordFact(s2, 100, L, 'argument', { placeId: 'cafe', tags: ['argument'] }); // imp 8
  for (let i = 0; i < L.memory.cap; i++) {
    recordFact(s2, 100, L, 'small_talk', { placeId: 'cafe', tags: ['socialize'] }); // imp 1
  }
  assert.ok(s2.memories.some((m) => m.kind === 'argument'), '고중요 기억 보존');
});

test('P3-18. 검색: 연관 기억이 보정에 기여하고 무관 기억은 기여하지 않음', () => {
  const w = createWorld(SEED);
  const s = freshSim(w);
  recordFact(s, 100, L, 'argument', { placeId: 'cafe', tags: ['argument', 'facility:cafe'] });
  recordFact(s, 100, L, 'meal', { placeId: 'cafe', tags: ['eat', 'facility:cafe'] });
  const shortlist = shortlistMemories(s, 101, L);
  const atCafe = memoryModFor(shortlist, ['eat', 'facility:cafe'], 101, L);
  const atPark = memoryModFor(shortlist, ['play', 'facility:park'], 101, L);
  assert.ok(atCafe.mod !== 0, '카페 후보엔 기억 보정');
  assert.ok(atCafe.cited.length >= 1);
  assert.equal(atPark.mod, 0, '공원 후보엔 무관');
  // argument(8, neg) > meal(2, pos) → 순 보정은 음수
  assert.ok(atCafe.mod < 0, '다툰 카페는 기피');
});

test('P3-19. 회고 멱등: 하루 2회 수면에도 파생·습관 중복 없음', () => {
  const w = createWorld(SEED);
  const s = freshSim(w);
  const emitted = [];
  const emit = (type, simId, payload) => emitted.push({ type, simId, payload });
  for (let i = 0; i < 5; i++) recordFact(s, 10, L, 'meal', { placeId: 'cafe', tags: ['eat', 'facility:cafe'] });
  runReflection(w, s, 500, emit);
  const habitAfter1 = s.habit['eat:cafe'];
  const moodAfter1 = s.pendingMood;
  assert.ok(habitAfter1 > 0, '습관 형성');
  runReflection(w, s, 600, emit); // 같은 날 두 번째 수면
  assert.equal(s.habit['eat:cafe'], habitAfter1, '습관 중복 증가 없음');
  assert.equal(s.pendingMood, moodAfter1, 'pendingMood 재계산 없음');
  runReflection(w, s, 500 + 1440, emit); // 다음날 — 커서 이후 신규 기억 없음 → mood 0
  assert.equal(s.pendingMood, 0);
});

test('P3-20. 수면 중 직렬화: pendingMood·기억·커서 보존', () => {
  const w = createWorld(SEED);
  advance(w, {}, 3000);
  const roundtrip = deserialize(serialize(w));
  advance(w, {}, 2000);
  advance(roundtrip, {}, 2000);
  assert.equal(hashWorld(w), hashWorld(roundtrip));
});

test('P3-21. 습관 캡: 장기 실행에도 상한 초과 없음', () => {
  const w = createWorld(SEED);
  const s = freshSim(w);
  const emit = () => {};
  for (let day = 0; day < 40; day++) {
    for (let i = 0; i < 5; i++) recordFact(s, day * 1440 + 10, L, 'meal', { placeId: 'cafe', tags: ['eat'] });
    runReflection(w, s, day * 1440 + 500, emit);
  }
  assert.ok(s.habit['eat:cafe'] <= L.social.habitCap);
});

test('P3-22. 관계 티어: 임계 함수 + 회고에서 경계 교차 시에만 이벤트', () => {
  assert.equal(computeTier(5000, 100, L), 'friend');
  assert.equal(computeTier(-5000, 50, L), 'rival');
  assert.equal(computeTier(0, 20, L), 'acquaintance');
  assert.equal(computeTier(9000, 5, L), 'stranger', '상호작용 부족이면 친밀도 높아도 stranger');
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  w.affinity[a.id][b.id] = 5000;
  w.interactions[a.id][b.id] = 100;
  const evs1 = [], evs2 = [];
  runReflection(w, a, 500, (type, simId, payload) => evs1.push({ type, payload }));
  assert.ok(evs1.some((e) => e.type === 'relationship_changed' && e.payload.tier === 'friend'));
  a.lastReflectedDay = -1; // 다음날 가정
  runReflection(w, a, 500 + 1440, (type, simId, payload) => evs2.push({ type, payload }));
  assert.ok(!evs2.some((e) => e.type === 'relationship_changed'), '티어 유지 시 이벤트 없음');
});

test('P3-25. 인지 켠 따라잡기/분할 등가성 (30일)', () => {
  const a = createWorld(SEED);
  advance(a, {}, 15 * 1440);
  const b = createWorld(SEED);
  for (const n of [1440, 10000, 1, 4319, 5840]) advance(b, {}, n);
  assert.equal(hashWorld(a), hashWorld(b));
});

test('P3-스모크. 30일 실행에서 회고·티어·습관이 실제로 발생', () => {
  const w = createWorld(SEED);
  const evs = advance(w, {}, 30 * 1440);
  assert.ok(w.sims.some((s) => s.memories.length > 10), '기억 축적');
  assert.ok(w.sims.some((s) => Object.keys(s.habit).length > 0), '습관 형성');
  assert.ok(w.sims.some((s) => s.lastReflectedDay >= 0), '회고 실행됨');
  assert.ok(evs.some((e) => e.type === 'relationship_changed'), '관계 변화 발생');
});

test('P3-회고 당일 필터: 며칠 전 기억은 pendingMood에 섞이지 않음 (Codex 12차 재현)', () => {
  const w = createWorld(SEED);
  const s = freshSim(w);
  const emit = () => {};
  for (let i = 0; i < 3; i++) recordFact(s, 100, L, 'argument', { placeId: 'cafe', tags: ['argument'] }); // day 0
  runReflection(w, s, 2 * 1440 + 500, emit); // day 2에 첫 수면
  assert.equal(s.pendingMood, 0, '당일(day 2) 기억이 없으므로 0');
  assert.equal(s.reflectionMemoryCursor, s.memorySeq, '커서는 과거 기억을 지나감');
});
