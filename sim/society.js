// §17 사회 시스템: 이민·질병·선거·연애·동아리 — 전부 결정적 (서브순서는 PLAN §17.8).
import { rngInt } from './prng.js';
import { recordFact } from './cognition.js';
import { generateTraits, occupationAllowed } from './traits.js';
import { makeAbilities, aptitudeFor } from './abilities.js'; // §21.1 (RNG 미소비)
import { pairHash, dayHash, riskHash } from './chrono.js'; // §21.2 나눔 · §21.3 전직 · §22.2 사망 (rngSim 미소비)
import { IMMIGRANT_NAMES } from './world.js';
import { CLUBS, CLUB_MEETINGS, AFFINITY_MIN, AFFINITY_MAX } from './constants.js';
import { isResidence } from './map.js';
import { learnToken as learnTokenRef } from './planning.js';

// §17.9: 최근 커플 링 (최대 8, 오래된 것부터 퇴출; dating/married 별개 엔트리)
function pushRecentCouple(world, a, b, t, kind) {
  world.recentCouples.push({ a: Math.min(a, b), b: Math.max(a, b), day: Math.floor(t / 1440), kind });
  while (world.recentCouples.length > 8) world.recentCouples.shift();
}

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function scaleDelta(delta, factor) {
  const s = Math.sign(delta);
  return s * floorDiv(Math.abs(delta) * factor, 100);
}

// ---- §17.3 질병 ----

// 일일 위험 드로우 (심 id asc, 심당 정확히 1드로우 — 이미 감염자도 드로우는 소비, 무발병)
export function dailyDiseaseDraws(world, t, emit) {
  const D = world.logic.disease;
  for (const sim of world.sims) {
    const roll = rngInt(world.rngSim, 1000);
    if (sim.sick) continue;
    let p = D.basePermille;
    if (sim.needs.hunger === 0) p += D.starvingBonus;
    if (world.weather.kind === 'rain') p += D.rainBonus;
    if (sim.needs.energy < 2000) p += D.lowEnergyBonus;
    if (roll < p) infect(world, sim, t, emit);
  }
}

function infect(world, sim, t, emit) {
  sim.sick = { kind: 'cold', untilTick: t + world.logic.disease.durationTicks };
  emit('fell_sick', sim.id, { untilTick: sim.sick.untilTick });
  recordFact(sim, t, world.logic, 'sick', { tags: ['health'] });
}

// 전염 (페어링 서브순서 ②): 정확히 한쪽 감염 시 1드로우
export function contagionDraw(world, a, b, t, emit) {
  const aSick = a.sick !== null, bSick = b.sick !== null;
  if (aSick === bSick) return;
  const roll = rngInt(world.rngSim, 1000);
  if (roll < world.logic.disease.contagionPermille) {
    infect(world, aSick ? b : a, t, emit);
  }
}

// 자연 치유 (4단계 감쇠 루프에서 매 틱, 무드로우)
export function naturalRecovery(world, sim, t, emit) {
  if (sim.sick && t >= sim.sick.untilTick) {
    sim.sick = null;
    emit('recovered', sim.id, { how: 'natural' });
    recordFact(sim, t, world.logic, 'healed', { tags: ['health'] });
  }
}

// ---- §17.4 선거 ----

export function maybeElection(world, t, day, emit) {
  const E = world.logic.election;
  if (day === 0 || day % E.intervalDays !== 0 || world.lastElectionDay === day) return;
  world.lastElectionDay = day;
  // 인기 = 타 심들의 자신을 향한 양수 호감 합
  const pops = world.sims.map((s) => ({
    id: s.id,
    pop: world.sims.reduce((sum, o) => o.id === s.id ? sum : sum + Math.max(0, world.affinity[o.id][s.id]), 0),
  })).filter((x) => x.pop > 0).sort((a, b) => (b.pop - a.pop) || (a.id - b.id));
  if (pops.length === 0) return; // 무산 — 현 시장 유지 (PLAN §17.8)
  const candidates = pops.slice(0, 2).map((x) => x.id);
  const votes = new Map(candidates.map((c) => [c, 0]));
  for (const voter of world.sims) {
    let best = candidates[0];
    if (candidates.length > 1) {
      const a0 = world.affinity[voter.id][candidates[0]];
      const a1 = world.affinity[voter.id][candidates[1]];
      best = a1 > a0 ? candidates[1] : candidates[0]; // 동률 → 후보 배열 앞(인기·id 우선)
    }
    votes.set(best, votes.get(best) + 1);
  }
  let winner = candidates[0];
  if (candidates.length > 1 && votes.get(candidates[1]) > votes.get(candidates[0])) winner = candidates[1];
  world.mayorId = winner;
  emit('election', winner, {
    candidates, votes: candidates.map((c) => votes.get(c)),
  });
  const mayor = world.sims.find((s) => s.id === winner);
  recordFact(mayor, t, world.logic, 'elected', { tags: ['politics'] });
  for (const voter of world.sims) {
    if (voter.id !== winner) recordFact(voter, t, world.logic, 'voted', { subjectSimId: winner, tags: ['politics', `sim:${winner}`] });
  }
}

// §17.9 유세: D-campaignDays에 선거 규칙과 동일한 상위 2 계산·캐시, 선거 당일 직전 클리어
export function updateCampaigners(world, day) {
  const E = world.logic.election;
  const next = Math.ceil(day / E.intervalDays) * E.intervalDays;
  if (day % E.intervalDays === 0) { world.campaigners = []; return; } // 선거일: 클리어 (선거는 이후 실행)
  if (next - day <= E.campaignDays && next - day >= 1) {
    if (world.campaigners.length === 0) {
      const pops = world.sims.map((s) => ({
        id: s.id,
        pop: world.sims.reduce((sum, o) => o.id === s.id ? sum : sum + Math.max(0, world.affinity[o.id][s.id]), 0),
      })).filter((x) => x.pop > 0).sort((a, b) => (b.pop - a.pop) || (a.id - b.id));
      world.campaigners = pops.slice(0, 2).map((x) => x.id);
    }
  } else if (world.campaigners.length > 0) {
    world.campaigners = [];
  }
}

