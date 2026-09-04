// Phase 3 인지: 기억 스트림·검색·회고 (PLAN §2.5 B/C/E, 델타 D1~D3).
// 전부 정수 연산, rng 미사용 — 결정적. LLM 없음.
import { NEGATIVE_MEMORY_KINDS } from './logic.js';
import { worldEventMood } from './world-events.js';

// 순환 import 회피: society가 cognition.recordFact를 쓰므로 훅은 지연 바인딩
let romanceHook = () => {};
let clubHook = () => {};
export function bindSocietyHooks(r, cJoin) { romanceHook = r; clubHook = cJoin; }

const SHORTLIST = 32; // D1: 후보 독립 숏리스트 크기 (Codex 대안 채택)
const MEMORY_MOD_CLAMP = 500000000000;  // §G memoryMod ±5e11
export const STATE_MOD_CLAMP = 250000000000;   // §G stateMod ±2.5e11 (§20.3에서 tick.js도 사용)

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ageDays(t, memTick) {
  return Math.min(Math.max(0, floorDiv(t - memTick, 1440)), 15);
}

// 기억 기록 (recordFact 훅, PLAN §2). tags는 정렬·중복 제거 고정.
export function recordFact(sim, t, L, kind, { subjectSimId = null, placeId = null, tags = [] } = {}) {
  const importance = L.memory.importance[kind];
  if (importance === undefined) return;
  const rec = {
    memorySeq: sim.memorySeq++,
    tick: t,
    kind,
    subjectSimId,
    placeId,
    importance,
    tags: [...new Set(tags)].sort(),
  };
  sim.memories.push(rec);
  evict(sim, t, L);
}

// 퇴출 완전 순서: 보존점수(recency×importance) 최저 → importance 최저 → tick 최고령 → memorySeq 최저
function evict(sim, t, L) {
  while (sim.memories.length > L.memory.cap) {
    let worst = 0;
    let worstKey = null;
    for (let i = 0; i < sim.memories.length; i++) {
      const m = sim.memories[i];
      const key = [
        L.memory.recencyLut[ageDays(t, m.tick)] * m.importance,
        m.importance,
        -m.tick, // 오래된(작은 tick) 우선 제거 → -tick 큰 쪽... 비교 방향 아래에서 통일
        m.memorySeq,
      ];
      if (worstKey === null || compareEvict(key, worstKey) < 0) { worst = i; worstKey = key; }
    }
    sim.memories.splice(worst, 1);
  }
}

// 작을수록 먼저 퇴출: 보존점수 asc → importance asc → tick asc(고령 우선) → memorySeq asc
function compareEvict(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  if (-a[2] !== -b[2]) return -a[2] - -b[2]; // tick asc
  return a[3] - b[3];
}

// D1: 후보 독립 숏리스트 (recency·importance만, 동점 memorySeq 낮은 쪽)
export function shortlistMemories(sim, t, L) {
  const scored = sim.memories.map((m) => ({
    m,
    s: L.memory.wRecency * L.memory.recencyLut[ageDays(t, m.tick)] + L.memory.wImportance * m.importance,
  }));
  scored.sort((a, b) => (b.s - a.s) || (a.m.memorySeq - b.m.memorySeq));
  return scored.slice(0, SHORTLIST).map((x) => x.m);
}

// §17.22 성능: 후보 독립 전처리 — base retrieval 내림차순(동점 memorySeq 오름차순) 정렬 + 태그 Set.
// memoryModFast와 함께 쓰면 memoryModFor와 **비트 동일** 결과 (정렬 총순서·topK·기여 합 모두 동일).
const tagSetCache = new WeakMap(); // 기억 객체당 1회 (tags 불변 — 직렬화 무영향)
function tagSetOf(m) {
  let s = tagSetCache.get(m);
  if (!s) { s = new Set(m.tags); tagSetCache.set(m, s); }
  return s;
}

export function prepareShortlist(shortlist, t, L) {
  const entries = shortlist.map((m) => ({
    m,
    base: L.memory.wRecency * L.memory.recencyLut[ageDays(t, m.tick)] + L.memory.wImportance * m.importance,
    tagSet: tagSetOf(m),
  }));
  entries.sort((a, b) => (b.base - a.base) || (a.m.memorySeq - b.m.memorySeq));
  return entries;
}

