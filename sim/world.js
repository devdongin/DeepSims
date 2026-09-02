import { makeAbilities } from './abilities.js'; // §21.1
import { SCHEMA_VERSION } from './constants.js';
// 월드 생성 — rngWorldgen만 사용, 이후 런타임은 rngSim (PLAN §2 네임드 스트림).
// schemaVersion 2: traits(성별·나이·MBTI·직업)·mood·world.logic 포함 (PLAN §12.1).
import { buildMap, defaultPlots, extraPlots128, extraPlots512, generateTerrain } from './map.js';
import { makeRng, rngNext, rngInt } from './prng.js';
import { generateTraits } from './traits.js';
import { DEFAULT_LOGIC } from './logic.js';

export const SIM_NAMES = ['민수', '지연', '하준', '서연', '도윤', '은지', '태호', '수아', '준호', '예린'];
// §17.1 이민자 이름 풀 (순환 사용, 중복 시 클라가 이름 뒤 id 표기)
export const IMMIGRANT_NAMES = ['재현', '소민', '우진', '하늘', '규리', '성민', '다은', '지호', '세아', '현우',
  '보라', '준서', '유나', '시우', '가온', '민재', '채원', '건우', '나윤', '태양'];
export const SIM_COUNT = 10;

export function createWorld(seed) {
  const rngWorldgen = makeRng(seed);
  const plots = [...defaultPlots(), ...extraPlots128(), ...extraPlots512()];
  const map = buildMap();
  generateTerrain(map, makeRng((seed ^ 0x7e44a1) >>> 0), plots); // §19 R-A 전용 스트림 (rngSim 비소비, 공터 보호)

  const sims = [];
  for (let id = 0; id < SIM_COUNT; id++) {
    const homeId = `house${Math.floor(id / 2)}`;
    const home = map.facilities.find((f) => f.id === homeId);
    const traits = generateTraits(rngWorldgen);
    sims.push({
      id,
      name: SIM_NAMES[id],
      homeId,
      isPlayer: false,
      traits,
      abilities: makeAbilities(seed, id), // §21.1 능력치 — 드로우 없이 seed·id에서 유도
      sharedDay: -1,
      sharedTo: [], // §21.2 나눔: 쌍당 하루 1회
      hungerZeroTicks: 0, // §22.2 굶은 채 머문 시간
      approachedDay: -1,
      approachedTo: [], // §22.6 하루에 같은 사람에게 거듭 말 걸지 않기
      mood: 0,
      x: home.door.x,
      y: home.door.y + 1, // 문 앞 도로변
      needs: {
        hunger: 5000 + rngInt(rngWorldgen, 4000),
        energy: 5000 + rngInt(rngWorldgen, 4000),
        social: 5000 + rngInt(rngWorldgen, 4000),
        fun: 5000 + rngInt(rngWorldgen, 4000),
      },
      money: DEFAULT_LOGIC.occupations[traits.occupation].startMoney + rngInt(rngWorldgen, 500),
      state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
      // Phase 3 인지 상태 (PLAN §2.5)
      memories: [],
      memorySeq: 0,
      habit: {},           // "action:facilityId" -> 누적 보너스 (§G habitMod)
      relTiers: {},        // otherSimId -> 'acquaintance'|'friend'|'rival' (stranger는 미기록)
      lastReflectedDay: -1,
      reflectionMemoryCursor: 0,
      pendingMood: null,
      // Phase 4 (PLAN §2.5 D/F)
      knownTokens: [],
      plan: null,
      lastPlannedDay: -1,
      hangoverUntil: -1, // §15.1.A: t < hangoverUntil 동안 숙취
      sick: null,        // §17.3: null | { kind, untilTick }
      groceries: 0,      // §16.B 장바구니 (집밥 재료)
      noPathCool: {},    // §17.23 no_path 쿨다운
      patrolIdx: 0,      // §17.24 순찰 진행 (경찰만 의미)
      hasCar: false,     // §19 R-B 자가용 (이동 속도 배수)
      complaintCursor: 0, // §19.5 불만 집계 커서 (중복 가산 방지 — 70차 ①)
      complaintDays: {},  // §19.7 kind → 마지막 불만 제기일 (Granovetter: 사건 수가 아니라 사람 수)
      longTrips: 0,      // §19 R-B 장거리 이동 횟수 (출발 시점 누적 — 64차 (c))
    });
  }

  const affinity = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));
  const interactions = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));
  const lastGreetDay = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(-1));

  return {
    schemaVersion: SCHEMA_VERSION,
    treasury: 0, // §17.15 국고 (세금 유입 → 복지·수당 유출)
    reputation: 0, // §17.21 마을 평판 — 행동 이벤트 누적, 이민 웨이브 규모 결정
    incidents: [], // §17.20 사건: { type:'fire', facilityId, sinceTick }
    policy: {},    // §18.T1 시장 정책 오버라이드 (화이트리스트: taxPct, welfareAmount, welfareThreshold)
    zoneOrders: [], // §18.T2 플레이어 건설 주문 FIFO: { plotId, type, dir }
    terrainVersion: 1, // §19 R-A 지형 생성 버전 (신규·마이그레이션 동일 계약 — 63차 ②)
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
    weather: { day: 0, kind: 'sunny' }, // §16.D — day 0은 드로우 없이 sunny 고정 (Codex 22차 항목 1)
    lostItems: [],   // §16.C 동적 오브젝트
    itemCounter: 0,
    plots, // 공터 96곳 (§16.5/16.6/17.0) — 지형 생성 전에 확정해 보호 대상으로 넘긴다
    projects: [], // §19.3 동시 건설 슬롯 (재정 비례)
    complaints: [], // §19.5 시민 불만: { kind, placeId, severity, sinceDay, count }
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
    logic: DEFAULT_LOGIC,
  };
}
