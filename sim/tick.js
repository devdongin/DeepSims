// 틱 파이프라인 — PLAN §2, §12.1, §14.1. state[t] = simulate(state[t-1], inputs[t]).
// tick() 내부의 "오늘"은 transitionDay = floorDiv(t, 1440). 수치 튜너블은 전부 world.logic.
import {
  ACTIONS, ACTION_FACILITY, NEED_OF_ACTION, NEED_MAX,
  SCORE_SCALE, AFFINITY_MIN, AFFINITY_MAX,
  COPING_ACTIONS, HOME_ONLY_ACTIONS, OUTDOOR_FACILITIES,
} from './constants.js';
import { demotePublicIfOverQuota } from './publicposts.js';
import { TILE, addBuilding, plotBuildable, zoneFootprint, isResidence, isAvailableResidence, isWalkable, sameRegion, isRoadProtected } from './map.js';
import { bfsPath, manhattan } from './pathfind.js';
import { recordRoadTrip } from './roads.js';
import { schoolFor, updateEducation, recordStudy, neededSchool, SCHOOL_TYPES, canWork } from './education.js';
import { foodAidBlockReason, takePublicMeal } from './food-aid.js';
import { medicalBlockReason, completeMedicalVisit } from './health-policy.js';
import { applyChildAllowance } from './family-policy.js';
import { applyHouseholdIntents, evaluateHouseholds } from './household.js';
import { settleHousing } from './housing.js';
import { resolveStoryCandidates } from './storyteller.js';
import { STOCK_ACTION, updateSeason, shouldStockFood, seasonalYield, winterExposureCost } from './seasons.js';
import { CULTURE_ACTION, updateNeedsTier, cultureBlockReason, completeCultureVisit } from './needs-tiers.js';
import { syncResidenceVillage } from './villages.js';
import { governmentFor, governmentViews, governmentEmitter, changeReputation,
  reputationVillage, recordMunicipalStats, publicBalance } from './government.js';
import { evaluateFoundingPetitions, applyFoundingDecision, fundFoundingPlans,
  foundingSiteReserved, foundingWorkerAllowed, recordFoundingHome, cancelFoundingConstruction } from './founding.js';
import { SETTLE_ACTION, isSettlementInTransit, settlementGatherTarget,
  advanceSettlementPlans, completeSettlementArrivals } from './settlement.js';
import { SUPPLY_ACTION, GROW_ACTION, sellsGroceries, deliveryQuote, completeDelivery, purchaseQuantity,
  completeGroceryPurchase, refreshSupplyOrders, openSupplyMarket, recordGardenProduce, procurementReserve, purchaseCost } from './food-supply.js';
import { rollTransportDay, recordTransportDeparture, recordTransportStep,
  recordTransportArrival, pruneTransportTrips, recordTransportEvent, transportSummary } from './transport-stats.js';
import { ESCORT_ACTION, escortableChildren, escortBlockReason, claimEscortPickup,
  beginHospitalEscort, syncEscortStep, cancelEscort } from './child-escort.js';
import { rngInt } from './prng.js';
import { workWindowFor, slotMatches, circadianEnergyPct, dayHash } from './chrono.js';
import { validateLogic, logicHash, ZONEABLE } from './logic.js';
import { applyPolicyCommand } from './policy-command.js';
import { validateTraits, OCCUPATIONS, occupationAllowed, SWITCH_ONLY_OCCUPATIONS, BIRTH_STAGE_OCCUPATIONS } from './traits.js';
import { aptitudeFor, developFromActivity } from './abilities.js'; // §21.1 / #96
import { makeSim, emptyState } from './simfactory.js';
import { recordIndustryDemand, recordCapacityShortfall, recordIndustryWant, maybeUnlockIndustries, neededIndustryFacility } from './industry.js';
import { makeAbilities } from './abilities.js';
import { surnameFor, surnameHash } from './surnames.js';
import { recordFact, shortlistMemories, memoryModFor, stateModFor, runReflection, memoryModFast, prepareShortlist, STATE_MOD_CLAMP } from './cognition.js';
import { buildDailyPlan, planFactorFor, maybeGenerateToken, transferTokens, expireAndMeasureTokens, learnToken } from './planning.js';
import { maybeConverse, processGreetings } from './interaction.js';
import {
  dailyDiseaseDraws, contagionDraw, naturalRecovery, maybeElection, mayorStipend, applyWelfare,
  dailyFireDraws, fireSelfOut, resolveFire, maybePromotion, zoneAllowedTypes, maybeBuyCar,
  collectComplaints, maybePetition, decayComplaints,
  maybeImmigration, maybeEmigration, checkClubJoin, clubMeetingTokens, pairDeltaBonus, applyRomance,
  updateCampaigners, maybeNewYear, maybeFestival, maybeChildren, maybeShare, maybeJobSwitch, maybeDeaths, growIdMatrices, remitPublicRevenue, maybeApproach, nextSimId, maybeFiscalReview, maybePublicWorks, evalStationDemand } from './society.js';
import { bindSocietyHooks } from './cognition.js';
bindSocietyHooks(applyRomance, checkClubJoin); // §17: 회고 훅 (모든 진입 경로에서 보장)

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function resKey(facilityId, resourceId) { return `${facilityId}:${resourceId}`; }

// §20.3 사회적 중력 (이슈 #33, 79차 합의).
// 실측: 동시에 사교 중인 심이 6~8명인데 10여 개 장소로 흩어져, cafe5는 체류 틱의 99%가 혼자였다.
// 과거 두 번 반증된 가설이지만 당시엔 동시 사교자가 2~3명뿐이라 중력이 작동할 물질이 없었다.
// 이번의 결정적 차이는 **오는 중인 심도 센다**는 것이다 — 지금은 의도가 보이지 않아
// 랑데부가 성립하지 못한다(A가 도착하면 B는 이미 떠났다).
// 심 전체를 시설마다 훑지 않고 **한 번만** 훑어 Map으로 만든다 (성능 이슈 #17 고려).
// §23.8 시설별 재실 인원 (하는 일과 무관). "혼자서는 못 하는 놀이"를 가리는 데 쓴다.
// socialPresence는 수다 떠는 사람만 세므로 여기서는 쓸 수 없다.
const LEISURE_COMPANY = new Set(['socialize', 'board_game', 'play', 'read', 'idle', 'stroll']);
export function occupancyAt(world, selfId) {
  const m = new Map();
  for (const o of world.sims) {
    if (selfId !== null && o.id === selfId) continue;
    const st = o.state;
    if (st.facilityId === null || st.kind !== 'performing') continue;
    // 점심을 급히 먹는 사람은 판의 맞은편에 앉아 줄 수 없다. **한가한 사람**만 센다.
    if (!LEISURE_COMPANY.has(st.action)) continue;
    m.set(st.facilityId, (m.get(st.facilityId) ?? 0) + 1);
  }
  return m;
}

export function socialPresence(world, selfId) {
  const m = new Map();
  for (const o of world.sims) {
    if (o.id === selfId) continue;
    const st = o.state;
    if (st.action !== 'socialize' || st.facilityId === null) continue;
    if (st.kind !== 'performing' && st.kind !== 'walking') continue;
    let e = m.get(st.facilityId);
    if (e === undefined) { e = { here: 0, coming: 0 }; m.set(st.facilityId, e); }
    if (st.kind === 'performing') e.here++; else e.coming++;
  }
  return m;
}

// 점수에 **곱하는** 끌림(%). 가산 슬롯(stateMod)으로는 안 된다 — 전형 점수 ~3e12 대비
// 클램프가 ±2.5e11(약 8%)이라 거리 항을 못 이긴다. 실제로 가산 형태는 3번째 반증됐다.
// 좌석이 다 찼으면 0 — 몰려가도 앉을 자리가 없으면 헛걸음만 는다 (79차 ③).
export function socialPullPct(world, fac, presence, L, sim = null) {
  const S = L.social;
  if (S.gravityPullPct === 0) return 0;   // 끄면 아래 비용을 아예 치르지 않는다
  const p = presence.get(fac.id);
  if (p === undefined) return 0;          // 아무도 없는 곳이 대부분 — 가장 싼 컷을 먼저
  // 자리가 남는지만 알면 된다 — 몇 개 남았는지는 쓰지 않으므로 첫 빈자리에서 끊는다.
  let free = false;
  for (const r of fac.resources) {
    if (world.reservations[resKey(fac.id, r.id)] === undefined) { free = true; break; }
  }
  if (!free) return 0;                    // 자리가 다 찼으면 끌림 0 (79차 ③)
  // §20.3 (80차 ②): 갈 수 없는 곳은 아무리 붐벼도 끌리지 않는다. 강 건너·산 너머 시설이
  // 중력으로 거리 항을 이기면 no_path가 폭증한다(끌림 150%에서 1,880건).
  // 심은 타일을 막지 않으므로 연결성은 타일에만 의존하고, 결과는 결정적이다.
  // 셋 중 가장 비싸므로 맨 뒤에 둔다 (성능 이슈 #17).
  if (sim !== null && !sameRegion(world.map, sim.x, sim.y, fac.door.x, fac.door.y)) return 0;
  const units = p.here + floorDiv(p.coming * S.gravityWalkingPct, 100);
  return Math.min(units * S.gravityPullPct, S.gravityPullCap);
}


function needValueFor(sim, action, L) {
  if (action === CULTURE_ACTION) return sim.needsTier.culture;
  if (action === 'study') return NEED_MAX - L.education.studyDeficit;
  if (action === 'work') return Math.min(sim.money, NEED_MAX); // 돈 0 → deficit 최대
  if (action === SUPPLY_ACTION) return Math.min(sim.money, NEED_MAX);
  if (action === GROW_ACTION) return Math.min(sim.money, NEED_MAX);
  if (action === STOCK_ACTION) return NEED_MAX - L.seasons.stockDeficit;
  // coping: 기분이 나쁠수록 급함 — deficit = -mood (게이트로 mood < 0 보장, §15.1.A)
  if (COPING_ACTIONS.includes(action)) return NEED_MAX + sim.mood;
  if (action === 'build') return NEED_MAX - L.build.deficit; // 고정 중간 급함 (§15.1.B)
  if (action === 'shop') return sim.needs.hunger; // 배고픈데 장이 비면 급함 (§16.B, Codex 22차 항목 5)
  if (action === 'construct') return NEED_MAX - L.construct.deficit; // §16.5 고정 급함
  if (action === 'see_doctor') return NEED_MAX - L.disease.doctorDeficit; // 아플 때 최우선급 (§17.3)
  if (action === ESCORT_ACTION) return NEED_MAX - L.disease.doctorDeficit;
  if (action === 'respond_fire') return NEED_MAX - L.incidents.respondDeficit; // §17.20 화재 급함
  return sim.needs[NEED_OF_ACTION[action]];
}

// MBTI → 행동별 persFactor (PLAN §12.1). floorDiv 곱 후 [50,200] 클램프 1회.
// §23.25 기분의 바닥선. 삶의 조건을 작은 가산으로 더한다 — 어느 하나가 지배하지 않게
// 각 항이 작고, 합은 clamp로 묶는다. rng를 쓰지 않으므로 결정성에 관여하지 않는다.
export function moodBaseline(sim, world, L) {
  const B = L.mood.baseline;
  let v = 0;
  if (world.partners?.[sim.id] !== undefined) {
    v += world.partnerStage?.[sim.id] === 'married' ? B.married : B.dating;
  }
  let friends = 0, rivals = 0;
  for (const tier of Object.values(sim.relTiers ?? {})) {
    if (tier === 'friend') friends++;
    else if (tier === 'rival') rivals++;
  }
  v += Math.min(B.friendCap, friends * B.perFriend);
  v -= Math.min(B.rivalCap, rivals * B.perRival);
  if (sim.homeId) v += B.home;
  if (sim.sick) v += B.sick;              // 아프면 바닥이 내려간다
  if (sim.traits.occupation === 'jobless') v += B.jobless;
  // 즐겨 하는 일이 있는 삶 — 습관이 붙은 여가 하나당 조금씩 (§17.6 클럽과 같은 신호)
  let habits = 0;
  for (const [k, n] of Object.entries(sim.habit ?? {})) {
    if (n >= L.club.habitMin && !k.startsWith('work:')) habits++;
  }
  v += Math.min(B.habitCap, habits * B.perHabit);
  return clamp(v, -B.span, B.span);
}

function persFactorFor(sim, action, L) {
  const m = sim.traits.mbti;
  let f = 100;
  if (action === 'socialize') f = L.persFactor.socializeBase - m.EI;
  else if (action === 'play') f = L.persFactor.playBase + (m.EI - 50);
  else if (action === 'work') f = L.persFactor.workBase - m.JP;
  // 대처 성향 (§15.1.A): E→음주, F→폭식, I→은둔, T→운동
  else if (action === 'drink') f = L.coping.persDrinkBase - floorDiv(m.EI, 2);
  else if (action === 'binge_eat') f = 100 + (m.TF - 50);
  else if (action === 'hole_up') f = 100 + (m.EI - 50);
  else if (action === 'exercise') f = 100 + (50 - m.TF);
  // §16.B: N·I는 독서, I는 낚시 선호
  else if (action === 'read') f = 100 + (m.SN - 50) + floorDiv(m.EI - 50, 2);
  else if (action === 'fish') f = 100 + (m.EI - 50);
  else if (action === 'construct') f = 100 + floorDiv(100 - m.JP, L.construct.persJDiv); // J형이 부지런 (§16.5)
  // §23.8 여가 확대 — 성향이 다르면 쉬는 법도 다르다.
  else if (action === 'stroll') f = 100 + floorDiv(50 - m.EI, 2);   // 혼자 걷는 쪽은 I
  else if (action === 'garden') f = 100 + (m.SN - 50) + floorDiv(100 - m.JP, 4); // 손에 잡히는 것(S)·꾸준함(J)
  else if (action === 'music') f = 100 + (50 - m.SN) + floorDiv(50 - m.EI, 2);   // 안으로 향하는 N
  else if (action === 'volunteer') f = 100 + (50 - m.TF) + floorDiv(m.EI - 50, 2); // 사람을 향한 F
  else if (action === 'board_game') f = 100 + (m.EI - 50) + floorDiv(m.TF - 50, 2); // 마주 앉는 E·규칙을 즐기는 T
  return clamp(f, 50, 200);
}

// 기분 보정 (PLAN §12.1): 기분 전환 욕구 + 무기력. §G moodMod 슬롯, ±2.5e11 클램프.
function moodModFor(sim, action, L) {
  let mod = 0;
  if ((action === 'play' || action === 'socialize') && sim.mood < 0) {
    mod += Math.min(-sim.mood, NEED_MAX) * L.mood.reliefScale;
  }
  if (sim.mood < L.mood.lethargyThreshold) {
    mod += (sim.mood - L.mood.lethargyThreshold) * L.mood.lethargyScale;
  }
  return clamp(mod, -250000000000, 250000000000);
}