// 후보별 고속 경로: overlap 버킷(0..cap)별로 base 순서가 보존됨을 이용해 k-way 병합으로 topK 추출.
// 비교자는 (retrieval desc, memorySeq asc) — memoryModFor의 전체 정렬과 동일한 총순서.
const bucketScratch = []; // §17.22: 호출 간 재사용 (매 호출 초기화 — 순수성 불변)
export function memoryModFast(prep, candTags, L) {
  const cap = L.memory.relevanceCap;
  while (bucketScratch.length <= cap) bucketScratch.push([]);
  const buckets = bucketScratch;
  for (let o = 0; o <= cap; o++) buckets[o].length = 0;
  for (const e of prep) {
    let overlap = 0;
    for (const tag of candTags) if (e.tagSet.has(tag)) overlap++;
    if (overlap > cap) overlap = cap;
    buckets[overlap].push(e);
  }
  const ptr = new Array(cap + 1).fill(0);
  let mod = 0;
  const cited = [];
  for (let taken = 0; taken < L.memory.topK; taken++) {
    let bi = -1; let bestRet = -Infinity; let bestSeq = Infinity;
    for (let o = 0; o <= cap; o++) {
      const e = buckets[o][ptr[o]];
      if (!e) continue;
      const ret = e.base + L.memory.relevancePer * o;
      if (ret > bestRet || (ret === bestRet && e.m.memorySeq < bestSeq)) {
        bi = o; bestRet = ret; bestSeq = e.m.memorySeq;
      }
    }
    if (bi < 0) break;
    const e = buckets[bi][ptr[bi]++];
    if (bi > 0) { // overlap 0 은 슬롯만 차지 (기존과 동일)
      const scale = NEGATIVE_MEMORY_KINDS.includes(e.m.kind) ? -L.memory.negScale : L.memory.posScale;
      mod += e.m.importance * (1 + bi) * scale;
      cited.push(e.m.memorySeq);
    }
  }
  return { mod: clamp(mod, -MEMORY_MOD_CLAMP, MEMORY_MOD_CLAMP), cited };
}

// 후보별 memoryMod: 숏리스트에서 연관성 포함 retrieval로 top-K 선별 후 부호 기여 합산.
// 반환: { mod, cited } — cited는 기여한 memorySeq 목록 (§14.1 citedMemorySeqs).
export function memoryModFor(shortlist, candTags, t, L) {
  const ranked = [];
  for (const m of shortlist) {
    let overlap = 0;
    for (const tag of candTags) if (m.tags.includes(tag)) overlap++;
    overlap = Math.min(overlap, L.memory.relevanceCap);
    const retrieval = L.memory.wRecency * L.memory.recencyLut[ageDays(t, m.tick)]
      + L.memory.wImportance * m.importance + L.memory.relevancePer * overlap;
    ranked.push({ m, overlap, retrieval });
  }
  ranked.sort((a, b) => (b.retrieval - a.retrieval) || (a.m.memorySeq - b.m.memorySeq));
  let mod = 0;
  const cited = [];
  for (const { m, overlap } of ranked.slice(0, L.memory.topK)) {
    if (overlap === 0) continue; // 무관한 기억은 기여하지 않음
    const scale = NEGATIVE_MEMORY_KINDS.includes(m.kind) ? -L.memory.negScale : L.memory.posScale;
    mod += m.importance * (1 + overlap) * scale;
    cited.push(m.memorySeq);
  }
  return { mod: clamp(mod, -MEMORY_MOD_CLAMP, MEMORY_MOD_CLAMP), cited };
}

// 현재 상태 유래 보정: 그 시설에서 수행 중인 친구/라이벌 (PLAN §2.5.C 분리 원칙)
export function stateModFor(world, sim, facilityId, L) {
  let mod = 0;
  for (const other of world.sims) {
    if (other.id === sim.id) continue;
    if (other.state.kind !== 'performing' || other.state.facilityId !== facilityId) continue;
    const tier = sim.relTiers[other.id];
    if (tier === 'friend') mod += L.social.friendStateBonus;
    else if (tier === 'rival') mod -= L.social.rivalStatePenalty;
  }
  return clamp(mod, -STATE_MOD_CLAMP, STATE_MOD_CLAMP);
}

export function computeTier(affinityVal, interactionCount, L) {
  if (affinityVal >= L.social.friendAffinity && interactionCount >= L.social.friendInteractions) return 'friend';
  if (affinityVal <= L.social.rivalAffinity && interactionCount >= L.social.rivalInteractions) return 'rival';
  if (interactionCount >= L.social.acquaintanceInteractions) return 'acquaintance';
  return 'stranger';
}

