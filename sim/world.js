import { makeAbilities } from './abilities.js'; // §21.1
import { demotePublicIfOverQuota, fillPublicPosts } from './publicposts.js';
import { SCHEMA_VERSION } from './constants.js';
// 월드 생성 — rngWorldgen만 사용, 이후 런타임은 rngSim (PLAN §2 네임드 스트림).
// schemaVersion 2: traits(성별·나이·MBTI·직업)·mood·world.logic 포함 (PLAN §12.1).
import { buildMap, defaultPlots, extraPlots128, extraPlots512, generateTerrain } from './map.js';
import { makeRng, rngNext, rngInt } from './prng.js';
import { generateTraits } from './traits.js';
import { DEFAULT_LOGIC } from './logic.js';

import { makeSim } from './simfactory.js';
import { surnameFor } from './surnames.js';

export const SIM_NAMES = ['민수', '지연', '하준', '서연', '도윤', '은지', '태호', '수아', '준호', '예린'];
// §17.1 이민자 이름 풀 (순환 사용, 중복 시 클라가 이름 뒤 id 표기)
export const IMMIGRANT_NAMES = ['재현', '소민', '우진', '하늘', '규리', '성민', '다은', '지호', '세아', '현우',
  '보라', '준서', '유나', '시우', '가온', '민재', '채원', '건우', '나윤', '태양'];
export const SIM_COUNT = 10;

// §19.12 (이슈 #52) 역 수요 관측·언락 상태의 단일 정의 — 신규 월드와 마이그레이션이
// 같은 모양을 쓴다. 값은 전부 유한 정수/불리언 (undefined/NaN 금지 — 직렬화 왕복 고정점).
export function makeTransitState() {
  return {
    stationUnlocked: false, // 비가역 — 언락 뒤 수요가 줄어도 다시 잠그지 않는다
    unlockedDay: -1,        // 언락된 날 (-1 = 아직)
    fulfillmentPct: 0,      // stationDemand 대비 충족도 % (이분 컷이 아니라 %를 남긴다)
    demand: 0,              // 가중 수요 = floorDiv(weightedTrips × 거리계수, 100)
    totalLongTrips: 0,      // Σ sim.longTrips (관측)
    weightedTrips: 0,       // 차 보유 할인 적용 후 (관측)
    carsOwned: 0,           // 차 보유 심 수 (관측)
    avgTripTiles: 0,        // 장거리 이동 평균 칸수 (거리 분포 관측)
  };
}