// 점수 코어: base=floorDiv(num×1e5, den) × persFactor — planFactor·보정 합산은 collectCandidates에서
// (§G 순서: base × pers → × plan → + mods). 경계 증명은 PLAN §2.5.G.
function prepareCandidateScore(sim, action, L) {
  const deficit = NEED_MAX - needValueFor(sim, action, L);
  return { deficit, num: deficit * deficit * 16,
    persFactor: persFactorFor(sim, action, L), moodMod: moodModFor(sim, action, L),
    ignoresDistance: COPING_ACTIONS.includes(action) || action === 'respond_fire' || action === ESCORT_ACTION };
}
function scoreCandidate(sim, action, res, L, prepared = null) {
  const p = prepared ?? prepareCandidateScore(sim, action, L);
  // 대처 행동은 거리 무시 (den 고정 16) — 대처 방식 선택은 성격이 지배해야 한다 (§15.1.A).
  // 아니면 "집이 가까워서 은둔"이 항상 이겨 성격 변조가 무력화된다.
  // §17.20: 화재 출동도 거리 무시 — 불은 어디든 달려간다
  const den = p.ignoresDistance ? 16 : manhattan(sim.x, sim.y, res.x, res.y) + 16;
  const base = floorDiv(p.num * SCORE_SCALE, den);
  return { core: floorDiv(base * p.persFactor, 100), deficit: p.deficit,
    persFactor: p.persFactor, moodMod: p.moodMod };
}

// 하드 제약 (assign·자율 결정 공통). t = 전이 틱.
// 사유 반환 변형 — reason chain(§15.1.C)과 공유. null = 허용.
// blockedBy 우선순위: no_money → off_hours → not_coping → not_needed (Codex 20차 항목 2)
// §22.2 (91차 ②) 아이가 하지 않는 일. 어른의 노동·대처·공적 임무는 아이의 몫이 아니다.
// 아이는 먹고 자고 놀고 어울리고 배운다.
const CHILD_BLOCKED = new Set(['work', 'construct', 'build', 'respond_fire', 'patrol',
  'drink', 'binge_eat', 'shop', 'see_doctor', 'fish',
  'volunteer', SUPPLY_ACTION, GROW_ACTION, STOCK_ACTION]); // §23.8 봉사는 어른 몫 — 산책·텃밭·연주·보드게임은 아이도 한다
const LABOR_ACTIONS = new Set(['work', 'construct', 'build', 'respond_fire', 'patrol', SUPPLY_ACTION, GROW_ACTION]);

// §22.18 (Codex 110차 ①) **'갈 곳이 없다'와 '자리가 다 찼다'는 다르다.**
// actionBlockReason이 null을 돌려줘도 그 안에는 시설 부재·만석·도달 불가가 섞여 있다.
// 셋을 한 원장에 넣으면 "병원을 지어라"와 "병원을 키워라"가 구분되지 않는다.
//   no_facility   — 이 행동을 제공하는 시설이 세계에 하나도 없다
//   capacity_full — 시설은 있는데 자리가 전부 예약돼 있다
//   unreachable   — 자리는 있는데 길이 막혀 있다 (§17.23 no_path 쿨다운)
// rng 미소비, 세계를 바꾸지 않는다.
export function facilityShortfallKind(world, sim, action, t) {
  const L = world.logic;

  // **가상 자원을 쓰는 행동은 시설 수로 판정할 수 없다** (Codex 111차 ①②).
  // 경찰의 근무는 patrol.targets에서 patrolIdx로 고른 좌표 하나를, 소방 대응은
  // firesite를 자원으로 쓴다. 후보 생성이 그 특수 분기를 타는데 여기서 시설을 세면
  // 두 경로가 어긋나 **원장이 거짓말을 한다** — 순찰 지점 하나가 막혀도 경찰서
  // 자리가 비어 있으면 '부족 없음'으로 보고된다.
  // 억지로 판정하는 대신 명시적으로 비대상으로 둔다. 판정할 수 없는 것을 판정하지
  // 않는 것이 틀린 답을 내는 것보다 낫다.
  if (action === 'respond_fire') return null;
  if (action === SUPPLY_ACTION) return null; // 주문·잉여·시장 자금으로 판정한다.
  if (action === 'work' && sim.traits.occupation === 'police') return null;
  if (action === 'work' && sim.traits.occupation === 'jobless') return null;
  // §23.9 집에서만 하는 일(집밥·텃밭·연주·은둔·침대 만들기)은 시설 수를 셀 대상이 아니다.
  // 집이 없어서 못 한 것은 **주거 부족**이지 '가구내 자가소비 생산활동 수요'가 아니다.
  // 원장이 그렇게 말하면 처방이 "식당을 지어라"가 되고, 정작 필요한 것은 집이다.
  if (HOME_ONLY_ACTIONS.includes(action)
      && !world.map.facilities.some((f) => f.id === sim.homeId)) return null;
  const ftypes = action === 'work'
    ? [].concat(L.workplace[sim.traits.occupation] ?? [])
    : action === 'study' ? [schoolFor(sim)] : (ACTION_FACILITY[action] ?? []);
  if (ftypes.length === 0) return null; // 시설을 쓰지 않는 행동
  let anyFacility = false, anyFree = false;
  for (const ftype of ftypes) {
    for (const fac of world.map.facilities) {
      if (fac.type !== ftype) continue;
      if (HOME_ONLY_ACTIONS.includes(action) && fac.id !== sim.homeId) continue;
      if (world.incidents.some((inc) => inc.facilityId === fac.id)) continue;
      anyFacility = true;
      for (const res of fac.resources) {
        if (fac.type === 'mall'
          && (((action === 'shop' || action === STOCK_ACTION) && res.kind !== 'till') || (action === 'play' && res.kind !== 'seat'))) continue;
        const holder = world.reservations[resKey(fac.id, res.id)];
        if (holder !== undefined && holder !== sim.id) continue;
        anyFree = true;
        const cool = sim.noPathCool[`${fac.id}:${res.id}`];
        if (cool !== undefined && t < cool) continue;
        return null; // 갈 수 있는 자리를 찾았다 — 더 볼 필요가 없다 (111차 ⑤ 성능)
      }
    }
  }
  if (!anyFacility) return 'no_facility';
  if (!anyFree) return 'capacity_full';
  return 'unreachable'; // 자리는 있는데 전부 길이 막혀 있다 (§17.23 쿨다운)
}

export function actionBlockReason(world, sim, action, t) {
  if(isSettlementInTransit(world,sim.id)&&action!==SETTLE_ACTION)return 'household_in_transit';
  if(action===SETTLE_ACTION)return settlementGatherTarget(world,sim)?null:'not_needed';
  const L = world.logic;
  if (action === 'seek_food_aid') return foodAidBlockReason(world, sim);
  if (action === ESCORT_ACTION) return escortBlockReason(world, sim);
  if (LABOR_ACTIONS.has(action) && !canWork(sim)) return sim.traits.occupation === 'child' ? 'too_young' : 'not_needed';
  if (action === SUPPLY_ACTION) {
    if (sim.groceries <= L.supply.keepReserve || !world.foodSupply.orders.length) return 'not_needed';
    if (!world.map.facilities.some(f => deliveryQuote(world, sim, f).ok)) return 'no_market_funds';
  }
  if (action === GROW_ACTION) {
    if (sim.groceries > L.supply.keepReserve) return 'not_needed';
    if (!world.foodSupply.orders.some(o => o.quantity > 0 && world.map.facilities.some(f => f.id === o.facilityId
      && (f.revenue ?? 0) >= L.supply.unitPrice && !world.incidents.some(i => i.facilityId === f.id)))) return 'not_needed';
  }
  if (action === 'study') {
    if (!schoolFor(sim) || sim.traits.occupation !== 'student') return 'not_needed';
    const day = Math.floor(t / 1440), tod = t % 1440;
    if (day % 7 >= 5 || tod < L.education.startMinute || tod >= L.education.endMinute) return 'off_hours';
    if (sim.education.studyDay === day && sim.education.dailyTicks >= L.education.dailyStudyTicks) return 'not_needed';
  }
  if (sim.traits.occupation === 'child' && CHILD_BLOCKED.has(action)) return 'too_young';
  if (action === STOCK_ACTION && !shouldStockFood(world, sim, t)) return 'not_needed';
  if (action === CULTURE_ACTION) return cultureBlockReason(world, sim);
  if (action === 'see_doctor') return medicalBlockReason(world, sim);
  const cost = action === 'shop' || action === STOCK_ACTION ? purchaseCost(world, sim, action) : (L.actions[action]?.cost ?? 0);
  if (cost > 0 && sim.money < cost) return 'no_money';
  if (action === STOCK_ACTION && sim.money - cost < L.actions.eat.cost) return 'not_needed'; // 비축 뒤에도 긴급 한 끼 현금은 남긴다.
  if (action === 'work') {
    const ww = workWindowFor(sim, L, floorDiv(t, 1440)); // §17.13 단일 권위 (일별 야근 포함)
    if (!ww) return 'off_hours';
    if (!slotMatches(ww, t % 1440)) return 'off_hours';
  }
  if (COPING_ACTIONS.includes(action) && sim.mood >= L.coping.threshold) return 'not_coping';
  if (action === 'respond_fire') {
    if (sim.traits.occupation !== 'firefighter') return 'not_needed';
    if (world.incidents.length === 0) return 'no_project'; // 불이 없다
  }
  if (action === 'shop' && (sim.groceries > 0 || sim.money < cost)) {
    return sim.money < cost ? 'no_money' : 'not_needed'; // 장바구니 차 있으면 불필요 (§16.B)
  }
  if (action === 'shop' || action === STOCK_ACTION) {
    const shops = world.map.facilities.filter(sellsGroceries);
    if (shops.length && !shops.some(f => (f.groceryStock ?? 0) >= purchaseQuantity(world, sim, action))) return 'no_stock';
  }
  if (action === 'cook_eat' && sim.groceries < 1) return 'no_groceries';
  if (action === 'construct' && world.projects.length === 0) return 'no_project';
  if (action === 'build') {
    const home = world.map.facilities.find((f) => f.id === sim.homeId);
    const residents = world.sims.reduce((n, x) => n + (x.homeId === sim.homeId ? 1 : 0), 0);
    const extraBuilt = home.resources.length - 2;
    if (residents <= home.resources.length || extraBuilt >= L.build.maxExtraBeds) return 'not_needed';
  }
  return null;
}

function actionAllowed(world, sim, action, t) {
  return actionBlockReason(world, sim, action, t) === null;
}

// §17.22: 시설 타입 인덱스 — facilities 배열 길이 변화 시에만 재구축 (append-only라 안전)
let facIndexRef = null; let facIndexLen = -1; let facIndex = null; let facIdIndex = null;
function facilitiesByType(map) {
  if (facIndexRef !== map.facilities || facIndexLen !== map.facilities.length) {
    facIndex = new Map();
    facIdIndex = new Map();
    for (const f of map.facilities) {
      let arr = facIndex.get(f.type);
      if (!arr) { arr = []; facIndex.set(f.type, arr); }
      arr.push(f);
      facIdIndex.set(f.id, f);
    }
    facIndexRef = map.facilities; facIndexLen = map.facilities.length;
  }
  return facIndex;
}