// §17.9 새해: 전원 age+1, 생애 주기 전직 (일일 평가 이민 다음 — 당일 이민자도 함께 나이 먹음)
export function maybeNewYear(world, t, day, emit) {
  const S = world.logic.society;
  if (day === 0 || day % S.yearDays !== 0) return; // §17.9 새해 — 노화·졸업·은퇴는 연 단위 유지
  emit('new_year', null, { year: floorDiv(day, S.yearDays) });
  for (const sim of world.sims) {
    // §22.2 상한을 없앴다. 예전엔 90에서 멈춰 '죽지 않는 90세'가 무한 누적됐다.
    sim.traits.age += 1;
    if (sim.traits.occupation === 'child' && sim.traits.age >= S.schoolAge) {
      sim.traits.occupation = 'student'; // §22.2 아이가 자라 학교에 간다
      emit('grew_up', sim.id, { age: sim.traits.age, to: 'student' });
    } else if (sim.traits.occupation === 'student' && sim.traits.age >= S.graduateAge) {
      // §18.T3: 가중 풀 단일 드로우 (51차 (a)) — 대학 보유 마을은 고급 직업 풀 append
      const G2 = world.logic.graduation;
      const hasUni = world.map.facilities.some((f) => f.type === 'university');
      const raw = hasUni ? [...G2.poolBase, ...G2.poolUni] : G2.poolBase;
      let pool = raw.filter((o) => occupationAllowed(o, sim.traits.age)); // §18.T3: 나이 제약 (52차)
      if (pool.length === 0) pool = ['office_worker']; // 폴백 풀 — 드로우 1회 계약 유지 (53차)
      // §21.1 적성 가중 (이슈 #62): 잘하는 쪽으로 기울되 이분법은 아니다.
      // 적성 높은 직업을 풀에 **여러 번 넣어** 확률을 올린다 — rngInt 드로우는 1회 그대로다.
      const A = world.logic.abilities;
      const weighted = [];
      for (const o of pool) {
        const reps = 1 + floorDiv(aptitudeFor(sim, o, world.logic) * A.aptitudePoolWeight, 10000);
        for (let r = 0; r < reps; r++) weighted.push(o);
      }
      sim.traits.occupation = weighted[rngInt(world.rngSim, weighted.length)];
      emit('graduated', sim.id, { to: sim.traits.occupation, uni: hasUni });
    } else if (sim.traits.occupation !== 'retired' && sim.traits.age >= S.retireAge) {
      sim.traits.occupation = 'retired';
      emit('retired_now', sim.id, {});
    }
  }
}