// 기억 kind → 습관 키의 행동 부분. 대처 행동 포함 — 반복 대처가 습관(중독)으로 창발 (§15.1.A)
const HABIT_KINDS = {
  meal: 'eat', work_done: 'work', small_talk: 'socialize', play_time: 'play',
  drank: 'drink', binge: 'binge_eat', hole_up: 'hole_up', workout: 'exercise',
  read_time: 'read', shopping: 'shop', home_meal: 'cook_eat', fishing: 'fish',
};

// 회고 (onEnterPerforming(sleep) 훅, PLAN §2.5.E). 멱등: lastReflectedDay + memorySeq 커서.
// transitionDay = floorDiv(t, 1440) (틱 내부 날짜 규약). rng 미소비.
export function runReflection(world, sim, t, emit) {
  const L = world.logic;
  const day = floorDiv(t, 1440);
  if (sim.lastReflectedDay >= day) return;

  // 커서 이후 **그리고 당일(transitionDay)** 기억만 처리 — 며칠 만의 첫 수면에서 과거 일자가
  // pendingMood·습관에 섞이지 않게 (PLAN §2.5.E "당일 기억 범위"). 커서는 전체를 지나간다.
  const fresh = sim.memories.filter(
    (m) => m.memorySeq >= sim.reflectionMemoryCursor && floorDiv(m.tick, 1440) === day);

  // 1) 관계 티어 갱신 — 경계 교차 시에만 이벤트 (D3)
  const newTierFacts = [];
  for (const other of world.sims) {
    if (other.id === sim.id) continue;
    const tier = computeTier(world.affinity[sim.id]?.[other.id] ?? 0,
      world.interactions[sim.id]?.[other.id] ?? 0, L);
    const prev = sim.relTiers[other.id] ?? 'stranger';
    if (tier !== prev) {
      // §23.32 카운터는 티어를 **쓰는 이 자리**에서만 움직인다 — 세는 곳이 없어야 싸다.
      if (prev === 'friend') sim.friendCount--;
      else if (prev === 'rival') sim.rivalCount--;
      if (tier === 'friend') sim.friendCount++;
      else if (tier === 'rival') sim.rivalCount++;
      if (tier === 'stranger') delete sim.relTiers[other.id];
      else sim.relTiers[other.id] = tier;
      emit('relationship_changed', sim.id, { withSimId: other.id, tier, prevTier: prev });
      newTierFacts.push(other.id);
    }
  }

  // 2) pendingMood — 당일 신규 기억의 부호 importance 가중합 (기상 시 적용)
  let moodSum = 0;
  for (const m of fresh) {
    const sign = NEGATIVE_MEMORY_KINDS.includes(m.kind) ? -1 : 1;
    moodSum += sign * m.importance * L.social.reflectionMoodScale;
  }
  sim.pendingMood = clamp(moodSum + worldEventMood(world, t), -10000, 10000);

  // 3) 습관 — 같은 행동×시설 반복 ≥ 임계 → 보너스 누적 (캡·일일 증가 상한, §G)
  const counts = new Map();
  for (const m of fresh) {
    const action = HABIT_KINDS[m.kind];
    if (!action || !m.placeId) continue;
    const key = `${action}:${m.placeId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...counts.entries()].sort()) {
    if (n < L.social.habitMinRepeats) continue;
    const hadHabit=Object.hasOwn(sim.habit,key),before = sim.habit[key] ?? 0;
    sim.habit[key] = Math.min(L.social.habitCap, before + L.social.habitIncrement);
    // §23.32 '즐겨 하는 일'의 문턱을 넘는 순간만 센다 (근무는 취미가 아니다)
    if (!key.startsWith('work:')) sim.habitCount = (sim.habitCount ?? 0)
      + Number(sim.habit[key] >= L.club.habitMin) - Number(hadHabit && before >= L.club.habitMin);
  }

  // 3.5) §17.5/§17.6: 연애 전이(파혼→결혼→탐색, 먼저 회고하는 쪽이 실행) + 동아리 가입
  romanceHook(world, sim, t, emit);
  clubHook(world, sim, t, emit);

  // 4) 커서·날짜 갱신 → 하루 1회, 재처리 없음. 회고 파생 기억은 커서 이후 삽입 → 일괄 퇴출 규칙 준수.
  sim.reflectionMemoryCursor = sim.memorySeq;
  sim.lastReflectedDay = day;
  for (const otherId of newTierFacts) {
    recordFact(sim, t, L, 'relationship_changed', {
      subjectSimId: otherId,
      tags: ['relationship', `sim:${otherId}`],
    });
  }
}
