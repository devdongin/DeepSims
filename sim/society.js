// §17 사회 시스템: 이민·질병·선거·연애·동아리 — 전부 결정적 (서브순서는 PLAN §17.8).
import { rngInt } from './prng.js';
import { recordFact } from './cognition.js';
import { generateTraits } from './traits.js';
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
    sim.traits.age = Math.min(90, sim.traits.age + 1);
    if (sim.traits.occupation === 'student' && sim.traits.age >= S.graduateAge) {
      // §18.T3: 가중 풀 단일 드로우 (51차 (a)) — 대학 보유 마을은 고급 직업 풀 append
      const G2 = world.logic.graduation;
      const hasUni = world.map.facilities.some((f) => f.type === 'university');
      const pool = hasUni ? [...G2.poolBase, ...G2.poolUni] : G2.poolBase;
      sim.traits.occupation = pool[rngInt(world.rngSim, pool.length)];
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
    traits.age = 15;
    traits.occupation = 'student';
    const id = world.sims[world.sims.length - 1].id + 1;
    const name = IMMIGRANT_NAMES[world.immigrantCounter % IMMIGRANT_NAMES.length];
    world.immigrantCounter++;
    const L = world.logic;
    const child = {
      id, name, homeId: pa.homeId, isPlayer: false, traits, mood: 0,
      x: home.door.x, y: home.door.y + 1,
      needs: { hunger: 7000, energy: 7000, social: 7000, fun: 7000 },
      money: L.occupations.student.startMoney,
      state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
      memories: [], memorySeq: 0, habit: {}, relTiers: {},
      lastReflectedDay: -1, reflectionMemoryCursor: 0, pendingMood: null,
      knownTokens: [], plan: null, lastPlannedDay: -1,
      hangoverUntil: -1, groceries: 0, sick: null, noPathCool: {},
    };
    world.sims.push(child);
    for (const row of world.affinity) row.push(0);
    world.affinity.push(new Array(world.sims.length).fill(0));
    for (const row of world.interactions) row.push(0);
    world.interactions.push(new Array(world.sims.length).fill(0));
    for (const row of world.lastGreetDay) row.push(-1);
    world.lastGreetDay.push(new Array(world.sims.length).fill(-1));
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

// §17.15 복지: 일일 평가(수당 다음) — 잔고 < threshold 심에게 id asc, 국고 한도 + 일일 인원 캡
export function applyWelfare(world, t, emit) {
  const E = world.logic.economy;
  // §18.T1: 정책 오버라이드 우선
  const amount = world.policy.welfareAmount ?? E.welfareAmount;
  const threshold = world.policy.welfareThreshold ?? E.welfareThreshold;
  let paid = 0;
  for (const sim of world.sims) {
    if (paid >= E.welfareDailyCap || world.treasury < amount) break;
    if (sim.money >= threshold) continue;
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
  const id = world.sims[world.sims.length - 1].id + 1;
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
    hangoverUntil: -1, groceries: 0, sick: null, noPathCool: {},
  };
  world.sims.push(sim);
  for (const row of world.affinity) row.push(0);
  world.affinity.push(new Array(world.sims.length).fill(0));
  for (const row of world.interactions) row.push(0);
  world.interactions.push(new Array(world.sims.length).fill(0));
  for (const row of world.lastGreetDay) row.push(-1);
  world.lastGreetDay.push(new Array(world.sims.length).fill(-1));
  emit('immigrated', id, { name, occupation: traits.occupation, homeId: home.id });
  for (const other of world.sims) {
    if (other.id !== id) recordFact(other, t, L, 'new_neighbor', { subjectSimId: id, tags: [`sim:${id}`, 'town'] });
  }
}

// ---- §17.5 연애 (회고에서 호출 — 먼저 회고하는 쪽이 실행, PLAN §17.8) ----

export function applyRomance(world, sim, t, emit) {
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