// §17.11 자녀 정착 (새해 평가 다음): 동거 married 부부, 가구 정원 여유 시 1드로우.
// 처리 순서(커플별 완결, min-id asc): id→이름→push→매트릭스→parents→호감 초기화→기억→이벤트.
// 신생 심은 그날의 남은 일일 시스템에 미참여(다음 틱부터 결정 참여) — Codex 30차 규칙.
export function maybeChildren(world, t, day, emit) {
  const S = world.logic.society;
  const F = world.logic.family;
  if (day === 0 || day % S.childCheckDays !== 0) return; // §17.13 월간 평가 (나이는 새해 유지)
  // married 페어 (min asc, 중복 제거)
  const pairs = [];
  for (const [aStr, b] of Object.entries(world.partners)) {
    const a = Number(aStr);
    if (a < b && world.partnerStage[a] === 'married') pairs.push([a, b]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  for (const [a, b] of pairs) {
    const pa = world.sims.find((s2) => s2.id === a);
    const pb = world.sims.find((s2) => s2.id === b);
    if (pa.homeId !== pb.homeId) continue; // 같은 집 필수 (드로우 없음)
    const home = world.map.facilities.find((f) => f.id === pa.homeId);
    const residents = world.sims.filter((s2) => s2.homeId === pa.homeId).length;
    // 정원 여유 또는 증축 여력(예비 슬롯) 필요 — 아이가 생기면 부모의 build(§15.1)가 발동하는 창발
    const extraLeft = Math.min(home.extraBedSlots?.length ?? 0, world.logic.build.maxExtraBeds)
      - (home.resources.length - 2);
    if (home.resources.length <= residents && extraLeft <= 0) continue; // (드로우 없음)
    const roll = rngInt(world.rngSim, 1000);
    if (roll >= F.childPermille) continue;
    // traits 생성 후 age/occupation 강제 — 소비된 두 드로우는 의도적 폐기 (결정적, Codex 30차)
    const traits = generateTraits(world.rngSim);
    // §22.2 아기로 태어난다. 예전엔 15세 청소년이 즉시 나타났다 — 자라는 시간이 없었다.
    traits.age = 0;
    traits.occupation = 'child';
    const id = nextSimId(world); // §22.2 sims 배열 끝이 아니라 전용 카운터 (사망 시 id 충돌 방지)
    const name = IMMIGRANT_NAMES[world.immigrantCounter % IMMIGRANT_NAMES.length];
    world.immigrantCounter++;
    const L = world.logic;
    const child = {
      id, name, homeId: pa.homeId, isPlayer: false, traits, mood: 0,
      x: home.door.x, y: home.door.y + 1,
      needs: { hunger: 7000, energy: 7000, social: 7000, fun: 7000 },
      money: L.occupations.child.startMoney,
      state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
      memories: [], memorySeq: 0, habit: {}, relTiers: {},
      lastReflectedDay: -1, reflectionMemoryCursor: 0, pendingMood: null,
      knownTokens: [], plan: null, lastPlannedDay: -1,
      hangoverUntil: -1, groceries: 0, sick: null, noPathCool: {}, patrolIdx: 0, hasCar: false, longTrips: 0, complaintCursor: 0, complaintDays: {},
      abilities: makeAbilities(world.seed, id), // §21.1 능력치 — 드로우 없이 seed·id에서 유도
      sharedDay: -1, sharedTo: [], // §21.2 나눔: 쌍당 하루 1회
      hungerZeroTicks: 0, // §22.2
    };
    world.sims.push(child);
    growIdMatrices(world); // §22.2 id 공간 기준 확장 (sims.length는 사망 후 어긋난다)
    world.parents[id] = [a, b];
    world.affinity[id][a] = 5000; world.affinity[a][id] = 5000;
    world.affinity[id][b] = 5000; world.affinity[b][id] = 5000;
    recordFact(pa, t, L, 'child', { subjectSimId: id, tags: [`sim:${id}`, 'family'] });
    recordFact(pb, t, L, 'child', { subjectSimId: id, tags: [`sim:${id}`, 'family'] });
    for (const other of world.sims) {
      if (other.id !== id && other.id !== a && other.id !== b) {
        recordFact(other, t, L, 'new_neighbor', { subjectSimId: id, tags: [`sim:${id}`, 'town'] });
      }
    }
    emit('child_settled', id, { name, parentA: a, parentB: b, homeId: pa.homeId });
  }
}

// §17.10 축제: 전 주민이 즉시 아는 마을 행사
export function maybeFestival(world, t, day, emit) {
  const S = world.logic.society;
  if (day === 0 || day % S.festivalDays !== 0) return;
  const token = {
    tokenId: world.tokenCounter++,
    topic: 'festival',
    originTick: t,
    scheduledTick: day * 1440 + 1140,
    placeId: 'park',
    expiresTick: day * 1440 + 1140 + 180,
  };
  world.tokens.push(token);
  emit('festival', null, { tokenId: token.tokenId, scheduledTick: token.scheduledTick });
  for (const sim of world.sims) learnTokenRef(sim, token, t, world.logic);
}

export function mayorStipend(world, t, emit) {
  if (world.mayorId === null) return;
  const mayor = world.sims.find((s) => s.id === world.mayorId);
  if (!mayor) return;
  // §17.15 수당은 국고 지출 — 잔고 내에서만 (재정난이면 미지급, 이벤트 없음)
  const pay = Math.min(world.logic.election.mayorStipend, world.treasury);
  if (pay <= 0) return;
  world.treasury -= pay;
  mayor.money += pay;
  emit('money_changed', mayor.id, { delta: pay, balance: mayor.money, action: 'mayor' });
}

// §17.15 복지: 일일 평가(수당 다음) — 잔고 < threshold 심에게, 국고 한도 + 일일 인원 캡.
//
// §20.1: **필요도 순(잔고 오름차순)** 으로 지급한다. 예전에는 world.sims를 id 오름차순으로
// 훑다가 캡에 닿으면 break 했는데, 빈곤층이 캡보다 많으면 id가 높은 빈곤층이 **영구히**
// 배제됐다 (이슈 #55: 잔고 0원인 #36이 14일간 한 번도 못 받는 동안 #4는 11번 받았다).
// 낮은 id는 받아서 문턱을 넘고, 다시 내려오면 또 먼저 받는 순환에 갇히는 구조였다.
//
// 정렬은 tick 내 순수 계산이라 rngSim을 소비하지 않는다. 동점은 id 오름차순으로 갈라
// 결정성을 보존한다. 캡은 정책 노브로 남긴다 — 순서만 바꿔도 가장 가난한 쪽부터 채워지고
// 받은 심은 문턱 위로 올라가 다음 날 자리를 비워주므로 **순환이 창발**한다.
export function applyWelfare(world, t, emit) {
  const E = world.logic.economy;
  // §18.T1: 정책 오버라이드 우선
  const amount = world.policy.welfareAmount ?? E.welfareAmount;
  const threshold = world.policy.welfareThreshold ?? E.welfareThreshold;
  const needy = world.sims
    .filter((s) => s.money < threshold)
    .sort((a, b) => (a.money - b.money) || (a.id - b.id));
  let paid = 0;
  for (const sim of needy) {
    if (paid >= E.welfareDailyCap || world.treasury < amount) break;
    world.treasury -= amount;
    sim.money += amount;
    paid++;
    emit('welfare_paid', sim.id, { amount, balance: sim.money, treasury: world.treasury });
  }
}

// ---- §17.1 이민 ----

export function maybeImmigration(world, t, day, emit) {
  const S = world.logic.society;
  const G = world.logic.growth;
  if (day === 0 || day % S.immigrationIntervalDays !== 0) return;
  // §17.21 평판 웨이브: 활기찬 마을일수록 여러 명이 온다 (각자 빈 침대 필요, 결정적)
  const wave = Math.min(G.immigWaveMax + world.cityTier, 1 + Math.floor(world.reputation / G.immigPerExtra)); // §18.T4 등급 캡 확장
  for (let wv = 0; wv < wave; wv++) immigrateOne(world, t, emit);
}

function immigrateOne(world, t, emit) {
  const beds = world.map.facilities.filter(isResidence)
    .reduce((n, f) => n + f.resources.length, 0);
  if (beds <= world.sims.length) return; // 집 없으면 안 온다
  // 빈 침대 있는 주거 (배열 순 — §18.T3 아파트 포함)
  const home = world.map.facilities
    .filter(isResidence)
    .find((f) => f.resources.length > world.sims.filter((s) => s.homeId === f.id).length);
  if (!home) return;
  const traits = generateTraits(world.rngSim); // §12.1 순서, rngSim 소비
  const name = IMMIGRANT_NAMES[world.immigrantCounter % IMMIGRANT_NAMES.length];
  world.immigrantCounter++;
  const id = nextSimId(world); // §22.2 (위와 동일)
  const L = world.logic;
  const sim = {
    id, name, homeId: home.id, isPlayer: false, traits, mood: 0,
    x: 2, y: 23, // 서쪽 도로 끝에서 걸어 들어온다
    needs: { hunger: 7000, energy: 7000, social: 7000, fun: 7000 },
    money: L.occupations[traits.occupation].startMoney,
    state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
    memories: [], memorySeq: 0, habit: {}, relTiers: {},
    lastReflectedDay: -1, reflectionMemoryCursor: 0, pendingMood: null,
    knownTokens: [], plan: null, lastPlannedDay: -1,
    hangoverUntil: -1, groceries: 0, sick: null, noPathCool: {}, patrolIdx: 0, hasCar: false, longTrips: 0, complaintCursor: 0, complaintDays: {},
      abilities: makeAbilities(world.seed, id), // §21.1 능력치 — 드로우 없이 seed·id에서 유도
      sharedDay: -1, sharedTo: [], // §21.2 나눔: 쌍당 하루 1회
  };
  world.sims.push(sim);
  // §22.4 이민자가 들고 오는 초기 자금도 마을 밖에서 들어온 돈이다 (G1 폐쇄 회계의 경계 유입).
  world.externalInflow = (world.externalInflow ?? 0) + sim.money;
  growIdMatrices(world); // §22.2 id 공간 기준 확장
  emit('immigrated', id, { name, occupation: traits.occupation, homeId: home.id });
  for (const other of world.sims) {
    if (other.id !== id) recordFact(other, t, L, 'new_neighbor', { subjectSimId: id, tags: [`sim:${id}`, 'town'] });
  }
}

// ---- §17.5 연애 (회고에서 호출 — 먼저 회고하는 쪽이 실행, PLAN §17.8) ----

export function applyRomance(world, sim, t, emit) {
  if (sim.traits.occupation === 'child') return; // §22.2 (91차 ②) 아이는 연애하지 않는다
  const R = world.logic.romance;
  const partner = world.partners[sim.id];
  // ① 파혼: 어느 한 방향 호감 < breakup
  if (partner !== undefined && world.partnerStage[sim.id] === 'dating') {
    const other = world.sims.find((s) => s.id === partner);
    if (world.affinity[sim.id][partner] < R.breakup || world.affinity[partner][sim.id] < R.breakup) {
      delete world.partners[sim.id]; delete world.partners[partner];
      delete world.partnerStage[sim.id]; delete world.partnerStage[partner];
      emit('broke_up', sim.id, { withSimId: partner });
      sim.mood = clamp(sim.mood - R.breakupMood, -10000, 10000);
      other.mood = clamp(other.mood - R.breakupMood, -10000, 10000);
      recordFact(sim, t, world.logic, 'heartbreak', { subjectSimId: partner, tags: [`sim:${partner}`, 'love'] });
      recordFact(other, t, world.logic, 'heartbreak', { subjectSimId: sim.id, tags: [`sim:${sim.id}`, 'love'] });
      return;
    }
  }
  // ①.5 §17.11: 별거 중인 부부는 회고마다 합가 재시도 (결혼 시점에 침대가 없었던 경우 —
  // 건설로 침대가 생기면 다음 회고에서 합침. 무드로우, 결혼 시 이주와 동일 규칙)
  if (partner !== undefined && world.partnerStage[sim.id] === 'married') {
    const other = world.sims.find((s2) => s2.id === partner);
    if (other.homeId !== sim.homeId) {
      const [lo, hi] = sim.id < partner ? [sim, other] : [other, sim];
      const loHome = world.map.facilities.find((f) => f.id === lo.homeId);
      const residents = world.sims.filter((s2) => s2.homeId === lo.homeId).length;
      if (loHome.resources.length > residents) {
        const from = hi.homeId;
        hi.homeId = lo.homeId;
        emit('moved_home', hi.id, { from, to: lo.homeId });
      } else {
        // 신혼집: 두 자리 빈 집(facilityId asc)으로 부부가 함께 이사
        const fresh = world.map.facilities.find((f) => isResidence(f)
          && f.resources.length - world.sims.filter((s2) => s2.homeId === f.id).length >= 2);
        if (fresh) {
          for (const mover of [lo, hi]) {
            const from = mover.homeId;
            mover.homeId = fresh.id;
            emit('moved_home', mover.id, { from, to: fresh.id });
          }
        }
      }
    }
  }
  // ② 결혼
  if (partner !== undefined && world.partnerStage[sim.id] === 'dating') {
    const mutual = Math.min(world.affinity[sim.id][partner], world.affinity[partner][sim.id]);
    if (mutual >= R.marryMin && world.interactions[sim.id][partner] >= R.marryInteractions) {
      world.partnerStage[sim.id] = 'married';
      world.partnerStage[partner] = 'married';
      emit('married', sim.id, { withSimId: partner });
      const other = world.sims.find((s) => s.id === partner);
      recordFact(sim, t, world.logic, 'wedding', { subjectSimId: partner, tags: [`sim:${partner}`, 'love'] });
      recordFact(other, t, world.logic, 'wedding', { subjectSimId: sim.id, tags: [`sim:${sim.id}`, 'love'] });
      pushRecentCouple(world, sim.id, partner, t, 'married');
      // §17.9 결혼식 잔치 — 회고 중 즉시 생성 (tokenCounter는 전역 단조·파이프라인 순서로 결정적)
      const day0 = floorDiv(t, 1440);
      const wtoken = {
        tokenId: world.tokenCounter++,
        topic: 'wedding',
        originTick: t,
        scheduledTick: (day0 + 1) * 1440 + 1140,
        placeId: 'park',
        expiresTick: (day0 + 1) * 1440 + 1140 + 120,
      };
      world.tokens.push(wtoken);
      emit('token_created', sim.id, { tokenId: wtoken.tokenId, placeId: 'park', scheduledTick: wtoken.scheduledTick, wedding: true });
      // 부부 + 각자의 friend 티어에게 즉시 인지 (id 오름차순)
      const invitees = new Set([sim.id, partner]);
      for (const s2 of world.sims) {
        if (sim.relTiers[s2.id] === 'friend' || other.relTiers[s2.id] === 'friend') invitees.add(s2.id);
      }
      for (const id of [...invitees].sort((a, b) => a - b)) {
        const guest = world.sims.find((s2) => s2.id === id);
        if (guest) learnTokenRef(guest, wtoken, t, world.logic);
      }
      // 이주: id 높은 쪽이 낮은 쪽 집으로 (빈 침대 있을 때만 — 없으면 건설 수요로 해소될 때까지 대기)
      const [lo, hi] = sim.id < partner ? [sim, other] : [other, sim];
      const loHome = world.map.facilities.find((f) => f.id === lo.homeId);
      const residents = world.sims.filter((s) => s.homeId === lo.homeId).length;
      if (hi.homeId !== lo.homeId && loHome.resources.length > residents) {
        const from = hi.homeId;
        hi.homeId = lo.homeId;
        emit('moved_home', hi.id, { from, to: lo.homeId });
      }
      return;
    }
  }
  // ③ 새 연애 탐색 (미혼만)
  if (partner === undefined) {
    let best = null, bestMutual = 0;
    for (const other of world.sims) {
      if (other.id === sim.id || world.partners[other.id] !== undefined) continue;
      if (other.traits.occupation === 'child') continue; // §22.2 아이는 상대가 되지 않는다
      const mutual = Math.min(world.affinity[sim.id][other.id], world.affinity[other.id][sim.id]);
      if (mutual >= R.datingMin && world.interactions[sim.id][other.id] >= R.datingInteractions
        && (mutual > bestMutual || (mutual === bestMutual && best !== null && other.id < best.id))) {
        best = other; bestMutual = mutual;
      }
    }
    if (best) {
      world.partners[sim.id] = best.id; world.partners[best.id] = sim.id;
      world.partnerStage[sim.id] = 'dating'; world.partnerStage[best.id] = 'dating';
      emit('started_dating', sim.id, { withSimId: best.id });
      pushRecentCouple(world, sim.id, best.id, t, 'dating');
      recordFact(sim, t, world.logic, 'love', { subjectSimId: best.id, tags: [`sim:${best.id}`, 'love'] });
      recordFact(best, t, world.logic, 'love', { subjectSimId: sim.id, tags: [`sim:${sim.id}`, 'love'] });
    }
  }
}

// ---- §17.6 동아리 ----

export function checkClubJoin(world, sim, t, emit) {
  const L = world.logic;
  for (const club of CLUBS) {
    if ((sim.habit[club.habitKey] ?? 0) < L.club.habitMin) continue;
    if (world.clubs[club.id].includes(sim.id)) continue;
    world.clubs[club.id].push(sim.id);
    world.clubs[club.id].sort((a, b) => a - b);
    emit('joined_club', sim.id, { clubId: club.id });
    recordFact(sim, t, L, 'club_joined', { placeId: CLUB_MEETINGS[club.id].placeId, tags: ['club'] });
  }
}

// 주간 모임 토큰 (4단계 토큰 생성 다음, 클럽 id 순): 멤버 전원 즉시 인지
export function clubMeetingTokens(world, t, emit, learnToken) {
  const day = floorDiv(t, 1440);
  const tod = t % 1440;
  for (const club of CLUBS) {
    const m = CLUB_MEETINGS[club.id];
    if (day % 7 !== m.dow || tod !== m.tod) continue;
    const members = world.clubs[club.id];
    if (members.length < 2) continue;
    const token = {
      tokenId: world.tokenCounter++,
      topic: 'club',
      originTick: t,
      scheduledTick: t + 120,
      placeId: m.placeId,
      expiresTick: t + 240,
    };
    world.tokens.push(token);
    emit('token_created', null, { tokenId: token.tokenId, placeId: m.placeId, scheduledTick: token.scheduledTick, clubId: club.id });
    for (const id of members) {
      const sim = world.sims.find((s) => s.id === id);
      if (sim) learnToken(sim, token, t, world.logic);
    }
  }
}

// ---- §17.7 사회적 영향: 험담이 청자→대상 호감도를 바꾼다 ----
export function applyGossipInfluence(world, listener, aboutSimId, sentiment, emit) {
  if (aboutSimId === null || aboutSimId === undefined || sentiment === 0) return;
  const L = world.logic;
  const factor = L.affinity.tfScaleBase + listener.traits.mbti.TF;
  const delta = scaleDelta(sentiment * L.influence.gossipDelta, factor);
  world.affinity[listener.id][aboutSimId] = clamp(
    world.affinity[listener.id][aboutSimId] + delta, AFFINITY_MIN, AFFINITY_MAX);
}

// 페어의 관계 보너스(동아리 동료·연인) — 호감도 델타에 가산할 값
export function pairDeltaBonus(world, a, b) {
  const L = world.logic;
  let bonus = 0;
  if (world.partners[a.id] === b.id) bonus += L.romance.sweetTalkDelta;
  // §17.11 가족(부모-자녀)
  if ((world.parents[a.id] ?? []).includes(b.id) || (world.parents[b.id] ?? []).includes(a.id)) {
    bonus += L.family.familyBonus;
  }
  for (const club of CLUBS) {
    const mem = world.clubs[club.id];
    if (mem.includes(a.id) && mem.includes(b.id)) { bonus += L.club.pairBonus; break; }
  }
  // §17.18 삼각 폐쇄(Science Advances aax7310): 공통 친구 수에 비례한 가산 (캡, 그라데이션)
  const T = L.triad;
  if (T) {
    let common = 0;
    for (const [cid, tier] of Object.entries(a.relTiers)) {
      if (tier === 'friend' && b.relTiers[cid] === 'friend') common++;
      if (common >= T.maxCommon) break;
    }
    bonus += common * T.perFriendBonus;
  }
  return bonus;
}

// ---- §17.20 사건: 화재 ----

// 일일 화재 드로우 (§17.8 ①.5 — 질병 다음): 시설 배열 순, 시설당 정확히 1드로우.
// 이미 불타는 시설도 드로우는 소비(무발화) — 드로우 수 불변 계약.
export function dailyFireDraws(world, t, emit) {
  const I = world.logic.incidents;
  for (const fac of world.map.facilities) {
    if (!fac.w || fac.type === 'park' || fac.type === 'pond') continue;
    const roll = rngInt(world.rngSim, 1000);
    if (world.incidents.some((inc) => inc.facilityId === fac.id)) continue;
    let p = I.fireBasePermille;
    if (fac.type === 'restaurant' || fac.type === 'cafe') p += I.kitchenBonusPermille;
    if (roll < p) {
      world.incidents.push({ type: 'fire', facilityId: fac.id, sinceTick: t });
      emit('fire_started', null, { facilityId: fac.id });
    }
  }
}

// 자연 진화 (4단계 매 틱): 방치된 불은 스스로 꺼지지만 마을 평판이 타격을 입는다.
export function fireSelfOut(world, t, emit) {
  const I = world.logic.incidents;
  for (let i = world.incidents.length - 1; i >= 0; i--) {
    const inc = world.incidents[i];
    if (t - inc.sinceTick >= I.selfOutTicks) {
      world.incidents.splice(i, 1);
      world.reputation = Math.max(0, world.reputation - I.selfOutRepPenalty);
      emit('fire_out', null, { facilityId: inc.facilityId, by: 'self' });
    }
  }
}

// 진압 완료 정산: 사건 제거 + 목격자 호감 + 영웅 기억
export function resolveFire(world, sim, facilityId, t, emit) {
  const idx = world.incidents.findIndex((inc) => inc.facilityId === facilityId);
  if (idx < 0) return false; // 이미 꺼짐 (자연 진화 레이스) — 무해
  const I = world.logic.incidents;
  world.incidents.splice(idx, 1);
  emit('fire_out', null, { facilityId, by: sim.id });
  const fac = world.map.facilities.find((f) => f.id === facilityId);
  for (const other of world.sims) {
    if (other.id === sim.id) continue;
    const d = Math.abs(other.x - fac.x) + Math.abs(other.y - fac.y);
    if (d <= I.heroRadius) {
      world.affinity[other.id][sim.id] = clamp(world.affinity[other.id][sim.id] + I.heroAffinity, AFFINITY_MIN, AFFINITY_MAX);
    }
  }
  emit('heroic_save', sim.id, { facilityId });
  recordFact(sim, t, world.logic, 'heroic', { placeId: facilityId, tags: ['respond_fire', `facility:${facilityId}`] });
  return true;
}

// ---- §18.T4 도시 등급 ----

// 승급 판정 (일일 평가 — 이민 직후·새해 전, 49차 합의): 최고 도달 등급으로 1회 승급, 비가역.
export function maybePromotion(world, t, emit) {
  const L = world.logic;
  const pop = world.sims.length;
  let target = world.cityTier;
  for (let i = world.cityTier + 1; i < L.tiers.length; i++) {
    if (pop >= L.tiers[i].popMin) target = i;
  }
  if (target === world.cityTier) return;
  const from = world.cityTier;
  world.cityTier = target;
  emit('city_promoted', null, { from, to: target, nameKo: L.tiers[target].nameKo, pop });
  world.reputation = Math.min(L.growth.repCap, world.reputation + L.promotion.repBonus);
  for (const sim of world.sims) { // id asc — 합의: 사실 발생 mood 델타 (clamp)
    sim.mood = clamp(sim.mood + L.promotion.moodBonus, -10000, 10000);
    recordFact(sim, t, L, 'celebration', { tags: ['festival'] });
  }
}

// §18.T4: 현재 등급에서 zone 허용 타입 (기본 + 누적 언락)
export function zoneAllowedTypes(world) {
  const out = ['house', 'cafe', 'office', 'park'];
  for (let i = 1; i <= world.cityTier; i++) out.push(...world.logic.tiers[i].unlocks);
  return out;
}


// §19 R-B 자가용 구매 (회고 1회당 최대 1대, 중복 불가 — 64차 (d)). RNG 없음.
// 장거리 이동이 반복되면 차를 산다: 이동 수요가 수단을 만든다(4단계 모델의 ABM 대체).
export function maybeBuyCar(world, sim, t, emit) {
  const T = world.logic.transport;
  if (sim.hasCar) return;
  if (sim.longTrips < T.carTripsMin) return;
  if (sim.money < T.carPrice) return;
  sim.money -= T.carPrice;
  sim.hasCar = true;
  world.treasury += floorDiv(T.carPrice * world.logic.economy.taxPct, 100); // 취득세 — 국고 순환
  emit('car_bought', sim.id, { price: T.carPrice, longTrips: sim.longTrips, balance: sim.money });
  recordFact(sim, t, world.logic, 'milestone', { tags: ['car'] });
}

// ---- §19.5 시민 불만 → 집단 청원 (Granovetter 문턱 모델, Codex 70차 조건 반영) ----

// 회고 직후 호출. **커서 이후 신규 기억만** 집계해 중복 가산을 막는다(70차 ①). 드로우 0.
export function collectComplaints(world, sim, t, emit) {
  const C = world.logic.complaints;
  const day = floorDiv(t, 1440);
  const fresh = sim.memories.filter((m) => m.memorySeq >= sim.complaintCursor);
  if (fresh.length === 0) return;
  sim.complaintCursor = sim.memorySeq; // 다음 회고는 이 이후만 본다

  const counts = new Map(); // `${kind}|${placeId}` → n
  for (const m of fresh) {
    let kind = null;
    if (m.kind === 'lonely') kind = 'lonely';
    else if (m.kind === 'starving') kind = 'hungry';
    else if (m.kind === 'unmet') { // §19.5/§19.10: 위급한데 못 한 이유별로 분화 (이슈 #49)
      if (m.tags.includes('no_money')) kind = 'no_money';
      else if (m.tags.includes('blocked')) kind = 'blocked';
      else kind = 'no_facility';
    }
    if (!kind) continue;
    const key = `${kind}|${m.placeId ?? ''}`; // no_facility의 placeId에는 막힌 행동이 들어간다
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...counts.entries()].sort()) { // 키 정렬 — 결정적
    const [kind, placeId] = key.split('|');
    if (kind === 'lonely' && n < C.lonelyMin) continue;
    const found = world.complaints.find((x) => x.kind === kind && x.placeId === placeId);
    if (found) { // 기존 항목은 배열 위치 유지 (70차 ④)
      found.count += n;
      found.severity = Math.min(100, found.severity + n);
    } else {
      world.complaints.push({ kind, placeId, severity: Math.min(100, n), sinceDay: day, count: n });
    }
    sim.complaintDays[kind] = day; // §19.7 이 심이 이 종류로 불만을 제기한 날 (사람 수 판정용)
  }
  // 캡 초과 시 oldest-first 제거 (sinceDay asc, 동률은 배열 순 — 70차 ④)
  while (world.complaints.length > C.cap) {
    let oldest = 0;
    for (let i = 1; i < world.complaints.length; i++) {
      if (world.complaints[i].sinceDay < world.complaints[oldest].sinceDay) oldest = i;
    }
    world.complaints.splice(oldest, 1);
  }
}

// 일일 평가에서 호출 (평판 감쇠 다음·이민 전 — 70차 ③). kind별 문턱 초과 시 1회 청원,
// 문턱 아래로 내려가야 재무장(70차 ②). RNG 없음.
export function maybePetition(world, t, day, emit) {
  const C = world.logic.complaints;
  const pop = world.sims.length;
  const threshold = floorDiv(pop * C.petitionPct, 100);
  // §19.7 (이슈 #45): 사건 수가 아니라 **최근 windowDays 내에 그 불만을 제기한 사람 수**로
  // 판정한다. 한 명이 하루 열 번 외로워도 한 사람이다 — Granovetter 모델의 원의미.
  // 72차 ①: 현재 complaints의 kind + 이미 추적 중인 petitions 키의 **합집합**을 순회한다.
  // 감쇠로 마지막 불만이 사라진 kind가 armed=false로 남으면 영영 재무장되지 않는다.
  const kinds = new Set([...world.complaints.map((c) => c.kind), ...Object.keys(world.petitions)]);
  const byKind = new Map();
  for (const kind of kinds) {
    let people = 0;
    for (const s2 of world.sims) {
      const d = s2.complaintDays?.[kind];
      if (d !== undefined && day - d <= C.windowDays) people++;
    }
    byKind.set(kind, people);
  }
  for (const kind of [...byKind.keys()].sort()) { // kind asc — 결정적
    const total = byKind.get(kind);
    const st = world.petitions[kind] ?? { lastDay: -1, armed: true };
    if (total > threshold && st.armed) {
      world.reputation = Math.max(0, world.reputation - C.petitionRepPenalty);
      emit('petition', null, { kind, total, threshold, pop });
      world.petitions[kind] = { lastDay: day, armed: false };
    } else if (total <= threshold && !st.armed) {
      world.petitions[kind] = { lastDay: st.lastDay, armed: true }; // 재무장
    } else if (!world.petitions[kind]) {
      world.petitions[kind] = st;
    }
  }
}


// §19.7 불만 망각 (이슈 #45): 일일 감쇠로 count·severity를 줄이고 0이 되면 제거한다.
// 문제가 개선되면 문턱 아래로 내려가 청원이 재무장하고, 지속되면 다시 쌓여 재발화한다.
// 누적만 하면 재무장이 영원히 불가능해져 루프가 1회성으로 동결된다(라이브에서 실제 발생).
export function decayComplaints(world) {
  const C = world.logic.complaints;
  for (let i = world.complaints.length - 1; i >= 0; i--) {
    const c = world.complaints[i];
    c.count = floorDiv(c.count * C.decayPct, 100);
    c.severity = floorDiv(c.severity * C.decayPct, 100);
    if (c.count <= 0) world.complaints.splice(i, 1); // 잊힌 불만은 사라진다
  }
}

// ---- §21.2 나눔 — 가까운 사람이 곤경이면 돕는다 (이슈 #43/#51, 사용자 규칙 §0.1) ----
//
// 관찰에서 나온 행동이다: 빈곤층 10명 중 8명이 **은퇴자**였다. retired는 wagePct가 0이라
// 소득 경로가 아예 없고, 저축을 다 쓰면 굶는다. 복지는 하루 5명 캡이라 은퇴자 11명을 못 받친다.
//
// 여기서 복지 캡을 올리면 지표는 내려가지만 그건 계기판을 손으로 누르는 것이다(§0.1).
// 대신 사람이 실제로 하는 행동을 준다 — **만나서, 곤경에 처한 가까운 사람에게 나눠준다.**
// 그래서 이 행동은 사교 페어링 안에서만 일어난다: 관계가 있어야 하고, 만나야 한다.
// §20.3 사회적 중력으로 만남이 늘어난 것이 여기로 연결된다.
//
// rngSim을 소비하지 않는다 — dayHash 의사확률이라 드로우 순서 계약이 불변이다.
// 심 사이의 이전이라 통화 총량은 보존된다(생성도 소멸도 아니다).
export function maybeShare(world, a, b, t, day, emit) {
  const S = world.logic.sharing;
  for (const [giver, taker] of [[a, b], [b, a]]) {
    if (taker.money >= S.needyBelow) continue;          // 곤경이 아니면 도울 일이 없다
    if (giver.money < S.giverKeepMin + S.amount) continue; // 주는 쪽도 살아야 한다
    // §21.2 (83차 ③) **쌍당 하루 1회**. 같은 날 같은 두 사람이 여러 번 마주쳐도 한 번만 준다 —
    // 하루에 같은 사람에게 거듭 쥐여주는 건 사람의 행동이 아니다. giverKeepMin은 주는 쪽의
    // 빈곤만 막을 뿐 반복 이체를 막지 못하므로 상태로 명시한다.
    if (giver.sharedDay !== day) { giver.sharedDay = day; giver.sharedTo = []; }
    if (giver.sharedTo.includes(taker.id)) continue;
    // 관계가 가까울수록 잘 돕는다 — 이분 컷이 아니라 확률 가중 (사용자 규칙)
    let pct = S.basePct;
    if (giver.homeId === taker.homeId) pct += S.householdBonusPct; // 한집 식구
    if (world.partners[giver.id] === taker.id) pct += S.partnerBonusPct;
    const tier = giver.relTiers[taker.id];
    if (tier === 'friend') pct += S.friendBonusPct;
    else if (tier === 'rival') continue;                // 사이가 나쁘면 돕지 않는다
    if (pairHash(giver.id, taker.id, day, 41) >= Math.min(100, pct)) continue;
    giver.sharedTo.push(taker.id);
    giver.money -= S.amount;
    taker.money += S.amount;
    emit('money_shared', giver.id, {
      toSimId: taker.id, amount: S.amount,
      giverBalance: giver.money, takerBalance: taker.money,
      relation: giver.homeId === taker.homeId ? 'household' : (tier ?? 'stranger'),
    });
  }
}

// ---- §21.3 전직 — 손님은 있는데 일할 사람이 없다 (이슈 #63, 사용자 규칙 §0.1) ----
//
// §20.2 매출 원장이 문제를 드러냈다: restaurant에 24,400원, market에 4,200원이 쌓이는데
// 두 곳 다 **근무자가 없다**. 민간 임금 직군이 barista 하나뿐이라 돈이 고이기만 한다.
//
// 시설을 더 짓거나 매출을 재분배하는 처방은 계기판을 누르는 것이다(§0.1).
// 대신 사람이 실제로 하는 행동을 준다 — **손님이 몰린 가게에 누군가 그 일을 하러 간다.**
// 그래서 chef·clerk는 아무도 그 직업으로 **태어나지 않는다**(SWITCH_ONLY). 수요가 만든다.
//
// rngSim 미소비(dayHash), 인구 직접 조작 없음. 옮기는 것은 기존 심의 직업뿐이다.
export function maybeJobSwitch(world, t, day, emit) {
  const L = world.logic;
  const I = L.industry;
  // §21.3 (86차 ①): **정렬 필수**. Object.keys는 params 객체의 삽입 순서를 따르는데,
  // 로직 파일을 손으로 고쳐 키 순서가 바뀌면 같은 날 후보가 달라진다.
  // canonical hash가 키 순서를 무시한다면 '같은 로직 해시인데 다른 결과'가 되어버린다.
  for (const facType of Object.keys(I.openings).sort()) {
    const occ = I.openings[facType];
    const facs = world.map.facilities.filter((f) => f.type === facType);
    if (facs.length === 0) continue;
    // 수요 신호: 손님이 실제로 돈을 쓴 만큼만 사람을 쓴다
    let revenue = 0;
    for (const f of facs) revenue += f.revenue ?? 0;
    if (revenue < I.minRevenueToHire) continue;
    let have = 0;
    for (const s of world.sims) if (s.traits.occupation === occ) have++;
    if (have >= facs.length * I.workersPerFacility) continue;
    // 후보: 근로 가능하고, **지금 하는 일보다 이 일을 더 잘하는** 사람
    const cands = [];
    for (const s of world.sims) {
      if (s.traits.occupation === occ) continue;
      if (!occupationAllowed(occ, s.traits.age)) continue;
      if (s.traits.occupation === 'retired' || s.traits.occupation === 'student') continue;
      const gain = aptitudeFor(s, occ, L) - aptitudeFor(s, s.traits.occupation, L);
      if (gain < I.minAptGain) continue; // 잦은 이직 방지 — 확실히 더 잘할 때만 옮긴다
      cands.push(s);
    }
    if (cands.length === 0) continue;
    // 적성 높은 순, 동점은 id 오름차순 — 전순서라 정렬 안정성에 기대지 않는다
    cands.sort((a, b) => (aptitudeFor(b, occ, L) - aptitudeFor(a, occ, L)) || (a.id - b.id));
    const pick = cands[0];
    // 이분 컷이 아니라 확률: 적성이 높을수록 잘 옮긴다
    const apt = aptitudeFor(pick, occ, L);
    const pct = Math.min(I.switchMaxPct, floorDiv(apt * I.switchPctPerApt, 100));
    if (dayHash(pick.id, day, 53) >= pct) continue;
    const from = pick.traits.occupation;
    pick.traits.occupation = occ;
    emit('job_changed', pick.id, { from, to: occ, facilityType: facType, aptitude: apt, revenue });
  }
}

// ---- §22.2 생애 주기: 출생과 사망 (사용자 지시) ----
//
// 사용자 지시: "사람의 능력치나 외부 요인등으로 사망하는 시나리오가 들어가야
// 실제 인간세계에 가깝게 구현이 될 거잖아"
//
// 이전 세계의 문제: 사망 코드가 한 줄도 없었고 나이는 Math.min(90, age+1)로 90에서 멈췄다.
// 즉 **죽지 않는 90세가 무한 누적**되는 구조였다. 출생도 15세 청소년이 즉시 나타나
// 자라는 시간이 없었다.

// 새 심 id 전용 카운터. 예전엔 `sims[sims.length-1].id + 1`이었는데, 사망으로 마지막 심이
// 사라지면 이미 쓰인 id를 재발급해 행렬·관계가 뒤엉킨다.
export function nextSimId(world) {
  if (world.nextSimId === undefined) {
    world.nextSimId = world.sims.reduce((m, s) => Math.max(m, s.id), -1) + 1;
  }
  return world.nextSimId++;
}

// id로 인덱싱되는 행렬들을 id 공간(nextSimId) 크기로 맞춘다.
// 예전엔 `new Array(sims.length)`였는데 사망 후에는 sims.length < maxId라 행이 짧아져
// undefined 접근이 난다 (89차 ③).
export function growIdMatrices(world) {
  const n = world.nextSimId ?? (world.sims.reduce((m, s) => Math.max(m, s.id), -1) + 1);
  const fit = (mat, fill) => {
    for (const row of mat) while (row.length < n) row.push(fill);
    while (mat.length < n) mat.push(new Array(n).fill(fill));
  };
  fit(world.affinity, 0);
  fit(world.interactions, 0);
  fit(world.lastGreetDay, -1);
}

// 하루치 사망 위험 (10만분율). 이분 컷이 아니라 **가중 합**이다.
export function deathRiskPer100k(world, sim, L) {
  const D = L.mortality;
  const age = sim.traits.age;
  // 노화: (나이-바닥)³ / 제수. 40세까지 0이고 그 뒤로 가파르게 오른다.
  let risk = 0;
  if (age > D.ageFloor) {
    const d = age - D.ageFloor;
    risk = floorDiv(d * d * d, D.ageDivisor);
  }
  // 외부 요인 ①: 굶은 채 머문 시간 (§21.2에서 배운 축 — 전이 횟수가 아니라 머문 시간)
  const starved = sim.hungerZeroTicks ?? 0;
  if (starved > D.starveGraceTicks) {
    risk += floorDiv((starved - D.starveGraceTicks) * D.starvePer100kPer100Ticks, 100);
  }
  // 외부 요인 ②: 질병
  if (sim.sick) risk = floorDiv(risk * D.sickMultPct, 100) + D.sickFlat;
  // 능력치: 체력이 낮을수록 위험하다 (기울기)
  const stam = sim.abilities?.stamina ?? 50;
  risk = floorDiv(risk * (100 + floorDiv((50 - stam) * D.staminaSpanPct, 100)), 100);
  return Math.max(0, Math.min(D.maxPer100k, risk));
}

// 사망 처리 — 심을 실제로 제거하고 남은 참조를 정리한다 (89차 ③의 정리 목록).
// 행렬은 묘비로 남긴다(행을 지우면 id 인덱싱이 무너진다).
function removeSim(world, sim, t, emit, cause) {
  const id = sim.id;
  // 예약 해제 — 죽은 사람이 자리를 붙들고 있으면 안 된다
  if (sim.state.facilityId !== null && sim.state.resourceId !== null) {
    const key = `${sim.state.facilityId}:${sim.state.resourceId}`;
    if (world.reservations[key] === id) delete world.reservations[key];
  }
  // 배우자 사별
  const partner = world.partners[id];
  if (partner !== undefined) {
    delete world.partners[id]; delete world.partners[partner];
    delete world.partnerStage[id]; delete world.partnerStage[partner];
    const p = world.sims.find((s) => s.id === partner);
    if (p) {
      p.mood = clamp(p.mood + world.logic.mood.starving, -10000, 10000); // 사별은 깊은 상실 (starving은 음수 상수)
      recordFact(p, t, world.logic, 'bereaved', { subjectSimId: id, tags: [`sim:${id}`, 'family'] });
      emit('bereaved', partner, { lostSimId: id });
    }
  }
  if (world.mayorId === id) world.mayorId = null; // 다음 선거에서 다시 뽑힌다
  // 분실물 보관자가 죽으면 물건은 주인에게 갈 길이 없다 — 목록에서 뺀다
  world.lostAndFound = world.lostAndFound.filter((lf) => lf.finderId !== id);
  delete world.parents[id];
  // §22.2 (91차 ①) 남은 참조 정리 — 빠뜨리면 죽은 사람이 계속 언급된다.
  // 자녀의 부모 목록에서 뺀다. interaction.js의 family_talk가 죽은 부모를 참조하지 않게.
  for (const childId of Object.keys(world.parents)) {
    const ps = world.parents[childId];
    if (ps.includes(id)) {
      const left = ps.filter((p) => p !== id);
      if (left.length === 0) delete world.parents[childId];
      else world.parents[childId] = left;
    }
  }
  // 동아리 명단
  for (const key of Object.keys(world.clubs)) {
    const i = world.clubs[key].indexOf(id);
    if (i >= 0) world.clubs[key].splice(i, 1);
  }
  // §21.2 나눔의 '오늘 준 사람' 목록
  for (const s of world.sims) {
    if (s.sharedTo?.length) {
      const i = s.sharedTo.indexOf(id);
      if (i >= 0) s.sharedTo.splice(i, 1);
    }
  }
  const idx = world.sims.findIndex((s) => s.id === id);
  if (idx >= 0) world.sims.splice(idx, 1);
  emit('died', id, { name: sim.name, age: sim.traits.age, cause, pop: world.sims.length });
}

// 일일 사망 판정 (id 오름차순 — 선거·수당·이민보다 먼저, 89차 ③).
// riskHash라 rngSim을 소비하지 않는다. 인구를 직접 조작하지 않는다 —
// 죽음은 나이·체력·질병·굶주림이라는 **조건에서 창발**한다.
export function maybeDeaths(world, t, day, emit) {
  const L = world.logic;
  const doomed = [];
  for (const sim of world.sims) { // sims는 id asc 유지
    const risk = deathRiskPer100k(world, sim, L);
    if (risk <= 0) continue;
    if (riskHash(sim.id, day, 71) >= risk) continue;
    const starved = (sim.hungerZeroTicks ?? 0) > L.mortality.starveGraceTicks;
    doomed.push([sim, sim.sick ? 'illness' : (starved ? 'starvation' : 'age')]);
  }
  for (const [sim, cause] of doomed) removeSim(world, sim, t, emit, cause);
}

// ---- §22.4 공공 부문 회계 폐쇄 (이슈 #43, 대목표 G1) ----
//
// 관찰: 라이브에서 통화의 87%가 잠겨 있었다 — 국고 55%, 시설 매출 32%, 시민 손엔 13%.
// 가장 큰 웅덩이는 hospital(전체 매출의 70%)이었는데, 의사·간호사가 공공 직군이라
// 아무도 그 돈을 받지 못했다.
//
// 여기서 복지 캡을 올리는 건 계기판을 누르는 것이다(§0.1). 대신 **회계를 닫는다**:
// 시민이 공공 시설에 낸 돈은 국고로 가고, 공공 임금은 그 국고에서 나온다.
// 소비 → 국고 → 공공 임금 → 시민 → 소비.
//
// 77차에서 나는 이 방향을 '순유출로 국고가 무너진다'며 뺐었다. 그때와 달라진 건
// §20.2 매출 원장이 생겨 **공공 시설 매출이 국고로 들어온다**는 점이다(89차 ④에서 번복 승인).
export function remitPublicRevenue(world, t, emit) {
  const E = world.logic.economy;
  let total = 0;
  // 시설 id 오름차순 — 결정적
  const facs = world.map.facilities
    .filter((f) => E.publicFacilityTypes.includes(f.type) && (f.revenue ?? 0) > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of facs) {
    const amt = f.revenue;
    f.revenue = 0;
    world.treasury += amt;
    total += amt;
    emit('public_revenue_remitted', null, { facilityId: f.id, type: f.type, amount: amt, treasury: world.treasury });
  }
  return total;
}