// ctx: { shortlist, prep, urgency } — Phase 3 인지 보정. urgency 시 습관 보정 배제 (PLAN §2.5.D).
export function collectCandidates(world, sim, actions, t, includeZeroScore = false, ctx = null) {
  const L = world.logic;
  const out = [];
  const byType = facilitiesByType(world.map);
  const stateModCache = new Map(); // 같은 결정 내 시설별 캐시 (심 상태 불변 구간 — 결과 동일)
  let presence = null;             // §20.3 사교 후보가 처음 나올 때 한 번만 만든다
  let occupancy = null;            // §23.8 보드게임 후보가 처음 나올 때 한 번만 만든다
  const memoCache = new Map(); // (action|facility) → {mm, pl} — 자원들이 공유 (결과 동일, §17.22)
  // Decision-local only: reservations/cooldowns may change before the next sim or tick.
  // Preserve resource order; own reservations remain available, not counted as full.
  const availableCache = new Map();
  const home = facIdIndex.get(sim.homeId);
  const candTags = ['', '']; // 재사용 버퍼 (memoryModFast는 동기 소비)
  for (const action of actions) {
    if (action === 'idle') continue;
    if (!actionAllowed(world, sim, action, t)) continue;
    if (action === ESCORT_ACTION) {
      for (const child of escortableChildren(world, sim)) {
        const res={id:`child:${child.id}`,x:child.x,y:child.y};
        const holder=world.reservations[resKey('childcare',res.id)];
        if(holder!==undefined&&holder!==sim.id)continue;
        const sc=scoreCandidate(sim,action,res,L),cand={action,facilityId:'childcare',resourceId:res.id,res,...sc,
          planFactor:100,partyPull:false,weatherFactor:100,score:sc.core+sc.moodMod,
          memoryMod:0,stateMod:0,habitMod:0,cited:[]};
        if(cand.score>0||includeZeroScore)out.push(cand);
      }
      continue;
    }
    // §16.5.B: construct는 가상 현장(site) — 활성 프로젝트 plot 모서리 4 작업 스팟
    if(action===SETTLE_ACTION){
      const target=settlementGatherTarget(world,sim);if(target)out.push(target.candidate);
      continue;
    }
    if (action === 'construct') {
      // §19.3: 다중 프로젝트 중 맨해튼 최근접 현장으로 (동률 plotId asc — 결정적)
      let pr = null; let best = Infinity;
      for (const cand2 of [...world.projects].sort((a, b) => a.plotId - b.plotId)) {
        if(!foundingWorkerAllowed(world,sim,cand2))continue;
        const pl = world.plots.find((p) => p.plotId === cand2.plotId);
        const d = Math.abs(pl.x + 3 - sim.x) + Math.abs(pl.y + 2 - sim.y);
        if (d < best) { best = d; pr = cand2; }
      }
      if (!pr) continue;
      const plot = world.plots.find((p) => p.plotId === pr.plotId);
      const right=pr.foundingPetitionId===undefined?5:4; // 개척 집 완공 후에도 내부 바닥인 작업점
      const spots = [
        { id: `p${pr.plotId}:spot0`, x: plot.x + 1, y: plot.y + 1 },
        { id: `p${pr.plotId}:spot1`, x: plot.x + right, y: plot.y + 1 },
        { id: `p${pr.plotId}:spot2`, x: plot.x + 1, y: plot.y + 3 },
        { id: `p${pr.plotId}:spot3`, x: plot.x + right, y: plot.y + 3 },
      ];
      for (const res of spots) {
        const holder = world.reservations[resKey('site', res.id)];
        if (holder !== undefined && holder !== sim.id) continue;
        const sc = scoreCandidate(sim, action, res, L);
        const cand = {
          action, facilityId: 'site', resourceId: res.id, res,
          ...sc, planFactor: 100, partyPull: false, weatherFactor: 100,
          score: floorDiv(sc.core * 100, 100) + sc.moodMod,
          memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
        };
        if (cand.score <= 0 && !includeZeroScore) continue;
        out.push(cand);
      }
      continue;
    }
    // §17.20: respond_fire — 불타는 시설 문 앞 가상 스팟 (위급 승격은 아래 소방관 분기)
    if (action === 'respond_fire') {
      for (const inc of world.incidents) {
        const fac = world.map.facilities.find((f) => f.id === inc.facilityId);
        const res = { id: `fire:${inc.facilityId}`, x: fac.door.x, y: fac.door.y - 1 >= 0 ? fac.door.y - 1 : fac.door.y };
        const holder = world.reservations[resKey('firesite', res.id)];
        if (holder !== undefined && holder !== sim.id) continue;
        const sc = scoreCandidate(sim, action, res, L);
        const cand = {
          action, facilityId: 'firesite', resourceId: res.id, res,
          ...sc, planFactor: 100, partyPull: false, weatherFactor: 100,
          score: sc.core + sc.moodMod,
          memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
        };
        if (cand.score <= 0 && !includeZeroScore) continue;
        out.push(cand);
      }
      continue;
    }
    // §17.24: 경찰 work = 순찰 — patrolIdx 순회 지점(공공시설 문 앞) 가상 스팟
    if (action === 'work' && sim.traits.occupation === 'police') {
      // 57차: facilities 배열 순 단일 필터 — 신축 append 시 기존 인덱스 의미 보존
      const spots = world.map.facilities.filter((f) => L.patrol.targets.includes(f.type));
      if (spots.length > 0) {
        const fac2 = spots[sim.patrolIdx % spots.length];
        // §19.4: 순찰 지점은 문 주변의 **도달 가능한** 칸 — 북→남→동→서 고정 순서(결정적).
        // 문 북쪽이 나무·벽이면 영원히 no_path가 나던 고착 수리 (이슈 #40).
        const around = [
          { x: fac2.door.x, y: fac2.door.y - 1 },
          { x: fac2.door.x, y: fac2.door.y + 1 },
          { x: fac2.door.x + 1, y: fac2.door.y },
          { x: fac2.door.x - 1, y: fac2.door.y },
          { x: fac2.door.x, y: fac2.door.y }, // 최후: 문 자체
        ];
        const spot = around.find((p) => isWalkable(world.map, p.x, p.y));
        const res = spot ? { id: `patrol:${fac2.id}`, x: spot.x, y: spot.y } : null;
        const cool = res ? sim.noPathCool[`patrol:${res.id}`] : undefined;
        const holder = res ? world.reservations[resKey('patrol', res.id)] : undefined;
        if (res && !(cool !== undefined && t < cool) && (holder === undefined || holder === sim.id)) {
          const sc = scoreCandidate(sim, action, res, L);
          const cand = {
            action, facilityId: 'patrol', resourceId: res.id, res,
            ...sc, planFactor: 100, partyPull: false, weatherFactor: 100,
            score: sc.core + sc.moodMod, memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
          };
          if (cand.score > 0 || includeZeroScore) out.push(cand);
        }
      }
      continue;
    }
    // §17.2: work는 자기 직업의 근무 시설에서만
    const ftypes = action === 'work'
      ? [].concat(L.workplace[sim.traits.occupation]) // §18.T3: 배열 허용 (student → school|university)
      : action === 'study' ? [schoolFor(sim)] : ACTION_FACILITY[action];
    let preparedScore = null; // Same sim/action: only distance changes between seats.
    for (const ftype of ftypes) {
      const facilities = HOME_ONLY_ACTIONS.includes(action)
        ? (home?.type === ftype ? [home] : []) : (byType.get(ftype) ?? []);
      for (const fac of facilities) {
        if ((action === 'shop' || action === STOCK_ACTION) && (fac.groceryStock ?? 0) < purchaseQuantity(world, sim, action)) continue;
        if (action === SUPPLY_ACTION && !deliveryQuote(world, sim, fac).ok) continue;
        // §23.8 보드게임은 **혼자 할 수 없다.** 사람이 없는 카페에서는 후보가 아니다.
        // 게이트를 안 두면 30일 실측에서 480건까지 치솟아 놀이(71)·독서(72)를 밀어냈다.
        // 이건 가중치를 눌러 고칠 문제가 아니라 규칙이 빠진 문제다(§0.1) — 판을 펴려면
        // 맞은편에 사람이 앉아 있어야 한다.
        if (action === 'board_game') {
          occupancy ??= ctx?.occ ?? occupancyAt(world, null);
          let here = occupancy.get(fac.id) ?? 0;
          // 스냅샷은 자기 자신도 세므로 여기서 뺀다 — 혼자 앉아 있는 것은 동반이 아니다.
          const my = sim.state;
          if (my.facilityId === fac.id && my.kind === 'performing' && LEISURE_COMPANY.has(my.action)) here--;
          if (here <= 0) continue;
        }
        if (world.incidents.some((inc) => inc.facilityId === fac.id)) continue; // §17.20 화재 중 사용 불가
        let available = availableCache.get(fac.id);
        if (!available) {
          available = [];
          for (const res of fac.resources) {
            const key = resKey(fac.id, res.id);
            const holder = world.reservations[key];
            if (holder !== undefined && holder !== sim.id) continue;
            const cool = sim.noPathCool[key];
            if (cool !== undefined && t < cool) continue;
            available.push(res);
          }
          availableCache.set(fac.id, available);
        }
        if (available.length === 0) continue;
        const facTag = `facility:${fac.id}`; // 자원 루프 밖 1회
        // §17.22: (action, 시설) 단위 공유 계산 — 자원(좌석)별로 동일한 값 재사용 (결과 동일)
        const memoKey = action + '|' + fac.id;
        let memo = memoCache.get(memoKey);
        for (const res of available) {
          // Action-dependent mall filtering must not leak into the shared availability cache.
          if (fac.type === 'mall' && (((action === 'shop' || action === STOCK_ACTION || action === SUPPLY_ACTION) && res.kind !== 'till') || (action === 'play' && res.kind !== 'seat'))) continue;
          if (!memo) {
            const pl0 = (ctx && ctx.urgency)
              ? { factor: 100, partyPull: false }
              : planFactorFor(world, sim, action, fac.id, t, L);
            let mm0 = null;
            if (ctx) {
              candTags[0] = action; candTags[1] = facTag;
              mm0 = memoryModFast(ctx.prep, candTags, L);
            }
            memo = { pl: pl0, mm: mm0 };
            memoCache.set(memoKey, memo);
          }
          preparedScore ??= prepareCandidateScore(sim, action, L);
          const sc = scoreCandidate(sim, action, res, L, preparedScore);
          const pl = memo.pl;
          // §16.D: 우천 야외 축소 계수 — §G 곱셈 체인 확장 (base×pers×plan×weather, 축소만이라 경계 보존)
          const weatherFactor = (world.weather?.kind === 'rain' && OUTDOOR_FACILITIES.includes(ftype))
            ? L.weather.outdoorRainFactor : 100;
          const cand = {
            action, facilityId: fac.id, resourceId: res.id, res,
            core: sc.core, deficit: sc.deficit, persFactor: sc.persFactor, moodMod: sc.moodMod,
            planFactor: pl.factor, partyPull: pl.partyPull, weatherFactor,
            score: floorDiv(floorDiv(sc.core * pl.factor, 100) * weatherFactor, 100) + sc.moodMod,
            memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
          };
          if (ctx) {
            const mm = memo.mm;
            cand.memoryMod = mm.mod;
            cand.cited = mm.cited;
            let sm = stateModCache.get(fac.id);
            if (sm === undefined) { sm = stateModFor(world, sim, fac.id, L); stateModCache.set(fac.id, sm); }
            // §20.3 사교 후보에만 사회적 중력을 더한다 (먹기·놀기는 붐빈다고 끌리지 않는다).
            // 기존 stateMod 클램프(±2.5e11) 안에서 합산한다.
            cand.stateMod = sm;
            if (!ctx.urgency) cand.habitMod = Math.min(sim.habit[`${action}:${fac.id}`] ?? 0, L.social.habitCap);
            cand.score += cand.memoryMod + cand.stateMod + cand.habitMod;
            // §20.3 사회적 중력 — 사교 후보에만 붙는 **곱셈 인자** (이슈 #33).
            // **§G 순서에서 벗어나 mods 이후에 곱한다.** 의도적이며, 근거는 실측이다:
            // plan·weather와 같은 자리(mods 이전)에 두면 헛걸음은 29%까지만 내려가고
            // no_path가 1,375건 터진다. mods까지 함께 곱하면 memoryMod·habitMod —
            // 즉 '내가 실제로 가본 곳'의 기여 — 도 같이 커져, 중력이 가본 적 없는 먼 시설로
            // 심을 내던지지 않는다. 결과: 헛걸음 14.5%, no_path 0.
            // 먹기·놀기는 붐빈다고 끌리지 않으므로 socialize에만 적용한다.
            if (action === 'socialize' && L.social.gravityPullPct > 0) {
              presence ??= socialPresence(world, sim.id);
              const pull = socialPullPct(world, fac, presence, L, sim);
              if (pull > 0) cand.score += floorDiv(cand.score * pull, 100);
            }
            // §22.6 청을 받아들였으면 그 자리로 마음이 기운다 (이슈 #69).
            // 하던 일을 강제로 끊지 않고 **다음 선택에서** 그리로 가게 하는 가중이다.
            if (action === 'socialize' && sim.invitedTo
                && sim.invitedTo.untilTick > t && sim.invitedTo.facilityId === fac.id) {
              cand.score += floorDiv(cand.score * L.social.invitePullPct, 100);
            }
          }
          if (cand.score <= 0 && !includeZeroScore) continue;
          out.push(cand);
        }
      }
    }
  }
  return out;
}

// argmax + 타이브레이크: score desc → action enum 순 → facilityId → resourceId (PLAN §2)
function pickBest(cands) {
  let best = null;
  for (const c of cands) {
    if (best === null) { best = c; continue; }
    if (c.score !== best.score) { if (c.score > best.score) best = c; continue; }
    const ae = ACTIONS.indexOf(c.action) - ACTIONS.indexOf(best.action);
    if (ae !== 0) { if (ae < 0) best = c; continue; }
    if (c.facilityId !== best.facilityId) { if (c.facilityId < best.facilityId) best = c; continue; }
    if (c.resourceId < best.resourceId) best = c;
  }
  return best;
}

function releaseReservation(world, sim) {
  const s = sim.state;
  if (s.facilityId !== null && s.resourceId !== null) {
    const key = resKey(s.facilityId, s.resourceId);
    if (world.reservations[key] === sim.id) delete world.reservations[key];
  }
}

function actionDuration(action, L) { return L.actions[action].duration; }

// §20.2 소비 → 시설 매출 이전. 예전에는 sim.money -= cost 로 **소멸**했다 (이슈 #43).
// 돈이 사라지지 않고 시설 원장에 쌓이고, 그 원장이 민간 서비스 임금의 재원이 된다.
// 순수 정수 이동 — rngSim 미소비, 드로우 순서 무관.
function payToFacility(world, facilityId, amount) {
  if (amount <= 0 || facilityId === null) return;
  const fac = world.map.facilities.find((f) => f.id === facilityId);
  if (!fac) return; // 시설 없는 소비(예: 노점 없음)는 기존대로 소멸 — 화이트리스트 밖
  fac.revenue = (fac.revenue ?? 0) + amount;
}

// 예약 + walking/performing 전이 (원자적). reason은 판단 사유 (PLAN §14.1).
function startAction(world, sim, cand, t, emit, reason) {
  releaseReservation(world, sim);
  world.reservations[resKey(cand.facilityId, cand.resourceId)] = sim.id;
  const path = bfsPath(world.map, sim.x, sim.y, cand.res.x, cand.res.y);
  if (path === null) {
    delete world.reservations[resKey(cand.facilityId, cand.resourceId)];
    sim.state = emptyState();
    emit('action_failed', sim.id, { action: cand.action, reason: 'no_path' });
    // §17.23 no_path 쿨다운: 같은 자원 재선택 고착 방지 — 다음 틱엔 차순위 후보로
    sim.noPathCool[`${cand.facilityId}:${cand.resourceId}`] = t + world.logic.construct.noPathCoolTicks;
    // §19.4: 순찰이 실패하면 다음 순찰 지점으로 넘어간다 (같은 곳 무한 재시도 방지 — 이슈 #40)
    if (cand.facilityId === 'patrol') sim.patrolIdx++;
    return false;
  }
  if(cand.action===ESCORT_ACTION&&!claimEscortPickup(world,sim,Number(cand.resourceId.slice(6)))){
    delete world.reservations[resKey(cand.facilityId,cand.resourceId)];
    emit('action_failed',sim.id,{action:cand.action,reason:'child_unavailable'});return false;
  }
  // §19 R-B: 장거리 이동 통계 — **출발 시점** 누적(64차 (c) 계약 고정)
  // §19.12: 칸수도 같은 자리에서 누적 — 거리 분포가 역 수요 판정의 입력이다 (이슈 #52)
  if (path.length >= world.logic.transport.longTripMin) {
    sim.longTrips++;
    sim.longTripTiles = (sim.longTripTiles ?? 0) + path.length;
  }
  // §22.16 emptyState를 펼쳐서 만든다. 예전에는 여기서 필드를 손으로 나열해
  // sideTalkTicks가 빠졌고(§22.14), 읽는 쪽의 `?? 0` 가드 덕에 우연히 버티고 있었다.
  // 필드를 하나 늘릴 때마다 이런 자리를 찾아다녀야 하는 구조는 언젠가 반드시 어긋난다.
  sim.state = {
    ...emptyState(),
    kind: path.length === 0 ? 'performing' : 'walking',
    action: cand.action,
    facilityId: cand.facilityId,
    resourceId: cand.resourceId,
    path,
    journey: path.length ? { x: sim.x, y: sim.y, walked: 0 } : null,
    ticksLeft: actionDuration(cand.action, world.logic),
  };
  recordTransportDeparture(world, sim, path, t);
  emit('action_started', sim.id, {
    action: cand.action, facilityId: cand.facilityId, resourceId: cand.resourceId, reason,
  });
  // onEnterPerforming(sleep) 훅 — 경로 0으로 즉시 수행 진입하는 경우 (PLAN §2 전이 훅)
  if (sim.state.kind === 'performing' && cand.action === 'sleep') {
    runReflection(world, sim, world.worldTick + 1, emit);
    maybeBuyCar(world, sim, world.worldTick + 1, emit); // §19 R-B: 두 sleep 전이 지점 모두 (65차)
    collectComplaints(world, sim, world.worldTick + 1, emit); // §19.5
  }
  return true;
}


function startIdle(sim, L, emit) {
  sim.state = { ...emptyState(), kind: 'performing', action: 'idle', ticksLeft: actionDuration('idle', L) };
  emit('action_started', sim.id, { action: 'idle', reason: { noCandidates: true } });
}

function applyMood(sim, delta) {
  sim.mood = clamp(sim.mood + delta, -10000, 10000);
}

// 부호 보존 스케일 (PLAN §12.1): sign(d) × floorDiv(|d| × factor, 100)
function scaleDelta(delta, factor) {
  const s = Math.sign(delta);
  return s * floorDiv(Math.abs(delta) * factor, 100);
}

function argumentThreshold(sim, L) {
  return clamp(
    L.affinity.argumentBase - (sim.traits.mbti.TF - 50) * L.affinity.argumentTfCoef,
    L.affinity.argClampMin, L.affinity.argClampMax);
}

// ---- 입력 명령 핸들러 (1단계) ----

function applyLogicUpdate(world, inp, emit) {
  const p = inp.payload;
  // 페이로드 형태 엄격 검증: params 객체 + hash 문자열 + revision 정수 필수, 해시 일치 무조건 검사
  if (p === null || typeof p !== 'object' || Array.isArray(p)
    || typeof p.hash !== 'string' || !Number.isSafeInteger(p.revision)) {
    emit('input_rejected', null, { reason: 'malformed_payload', inputId: inp.id ?? null });
    return;
  }
  const v = validateLogic(p.params);
  if (!v.ok || logicHash(p.params) !== p.hash) {
    emit('input_rejected', null, { reason: 'invalid_logic', errors: (v.errors ?? []).slice(0, 5), inputId: inp.id ?? null });
    return;
  }
  world.logic = p.params;
  emit('logic_changed', null, { hash: p.hash, revision: p.revision });
}