export function createWorld(seed) {
  const rngWorldgen = makeRng(seed);
  const plots = [...defaultPlots(), ...extraPlots128(), ...extraPlots512()];
  const map = buildMap();
  generateTerrain(map, makeRng((seed ^ 0x7e44a1) >>> 0), plots); // §19 R-A 전용 스트림 (rngSim 비소비, 공터 보호)

  // §22.7 첫 주민 이름도 시드로 갈린다. 고정 순서면 지형·성격이 달라도 '민수·지연·하준'이
  // 늘 같은 자리에 서 있어 다른 마을처럼 느껴지지 않는다.
  // **전용 임시 rng**를 써서 rngWorldgen/rngSim 스트림을 건드리지 않는다 — 드로우 순서 계약 불변.
  const nameOrder = (() => {
    const r = makeRng((seed ^ 0x9e3779b9) >>> 0);
    const arr = SIM_NAMES.slice();
    for (let i = arr.length - 1; i > 0; i--) { // Fisher–Yates, 결정적
      const j = rngInt(r, i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  })();

  const sims = [];
  for (let id = 0; id < SIM_COUNT; id++) {
    const homeId = `house${Math.floor(id / 2)}`;
    const home = map.facilities.find((f) => f.id === homeId);
    const traits = generateTraits(rngWorldgen);
    // §22.16 심 생성은 makeSim 한 곳으로 모은다. rng 소비 순서(traits → needs×4 → money)는
    // 여기서 그대로 유지하고 값만 넘긴다 — 월드젠 바이트 동일성이 걸려 있다.
    const needs = {
      hunger: 5000 + rngInt(rngWorldgen, 4000),
      energy: 5000 + rngInt(rngWorldgen, 4000),
      social: 5000 + rngInt(rngWorldgen, 4000),
      fun: 5000 + rngInt(rngWorldgen, 4000),
    };
    const money = DEFAULT_LOGIC.occupations[traits.occupation].startMoney + rngInt(rngWorldgen, 500);
    sims.push(makeSim({
      id,
      name: nameOrder[id], // §22.7 시드로 섞인 순서
      surname: surnameFor(seed, id),
      homeId,
      traits,
      seed,
      x: home.door.x,
      y: home.door.y + 1, // 문 앞 도로변
      needs,
      money,
    }));
  }

  const affinity = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));
  const interactions = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));
  const lastGreetDay = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(-1));

  const world = {
    schemaVersion: SCHEMA_VERSION,
    treasury: DEFAULT_LOGIC.economy.initialTreasury ?? 0, // §17.15 국고 · §22.78 종잣돈
    reputation: 0, // §17.21 마을 평판 — 행동 이벤트 누적, 이민 웨이브 규모 결정
    incidents: [], // §17.20 사건: { type:'fire', facilityId, sinceTick }
    policy: {},    // §18.T1 시장 정책 오버라이드 (화이트리스트: taxPct, welfareAmount, welfareThreshold)
    childAllowanceDay: -1, // #71 마지막 가구 지원 심사일, 같은 아이 중복 지급 방지
    householdIntents: [], // #51 다음 틱에 재검증할 분가 의도
    nextHouseholdIntentId: 0,
    householdDaily: { day: -1, households: [], failures: {} },
    facilityUseToday: {}, // #93 완료된 실제 시설 이용 횟수(일 경계에서 주택시장 스냅샷으로 소비)
    housingMarket: { day:-1, homes:[], facilityUse:{}, totals:{charged:0,paid:0,shortfall:0} },
    rentPressure: {},
    zoneOrders: [], // §18.T2 플레이어 건설 주문 FIFO: { plotId, type, dir }
    centers: [], // §18.T6 플레이어가 지정한 도시계획 중심점: { centerId, x, y, createdTick }
    terrainVersion: 1, // §19 R-A 지형 생성 버전 (신규·마이그레이션 동일 계약 — 63차 ②)
    // §22.18 산업 수요 원장 — '무엇이 없어서 아쉬웠는지'를 분류별로 센다.
    // 건물을 미리 세우는 대신 세계가 필요를 기록하고, 그 필요에서 산업이 자란다.
    industryDemand: {},
    capacityShortfall: {}, // §22.18 만석 — '키우라'는 신호 (짓는 것과 다르다)
    industryWant: {},      // §22.19 일상 수요 — 위급하지 않은 아쉬움 (섞지 않는다)
    transit: makeTransitState(), // §19.12 역 수요 관측·언락 (이슈 #52 — 일일 판정이 갱신)
    termStartPolicy: null, // §22.20 임기 시작 정책 스냅샷 — '조정하지 않았다'의 기준선
    lastFiscalDay: -1,     // §22.22 시장 재정 리뷰 하루 1회 가드
    playerPolicyDay: -1,   // §22.22 플레이어 정책 입력을 시장이 존중하는 창
    lastPublicWorksDay: -1, // §22.26 공공사업 하루 1회 가드
    externalInflow: 0,  // §22.4 경계 유입 누계 (기반 부문 임금·낚시·습득·이민 초기금)
    externalOutflow: 0, // §22.4 경계 유출 누계 (건설비·차값 — 마을 밖으로 나간다)
    nextSimId: SIM_COUNT, // §22.2 새 심 id 카운터 (사망 후 id 재사용 방지)
    cityTier: 0,    // §18.T4 도시 등급 (0 마을 → 3 대도시, 비가역)
    statsHistory: [], // §18.T5 일일 통계 링 (캡 180): {day,pop,treasury,reputation,avgMood,employed,tier}
    lostAndFound: [], // §17.24 분실물 보관: {itemId, finderId, amount, dueDay}
    seed,
    worldTick: 0,
    rngSim: makeRng(rngNext(rngWorldgen)),
    rngWorldgen, // 생성 후 미사용 (보존만)
    map,
    sims,
    affinity,
    interactions, // 페어링 틱 카운트 (대칭, PLAN §12.1 D3)
    lastGreetDay, // 인사 하루 1회 가드 (대칭, D9)
    wear: {}, // 경로 마모 → 도로화 — 희소 객체 (§17.0 성능 계약)
    roadReports: [],
    weather: { day: 0, kind: 'sunny' }, // §16.D — day 0은 드로우 없이 sunny 고정 (Codex 22차 항목 1)
    lostItems: [],   // §16.C 동적 오브젝트
    itemCounter: 0,
    plots, // 공터 96곳 (§16.5/16.6/17.0) — 지형 생성 전에 확정해 보호 대상으로 넘긴다
    projects: [], // §19.3 동시 건설 슬롯 (재정 비례)
    complaints: [], // §19.5 시민 불만: { kind, placeId, severity, sinceDay, count }
    unlockedIndustries: [], // 수요 증거로 비가역 언락된 업종 id (정의 순서)
    complaintReasonDay: 0, // §19.10 원인 분화 시행일 (신규 월드는 처음부터 정확)
    petitions: {},  // §19.5 kind별 { lastDay, armed } — 재발화 방지 (70차 ②)         // 활성 건설 프로젝트 (최대 1)
    lastPlanDay: -1,       // 도시계획 트리거 일일 가드
    // §17 사회 상태
    partners: {},          // simId -> partnerId (대칭)
    partnerStage: {},      // simId -> 'dating' | 'married' (대칭)
    clubs: { book_club: [], fishing_club: [], fitness_club: [], drinking_pals: [] },
    mayorId: null,
    lastElectionDay: -1,
    immigrantCounter: 0,
    lastDailyDay: -1,      // 일일 평가(질병·선거·수당·이민) 가드
    campaigners: [],       // §17.9 유세 중 후보 (D-3 계산, 선거 직전 클리어)
    recentCouples: [],     // §17.9 최근 커플 링 (최대 8, {a,b,day,kind})
    parents: {},           // §17.11 childId -> [부모A, 부모B] (id asc)
    reservations: {}, // "facilityId:resourceId" -> simId
    tokens: [],       // 활성 정보 토큰 (PLAN §F)
    tokenCounter: 0,
    // §22.14 **깊은 복사가 필요하다.** 예전에는 DEFAULT_LOGIC을 참조로 그대로 넣어서
    // 모든 세계가 같은 logic 객체를 공유했다 — 한 세계의 값을 바꾸면 모듈 기본값과
    // 이후 만들어지는 모든 세계가 함께 오염된다. 서버는 세계가 하나라 안 물렸지만,
    // A/B 소크·테스트처럼 한 프로세스에서 여러 세계를 돌리면 대조군이 처치군을 오염시켜
    // **모든 지표가 0% 변화로 나온다**. 실제로 이 절의 첫 설계를 거짓 반증할 뻔했다.
    logic: structuredClone(DEFAULT_LOGIC),
  };
  // §23.13 공공 정원. generateTraits는 인구를 모른 채 직업을 뽑으므로, 열 명짜리 마을이
  // 경찰 둘·소방관 하나·의사 하나를 데리고 태어났다(실측). 공공 임금은 국고가 전액
  // 보장하니 1일차에 국고 −10,766이다. 만들어진 순서대로 정원을 넘은 자리를 민간직으로
  // 돌린다 — rng를 쓰지 않아 월드젠의 드로우 순서는 그대로다.
  for (const sim of world.sims) demotePublicIfOverQuota(world, sim);
  fillPublicPosts(world); // 빈 자리는 채운다 — 경찰도 의사도 없는 마을을 만들지 않는다
  return world;
}
