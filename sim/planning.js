// Phase 4: 하루 계획 + 정보 확산 (PLAN §2.5 D/F, 델타 D4~D7). 정수 연산, 계획은 rng 미사용.
import { recordFact } from './cognition.js';
import { rngInt } from './prng.js';
import { workWindowFor, sleepWindowFor, slotMatches, dayHash, isWeekend } from './chrono.js';

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// 기상 시 하루 계획 생성 (sleep 완료 정산 직후, lastPlannedDay 가드는 호출자)
// 슬롯 배열 순서 = 우선순위: 식사 > 근무 > 여가 (D4, 겹칠 때 앞선 슬롯의 intent만 유효)
export function buildDailyPlan(sim, L, day) {
  const slots = [];
  slots.push({ from: L.plan.mealSlot1Start, to: L.plan.mealSlot1End, intent: 'eat' });
  slots.push({ from: L.plan.mealSlot2Start, to: L.plan.mealSlot2End, intent: 'eat' });
  // §17.13 개인 근무 창: 크로노타입·야근(일별 의사확률)·교대 반영 (to > 1440 자정 랩)
  const ww = workWindowFor(sim, L, day);
  if (ww) slots.push({ from: ww.from, to: ww.to, intent: 'work' });
  // 여가 의도 의사확률: p(사교)=100-EI — E 성향일수록 어울리는 날이 많고, I도 가끔 어울린다
  // §17.17 주말은 여가 창이 근무 시간대까지 확장 (근무 슬롯이 빠진 자리를 여가가 채움)
  slots.push({
    from: isWeekend(day) ? L.plan.mealSlot1End : L.plan.leisureStart, to: L.plan.leisureEnd,
    intent: dayHash(sim.id, day, 2) < (100 - sim.traits.mbti.EI) ? 'socialize' : 'play',
  });
  // §17.13 개인 수면 슬롯 (우선순위 최하 — 욕구 주도 수면의 타이밍만 끌어당김)
  const sw = sleepWindowFor(sim, L);
  slots.push({ from: sw.from, to: sw.to, intent: 'sleep' });
  return slots;
}

// planFactor (D4/D6): 토큰 끌림 > 슬롯 일치 > 중립. 위급 시 호출자가 100으로 강제.
export function planFactorFor(world, sim, action, facilityId, t, L) {
  if (action === 'socialize' && sim.knownTokens.length > 0) {
    for (const tokenId of sim.knownTokens) { // 정렬 저장 → tokenId asc
      const token = world.tokens.find((tk) => tk.tokenId === tokenId);
      if (token && token.placeId === facilityId
        && t >= token.scheduledTick - L.plan.partyWindowBefore && t <= token.expiresTick) {
        return { factor: L.plan.partyPullFactor, partyPull: true };
      }
    }
  }
  // §17.9 유세: 후보는 사교가 곧 선거운동 (파티 끌림 다음 우선순위)
  if (action === 'socialize' && world.campaigners.includes(sim.id)) {
    return { factor: L.election.campaignPull, partyPull: false, campaign: true };
  }
  const slots = sim.plan;
  if (Array.isArray(slots)) {
    const tod = t % 1440;
    // 활성 intent = tod를 포함하는 **첫** 슬롯 (배열 순서 = 우선순위, D4)
    const active = slots.find((slot) => slotMatches(slot, tod)); // §17.13 자정 랩 지원
    if (active && active.intent === action) {
      const factor = clamp(100 + floorDiv(L.plan.bonusMax * (100 - sim.traits.mbti.JP), 100), 100, 150);
      return { factor, partyPull: false };
    }
  }
  return { factor: 100, partyPull: false };
}

// 세계 이벤트 토큰 생성 (4단계, t % interval == generateAtTod) — rngSim 1드로우 (PLAN §F)
export function maybeGenerateToken(world, t, emit) {
  const L = world.logic;
  if (t % L.diffusion.intervalTicks !== L.diffusion.generateAtTod) return;
  const placeId = rngInt(world.rngSim, 2) === 0 ? 'cafe' : 'park';
  const day = floorDiv(t, 1440);
  const token = {
    tokenId: world.tokenCounter++,
    topic: 'gathering',
    originTick: t,
    scheduledTick: (day + 1) * 1440 + L.diffusion.scheduleTod,
    placeId,
    expiresTick: (day + 1) * 1440 + L.diffusion.scheduleTod + L.diffusion.expireAfter,
  };
  world.tokens.push(token);
  emit('token_created', null, { tokenId: token.tokenId, placeId, scheduledTick: token.scheduledTick });
  // 초기 전파: 외향성 상위 n명 (EI asc, 동점 id asc)
  const seeds = [...world.sims]
    .sort((a, b) => (a.traits.mbti.EI - b.traits.mbti.EI) || (a.id - b.id))
    .slice(0, L.diffusion.seedCount);
  for (const sim of seeds) learnToken(sim, token, t, world.logic);
}

export function learnToken(sim, token, t, L) {
  if (sim.knownTokens.includes(token.tokenId)) return false;
  sim.knownTokens.push(token.tokenId);
  sim.knownTokens.sort((a, b) => a - b);
  recordFact(sim, t, L, 'party_info', {
    placeId: token.placeId,
    tags: ['party', `facility:${token.placeId}`, 'socialize'],
  });
  return true;
}

// 페어 내 전파 (2b단계, 그 틱 호감도 변동 **이전** 값 사용, 토큰당 정확히 1드로우) (PLAN §F)
export function transferTokens(world, a, b, t, emit) {
  const L = world.logic;
  let transferred = 0;
  const union = [...new Set([...a.knownTokens, ...b.knownTokens])].sort((x, y) => x - y);
  for (const tokenId of union) {
    const token = world.tokens.find((tk) => tk.tokenId === tokenId);
    if (!token || t > token.expiresTick) continue; // expiresTick 포함 (D6 폐구간)
    const aKnows = a.knownTokens.includes(tokenId);
    const bKnows = b.knownTokens.includes(tokenId);
    if (aKnows === bKnows) continue; // 둘 다 알거나 둘 다 모름 → 시도 없음
    const [holder, receiver] = aKnows ? [a, b] : [b, a];
    const preAffinity = world.affinity[holder.id][receiver.id];
    const threshold = clamp(
      L.diffusion.transferBase
      + floorDiv(preAffinity, L.diffusion.transferAffinityDiv)
      + floorDiv(receiver.traits.mbti.TF, L.diffusion.transferTfDiv),
      50, 950);
    const roll = rngInt(world.rngSim, 1000); // 성공 여부와 무관하게 정확히 1드로우
    if (roll < threshold) { learnToken(receiver, token, t, L); transferred++; }
  }
  return transferred;
}

// 만료·모임 판정 (4단계): scheduledTick 도달 시 창발 참석자 수 집계 (PLAN §F)
export function expireAndMeasureTokens(world, t, emit) {
  for (const token of world.tokens) {
    if (t === token.scheduledTick) {
      let count = 0;
      for (const sim of world.sims) {
        if (sim.state.kind === 'performing' && sim.state.facilityId === token.placeId) count++;
      }
      emit('gathering', null, { tokenId: token.tokenId, placeId: token.placeId, count });
    }
  }
  const expired = world.tokens.filter((tk) => t > tk.expiresTick).map((tk) => tk.tokenId); // 만료는 expiresTick 다음 틱
  if (expired.length > 0) {
    world.tokens = world.tokens.filter((tk) => t <= tk.expiresTick);
    for (const sim of world.sims) {
      sim.knownTokens = sim.knownTokens.filter((id) => !expired.includes(id));
    }
  }
}