function applyCreatePlayer(world, inp, t, emit) {
  const p = inp.payload;
  const reject = (reason) => emit('input_rejected', null, { reason, inputId: inp.id ?? null });
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return reject('malformed_payload');
  if (world.sims.some((s) => s.isPlayer)) return reject('player_exists');
  const name = typeof p.name === 'string' ? p.name : '';
  const nameLen = [...name].length; // 유니코드 코드포인트
  if (nameLen < 1 || nameLen > 12) return reject('invalid_name');
  if (p.nameMode !== undefined && !['full', 'given'].includes(p.nameMode)) return reject('invalid_name_mode');
  // §22.17 주인공은 **이름·성별·MBTI만** 고른다 (사용자 지시). 나이와 직업은 세계가 정한다 —
  // 이 마을에 이사 오는 사람이 자기 나이를 고르지 않듯이, 그리고 직업은 이 세계에서
  // 무엇이 필요한지·내가 무엇을 잘하는지로 정해지는 것이지 메뉴에서 고르는 게 아니다.
  //
  // 나이: (seed, id) 해시로 25~44세 사이. 난수를 소비하지 않는다.
  // 직업: 능력치 적성이 가장 높은 직업. 동점은 OCCUPATIONS 등재 순 — 완전 순서다.
  const id = nextSimId(world);
  const age = 25 + (surnameHash(world.seed, id * 7 + 3) % 20);
  const abilities = makeAbilities(world.seed, id);
  const pickable = OCCUPATIONS.filter((o) => occupationAllowed(o, age)
    && !SWITCH_ONLY_OCCUPATIONS.includes(o) && !BIRTH_STAGE_OCCUPATIONS.includes(o));
  let occupation = pickable[0];
  let best = -1;
  for (const o of pickable) {
    const key = world.logic.abilities.keyAbility[o];
    const v = key === undefined ? 50 : (abilities[key] ?? 50);
    if (v > best) { best = v; occupation = o; }
  }
  const traits = { gender: p.gender, age, mbti: p.mbti, occupation };
  const traitErr = validateTraits(traits);
  if (traitErr) return reject(`invalid_traits: ${traitErr}`);

  // 홈: 거주자 최소 집, 동수면 facilityId 오름차순 (결정적)
  const houses = world.map.facilities.filter(isAvailableResidence); // 개척 예약 주택 제외
  const counts = new Map(houses.map((h) => [h.id, 0]));
  for (const s of world.sims) if (counts.has(s.homeId)) counts.set(s.homeId, counts.get(s.homeId) + 1);
  const home = [...houses].sort((a, b) => (counts.get(a.id) - counts.get(b.id)) || (a.id < b.id ? -1 : 1))[0];


  // §22.16 플레이어도 같은 창구로 만든다. 예전에는 여기만 필드가 달라서 groceries·sick이
  // 빠졌고, 그게 결정성 계약을 깨뜨렸다 (§22.13). 이제 그럴 자리가 없다.
  const sim = makeSim({
    id,
    name,
    // 명시적 full 입력은 사용자가 적은 이름 그대로 표시한다. 과거 입력의 기본 동작은 보존한다.
    surname: p.nameMode === 'full' ? '' : typeof p.surname === 'string' && p.surname.length >= 1 && p.surname.length <= 2
      ? p.surname
      : surnameFor(world.seed, id), // 플레이어가 성을 안 고르면 분포에서 뽑아 준다
    homeId: home.id,
    villageId: home.villageId,
    householdId: `household:${id}`,
    isPlayer: true,
    logic: world.logic,
    traits,
    seed: world.seed,
    x: home.door.x,
    y: home.door.y + 1,
    needs: { hunger: 7000, energy: 7000, social: 7000, fun: 7000 }, // 고정, rng 미소비
    money: world.logic.occupations[traits.occupation].startMoney,   // 고정분만
  });
  world.sims.push(sim);
  // §23.14 플레이어도 정원을 지킨다 (Codex 지적: 인구 11명 마을에 플레이어가 police로
  // 태어났고 경찰 정원은 0이었다). 규칙이 사람을 가려서 적용되면 규칙이 아니다.
  // 강등되면 돈도 새 직업 기준으로 맞춘다 — 이민자와 같은 이유다.
  if (demotePublicIfOverQuota(world, sim, emit, 'player_quota')) {
    sim.money = world.logic.occupations[sim.traits.occupation].startMoney;
  }
  // §23.17 플레이어가 들고 오는 돈도 **마을 밖에서 들어온 돈**이다 (Codex 지적: 이민자
  // 경로에만 있었고 여기엔 없어서, 플레이어를 만들 때마다 폐쇄 회계 G1에 구멍이 났다).
  // 강등까지 끝난 최종 금액을 잡는다 — 중간 상태를 장부에 남기지 않는다.
  world.externalInflow = (world.externalInflow ?? 0) + sim.money;
  // 행렬은 **id 공간** 기준으로 늘린다. sims.length 기준으로 늘리면 사망으로 심이
  // 빠진 뒤 첨자가 어긋난다 (§22.2에서 같은 이유로 growIdMatrices를 만들었다).
  growIdMatrices(world);
  emit('player_created', id, { name, occupation: sim.traits.occupation, homeId: home.id });
}

// announce (D7): 플레이어가 모임 공지 토큰을 주입 — 초기엔 플레이어만 알고 확산으로 퍼진다
function applyAnnounce(world, inp, t, emit) {
  const p = inp.payload;
  const reject = (reason) => emit('input_rejected', null, { reason, inputId: inp.id ?? null });
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return reject('malformed_payload');
  const player = world.sims.find((s) => s.isPlayer);
  if (!player) return reject('no_player');
  if (!['cafe', 'park'].includes(p.placeId)) return reject('invalid_place');
  const L = world.logic;
  if (!Number.isSafeInteger(p.hoursFromNow) || p.hoursFromNow < 1 || p.hoursFromNow > L.diffusion.announceMaxHours) {
    return reject('invalid_hours');
  }
  const token = {
    tokenId: world.tokenCounter++,
    topic: 'announce',
    originTick: t,
    scheduledTick: t + p.hoursFromNow * 60,
    placeId: p.placeId,
    expiresTick: t + p.hoursFromNow * 60 + L.diffusion.expireAfter,
  };
  world.tokens.push(token);
  learnToken(player, token, t, L);
  emit('token_created', player.id, { tokenId: token.tokenId, placeId: p.placeId, scheduledTick: token.scheduledTick, announced: true });
}

// §18.T1: 시장 정책 — 화이트리스트 필드만 월드 정책 오버라이드로 병합 (내구 입력, 리플레이 불변)
function applyPolicy(world, inp, t, emit) {
  applyPolicyCommand(world,inp.payload,t,emit);
}

// §18.T2: 건설 지시 — 주문 시 국고 차감·FIFO 적재 (47차 합의: 취소 없음, 착공 시 재검증)
function applyZone(world, inp, t, emit) {
  const p = inp.payload ?? {};
  const L = world.logic;
  const plot = world.plots.find((pl) => pl.plotId === p.plotId);
  const government=governmentFor(world,plot?.villageId);
  const cost = L.zone.costs[p.type];
  let reason = null;
  if (!plot) reason = 'no_plot';
  else if (plot.used) reason = 'plot_used';
  else if (!zoneAllowedTypes(world,plot.villageId).includes(p.type)) reason = 'tier_locked'; // §18.T4 등급 게이트
  else if (!ZONEABLE.includes(p.type)) reason = 'bad_type'; // 언락됐지만 레시피 미구현(T3 대기)
  else if (!Number.isSafeInteger(p.dir) || p.dir < 0 || p.dir > 3) reason = 'bad_dir';
  else if (foundingSiteReserved(world,plot,p.type,p.dir)) reason='site_reserved';
  if (reason) { emit('input_rejected', null, { command: 'zone', reason }); return; }
  const demolitionTiles = () => { const fp = zoneFootprint(p.type, p.dir); let n = 0;
    for (let y = plot.y; y < plot.y + fp.h; y++) for (let x = plot.x; x < plot.x + fp.w; x++) {
      const tile = world.map.tiles[y * world.map.w + x];
      if (tile === TILE.ROAD || tile === TILE.SIDEWALK) n++; else if (tile !== TILE.GRASS) return -1;
    } return n; };
  const demolished = plot ? demolitionTiles() : 0;
  if (reason === null && !(() => { const fp = zoneFootprint(p.type, p.dir); return plotBuildable(world.map, plot, fp.w, fp.h) || demolished > 0; })()) reason = 'not_buildable';
  else if (reason === null && government.treasury < cost + Math.max(0, demolished) * (L.zone.demolitionCostPerTile ?? 0)) reason = 'treasury_short';
  if (reason) { emit('input_rejected', null, { command: 'zone', reason }); return; }
  const demolitionCost = demolished * (L.zone.demolitionCostPerTile ?? 0);
  const tileChanges = [];
  if (demolished > 0) for (let y = plot.y; y < plot.y + zoneFootprint(p.type, p.dir).h; y++) for (let x = plot.x; x < plot.x + zoneFootprint(p.type, p.dir).w; x++) {
    const tile = world.map.tiles[y * world.map.w + x];
    if (tile === TILE.ROAD || tile === TILE.SIDEWALK) {
      world.map.tiles[y * world.map.w + x] = TILE.GRASS;
      tileChanges.push({ index: y * world.map.w + x, tile: TILE.GRASS });
    }
    delete world.wear[y * world.map.w + x];
  }
  government.treasury -= cost + demolitionCost;
  // §22.4 (93차 ②) 건설비는 마을 밖 시공사에게 나간다 — 경계 **유출**로 명시한다.
  // 안 세면 '내부에서 돈이 사라지는' 회계가 되어 G1 폐쇄 회계가 성립하지 않는다.
  world.externalOutflow = (world.externalOutflow ?? 0) + cost + demolitionCost;
  world.zoneOrders.push({ plotId: p.plotId, type: p.type, dir: p.dir });
  emit('zoned', null, { plotId: p.plotId, type: p.type, dir: p.dir, cost, demolitionCost, demolished, tileChanges, treasury: government.treasury });
}

// §18.T6: 플레이어가 지정한 계획 중심점 — 비용을 즉시 예약하고 자동 건설 점수에 반영한다.
function applyPlanCenter(world, inp, t, emit, source = 'player') {
  const p = inp.payload ?? {};
  const root = world.rootWorld ?? world;
  const villageId = Object.hasOwn(p, 'villageId') ? p.villageId : world.municipalityId ?? 'village:0';
  if (!root.villages.some(v => v.id === villageId)
    || (villageId !== 'village:0' && !root.villages.find(v => v.id === villageId)?.government)) {
    emit('input_rejected', null, { command: 'plan_center', reason: 'invalid_village' }); return;
  }
  const government = governmentFor(root, villageId);
  const cost = world.logic.zone.plannedCenterCost;
  const validCoord = Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y)
    && p.x >= 0 && p.x < world.map.w && p.y >= 0 && p.y < world.map.h;
  let reason = null;
  if (!validCoord) reason = 'out_of_bounds';
  else if (!isWalkable(world.map, p.x, p.y)) reason = 'not_walkable';
  else if ((root.centers ?? []).some((c) => c.x === p.x && c.y === p.y)) reason = 'duplicate';
  else if (government.treasury < cost) reason = 'treasury_short';
  if (reason) { emit('input_rejected', null, { command: 'plan_center', reason }); return; }
  government.treasury -= cost;
  root.externalOutflow = (root.externalOutflow ?? 0) + cost;
  root.centers ??= [];
  const centerId = `center${root.centers.length}`;
  const jurisdiction = villageId === 'village:0' ? {} : { villageId };
  root.centers.push({ centerId, x: p.x, y: p.y, createdTick: t, ...jurisdiction });
  emit('center_planned', source === 'mayor' ? government.mayorId : null,
    { centerId, x: p.x, y: p.y, cost, treasury: government.treasury, source, ...jurisdiction });
}

// 재정 리뷰일에 관측된 외곽 거주 수요를 본다. 기존 중심지 반경 안에는 중복 투자하지 않는다.
export function maybePlanCenter(world, t, day, emit) {
  const mayor = world.sims.find((s) => s.id === world.mayorId);
  if (!mayor || !canWork(mayor) || mayor.isPlayer || day % world.logic.fiscal.reviewIntervalDays !== 0) return;
  const Z = world.logic.zone;
  const cash = world.sims.reduce((n, s) => n + s.money, 0);
  const reserve = Math.max(0, floorDiv(cash * world.logic.election.hoardRatioPct, 100));
  if (world.treasury - Z.plannedCenterCost <= reserve) return;
  const villageId = world.municipalityId ?? 'village:0';
  const centers = [...world.map.facilities.filter((f) => ['city_hall', 'market'].includes(f.type)),
    ...world.centers.filter(c => (c.villageId ?? 'village:0') === villageId)];
  const homes = new Map(world.map.facilities.filter(isResidence).map((f) => [f.id, f]));
  const residents = world.sims.map((s) => homes.get(s.homeId)).filter(Boolean);
  const busy = new Set(world.projects.map((p) => p.plotId));
  const choices = world.plots.filter((p) => (p.villageId ?? 'village:0') === villageId
    && !p.used && !busy.has(p.plotId) && plotBuildable(world.map, p)
    && !foundingSiteReserved(world.rootWorld ?? world, p, 'office')
    && centers.every((c) => manhattan(p.x, p.y, c.x, c.y) >= Z.centerRadius))
    .map((p) => ({ p, residents: residents.filter((h) => manhattan(p.x, p.y, h.door.x, h.door.y) < Z.centerRadius
      && sameRegion(world.map, p.x, p.y, h.door.x, h.door.y)).length }))
    .filter((c) => c.residents >= Z.centerMinResidents)
    .sort((a, b) => b.residents - a.residents || a.p.plotId - b.p.plotId);
  if (choices.length) applyPlanCenter(world, { payload: choices[0].p }, t, emit, 'mayor');
}

// §18.T1: 유효 경제값 — 정책 오버라이드 우선 (읽기 단일 권위)
function econ(world, key, villageId) {
  return governmentFor(world,villageId).policy[key] ?? world.logic.economy[key];
}

function applyAssign(world, inp, t, emit) {
  const p = inp.payload;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    emit('input_rejected', null, { reason: 'malformed_payload', inputId: inp.id ?? null });
    return;
  }
  const { simId, actionType } = p;
  const sim = world.sims.find((s) => s.id === simId);
  if (!sim || !ACTIONS.includes(actionType) || actionType === 'idle') {
    emit('input_rejected', typeof simId === 'number' ? simId : null, { reason: 'invalid', inputId: inp.id ?? null });
    return;
  }
  const cands = collectCandidates(world, sim, [actionType], t, true); // assign은 효용 무시 (PLAN §2)
  const best = pickBest(cands);
  if (!best) {
    emit('input_rejected', simId, { reason: 'no_valid_target', action: actionType, inputId: inp.id ?? null });
    return;
  }
  startAction(world, sim, best, t, emit, { assigned: true });
}

// ---- 메인: 틱 t로의 전이. world를 mutate, 이벤트 배열 반환 ----
export function tick(world, inputsForThisTick = []) {
  const t = world.worldTick + 1;
  const events = [];
  rollTransportDay(world, t);
  const emit = (type, simId, payload) => {
    recordTransportEvent(world, type);
    events.push({ tick: t, type, simId, payload });
  };

  // 1) 입력 적용 — logic_update 먼저(sequence 순), 그 다음 나머지(sequence 순) (PLAN §14.1)
  const sorted = [...inputsForThisTick].sort((a, b) => a.sequence - b.sequence);
  for (const inp of sorted.filter((i) => i.command === 'logic_update')) applyLogicUpdate(world, inp, emit);
  for (const inp of sorted.filter((i) => i.command !== 'logic_update')) {
    if (inp.command === 'assign') applyAssign(world, inp, t, emit);
    else if (inp.command === 'create_player') applyCreatePlayer(world, inp, t, emit);
    else if (inp.command === 'announce') applyAnnounce(world, inp, t, emit);
    else if (inp.command === 'policy') applyPolicy(world, inp, t, emit);
    else if (inp.command === 'zone') applyZone(world, inp, t, emit);
    else if (inp.command === 'plan_center') applyPlanCenter(world, inp, t, emit);
    else if (inp.command === 'found_village') applyFoundingDecision(world, inp.payload, t, emit);
    else emit('input_rejected', null, { reason: 'unknown_command', inputId: inp.id ?? null });
  }

  // L은 logic_update 적용 **이후**에 캡처 — "같은 틱부터 새 로직" 계약 (PLAN §14.1)
  const L = world.logic;
  fundFoundingPlans(world,t,emit);
  updateSeason(world, t, emit);
  applyHouseholdIntents(world,t,emit); // #51 전날 의도는 이동/행동 전에 현재 조건으로 재검증
  advanceSettlementPlans(world,t,emit,(sim,cand)=>startAction(world,sim,cand,t,emit,{settlement:true}));

  // A guardian can die/emigrate between ticks. Never leave a child frozen or a
  // hospital seat owned by that child when the escort no longer exists.
  for(const child of world.sims){
    if(!['awaiting_escort','being_escorted'].includes(child.state.kind))continue;
    const guardian=world.sims.find(s=>s.id===child.state.escortId);
    if(!guardian||guardian.state.action!==ESCORT_ACTION){
      const key=`${child.state.facilityId}:${child.state.resourceId}`;
      if(world.reservations[key]===child.id)delete world.reservations[key];
      child.state=emptyState();
    }
  }

  // 2a) walking 전진 (id 오름차순). §19 R-B: 자가용은 한 틱에 최대 carSpeedTiles칸을
  // **경로 순서대로** 전진한다(64차 (a)) — 마모·습득·인사 등 칸 효과는 각 칸마다 그대로 적용.
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'walking') continue;
    if (!world.transportStats.pending[sim.id]) recordTransportDeparture(world, sim, s.path, t, false);
    if(s.action===ESCORT_ACTION&&s.escortPhase==='travel'&&!syncEscortStep(world,sim)){
      cancelEscort(world,sim);emit('action_failed',sim.id,{action:ESCORT_ACTION,reason:'child_unavailable'});continue;
    }
    const steps = sim.hasCar&&s.action!==SETTLE_ACTION ? world.logic.transport.carSpeedTiles : 1;
    let pickedThisTick = false; // §16.C 습득은 틱당 1회 — 차량이 습득률을 배로 늘리지 않도록 (65차 대비)
    for (let stepI = 0; stepI < steps && s.kind === 'walking' && s.path.length > 0; stepI++) {
    const next = s.path.shift();
    sim.x = next.x; sim.y = next.y;
    recordTransportStep(world, sim, t, world.map.tiles[sim.y * world.map.w + sim.x]);
    if(s.action===ESCORT_ACTION&&s.escortPhase==='travel'&&!syncEscortStep(world,sim)){
      cancelEscort(world,sim);emit('action_failed',sim.id,{action:ESCORT_ACTION,reason:'child_unavailable'});break;
    }
    if (s.journey) s.journey.walked++;
    // §22.91 보행 마모: 사람 발자국은 차도가 아니라 인도가 된다.
    const ti = sim.y * world.map.w + sim.x;
    if (world.map.tiles[ti] === TILE.GRASS) {
      world.wear[ti] = (world.wear[ti] ?? 0) + 1; // 희소 객체 (§17.0)
      if (world.wear[ti] >= world.logic.build.wearThreshold) {
        delete world.wear[ti]; // 0 엔트리 금지 규칙의 연장 — 도로화된 칸은 제거
        if (!isRoadProtected(world.map, sim.x, sim.y, false)) {
          world.map.tiles[ti] = TILE.SIDEWALK;
          emit('sidewalk_formed', sim.id, { x: sim.x, y: sim.y });
        }
      }
    }
    // §16.C: 분실물 습득 — 현재 좌표의 아이템(itemId 오름차순 첫 번째). 틱당 1회.
    if (world.lostItems.length > 0 && !pickedThisTick) {
      // 인접(맨해튼 ≤1)까지 습득 — 정확히 밟을 확률만으론 죽은 콘텐츠 (itemId asc 첫 번째)
      const idx = world.lostItems.findIndex((it) => Math.abs(it.x - sim.x) + Math.abs(it.y - sim.y) <= 1);
      if (idx !== -1) {
        pickedThisTick = true; // 틱당 1회 (차량 다중 전진 대비)
        const it = world.lostItems[idx];
        world.lostItems.splice(idx, 1);
        emit('item_found', sim.id, { itemId: it.itemId, amount: it.amount, x: it.x, y: it.y });
        // §17.24 정직 신고 (56차): 경찰이 있는 마을에서만, p = base + floorDiv(TF, tfDiv) — dayHash 비소비
        const H = world.logic.honesty;
        const day2 = floorDiv(t, 1440);
        const hasPolice = world.sims.some((s2) => s2.traits.occupation === 'police');
        if (hasPolice && dayHash(sim.id, day2, 7) < H.base + floorDiv(sim.traits.mbti.TF, H.tfDiv)) {
          world.lostAndFound.push({ itemId: it.itemId, finderId: sim.id, amount: it.amount, dueDay: day2 + H.holdDays });
          applyMood(sim, H.reportMood); // 뿌듯함
          emit('item_reported', sim.id, { itemId: it.itemId, amount: it.amount });
          recordFact(sim, t, world.logic, 'honest', { tags: ['luck'] });
        } else {
          sim.money += it.amount;
          world.externalInflow = (world.externalInflow ?? 0) + it.amount; // §22.4 경계 유입 (길에서 주운 돈)
          applyMood(sim, world.logic.items.pickupMood);
          emit('money_changed', sim.id, { delta: it.amount, balance: sim.money, action: 'found' });
          recordFact(sim, t, world.logic, 'found_item', { tags: ['luck'] });
        }
      }
    }
    if (s.path.length === 0) {
      recordTransportArrival(world, sim);
      recordRoadTrip(world, sim, s.journey, t, emit);
      s.journey = null;
      s.kind = 'performing';
      if(s.action===ESCORT_ACTION&&s.escortPhase===null){
        if(beginHospitalEscort(world,sim)){recordTransportDeparture(world,sim,sim.state.path,t);emit('child_escorted',sim.id,{childId:sim.state.escortId,facilityId:sim.state.facilityId});}
        else{sim.state=emptyState();emit('action_failed',sim.id,{action:ESCORT_ACTION,reason:'hospital_unavailable'});}
        continue;
      }
      // onEnterPerforming(sleep) — 도착 전이 지점 (PLAN §2 전이 훅)
      if (s.action === 'sleep') { runReflection(world, sim, t, emit); maybeBuyCar(world, sim, t, emit); collectComplaints(world, sim, t, emit); } // §19 R-B/§19.5
    }
    }
  }

  completeSettlementArrivals(world,t,emit);
  // 2a-2) 스쳐 지나가는 인사 (D9) — 전파(2b)보다 먼저: 같은 틱 전파는 인사 후 호감도를 본다
  processGreetings(world, t, emit);

  // 2b) socialize 페어링: 시설별, id 오름차순 2명씩. 호감도는 비대칭(각자 TF 계수) (PLAN §12.1)
  const pairedThisTick = new Set();
  const pairedWith = new Map(); // §17.5 파트너 회복 보너스용
  {
    const byFacility = new Map();
    for (const sim of world.sims) {
      const s = sim.state;
      if (s.kind === 'performing' && s.action === 'socialize') {
        if (!byFacility.has(s.facilityId)) byFacility.set(s.facilityId, []);
        byFacility.get(s.facilityId).push(sim);
      }
    }
    const facIds = [...byFacility.keys()].sort();
    for (const facId of facIds) {
      const group = byFacility.get(facId);
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i], b = group[i + 1];
        pairedThisTick.add(a.id); pairedThisTick.add(b.id);
        pairedWith.set(a.id, b.id); pairedWith.set(b.id, a.id);
        a.state.pairedTicks++; b.state.pairedTicks++;
        // §22.6 (95차 ②) 초대가 실제 만남으로 이어졌는지 계측한다.
        // 청을 받아들여도 그 자리로 가는 사이 초대한 쪽이 떠나 있을 수 있다 —
        // 지표가 없으면 '행동은 있는데 왜 외로움이 그대로인지' 알 수 없다.
        for (const p of [a, b]) {
          if (p.invitedTo && p.invitedTo.untilTick > t && p.invitedTo.facilityId === facId) {
            emit('invite_fulfilled', p.id, { facilityId: facId, withSimId: p === a ? b.id : a.id });
            p.invitedTo = null; // §22.13 undefined는 직렬화가 삼켜 왕복이 고정점이 아니다
          }
        }
        // §17.8 페어링 서브순서: ① 전파 → ② 전염 → ③ 대화(험담 영향 포함) → ④ 델타
        const transferred = transferTokens(world, a, b, t, emit);
        contagionDraw(world, a, b, t, emit);
        maybeConverse(world, a, b, facId, t, transferred > 0, emit);
        // D3: 상호작용 카운트 (대칭, 포화 캡)
        const IC = 1000000;
        world.interactions[a.id][b.id] = Math.min(IC, world.interactions[a.id][b.id] + 1);
        world.interactions[b.id][a.id] = Math.min(IC, world.interactions[b.id][a.id] + 1);
        const delta = rngInt(world.rngSim, L.affinity.deltaSpan) + L.affinity.deltaMin // [-20, 40]
          + pairDeltaBonus(world, a, b); // §17: 연인·동아리 동료 보너스
        const fA = L.affinity.tfScaleBase + a.traits.mbti.TF;
        const fB = L.affinity.tfScaleBase + b.traits.mbti.TF;
        const beforeAB = world.affinity[a.id][b.id];
        const beforeBA = world.affinity[b.id][a.id];
        const afterAB = clamp(beforeAB + scaleDelta(delta, fA), AFFINITY_MIN, AFFINITY_MAX);
        const afterBA = clamp(beforeBA + scaleDelta(delta, fB), AFFINITY_MIN, AFFINITY_MAX);
        world.affinity[a.id][b.id] = afterAB;
        world.affinity[b.id][a.id] = afterBA;
        // 페어 임계 = 두 심 중 더 얕은(높은) 값 (PLAN §12.1)
        const thr = Math.max(argumentThreshold(a, L), argumentThreshold(b, L));
        const crossed = (beforeAB >= thr && afterAB < thr) || (beforeBA >= thr && afterBA < thr);
        if (crossed) {
          emit('argument', a.id, { withSimId: b.id });
          applyMood(a, L.mood.argument); applyMood(b, L.mood.argument); // 사실 발생 지점 (PLAN §12.1)
          recordFact(a, t, L, 'argument', { subjectSimId: b.id, placeId: facId, tags: ['argument', `facility:${facId}`, `sim:${b.id}`] });
          recordFact(b, t, L, 'argument', { subjectSimId: a.id, placeId: facId, tags: ['argument', `facility:${facId}`, `sim:${a.id}`] });
        }
        // ⑤ §21.2 나눔 — 만나서 곤경에 처한 가까운 사람에게 나눠준다.
        // 만남의 첫 틱에만 (같은 자리에서 반복 이체 방지). dayHash라 rngSim 미소비.
        if (a.state.pairedTicks === 1) maybeShare(world, a, b, t, floorDiv(t, 1440), emit); // 틱 내부 날짜 규약
      }
    }
  }

  // §22.6 먼저 말 걸기 (이슈 #69) — 페어링이 끝난 뒤, 혼자 남은 심이 옆 사람에게 청한다.
  // 페어링 다음에 두는 이유: 누가 혼자인지 확정된 뒤라야 말을 걸 대상이 정해진다.
  // §22.14 승낙하면 그 자리에서 바로 말이 트인다 — pairedThisTick을 넘겨 이중 계산을 막는다.
  const sideTalked = maybeApproach(world, t, floorDiv(t, 1440), emit, pairedThisTick);

  // 2c) performing 전진 + 회복 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing') continue;
    // Old saves may resume a shift or construction before the next lifecycle pass.
    if (LABOR_ACTIONS.has(s.action) && !canWork(sim)) {
      releaseReservation(world, sim); sim.state = emptyState(); continue;
    }
    s.ticksLeft--;
    if (s.action === 'study') {
      const facility = world.map.facilities.find(f => f.id === s.facilityId);
      if (actionBlockReason(world,sim,'study',t) !== null || !facility || !recordStudy(sim, facility.type)) {
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
      const day = Math.floor(t / 1440);
      if (sim.education.studyDay !== day) { sim.education.studyDay = day; sim.education.dailyTicks = 0; }
      sim.education.dailyTicks++;
    }
    developFromActivity(world, sim, t, emit);
    const def = L.actions[s.action];
    const need = NEED_OF_ACTION[s.action];
    if (need && def.recoverPerTick) {
      const sideOnly = s.action === 'socialize' && !pairedThisTick.has(sim.id) && sideTalked.has(sim.id);
      const recovers = s.action !== 'socialize' || pairedThisTick.has(sim.id) || sideOnly;
      if (recovers) {
        let amt = def.recoverPerTick;
        // §22.14 곁다리 대화는 마주 앉은 대화보다 약하다
        if (sideOnly) amt = floorDiv(amt * L.social.sideTalkFactorPct, 100);
        // §17.5: 연인과의 수다는 더 달콤하다
        if (s.action === 'socialize' && pairedWith.get(sim.id) === world.partners[sim.id]) {
          amt = floorDiv(amt * L.romance.partnerSocialPct, 100);
        }
        sim.needs[need] = Math.min(NEED_MAX, sim.needs[need] + amt);
      }
    }
    // §16.5: 건설 노동 — 현재 프로젝트와 같은 plot의 현장 수행만 기여
    if (s.action === 'construct') {
      // §19.3: 자원 id가 프로젝트를 식별 — 옛 현장 수행자는 기여하지 않음 (§16.5 레이스 규칙 유지)
      const m2 = /^p(\d+):/.exec(s.resourceId); // §19.3 (67차 ②): 엄격 파싱 — 'p:spot0' 오인 방지
      if (m2) {
        const pid = Number(m2[1]);
        const prj = Number.isSafeInteger(pid) ? world.projects.find((p) => p.plotId === pid) : null;
        if (prj&&foundingWorkerAllowed(world,sim,prj)) {
          const plot=world.plots.find(p=>p.plotId===pid);
          const onSite=plot&&[plot.x+1,plot.x+4].includes(sim.x)&&[plot.y+1,plot.y+3].includes(sim.y);
          if(prj.foundingPetitionId===undefined||onSite)prj.progress++;
        }
      }
    }
    // 대처 행동의 틱당 효과 (§15.1.A): 기분 직접 회복 + 부수 욕구
    if (def.moodPerTick) applyMood(sim, def.moodPerTick);
    if (def.funPerTick) sim.needs.fun = Math.min(NEED_MAX, sim.needs.fun + def.funPerTick);
    if (def.energyPerTick) sim.needs.energy = Math.min(NEED_MAX, sim.needs.energy + def.energyPerTick);
    if (def.hungerPerTick) sim.needs.hunger = Math.min(NEED_MAX, sim.needs.hunger + def.hungerPerTick);
    // §23.10 마주 앉아 하는 놀이는 사교도 채운다 (Codex 지적: 보드게임 이용자가 남의
    // 존재만 소비하고 아무것도 돌려주지 않았다). 주 욕구는 '재미'로 두어 대화와
    // 정면 충돌하지 않게 하고, 사교는 부수 효과로 붙인다.
    if (def.socialPerTick) sim.needs.social = Math.min(NEED_MAX, sim.needs.social + def.socialPerTick);
  }

  // 3) 완료 정산 (id 오름차순) — 기분 델타는 사실 발생 지점에서 즉시 (PLAN §12.1)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing' || s.ticksLeft > 0) continue;
    if(s.action===SETTLE_ACTION){releaseReservation(world,sim);sim.state=emptyState();continue;}
    if(s.action===ESCORT_ACTION&&s.escortPhase===null){
      if(beginHospitalEscort(world,sim)){recordTransportDeparture(world,sim,sim.state.path,t);emit('child_escorted',sim.id,{childId:sim.state.escortId,facilityId:sim.state.facilityId});}
      else{sim.state=emptyState();emit('action_failed',sim.id,{action:ESCORT_ACTION,reason:'hospital_unavailable'});}
      continue;
    }
    if (s.action === 'seek_food_aid') {
      if (!takePublicMeal(world, sim, emit)) {
        emit('action_failed', sim.id, { action: s.action, reason: foodAidBlockReason(world, sim) ?? 'invalid_site' });
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
    } else if (s.action === 'eat' || s.action === 'drink' || s.action === 'binge_eat') {
      if (s.action !== 'drink') sim.hungerZeroTicks = 0; // §22.2 먹으면 굶은 시계가 멈춘다
      const cost = L.actions[s.action].cost;
      sim.money -= cost;
      payToFacility(world, s.facilityId, cost); // §20.2 소멸 → 시설 매출
      emit('money_changed', sim.id, { delta: -cost, balance: sim.money, action: s.action });
      if (s.action === 'drink') {
        // 숙취 (§15.1.A): t < hangoverUntil 동안 energy(수면 욕구) 감쇠 가산
        sim.hangoverUntil = t + L.coping.hangoverTicks;
        emit('hangover', sim.id, { untilTick: sim.hangoverUntil });
      }
      if (s.action === 'binge_eat') applyMood(sim, -L.actions.binge_eat.regretMood); // 후회
    } else if (s.action === CULTURE_ACTION) {
      const result = completeCultureVisit(world, sim, s.facilityId, emit);
      if (!result.ok) {
        emit('action_failed', sim.id, { action: s.action, reason: result.reason });
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
    } else if (s.action === 'garden') {
      // §23.8 텃밭은 **먹거리를 만든다** — 여가가 살림에 닿는 유일한 통로다.
      // 바깥에서 들어온 것이 아니라 땅에서 난 것이므로 돈이 아니라 식재료로 센다.
      const before = sim.groceries;
      sim.groceries = Math.min(L.market.maxGroceries, sim.groceries + seasonalYield(world, L.actions.garden.groceriesGain, t));
      recordGardenProduce(world, sim, before, emit);
    } else if (s.action === GROW_ACTION) {
      const before = sim.groceries;
      sim.groceries = Math.min(L.market.maxGroceries, sim.groceries + seasonalYield(world, L.actions.grow_groceries.groceriesGain, t));
      recordGardenProduce(world, sim, before, emit, GROW_ACTION);
    } else if (s.action === 'volunteer') {
      // 봉사는 마을의 평판을 올린다. 평판은 이민을 부르므로(§society.immigration)
      // "좋은 사람들이 사는 곳"이 실제로 사람을 불러들인다.
      const facility=world.map.facilities.find(f=>f.id===s.facilityId);
      changeReputation(world,L.actions.volunteer.repGain,facility?.villageId??sim.villageId);
    } else if (s.action === 'board_game') {
      const cost = L.actions.board_game.cost;
      sim.money -= cost;
      payToFacility(world, s.facilityId, cost); // 카페의 두 번째 매출원
      emit('money_changed', sim.id, { delta: -cost, balance: sim.money, action: s.action });
    } else if (s.action === 'exercise') {
      applyMood(sim, L.actions.exercise.completeMoodBonus);
    } else if (s.action === 'fish') {
      // §16.B: 완료 시 단 1드로우 (중단 시 정산 미도달 → 드로우 없음). 서브순서:
      // 드로우 → (성공 시) money+이벤트 / (허탕) mood 감점 → 이후 공통 완료 경로 (Codex 22차 항목 4)
      const catchAmt = seasonalYield(world, rngInt(world.rngSim, L.actions.fish.catchSpan), t, 'fish');
      if (catchAmt > 0) {
        sim.money += catchAmt;
        world.externalInflow = (world.externalInflow ?? 0) + catchAmt; // §22.4 경계 유입 (강에서 온 것)
        emit('fish_caught', sim.id, { amount: catchAmt });
        emit('money_changed', sim.id, { delta: catchAmt, balance: sim.money, action: 'fish' });
      } else {
        applyMood(sim, -L.actions.fish.missMood);
      }
    } else if (s.action === 'respond_fire') {
      resolveFire(world, sim, s.resourceId.slice(5), t, emit); // 'fire:<facId>' → facId (§17.20)
    } else if (s.action === 'see_doctor') {
      if (!completeMedicalVisit(world, sim, emit)) {
        emit('action_failed', sim.id, { action: s.action, reason: medicalBlockReason(world, sim) ?? 'invalid_site' });
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
    } else if (s.action === 'shop' || s.action === STOCK_ACTION) {
      const result = completeGroceryPurchase(world, sim, s.facilityId, emit, s.action);
      if (!result.ok) {
        emit('action_failed', sim.id, { action: s.action, reason: result.reason });
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
    } else if (s.action === SUPPLY_ACTION) {
      const result = completeDelivery(world, sim, s.facilityId, emit);
      if (!result.ok) {
        emit('action_failed', sim.id, { action: s.action, reason: result.reason });
        releaseReservation(world, sim); sim.state = emptyState(); continue;
      }
    } else if (s.action === 'cook_eat') {
      sim.hungerZeroTicks = 0; // §22.2
      sim.groceries = Math.max(0, sim.groceries - 1);
    } else if (s.action === 'build') {
      // 완료 시 게이트 재검증 (같은 집 동시 건설 초과 방지, Codex 20차 항목 3)
      const home = world.map.facilities.find((f) => f.id === s.facilityId);
      const extraBuilt = home.resources.length - 2;
      if (extraBuilt >= L.build.maxExtraBeds || sim.money < L.actions.build.cost) {
        emit('action_failed', sim.id, { action: 'build', reason: extraBuilt >= L.build.maxExtraBeds ? 'already_built' : 'no_money' });
        releaseReservation(world, sim);
        sim.state = emptyState();
        continue;
      }
      sim.money -= L.actions.build.cost;
      world.externalOutflow = (world.externalOutflow ?? 0) + L.actions.build.cost; // §22.4 자재값 — 경계 유출
      emit('money_changed', sim.id, { delta: -L.actions.build.cost, balance: sim.money, action: 'build' });
      const slot = home.extraBedSlots[extraBuilt]; // 슬롯 순서 고정 (§15.1.B)
      const newRes = { id: `bed${home.resources.length}`, kind: 'bed', x: slot.x, y: slot.y };
      home.resources.push(newRes);
      emit('bed_built', sim.id, { facilityId: home.id, resourceId: newRes.id, x: slot.x, y: slot.y });
    } else if (s.action === 'work') {
      let wage = floorDiv(L.actions.work.wageBase * L.occupations[sim.traits.occupation].wagePct, 100);
      // §21.1 능력치 임금 반영 (이슈 #62): 잘하는 사람이 더 번다. 이분법이 아니라 완만한 기울기 —
      // 능력 0 → -(span/2)%, 50 → 0%, 99 → +(span/2)%. 정수 연산, rngSim 미소비.
      {
        const A = L.abilities;
        const apt = aptitudeFor(sim, sim.traits.occupation, L);
        wage = floorDiv(wage * (100 + floorDiv((apt - 50) * A.wageSpanPct, 100)), 100);
      }
      // §20.2 민간 서비스 직군(화이트리스트)은 임금이 무에서 나지 않고 **일한 시설의 매출**에서 나온다.
      // 매출이 모자라면 있는 만큼만 받는다 — 손님 없는 가게는 임금을 다 못 준다 (이슈 #43).
      // 나머지 직군(사무·공공)은 이번 슬라이스에서 그대로 둔다: 경제기반이론의 기반 부문,
      // 즉 마을 밖에서 벌어오는 소득으로 본다 (77차 합의).
      // §22.4 임금 재원은 셋으로 갈린다 (이슈 #43, G1):
      //   민간 서비스 → 그 시설의 매출 / 공공 → 국고 / 나머지(기반 부문) → 마을 밖 소득
      // 어느 쪽이든 **없는 돈은 지급되지 않는다** — 재원이 모자라면 부분 지급이다.
      const occ = sim.traits.occupation;
      const priv = L.economy.privateWageOccupations.includes(occ);
      const pub = !priv && L.economy.publicWageOccupations.includes(occ);
      if (priv) {
        const payer = world.map.facilities.find((f) => f.id === s.facilityId);
        const balance = Math.max(0, payer?.revenue ?? 0);
        const avail = balance - procurementReserve(world, payer);
        const paid = Math.min(wage, avail);
        if (paid < wage) {
          sim.unpaidDays = (sim.unpaidDays ?? 0) + 1;
          emit('wage_shortfall', sim.id, {
            facilityId: s.facilityId, asked: wage, paid, shortfall: wage - paid, source: 'facility',
          });
        }
        else sim.unpaidDays = 0;
        if (payer) payer.revenue = balance - paid;
        wage = paid;
      } else if (pub) {
        // §22.23 공공 임금은 **전액 보장**이다 (사용자 지시). 예전에는
        // "국고는 절대 음수가 되지 않는다(89차 ④)"를 지키느라 paid=min(wage,국고)로
        // 깎았고, 그 결과가 지급률 11.2%·교사 실수령 0원이었다 — 가상 플레이어
        // 전원이 지적한 부정의다. 그 invariant를 **의도적으로 폐기**한다:
        // 일을 했으면 받는다. 국고가 모자라면 음수(공채)로 내려가고, §22.22의
        // runway 반응이 부채에 작동한다 (Bohn 1998이 정확히 부채 반응 함수다).
        // §22.4 폐쇄 회계는 유지된다 — 국고가 합산 항이므로 총합 불변식은 음수여도 성립.
        const workplace=world.map.facilities.find(f=>f.id===s.facilityId);
        const government=governmentFor(world,workplace?.villageId??sim.villageId);
        const before = government.treasury;
        const cap = -(L.economy.maxDebt ?? 0);
        if (before - wage < cap) {
          // maxDebt는 오버플로 가드다(1e12) — 여기 걸리는 건 사실상 버그 상황이고,
          // 그때만 부분 지급하며 관측 가능하게 알린다 (118차 C).
          const paid = Math.max(0, before - cap);
          emit('insolvent', sim.id, { asked: wage, paid, treasury: before });
          government.treasury = before - paid;
          wage = paid;
        } else {
          government.treasury = before - wage;
          // 0 하향 돌파 전이에만 알린다 — 매 지급마다가 아니라 빚이 시작될 때
          if (before >= 0 && government.treasury < 0) {
            emit('treasury_debt', sim.id, { treasury: government.treasury, firstWage: wage });
          }
        }
      } else {
        // 기반 부문 — 마을 밖에서 벌어오는 소득. 경계 유입으로 **명시해 기록한다**(G1 폐쇄 회계).
        world.externalInflow = (world.externalInflow ?? 0) + wage;
      }
      // §17.15 소득세 원천징수: 실수령 = wage×(100-taxPct)/100, 세금은 국고로
      const net = floorDiv(wage * (100 - econ(world, 'taxPct',sim.villageId)), 100);
      const tax = wage - net;
      sim.money += net;
      governmentFor(world,sim.villageId).treasury += tax;
      emit('money_changed', sim.id, { delta: net, balance: sim.money, action: 'work', tax });
      applyMood(sim, L.mood.moneyGain);
      if (tax > 0) applyMood(sim, -floorDiv(tax * L.economy.taxMoodPer, 10)); // §18.T1 납세 불만 (그라데이션)
      if (sim.traits.occupation === 'police' && s.facilityId === 'patrol') { // §17.24 순찰 정산
        sim.patrolIdx++;
        changeReputation(world,L.patrol.repPerPatrol,sim.villageId);
      }
    }
    // §22.14 옆 사람과 말이 트였으면 헛걸음이 아니다
    if (s.action !== 'idle') {
      if(world.map.facilities.some(f=>f.id===s.facilityId))world.facilityUseToday[s.facilityId]=(world.facilityUseToday[s.facilityId]??0)+1;
      emit('action_completed', sim.id, {
        action: s.action, facilityId: s.facilityId,
        result: s.action === 'socialize' && s.pairedTicks === 0 && (s.sideTalkTicks ?? 0) === 0 ? 'lonely' : 'success',
      });
    }
    if (s.action === 'socialize' && s.pairedTicks === 0 && (s.sideTalkTicks ?? 0) === 0) {
      emit('lonely', sim.id, { facilityId: s.facilityId });
      applyMood(sim, L.mood.lonely);
      recordFact(sim, t, L, 'lonely', { placeId: s.facilityId, tags: ['socialize', `facility:${s.facilityId}`] });
    } else if (s.action !== 'idle') {
      applyMood(sim, L.mood.actionCompleted);
      const kind = {
        eat: 'meal', work: 'work_done', socialize: 'small_talk', play: 'play_time',
        drink: 'drank', binge_eat: 'binge', hole_up: 'hole_up', exercise: 'workout', build: 'built_bed',
        read: 'read_time', shop: 'shopping', fish: 'fishing', cook_eat: 'home_meal', construct: 'construct_work', seek_food_aid: 'public_meal',
        see_doctor: 'healed',
      }[s.action];
      if (kind) {
        recordFact(sim, t, L, kind, { placeId: s.facilityId, tags: [s.action, `facility:${s.facilityId}`] });
      }
      // 기상: 회고가 기록해둔 pendingMood 적용 + 하루 계획 생성 (PLAN §2.5.D/E)
      if (s.action === 'sleep') {
        if (sim.pendingMood !== null) {
          sim.mood = sim.pendingMood;
          sim.pendingMood = null;
        }
        const day = floorDiv(t, 1440); // 틱 내부 날짜 규약
        if (sim.lastPlannedDay === undefined || sim.lastPlannedDay < day) {
          sim.plan = buildDailyPlan(sim, L, floorDiv(t, 1440));
          sim.lastPlannedDay = day;
        }
      }
    }
    releaseReservation(world, sim);
    sim.state = emptyState();
  }

  // 4) 욕구 감쇠(나이 보정 포함) → starving 판정·기분 델타 → 기분 감쇠 (순서 고정, PLAN §12.1)
  for (const sim of world.sims) {
    const age = sim.traits.age;
    for (const need of Object.keys(L.decay)) {
      let d = L.decay[need];
      if (need === 'fun' && age <= L.ageDecay.youngMax) d += L.ageDecay.youngFunAdd;
      if (need === 'energy' && age >= L.ageDecay.oldMin) d += L.ageDecay.oldEnergyAdd;
      if (need === 'energy') d = floorDiv(d * circadianEnergyPct(sim, L, t), 100); // §17.16 수면 압력 (개인 위상)
      if (need === 'energy' && sim.hangoverUntil > t) d += L.coping.hangoverEnergyDecay; // 숙취 (§15.1.A)
      if (need === 'energy') d += winterExposureCost(world, sim);
      if (sim.sick && (need === 'energy' || need === 'fun')) d += floorDiv(d * L.disease.decayFactorNum, L.disease.decayFactorDen); // 병 (§17.3)
      const before = sim.needs[need];
      sim.needs[need] = Math.max(0, before - d);
      if (need === 'hunger' && sim.needs[need] === 0) {
        // §22.2 굶은 채 머문 시간 — 사망 위험과 G5 고통 지표의 근거가 된다.
        // 전이 횟수(starving 이벤트)는 자주 먹을수록 더 찍히므로 복지 지표로 못 쓴다(§21.2).
        sim.hungerZeroTicks = (sim.hungerZeroTicks ?? 0) + 1;
      }
      if (need === 'hunger' && before > 0 && sim.needs[need] === 0) {
        emit('starving', sim.id, {});
        applyMood(sim, L.mood.starving);
        recordFact(sim, t, L, 'starving', { tags: ['eat'] });
      }
    }
    updateNeedsTier(sim, L, emit); // #91 감쇠 뒤 실제 충족 시간만 누적한다.
    naturalRecovery(world, sim, t, emit); // §17.3 자연 치유 (무드로우)
    // §23.25 기분은 **0이 아니라 그 사람의 삶으로 돌아간다.**
    // 예전에는 늘 0으로 수렴했다. 그래서 90일을 굴려도 마을의 평균 기분이 +50 언저리,
    // 행복도 50%에 붙박였다 — 친구가 여섯인 사람과 아무도 없는 사람이 같은 자리로 돌아갔다.
    // 기분이 단기 완충일 뿐 **상태가 아니었다.**
    // 이제 바닥선은 그 사람이 살아온 결과다: 짝이 있는가, 친구가 몇인가, 누울 집이 있는가,
    // 즐겨 하는 일이 있는가. 사건이 주는 진폭은 그대로이고, 가라앉는 자리만 달라진다.
    const base = moodBaseline(sim, world, L);
    const dm = L.mood.decayPerTick;
    if (sim.mood > base) sim.mood = Math.max(base, sim.mood - dm);
    else if (sim.mood < base) sim.mood = Math.min(base, sim.mood + dm);
  }

  // 4b) 고정 서브순서 (§16.D): 날씨 → 모임 판정 → 토큰 만료 → 토큰 생성 → 아이템 만료/스폰
  {
    const day = floorDiv(t, 1440);
    if (world.weather.day !== day) {
      const W = L.weather;
      const total = W.sunnyW + W.cloudyW + W.rainW;
      const roll = rngInt(world.rngSim, total);
      const kind = roll < W.sunnyW ? 'sunny' : roll < W.sunnyW + W.cloudyW ? 'cloudy' : 'rain';
      world.weather = { day, kind };
      emit('weather_changed', null, { kind, day });
    }
  }
  expireAndMeasureTokens(world, t, emit);
  maybeGenerateToken(world, t, emit);
  clubMeetingTokens(world, t, emit, learnToken); // §17.6 주간 모임 (멤버 즉시 인지)
  {
    // §16.C: 만료 → 스폰. 수락 기준: ROAD 타일 && 같은 좌표에 기존 아이템 없음.
    // 드로우 순서: (x,y) 시도들(성공 시 조기 중단) → amount → itemId 부여 (Codex 22차 항목 2)
    world.lostItems = world.lostItems.filter((it) => t <= it.expiresTick);
    const I = L.items;
    if (t % I.spawnInterval === 0) {
      for (let attempt = 0; attempt < I.spawnTries; attempt++) {
        const x = rngInt(world.rngSim, Math.min(I.spawnAreaW, world.map.w));
        const y = rngInt(world.rngSim, Math.min(I.spawnAreaH, world.map.h));
        const tile = world.map.tiles[y * world.map.w + x];
        // ROAD에만 스폰 — 사람이 다니는 곳에 떨어지고, 다니는 사람이 줍는다 (§16.C 개정)
        if (tile === TILE.ROAD
          && !world.lostItems.some((it) => it.x === x && it.y === y)) {
          const amount = I.amountMin + rngInt(world.rngSim, I.amountSpan);
          const item = { itemId: world.itemCounter++, x, y, amount, expiresTick: t + I.expireTicks };
          world.lostItems.push(item);
          emit('item_spawned', null, { itemId: item.itemId, x, y });
          break;
        }
      }
    }
  }

  // 4c) §16.5: 완공 판정(매 틱) → 일일 도시계획 트리거 (서브순서 맨 끝).
  // 의도된 순서: 완공 틱의 facility_built/moved_home은 잔여 노동자들의 action_completed보다
  // 먼저 나온다 (완공은 4단계, 노동 정산은 각자 스틴트가 끝나는 틱의 3단계 — Codex 24차 항목 2 문서화)
  // §19.3: plotId asc 순회 다중 완공 — 각 건물마다 축조→제거→이사→이벤트 (66차 ③)
  {
  for (const pr of [...world.projects].sort((a, b) => a.plotId - b.plotId)) {
    // required는 프로젝트 시작 시점에 스냅샷 — 진행 중 logic_update가 완공 시점을 흔들지 못함 (PLAN §16.5)
    if (pr.progress >= pr.required) {
      const plot = world.plots.find((p) => p.plotId === pr.plotId);
      const fac = addBuilding(world.map, pr.type, plot, pr.dir ?? 0); // §18.T2 회전
      recordFoundingHome(world,pr,fac,t,emit);
      openSupplyMarket(world, fac, emit);
      plot.used = true;
      world.projects.splice(world.projects.indexOf(pr), 1);
      emit('facility_built', null, { facilityId: fac.id, type: fac.type, x: plot.x, y: plot.y });
      if (isAvailableResidence(fac)) { // 개척 주택은 실제 도착 전 자동 이사하지 않는다
        // 이주: 가장 과밀한 집(거주-침대 최대, 동률 facilityId asc)의 최고 id 거주자
        let worst = null, worstOver = 0;
        for (const h of world.map.facilities) {
          if (!isResidence(h) || h.id === fac.id
            ||!world.sims.some(s=>s.homeId===h.id&&!isSettlementInTransit(world,s.id))) continue;
          const res = world.sims.filter((x) => x.homeId === h.id).length;
          const over = res - h.resources.length;
          if (over > worstOver || (over === worstOver && worst && h.id < worst.id)) {
            if (over > 0) { worst = h; worstOver = over; }
          }
        }
        if (worst) {
          const mover = world.sims.filter((x) => x.homeId === worst.id&&!isSettlementInTransit(world,x.id)).sort((a, b) => b.id - a.id)[0];
          mover.homeId = fac.id;
          syncResidenceVillage(world, mover.id);
          emit('moved_home', mover.id, { from: worst.id, to: fac.id });
          recordFact(mover, t, L, 'built_bed', { placeId: fac.id, tags: ['home'] });
        }
      }
    }
    } // §19.3 완공 루프 종료 (일일 평가부터는 매 틱 실행)
    // §17.8 일일 평가: 질병 → 선거 → 시장 수당 → 이민 (도시계획 트리거보다 앞)
    {
      const day = floorDiv(t, 1440);
      if (world.lastDailyDay !== day) {
        world.lastDailyDay = day;
        // §22.2 사망 판정 — 선거·수당·이민보다 **먼저** (89차 ③). id asc, riskHash라 RNG 미소비.
        maybeDeaths(world, t, day, emit);
        const storyCandidates = [];
        const offerStory = candidate => storyCandidates.push(candidate);
        dailyDiseaseDraws(world, t, emit, offerStory);
        dailyFireDraws(world, t, emit, offerStory); // 기존 질병 → 화재 드로우 수/순서 유지
        resolveStoryCandidates(world, t, storyCandidates, emit); // #89 후보 중 최대 1개, RNG 없음
        for(const local of governmentViews(world)){
          if(local.mayorId!==null&&!local.sims.some(s=>s.id===local.mayorId&&canWork(s)))local.mayorId=null;
          const localEmit=governmentEmitter(local,emit);
          updateCampaigners(local,day);
          maybeElection(local,t,day,localEmit);
          maybeFiscalReview(local,t,day,localEmit);
        }
        for(const local of governmentViews(world))maybePublicWorks(local, t, day, governmentEmitter(local,emit)); // 선거 → 재정 → 공공사업
        for(const local of governmentViews(world))maybePlanCenter(local, t, day, governmentEmitter(local,emit));
        // §22.4 공공 시설 매출 → 국고 (수당·복지보다 **먼저** — 오늘 쓸 재원을 먼저 채운다).
        // 89차 ④의 정산 순서: 소비 매출 반영 → 공공 지출.
        // §22.6 (95차 ②) 만료된 초대를 센다 — 성사되지 못한 청이 얼마나 되는지 봐야
        // '왜 관계는 느는데 외로움은 그대로인지'를 가릴 수 있다.
        for (const sim of world.sims) {
          if (sim.invitedTo && sim.invitedTo.untilTick <= t) {
            emit('invite_expired', sim.id, { facilityId: sim.invitedTo.facilityId });
            sim.invitedTo = null; // §22.13 위와 같은 이유
          }
        }
        remitPublicRevenue(world, t, emit);
        for(const local of governmentViews(world)){
          const localEmit=governmentEmitter(local,emit);
          mayorStipend(local,t,localEmit);
          applyWelfare(local,t,localEmit);
          applyChildAllowance(local,t,localEmit);
        }
        settleHousing(world,t,day,emit); // #93 지원 뒤 임대 정산, 다음 tick 이사 의도
        evaluateHouseholds(world,t,day,emit); // #51 지원·현재 잔고 뒤, 다음 틱 분가 의도 생성
        evaluateFoundingPetitions(world,t,emit); // 실제 주거/공터 부족이 지속된 경우만 청원
        // §21.3 전직: 손님이 몰린 가게에 누군가 일하러 간다 (복지 다음 — 서브순서 고정).
        // 복지 뒤에 두는 이유: 오늘의 지원이 반영된 뒤에 진로를 정하는 게 순서상 자연스럽다.
        maybeJobSwitch(world, t, day, emit);
        maybeUnlockIndustries(world,day,emit);
        { // §17.24 분실물 귀속 (56차: dueDay ≤ day, itemId asc — 신고 시점 경찰 존재만 검사)
          const due = world.lostAndFound.filter((lf) => lf.dueDay <= day).sort((a, b) => a.itemId - b.itemId);
          for (const lf of due) {
            world.lostAndFound.splice(world.lostAndFound.indexOf(lf), 1);
            const finder = world.sims.find((s2) => s2.id === lf.finderId);
            if (finder) {
              finder.money += lf.amount;
              world.externalInflow = (world.externalInflow ?? 0) + lf.amount; // §22.4 경계 유입
              emit('item_returned', finder.id, { itemId: lf.itemId, amount: lf.amount, balance: finder.money });
            }
          }
        }
        { // Factory pollution belongs to its actual municipality.
          for(const local of governmentViews(world)){
            const nf=local.map.facilities.filter(f=>f.type==='factory').length;
            if(nf>0)local.reputation=Math.max(0,local.reputation-nf*L.pollution.repPerFactoryPerDay);
          }
        }
        maybeImmigration(world, t, day, emit);
        maybeEmigration(world, t, day, emit);
        for(const local of governmentViews(world))maybePromotion(local, t, governmentEmitter(local,emit)); // 이민 직후·새해 전
        const resetStudent = sim => { releaseReservation(world,sim); sim.state=emptyState(); };
        const aged = maybeNewYear(world, t, day, emit, resetStudent);
        if(!aged) updateEducation(world, t, emit, resetStudent);
        maybeChildren(world, t, day, emit); // §17.11 자녀 정착
        maybeFestival(world, t, day, emit); // §17.10
        for(const local of governmentViews(world)){
          local.reputation=floorDiv(local.reputation*world.logic.growth.repDecayPct,100);
          maybePetition(local,t,day,governmentEmitter(local,emit));
        }
        decayComplaints(world); // §19.7 불만 망각 — 청원 판정 뒤에 적용 (당일 불만은 온전히 반영)
        { // §18.T5 일일 통계 (평판 감쇠 다음 — 54차 고정, 캡 180 shift)
          const pop = world.sims.length;
          const sumMood = world.sims.reduce((n, s2) => n + s2.mood, 0);
          const employed = world.sims.filter((s2) => world.logic.occupations[s2.traits.occupation].wagePct > 0
            && s2.traits.occupation !== 'student').length;
          world.statsHistory.push({ day, pop, treasury: publicBalance(world), reputation: world.reputation,
            avgMood: pop > 0 ? floorDiv(sumMood, pop) : 0, employed, tier: world.cityTier,
            incidents: world.incidents.length,
            transport: world.transportStats.history.length ? transportSummary(world.transportStats.history.at(-1)) : null });
          while (world.statsHistory.length > 180) world.statsHistory.shift();
          recordMunicipalStats(world,day);
        }
        // §19.12 역 수요 판정 (일일 통계 다음 — 서브순서 고정). RNG 미소비라 드로우
        // 순서 계약과 무관하고, world.transit 관측 필드와 1회성 언락 이벤트만 만든다.
        evalStationDemand(world, t, emit);
        for (const s2 of world.sims) { // §17.23 쿨다운 청소
          for (const k of Object.keys(s2.noPathCool)) if (s2.noPathCool[k] <= t) delete s2.noPathCool[k];
        }
      }
    }
    fireSelfOut(world, t, emit); // §17.20 자연 진화 (매 틱, 4단계)
    const day = floorDiv(t, 1440);
    // §18.T2: 플레이어 주문이 자동 수요보다 우선 — 프로젝트 슬롯이 비면 즉시(일일 게이트 무관) 착공
    // §19.3: 계획 단계 시작 시 슬롯 수를 한 번 계산 (틱 중 국고 변동에 흔들리지 않게 — 66차 ②)
    const maxProjects = Math.max(1, Math.min(L.growth.maxProjectSlots,
      1 + floorDiv(world.treasury, L.growth.slotPerTreasury)));
    while (world.projects.length < maxProjects && world.zoneOrders.length > 0) {
      const order = world.zoneOrders[0];
      const plot = world.plots.find((p) => p.plotId === order.plotId);
      const fp2 = plot ? zoneFootprint(order.type, order.dir) : null;
      if (!plot || plot.used || !plotBuildable(world.map, plot, fp2.w, fp2.h)
        ||foundingSiteReserved(world,plot,order.type,order.dir,order.foundingPetitionId??null)) { // 착공 재검증
        if(order.foundingPetitionId!==undefined){
          if(cancelFoundingConstruction(world,order.foundingPetitionId,'stale_order',t,emit))continue;
        }
        world.zoneOrders.shift();
        emit('input_rejected', null, { command: 'zone', reason: 'stale_order', plotId: order.plotId });
        continue;
      }
      world.zoneOrders.shift();
      // §22.23 공기 차등 — 타입별 노동량. 시장 행정력 할인은 그대로 곱한다.
      const base4 = L.construct.requiredByType?.[order.type] ?? L.construct.laborRequired;
      const required = governmentFor(world,plot.villageId).mayorId !== null
        ? floorDiv(base4 * L.election.mayorLaborPct, 100)
        : base4;
      world.projects.push({ plotId: order.plotId, type: order.type, dir: order.dir, progress: 0, required, zoned: true,
        ...(order.foundingPetitionId===undefined?{}:{foundingPetitionId:order.foundingPetitionId,fundedCost:order.fundedCost}) });
      emit('project_started', null, { plotId: order.plotId, type: order.type, dir: order.dir, x: plot.x, y: plot.y, required, zoned: true });
    }
    if (world.lastPlanDay !== day) {
      world.lastPlanDay = day;
      // §19.3 (67차 ①): 슬롯이 찰 때까지 수요를 재평가하며 반복 착공
      while (world.projects.length < maxProjects) {
      // §19.3: 이미 착공 중인 공터는 제외 (중복 배정 금지)
      const busy = new Set(world.projects.map((p) => p.plotId));
      const candidates = world.plots.filter((p) => !p.used && !busy.has(p.plotId) && plotBuildable(world.map, p)
        &&!foundingSiteReserved(world,p,'office')); // 기본 후보 footprint 7×5
      const centers = [
        ...world.map.facilities.filter((f) => ['city_hall', 'market'].includes(f.type)),
        ...(world.centers ?? []),
      ];
      const distance = (p, f) => Math.abs(p.x - f.x) + Math.abs(p.y - f.y);
      const centerScores = new Map(candidates.map(p => {
        const local = centers.filter(c => (c.villageId ?? 'village:0') === (p.villageId ?? 'village:0'));
        return [p.plotId, local.length === 0 ? 0 : Math.min(...local.map(f => distance(p, f)))];
      }));
      let freePlot = candidates.sort((a, b) => {
        return (centerScores.get(a.plotId) - centerScores.get(b.plotId)) || (a.plotId - b.plotId);
      })[0];
      if (!freePlot) break;
      {
        const beds = world.map.facilities.filter(isAvailableResidence)
          .reduce((n, f) => n + f.resources.length, 0);
        const cafeSeats = world.map.facilities.filter((f) => f.type === 'cafe')
          .reduce((n, f) => n + f.resources.length, 0);
        const parkSpots = world.map.facilities.filter((f) => f.type === 'park')
          .reduce((n, f) => n + f.resources.length, 0);
        const pop = world.sims.length;
        // 주거 수요는 고정 여유가 아니라 최근 관측된 인구 증가 속도를 반영한다.
        // 통계가 없는 초기 세계는 기존 계약(headroomBeds)으로 시작한다.
        const history = world.statsHistory ?? [];
        const recent = history.slice(-7);
        const growthPerDay = recent.length >= 2
          ? Math.max(0, (recent[recent.length - 1].pop - recent[0].pop) / (recent.length - 1))
          : 0;
        const observedHeadroom = Math.min(20, L.growth.headroomBeds + Math.ceil(growthPerDay * 3));
        // §17.11: 별거 부부는 신혼집 수요 — 부부당 침대 1개 추가 필요분으로 계산
        let separated = 0;
        for (const [aStr, b] of Object.entries(world.partners)) {
          const a = Number(aStr);
          if (a < b && world.partnerStage[a] === 'married') {
            const pa = world.sims.find((s2) => s2.id === a);
            const pb = world.sims.find((s2) => s2.id === b);
            if (pa.homeId !== pb.homeId) separated++;
          }
        }
        // §17.21 일자리 수요: office 근무 직업 심 수 vs 책상 슬롯 합
        const officeWorkers = world.sims.filter((s2) => L.workplace[s2.traits.occupation] === 'office'
          && L.occupations[s2.traits.occupation].wagePct > 0).length;
        const officeDesks = world.map.facilities.filter((f) => f.type === 'office')
          .reduce((n, f) => n + f.resources.length, 0);
        let type = neededSchool(world);
        if (type === 'university' && !candidates.some(p => zoneAllowedTypes(world,p.villageId).includes(type))) type = null;
        if (!type) type = neededIndustryFacility(world);
        if (!type && pop + separated + observedHeadroom > beds) {
          // 읍 이상에서는 같은 공터로 더 많은 침대를 제공하는 아파트를 우선한다.
          // tier는 관측된 세계 상태이고, 타입 선택은 결정적이다.
          type = governmentFor(world,freePlot.villageId).cityTier >= 1 ? 'apartment' : 'house';
        } // 선제 주택 (§17.21)
        if (!type && officeWorkers > officeDesks) type = 'office';
        else if (!type && pop > cafeSeats * L.construct.cafeRatio) type = 'cafe';
        else if (!type && pop > parkSpots * L.construct.parkRatio) type = 'park';
        if (!type) break;
        if (SCHOOL_TYPES.includes(type) || ['workshop','lab','warehouse'].includes(type)) {
          const fp=zoneFootprint(type,0);
          freePlot=candidates.find(p=>zoneAllowedTypes(world,p.villageId).includes(type)
            &&plotBuildable(world.map,p,fp.w,fp.h)&&!foundingSiteReserved(world,p,type));
          if(!freePlot) break;
          const cost=L.zone.costs[type];
          const government=governmentFor(world,freePlot.villageId);
          if(government.treasury<cost)break;
          government.treasury-=cost;world.externalOutflow=(world.externalOutflow??0)+cost;
          if (SCHOOL_TYPES.includes(type)) emit('school_planned',null,{type,plotId:freePlot.plotId,cost,treasury:government.treasury});
        }
        {
          // §17.4: 시장 재임 중엔 행정력으로 공사가 빨라진다 (시작 시점 스냅샷)
          const base5 = L.construct.requiredByType?.[type] ?? L.construct.laborRequired;
          const required = governmentFor(world,freePlot.villageId).mayorId !== null
            ? floorDiv(base5 * L.election.mayorLaborPct, 100)
            : base5;
          world.projects.push({ plotId: freePlot.plotId, type, progress: 0, required });
          emit('project_started', null, { plotId: freePlot.plotId, type, x: freePlot.x, y: freePlot.y, required });
        }
      }
      } // while 슬롯
    }
  }

  // 5) idle 심 결정 (id 오름차순, world.reservations = 틱-로컬 원장)
  // §23.10 재실 인원은 **결정을 시작하기 전에 한 번** 찍는다 (Codex 지적).
  // 심마다 그때그때 세면, 앞 순번이 방금 카페에 앉은 것이 뒷 순번에게 보인다.
  // 결과는 재현되지만 **id 순서가 세계의 의미를 바꾼다** — 같은 상황에서 1번이 먼저
  // 결정했느냐 2번이 먼저 결정했느냐로 보드게임이 열리기도 하고 안 열리기도 한다.
  // 모두가 같은 세계를 보고 결정해야 한다. 자기 자신은 읽는 쪽에서 뺀다.
  const occSnapshot = occupancyAt(world, null);
  for (const sim of world.sims) {
    if (sim.state.kind !== 'idle') continue;
    const shortlist = shortlistMemories(sim, t, L); // D1: 심당 1회 계산
    const prep = prepareShortlist(shortlist, t, L); // §17.22: 후보 독립 전처리 (심당 1회)
    const critical = Object.entries(NEED_OF_ACTION)
      .filter(([, need]) => sim.needs[need] < L.needCritical)
      .map(([action]) => action);
    let cands = [];
    let urgency = false;
    if (critical.length > 0) {
      cands = collectCandidates(world, sim, critical, t, false, { shortlist, prep, urgency: true, occ: occSnapshot });
      urgency = cands.length > 0;
      // §19.5 (71차 ①): 위급한데 갈 곳이 없다 = 시설 부재. 첫 위급 행동 하나만 기록(틱당 ≤1,
      // ACTIONS 순이라 결정적) → 회고에서 no_facility 불만으로 집계된다.
      if (cands.length === 0) {
        // §19.10 (이슈 #49): 왜 못 했는지를 구분해 기록한다. 시설은 있는데 돈이 없어서 막힌
        // 것을 '시설 부재'로 적으면 잘못된 처방(식당 증설)으로 이어진다.
        const why = actionBlockReason(world, sim, critical[0], t);
        const kindTag = why === 'no_money' ? 'no_money' : (why === 'off_hours' ? 'blocked' : 'no_facility');
        recordFact(sim, t, L, 'unmet', { placeId: critical[0], tags: [critical[0], kindTag] });
        // §22.18 **시설이 없어서** 못 한 것만 산업 수요로 적립한다. 돈이 없어서(no_money)나
        // 영업시간이 아니어서(blocked) 못 한 것은 시설 수요가 아니다 — 그걸 섞으면
        // '식당을 더 지어라'는 잘못된 처방이 나온다. §19.10에서 같은 이유로 불만 원인을
        // 분화했고, 지금 살아 있는 세계의 no_money 불만 452건이 정확히 그 함정이다.
      }
      // §22.18 (109차 ①) 원장은 **critical 각각을** 본다. 예전에는 위급 후보가 하나도
      // 없을 때 critical[0]만 적립해서, 다른 위급 행동은 후보가 있고 병원만 막힌 경우를
      // 통째로 놓쳤다 — 실측으로 병원·도서관·시장을 지운 세계를 40,000틱 돌려도
      // 원장이 비어 있었다. 돈·영업시간 때문에 막힌 것은 여전히 제외한다.
      const day18 = floorDiv(t, 1440);
      for (const act of critical) {
        if (cands.some((c) => c.action === act)) continue; // 갈 곳이 있었다
        // **사유가 붙은 실패는 시설 수요가 아니다.** 돈이 없어서(no_money),
        // 영업시간이 아니어서(off_hours), 장바구니가 비어서(no_groceries),
        // 아직 필요하지 않아서(not_needed), 아파야 가는 곳이라(healthy) 못 한 것은
        // 전부 '갈 곳이 없다'와 다르다. 실측으로 이 필터가 없을 때 집밥 실패
        // 196건이 '가구내 산업 수요'로 잘못 잡혔다.
        // 사유 없이 후보만 없는 경우 = 그 일을 할 자리가 세계에 없다.
        if (actionBlockReason(world, sim, act, t) !== null) continue;
        // 시설 부재만 산업 수요다. 만석은 **같은 산업을 키우라**는 다른 신호이므로
        // 따로 센다 — 섞으면 "병원을 지어라"와 "병원을 키워라"가 구분되지 않는다.
        const kind18 = facilityShortfallKind(world, sim, act, t);
        if (kind18 === 'no_facility') recordIndustryDemand(world, act, day18);
        else if (kind18 === 'capacity_full') recordCapacityShortfall(world, act, day18);
      }
    }
    if(!urgency){
      const gather=settlementGatherTarget(world,sim);
      if(gather){
        if(gather.hold)startIdle(sim,L,emit);
        else startAction(world,sim,gather.candidate,t,emit,{settlement:true});
        continue;
      }
      if(isSettlementInTransit(world,sim.id)){startIdle(sim,L,emit);continue;}
    }
    if (cands.length === 0) cands = collectCandidates(world, sim, ACTIONS, t, false, { shortlist, prep, urgency: false, occ: occSnapshot });
    const best = pickBest(cands);

    // §22.19 일상 수요 (이슈 #87). §22.18 원장은 **위급한 필요**에만 걸려서, 진료·독서·여가처럼
    // 굶어 죽지는 않지만 하고 싶은 일은 영원히 잡히지 않았다 — 실측으로 병원의 진료 자리를
    // 전부 없애고 40,000틱을 돌려도 보건업 수요가 0건이었다. 사람이 산업을 만드는 이유의
    // 절반은 위급하지 않은 아쉬움이다.
    //
    // 위급 원장과 **섞지 않는다** (Codex 112차). 강도가 다른 신호다.
    //
    // '하고 싶었다'의 기준은 임의 문턱이 아니라 **실제로 한 일과의 비교**다:
    // 내가 지금 하는 일보다 더 아쉬웠는데 갈 데가 없었다면 그게 일상 수요다.
    // 그래서 문턱을 고를 필요가 없고, 욕구가 다 찬 심은 저절로 세지 않는다.
    //
    // 빈도가 훨씬 높으므로 **심·행동당 하루 1회**로 묶는다. 안 그러면 매 결정마다
    // 같은 아쉬움이 다시 세어져 원장이 틱 잡음이 된다 (§22.6 approach에서 같은 실수로
    // 거절 5,924건이 나왔다).
    const day19 = floorDiv(t, 1440);
    if (sim.wantDay !== day19) { sim.wantDay = day19; sim.wantedActions = []; }
    const bestDeficit = best ? NEED_MAX - needValueFor(sim, best.action, L) : 0;
    for (const action of ACTIONS) {
      if (action === 'idle' || sim.wantedActions.includes(action)) continue;
      if (cands.some((c) => c.action === action)) continue;      // 갈 곳이 있었다
      // 자격 판정이 먼저다. actionBlockReason이 null이면 '지금 이 사람은 이걸 할 수 있고
      // 하려는 상태'라는 뜻이다 — 아프지 않으면 see_doctor가 'healthy'로 막히고,
      // 장바구니가 비면 cook_eat가 'no_groceries'로 막힌다.
      if (actionBlockReason(world, sim, action, t) !== null) continue;
      // 욕구가 있는 행동은 **실제로 한 일보다 더 아쉬웠을 때만** 센다.
      // 욕구가 없는 행동(진료 등)은 자격이 곧 의사다 — 아픈데 갈 병원이 없으면 그게 수요다.
      // 이 구분이 없으면 #87이 지목한 바로 그 구멍이 남는다: 병원 자리를 전부 없애도
      // 보건업 수요가 0건이었다.
      if ((NEED_OF_ACTION[action] !== undefined || action === CULTURE_ACTION)
        && NEED_MAX - needValueFor(sim, action, L) <= bestDeficit) continue;
      const kind19 = facilityShortfallKind(world, sim, action, t);
      if (kind19 !== 'no_facility' && kind19 !== 'capacity_full') continue;
      sim.wantedActions.push(action); // 오늘은 이 아쉬움을 이미 셌다
      recordIndustryWant(world, action, day19, kind19);
    }
    if (best) {
      // §15.1.C 사고 흐름: 막힌 대안 수집 (rng 미사용, ACTIONS 순, 최대 4개)
      const chain = [];
      for (const action of ACTIONS) {
        if (action === 'idle' || action === best.action || chain.length >= 4) continue;
        const blocked = actionBlockReason(world, sim, action, t);
        if (blocked) { chain.push({ a: action, b: blocked }); continue; }
        if (!cands.some((c) => c.action === action)) {
          const deficit = NEED_MAX - needValueFor(sim, action, L);
          chain.push({ a: action, b: deficit <= 0 ? 'sated' : 'full' });
        }
      }
      // 사유 필드는 §14.1 계약대로 + Phase 3 citedMemorySeqs
      startAction(world, sim, best, t, emit, {
        chain,
        need: NEED_OF_ACTION[best.action]
          ?? (COPING_ACTIONS.includes(best.action) ? 'mood' : best.action === 'build' ? 'space' : 'money'),
        deficit: best.deficit,
        persFactor: best.persFactor,
        planFactor: best.planFactor,
        partyPull: best.partyPull,
        moodMod: best.moodMod,
        memoryMod: best.memoryMod,
        stateMod: best.stateMod,
        habitMod: best.habitMod,
        citedMemorySeqs: best.cited,
        urgencyOverride: urgency,
      });
    } else startIdle(sim, L, emit);
  }

  // 5.5) §17.21 평판 적립: 이번 틱의 행동 이벤트 가중 합산 (순서 무관, 캡)
  {
    const G = world.logic.growth;
    const REP = { married: G.repMarried, festival: G.repFestival, facility_built: G.repBuilt,
      child_settled: G.repChild, election: G.repElection, gathering: G.repGathering };
    for (const e of events) {
      const r = REP[e.type];
      if (r) changeReputation(world,r,reputationVillage(world,e));
    }
  }

  // 6) ordinal 부여 — 단계 순 + 단계 내 적용 순서 (1단계는 sequence 순)
  refreshSupplyOrders(world, t, emit); // #76 소비/공급 후 실제 재고에서 다음 주문
  pruneTransportTrips(world);
  events.forEach((e, i) => { e.ordinal = i; });

  // 7) 틱 갱신
  world.worldTick = t;
  return events;
}

// advance = tick() n회 루프, 그 이상 아무것도 아님 (PLAN §0)
export function advance(world, inputsByTick, n) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const forTick = inputsByTick?.[world.worldTick + 1] ?? [];
    events.push(...tick(world, forTick));
  }
  return events;
}
