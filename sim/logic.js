// 판단 로직 파라미터 (PLAN §14.1) — 공식의 구조는 코드, 수치는 이 파라미터.
// world.logic에 전문이 직렬화되며, logic_update 입력으로만 교체된다.
import { fnv1a } from './serialize.js';

// v1 등가 + Phase 2 기본값. logic/params.json의 초기 내용이기도 하다.
export const DEFAULT_LOGIC = {
  logicSchemaVersion: 32, // §20.3 social.gravityPull*/WalkingPct 추가 (사회적 중력 — 이슈 #33)
  decay: { hunger: 6, energy: 4, social: 3, fun: 3 },
  ageDecay: { youngMax: 29, youngFunAdd: 2, oldMin: 60, oldEnergyAdd: 2 },
  actions: {
    respond_fire: { duration: 60, recoverPerTick: 0, cost: 0 }, // §17.20 화재 진압 (소방관 전용 위급 후보)
    eat: { duration: 30, recoverPerTick: 300, cost: 200 },
    sleep: { duration: 420, recoverPerTick: 25 },
    work: { duration: 240, wageBase: 1200 },
    socialize: { duration: 60, recoverPerTick: 150 },
    play: { duration: 60, recoverPerTick: 150 },
    idle: { duration: 5 },
    // 대처 행동 (§15.1.A) — 기분 게이트 하에서만 후보
    drink: { duration: 45, cost: 300, moodPerTick: 40, funPerTick: 50 },
    binge_eat: { duration: 20, cost: 400, moodPerTick: 25, hungerPerTick: 400, regretMood: 200 },
    hole_up: { duration: 120, moodPerTick: 10, energyPerTick: 15 },
    exercise: { duration: 60, moodPerTick: 15, funPerTick: 80, completeMoodBonus: 100 },
    // 건설 (§15.1.B)
    build: { duration: 240, cost: 3000 },
    // 세계관 확장 (§16.B)
    read: { duration: 40, recoverPerTick: 120, moodPerTick: 5 },
    shop: { duration: 15, cost: 600, groceriesGain: 3 },
    fish: { duration: 90, recoverPerTick: 60, moodPerTick: 12, catchSpan: 400, missMood: 100 },
    cook_eat: { duration: 25, recoverPerTick: 350, moodPerTick: 8 },
    construct: { duration: 60 }, // §16.5 스틴트
    see_doctor: { duration: 30, cost: 800 }, // §17.3 진료
  },
  occupations: {
    office_worker: { workStart: 540, workEnd: 1080, wagePct: 100, startMoney: 1000, flex: true },
    barista: { workStart: 420, workEnd: 960, wagePct: 90, startMoney: 1000, weekendWork: true }, // 카페는 주말도 연다
    freelancer: { workStart: 300, workEnd: 1260, wagePct: 80, startMoney: 1000, flex: true, weekendWork: true },
    student: { workStart: 840, workEnd: 1200, wagePct: 50, startMoney: 500 },
    retired: { workStart: -1, workEnd: -1, wagePct: 0, startMoney: 3000 },
    // §17.2 신규 직업 — 근무지는 workplace 매핑
    doctor: { workStart: 480, workEnd: 1140, wagePct: 140, startMoney: 1500 },
    civil_servant: { workStart: 540, workEnd: 1080, wagePct: 110, startMoney: 1200, flex: true },
    teacher: { workStart: 480, workEnd: 960, wagePct: 105, startMoney: 1100 },
    // §17.13 신규 — police/firefighter/nurse는 교대(shift), politician은 flex
    police: { workStart: 540, workEnd: 1080, wagePct: 115, startMoney: 1200, shift: 'rotating' },
    firefighter: { workStart: 540, workEnd: 1080, wagePct: 115, startMoney: 1200, shift: 'rotating' },
    nurse: { workStart: 540, workEnd: 1080, wagePct: 120, startMoney: 1200, shift: 'rotating' },
    politician: { workStart: 540, workEnd: 1080, wagePct: 125, startMoney: 1500, flex: true },
    worker: { workStart: 540, workEnd: 1080, wagePct: 95, startMoney: 1000 }, // §18.T3 공장
  },
  // §17.2: 직업 → 근무 시설 타입 (work 후보는 여기서만)
  workplace: {
    office_worker: 'office', barista: 'cafe', freelancer: 'office', student: ['school', 'university'], // §18.T3
    retired: 'office', doctor: 'hospital', civil_servant: 'city_hall', teacher: 'school',
    police: 'police_station', firefighter: 'fire_station', nurse: 'hospital', politician: 'city_hall',
    worker: 'factory', // §18.T3
  },
  persFactor: { socializeBase: 150, playBase: 100, workBase: 150 },
  affinity: {
    tfScaleBase: 50, argumentBase: -3000, argumentTfCoef: 20,
    argClampMin: -5000, argClampMax: -1000, deltaMin: -20, deltaSpan: 61,
  },
  mood: {
    argument: -800, lonely: -400, starving: -1000, actionCompleted: 50, moneyGain: 100,
    decayPerTick: 5, lethargyThreshold: -5000, reliefScale: 25000000, lethargyScale: 50000000,
  },
  needCritical: 2000,
  // Phase 3 (logicSchemaVersion 2): 기억·회고·관계 티어 (PLAN §2.5 B/C/E + D2 델타)
  memory: {
    cap: 256, topK: 8,
    importance: {
      argument: 8, starving: 8, party_info: 7, relationship_changed: 6,
      lonely: 4, work_done: 3, meal: 2, small_talk: 1, play_time: 1,
      drank: 3, binge: 3, hole_up: 2, workout: 3, built_bed: 5,
      read_time: 2, shopping: 1, home_meal: 2, fishing: 3, found_item: 2, construct_work: 4,
      sick: 6, healed: 4, love: 7, wedding: 9, heartbreak: 8, elected: 8, voted: 2, child: 9,
      new_neighbor: 3, club_joined: 4, heroic: 8, celebration: 7, milestone: 7, unmet: 6 },
    recencyLut: [1000, 820, 670, 550, 450, 370, 300, 250, 200, 165, 135, 110, 90, 74, 60, 50],
    wRecency: 2, wImportance: 100, relevancePer: 100, relevanceCap: 4,
    posScale: 2000000000, negScale: 4000000000, // 기여 = ±importance×(1+overlap)×scale, 합계는 §G ±5e11 클램프
  },
  social: {
    friendAffinity: 3000, friendInteractions: 60,
    rivalAffinity: -2000, rivalInteractions: 30,
    acquaintanceInteractions: 15,
    friendStateBonus: 150000000000,   // stateMod: 친구가 그 시설에 있으면 (±2.5e11 클램프)
    // §20.3 사회적 중력 (이슈 #33): '사람이 있는 곳'이 사교에는 낫다. 낯선 사람도 포함해
    // 그 시설에서 사교 중인 인원 + 사교하러 오는 중인 인원을 센다.
    // **곱셈**이라야 한다 — 가산 슬롯(stateMod)은 전형 점수 ~3e12 대비 클램프가 ±2.5e11(약 8%)뿐이라
    // 거리 항을 못 이기고, 실제로 그 형태는 세 번 반증됐다 (§20.3 기록).
    gravityPullPct: 60,               // 사교 중인 1명당 점수 가중 (%)
    gravityPullCap: 200,              // 총 상한 (%) — 3~4명에서 포화. 150%대에서 no_path 절벽이 있다
    gravityWalkingPct: 50,            // '오는 중'인 심의 가중치 (%). 쏠림 폭주를 막는 감쇠 신호다
    rivalStatePenalty: 200000000000,  // 라이벌이 있으면 감점 (양수로 저장, 적용 시 부호)
    reflectionMoodScale: 60,          // pendingMood = clamp(Σ 부호 importance × scale, ±10000)
    habitIncrement: 10000000000,      // 회고당(=하루당) 습관 증가 상한 (PLAN §G: 1e10/일)
    habitCap: 250000000000,           // 행동당 habitMod 상한 (PLAN §G: 2.5e11)
    habitMinRepeats: 3,               // 같은 행동×시설 반복 임계
  },
  // Phase 4 (logicSchemaVersion 3): 하루 계획·정보 확산 (PLAN §2.5 D/F)
  plan: {
    mealSlot1Start: 420, mealSlot1End: 540,     // 아침 식사 창
    mealSlot2Start: 1050, mealSlot2End: 1170,   // 저녁 식사 창
    leisureStart: 1170, leisureEnd: 1380,       // 저녁 여가
    bonusMax: 50,                               // planFactor = 100 + floorDiv(bonusMax×(100-JP),100)
    partyPullFactor: 150,                       // 토큰 장소 socialize의 planFactor
    partyWindowBefore: 120,                     // scheduledTick 전 몇 틱부터 끌리는가
  },
  diffusion: {
    intervalTicks: 4320,      // 3게임일마다
    generateAtTod: 600,       // 10:00
    scheduleTod: 1140,        // 다음날 19:00
    expireAfter: 120,
    seedCount: 2,             // 외향성 상위 n명이 초기 습득
    transferBase: 300,        // 성공 임계(‰): base + affinity/20 + TF/5, [50, 950] 클램프
    transferAffinityDiv: 20,
    transferTfDiv: 5,
    announceMaxHours: 48,
  },
  // 대화·상호작용 (logicSchemaVersion 4): D8~D10
  conversation: {
    lineInterval: 15,          // socialize 페어의 발화 간격 (pairedTicks % interval == 1)
    topicWeights: { couple_news: 25, family_talk: 30, food: 20, gossip: 30, memory_share: 20, politics: 25, weather: 10, work_gripe: 20 },
    greetingAffinity: 15,      // 인사 시 호감도(부호 보존 TF 스케일 적용 전 기본값)
    greetingSocial: 100,       // 인사 시 사교 회복
    greetingRange: 1,          // 맨해튼 거리 임계
  },
  // 로드맵 (logicSchemaVersion 5): 대처·건설 (§15.1)
  coping: {
    threshold: -2000,          // mood가 이보다 낮아야 coping 후보 활성
    hangoverTicks: 1440,       // 음주 후 숙취 지속
    hangoverEnergyDecay: 3,    // 숙취 중 energy 감쇠 가산
    persDrinkBase: 120,        // drink persFactor = base - floorDiv(EI,2)
  },
  build: {
    wearThreshold: 400,        // GRASS 밟힘 누적 → ROAD 전환
    maxExtraBeds: 2,           // 집당 증축 침대 상한
    deficit: 5000,             // build 후보의 고정 deficit
  },
  // 세계관 확장 (§16, logicSchemaVersion 6)
  weather: {
    sunnyW: 50, cloudyW: 30, rainW: 20,
    outdoorRainFactor: 60, // 비 오는 날 야외 시설 점수 ×60% (§G 곱셈 체인: base×pers×plan×weather)
  },
  items: {
    spawnInterval: 720,   // 12게임시간마다 스폰 시도
    spawnTries: 8,
    spawnAreaW: 64, spawnAreaH: 64, // §16.6: 동전은 구시가(사람 다니는 곳)에만 떨어진다
    amountMin: 50, amountSpan: 201,
    expireTicks: 2880,
    pickupMood: 100,
  },
  market: { maxGroceries: 6 },
  construct: {
    laborRequired: 600,  // 완공까지 누적 수행 틱
    deficit: 4000,       // needValue = NEED_MAX - deficit (고정 급함)
    persJDiv: 4,         // persFactor = 100 + floorDiv(100 - JP, persJDiv)
    cafeRatio: 2,        // 심 수 > 좌석합×ratio → cafe 프로젝트
    parkRatio: 1,        // 심 수 > 스팟합×ratio → park 프로젝트
    noPathCoolTicks: 240,     // §17.23 no_path 재시도 쿨다운 (4시간)
  },
  // §17 사회 (logicSchemaVersion 9)
  society: {
    immigrationIntervalDays: 3,
    yearDays: 120,           // §17.9 새해 주기 (전원 age+1) — 실시간 관람 페이싱(v0.9.1)
    graduateAge: 26,         // student → office_worker
    retireAge: 65,           // → retired
    festivalDays: 30,        // §17.10 마을 축제 주기
    childCheckDays: 30,      // §17.13 자녀 월간 평가 (나이는 새해 유지)
  },
  family: {
    childPermille: 300,      // §17.11 새해 자녀 정착 확률(‰, 동거 부부·빈 침대 조건)
    familyBonus: 12,         // 가족 페어링 호감 가산
  },
  // §17.13 생활 리듬 — 크로노타입·교대·야근 (전부 분 단위 tod, 무드로우)
  chrono: {
    earlyMax: 20, owlMin: 70,            // 라벨 구간 (표시용 — 로직은 연속 오프셋)
    maxShiftMin: 120,                    // 연속 크로노 오프셋 ±상한 (v 0..99 선형)
    overtimeProbPct: 70,                 // 야근 의사확률 상한: p=(100-JP)×70/100 (일별 dayHash)
    overtimeMinBase: 60, overtimeMinSpan: 90, // 야근 길이 60 + (100-JP)×90/100 그라데이션
    dayShiftStart: 540, dayShiftEnd: 1080,
    nightShiftStart: 1320, nightShiftEnd: 1800,  // 자정 랩 (to>1440)
    sleepStart: 1350, sleepLenMin: 450,
    daySleepStart: 480, daySleepEnd: 960,        // 야간조 주간 수면
  },
  // §17.18 삼각 폐쇄: 친구의 친구와는 빨리 가까워진다 (페어 델타 가산, 무드로우)
  triad: { perFriendBonus: 8, maxCommon: 3 },
  // §17.20 사건: 화재 — 소방관에게 실제 업무를 (일일 시설별 드로우, §17.8 ①.5)
  incidents: {
    fireBasePermille: 2, kitchenBonusPermille: 3, // 식당·카페 주방 가중
    respondDeficit: 5500,      // 진압 급함 (construct 4000보다 위)
    selfOutTicks: 1440,        // 방치 시 자연 진화 (평판 타격)
    selfOutRepPenalty: 40,     // 자연 진화 시 평판 감소
    heroAffinity: 800,         // 목격자(맨해튼≤10) → 진압 소방관 호감
    heroRadius: 10,
  },
  // §18.T4 도시 등급 (비가역, 49차 합의): 인구 문턱 승급 — 웨이브 캡 확장·zone 언락
  tiers: [
    { popMin: 0, nameKo: '마을', unlocks: [] },
    { popMin: 25, nameKo: '읍', unlocks: ['apartment'] },
    { popMin: 60, nameKo: '시', unlocks: ['factory', 'mall'] },
    { popMin: 120, nameKo: '대도시', unlocks: ['university'] },
  ],
  promotion: { moodBonus: 1000, repBonus: 100 },
  // §18.T3: 공장 공해(전역 평판, 51차 위치 고정 — 복지 다음·이민 전) + 대학 졸업 가중 풀
  pollution: { repPerFactoryPerDay: 3 },
  // §19.5 시민 불만 → 집단 청원 (Granovetter 문턱 모델, 70차 조건 반영)
  complaints: {
    cap: 64,               // 배열 상한 (초과 시 oldest-first 제거)
    lonelyMin: 3,          // 이 횟수 이상 외로우면 불만 적재
    petitionPct: 40,       // 문턱 = floorDiv(인구 × pct, 100), count > threshold일 때 발화
    petitionRepPenalty: 25, // 청원 발생 시 평판 감소
    decayPct: 82,          // §19.7 일일 망각 — 개선되면 문턱 아래로 내려가 청원이 재무장
    windowDays: 3,         // §19.7 이 기간 내 불만을 제기한 **사람 수**로 문턱 판정 (Granovetter)
  },
  // §19 R-B 교통 (64차 조건부 GO): 이동 수요가 쌓여야 수단이 생긴다 (4단계 모델의 ABM 대체)
  transport: {
    longTripMin: 40,      // 이 칸수 이상이면 '장거리' 1회 (출발 시점 누적)
    carTripsMin: 12,      // 자가용 구매 문턱
    carPrice: 6000,       // 실측 조정: 잔고 상한 ~9.8천 (soak 검증, 64차 (c))
    carSpeedTiles: 2,     // 틱당 최대 전진 칸수 (순서대로)
    stationDemand: 300,   // 마을 총 longTrips — 기차역 언락 (후속 라운드)
  },
  // §17.24 순찰·정직 (56차 합의): p(신고) = honesty.base + floorDiv(TF, honesty.tfDiv) — 정수식 고정
  patrol: { targets: ['cafe', 'park', 'market', 'bar', 'mall'], repPerPatrol: 1 },
  honesty: { base: 50, tfDiv: 4, reportMood: 200, holdDays: 3 },
  graduation: {
    poolBase: ['office_worker', 'office_worker', 'worker', 'teacher', 'civil_servant'],
    poolUni: ['doctor', 'doctor', 'politician', 'nurse'], // 대학 보유 시 풀에 append — 단일 드로우 유지
  },
  // §18.T2 건설 지시: 주문 시 국고 차감 (취소 없음 — 47차 합의), 착공 시 재검증
  zone: {
    costs: { house: 2000, cafe: 3000, office: 3000, park: 1000, apartment: 6000, factory: 8000, mall: 8000, university: 10000 },
  },
  // §17.21 도시 성장 드라이브: 행동 이벤트 → 평판 → 이민 웨이브 + 선제·일자리 건설
  growth: {
    headroomBeds: 2,        // 빈 침대가 이보다 적으면 선제 house 프로젝트
    repMarried: 40, repFestival: 30, repBuilt: 25, repChild: 30, repElection: 10, repGathering: 2,
    repCap: 500, repDecayPct: 95, // 일일 ×95% 감쇠
    immigPerExtra: 80, immigWaveMax: 3, // 웨이브 = 1 + floor(평판/80), 캡
    slotPerTreasury: 150000, // §19.3 국고 15만당 동시 건설 슬롯 +1 (돈이 시공 능력을 만든다)
    maxProjectSlots: 3,      // 동시 착공 상한
  },
  // §17.15 경제 순환: 소득세 → 국고 → 복지·시장 수당 (Lengnick baseline 차용, 드로우 0회)
  economy: {
    taxPct: 15,             // 임금 원천징수율
    welfareThreshold: 300,  // 이 잔고 미만이면 복지 대상
    welfareAmount: 200,     // 1회 지급액
    welfareDailyCap: 5,     // 하루 최대 수급자 수 (필요도 순 — §20.1)
    // §20.2 임금이 '일한 시설의 매출'에서 나오는 민간 서비스 직군 (화이트리스트).
    // 여기 없는 직군은 기반 부문(외부 소득)·공공 부문으로 보고 기존대로 지급한다.
    privateWageOccupations: ['barista'],
    taxMoodPer: 5,          // §18.T1: 납세 시점 mood 델타 = -floorDiv(tax×taxMoodPer, 10) (그라데이션)
  },
  // §17.16 서카디언 수면 압력: 시각별 에너지 감쇠 % (0시..23시, 개인 위상 보정 후 조회)
  circadian: {
    energyPct: [150, 150, 145, 140, 135, 125, 110, 100, 95, 90, 90, 90,
                95, 95, 95, 95, 100, 105, 110, 115, 125, 135, 145, 150],
  },
  disease: {
    basePermille: 5, starvingBonus: 30, rainBonus: 10, lowEnergyBonus: 20,
    contagionPermille: 40,
    durationTicks: 4320,     // 자연 치유 3일
    decayFactorNum: 1,       // 감쇠 가산 d += floorDiv(d × num, den) → +50%
    decayFactorDen: 2,
    doctorDeficit: 8500,     // see_doctor needValue = NEED_MAX - deficit (아플 때 최우선급)
  },
  election: {
    intervalDays: 15,
    mayorLaborPct: 90,       // 시장 재임 중 시작되는 프로젝트 노동량 ×90%
    mayorStipend: 200,       // 일일 수당
    campaignPull: 140,       // §17.9 유세: 후보의 socialize planFactor
    campaignDays: 3,         // 선거 D-3부터
  },
  romance: {
    datingMin: 4500, datingInteractions: 40,
    marryMin: 7500, marryInteractions: 120,
    breakup: 2000, breakupMood: 1500,
    partnerSocialPct: 150,   // 파트너 페어링 사교 회복 %
    sweetTalkDelta: 8,       // 파트너 대화 상호 호감 가산(스케일 전)
  },
  club: {
    habitMin: 10000000000,   // 가입 임계 (습관 형성 하루면 충분 — 120일 소크 튜닝)
    pairBonus: 10,           // 동료 페어링 호감 가산(스케일 전)
    talkDelta: 5,
  },
  influence: {
    gossipDelta: 30,         // 험담이 청자→대상 호감도에 주는 변동(스케일 전)
  },
};

// 부호가 음(불쾌)인 기억 종류 — memoryMod·pendingMood 계산에 사용 (구조, 코드 고정)
export const NEGATIVE_MEMORY_KINDS = ['argument', 'starving', 'lonely', 'sick', 'heartbreak'];

// 구버전 world.logic에 새 섹션의 기본값을 결정적으로 병합 (마이그레이션 전용)
export function mergeLogicDefaults(oldLogic) {
  const merged = structuredClone(DEFAULT_LOGIC);
  const copy = (dst, src) => {
    for (const k of Object.keys(dst)) {
      if (!(k in src)) continue;
      if (typeof dst[k] === 'object' && dst[k] !== null && !Array.isArray(dst[k])) copy(dst[k], src[k] ?? {});
      else dst[k] = src[k];
    }
  };
  copy(merged, oldLogic ?? {});
  merged.logicSchemaVersion = DEFAULT_LOGIC.logicSchemaVersion;
  return merged;
}

export function logicHash(params) {
  return fnv1a(JSON.stringify(sortKeys(params)));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

// 검증 (PLAN §14.1): DEFAULT_LOGIC과 키 구조 동일(미지 키 거부·누락 거부),
// 전 수치 safe integer + [-1e12, 1e12], logicSchemaVersion 일치, UTF-8 ≤ 8KB.
export function validateLogic(params) {
  const errors = [];
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, errors: ['params는 객체여야 함'] };
  }
  const json = JSON.stringify(params);
  if (Buffer.byteLength(json, 'utf8') > 8192) errors.push('params 전문 > 8KB');
  if (params.logicSchemaVersion !== DEFAULT_LOGIC.logicSchemaVersion) {
    errors.push(`logicSchemaVersion 불일치 (기대 ${DEFAULT_LOGIC.logicSchemaVersion})`);
  }
  checkShape(DEFAULT_LOGIC, params, '', errors);
  if (errors.length === 0) checkRanges(params, errors);
  return { ok: errors.length === 0, errors };
}

// 공식·상태 불변식에서 유도한 필드별 시맨틱 범위 (PLAN §14.1 검증 계약).
// 상한은 §2.5.G 점수 경계 증명(2^53)과 §G moodMod 슬롯(±2.5e11)이 유지되도록 잡았다.
function checkRanges(p, errors) {
  const inRange = (path, v, lo, hi) => {
    if (v < lo || v > hi) errors.push(`범위 위반: ${path}=${v} (허용 ${lo}~${hi})`);
  };
  for (const [k, v] of Object.entries(p.decay)) inRange(`decay.${k}`, v, 0, 1000);
  inRange('ageDecay.youngMax', p.ageDecay.youngMax, 15, 90);
  inRange('ageDecay.oldMin', p.ageDecay.oldMin, 15, 91);
  inRange('ageDecay.youngFunAdd', p.ageDecay.youngFunAdd, 0, 100);
  inRange('ageDecay.oldEnergyAdd', p.ageDecay.oldEnergyAdd, 0, 100);
  for (const [a, def] of Object.entries(p.actions)) {
    inRange(`actions.${a}.duration`, def.duration, 1, 10000);
    if ('recoverPerTick' in def) inRange(`actions.${a}.recoverPerTick`, def.recoverPerTick, 0, 10000);
    if ('cost' in def) inRange(`actions.${a}.cost`, def.cost, 0, 1000000);
    if ('wageBase' in def) inRange(`actions.${a}.wageBase`, def.wageBase, 0, 1000000);
  }
  for (const [o, occ] of Object.entries(p.occupations)) {
    inRange(`occupations.${o}.wagePct`, occ.wagePct, 0, 1000);
    inRange(`occupations.${o}.startMoney`, occ.startMoney, 0, 1000000);
    inRange(`occupations.${o}.workStart`, occ.workStart, -1, 1440);
    inRange(`occupations.${o}.workEnd`, occ.workEnd, -1, 1440);
    if (occ.wagePct > 0 && occ.workStart >= occ.workEnd) {
      errors.push(`occupations.${o}: workStart >= workEnd인데 근무 가능(wagePct>0)`);
    }
  }
  inRange('persFactor.socializeBase', p.persFactor.socializeBase, 0, 300);
  inRange('persFactor.playBase', p.persFactor.playBase, 0, 300);
  inRange('persFactor.workBase', p.persFactor.workBase, 0, 300);
  inRange('affinity.tfScaleBase', p.affinity.tfScaleBase, 0, 200);
  inRange('affinity.deltaSpan', p.affinity.deltaSpan, 1, 10000);   // rngInt(s, 0) 방지
  inRange('affinity.deltaMin', p.affinity.deltaMin, -10000, 10000);
  inRange('affinity.argumentBase', p.affinity.argumentBase, -10000, 0);
  inRange('affinity.argumentTfCoef', p.affinity.argumentTfCoef, 0, 200);
  inRange('affinity.argClampMin', p.affinity.argClampMin, -10000, 0);
  inRange('affinity.argClampMax', p.affinity.argClampMax, -10000, 0);
  if (p.affinity.argClampMin > p.affinity.argClampMax) errors.push('affinity: argClampMin > argClampMax');
  for (const k of ['argument', 'lonely', 'starving', 'actionCompleted', 'moneyGain']) {
    inRange(`mood.${k}`, p.mood[k], -10000, 10000);
  }
  inRange('mood.decayPerTick', p.mood.decayPerTick, 0, 1000);
  inRange('mood.lethargyThreshold', p.mood.lethargyThreshold, -10000, 0);
  inRange('mood.reliefScale', p.mood.reliefScale, 0, 25000000);     // 10000×scale ≤ 2.5e11 (§G)
  inRange('mood.lethargyScale', p.mood.lethargyScale, 0, 50000000); // 5000×scale ≤ 2.5e11 (§G)
  inRange('needCritical', p.needCritical, 0, 10000);
  // Phase 3 섹션
  inRange('memory.cap', p.memory.cap, 16, 1024);
  inRange('memory.topK', p.memory.topK, 1, 32);
  for (const [k, v] of Object.entries(p.memory.importance)) inRange(`memory.importance.${k}`, v, 1, 10);
  for (let i = 0; i < p.memory.recencyLut.length; i++) inRange(`memory.recencyLut[${i}]`, p.memory.recencyLut[i], 0, 10000);
  inRange('memory.wRecency', p.memory.wRecency, 0, 100);
  inRange('memory.wImportance', p.memory.wImportance, 0, 1000);
  inRange('memory.relevancePer', p.memory.relevancePer, 0, 1000);
  inRange('memory.relevanceCap', p.memory.relevanceCap, 0, 16);
  inRange('memory.posScale', p.memory.posScale, 0, 5000000000);   // 합계가 §G ±5e11 내로 클램프 가능
  inRange('memory.negScale', p.memory.negScale, 0, 5000000000);
  inRange('social.friendAffinity', p.social.friendAffinity, 0, 10000);
  inRange('social.rivalAffinity', p.social.rivalAffinity, -10000, 0);
  inRange('social.friendInteractions', p.social.friendInteractions, 0, 1000000);
  inRange('social.rivalInteractions', p.social.rivalInteractions, 0, 1000000);
  inRange('social.acquaintanceInteractions', p.social.acquaintanceInteractions, 0, 1000000);
  inRange('social.friendStateBonus', p.social.friendStateBonus, 0, 250000000000);
  // §20.3 (80차 ③): 상한은 임의로 두지 않고 **최대 점수에서 역산**한다.
  // 점수 상한 = deficit(NEED_MAX)² × 16 × SCORE_SCALE / den(최소 16) × persFactor(≤300%)
  //           + mods(memory 5e11 + state 2.5e11 + habit 2.5e11) ≈ 3.10e13 (실측 계산).
  // 여기에 (100 + cap)/100 을 곱해도 Number.MAX_SAFE_INTEGER(9.007e15)를 넘으면 안 되므로
  // cap ≤ 100 × (9.007e15 / 3.10e13 - 1) ≈ 28,000. 훨씬 보수적으로 500으로 제한한다
  // (cap=500이면 최대 1.86e14로 안전 정수의 2% 수준).
  // (관측된 no_path 절벽은 150 부근이므로 이 상한은 정수 안전성 전용 방어다.)
  inRange('social.gravityPullPct', p.social.gravityPullPct, 0, 500);
  inRange('social.gravityPullCap', p.social.gravityPullCap, 0, 500);
  inRange('social.gravityWalkingPct', p.social.gravityWalkingPct, 0, 100);
  inRange('social.rivalStatePenalty', p.social.rivalStatePenalty, 0, 250000000000);
  inRange('social.reflectionMoodScale', p.social.reflectionMoodScale, 0, 1000);
  inRange('social.habitIncrement', p.social.habitIncrement, 0, 10000000000);
  inRange('social.habitCap', p.social.habitCap, 0, 250000000000);
  inRange('social.habitMinRepeats', p.social.habitMinRepeats, 1, 100);
  // Phase 4 섹션
  for (const k of ['mealSlot1Start', 'mealSlot1End', 'mealSlot2Start', 'mealSlot2End', 'leisureStart', 'leisureEnd']) {
    inRange(`plan.${k}`, p.plan[k], 0, 1440);
  }
  if (p.plan.mealSlot1Start >= p.plan.mealSlot1End) errors.push('plan: mealSlot1 역전');
  if (p.plan.mealSlot2Start >= p.plan.mealSlot2End) errors.push('plan: mealSlot2 역전');
  if (p.plan.leisureStart >= p.plan.leisureEnd) errors.push('plan: leisure 역전');
  inRange('plan.bonusMax', p.plan.bonusMax, 0, 50); // planFactor ≤ 150 (§G)
  inRange('plan.partyPullFactor', p.plan.partyPullFactor, 100, 150);
  inRange('plan.partyWindowBefore', p.plan.partyWindowBefore, 0, 1440);
  inRange('diffusion.intervalTicks', p.diffusion.intervalTicks, 1440, 1000000);
  inRange('diffusion.generateAtTod', p.diffusion.generateAtTod, 0, 1439);
  inRange('diffusion.scheduleTod', p.diffusion.scheduleTod, 0, 1439);
  inRange('diffusion.expireAfter', p.diffusion.expireAfter, 1, 10000);
  inRange('diffusion.seedCount', p.diffusion.seedCount, 0, 100);
  inRange('diffusion.transferBase', p.diffusion.transferBase, 0, 1000);
  inRange('diffusion.transferAffinityDiv', p.diffusion.transferAffinityDiv, 1, 100000);
  inRange('diffusion.transferTfDiv', p.diffusion.transferTfDiv, 1, 100000);
  inRange('diffusion.announceMaxHours', p.diffusion.announceMaxHours, 1, 720);
  inRange('conversation.lineInterval', p.conversation.lineInterval, 1, 1440);
  let topicSum = 0;
  for (const [k, v] of Object.entries(p.conversation.topicWeights)) {
    inRange(`conversation.topicWeights.${k}`, v, 0, 1000);
    topicSum += v;
  }
  if (topicSum <= 0) errors.push('conversation.topicWeights 합이 0');
  inRange('conversation.greetingAffinity', p.conversation.greetingAffinity, 0, 10000);
  inRange('conversation.greetingSocial', p.conversation.greetingSocial, 0, 10000);
  inRange('conversation.greetingRange', p.conversation.greetingRange, 0, 10);
  // §15.1
  for (const a of ['drink', 'binge_eat', 'hole_up', 'exercise']) {
    for (const [k, v] of Object.entries(p.actions[a])) {
      inRange(`actions.${a}.${k}`, v, k === 'duration' ? 1 : 0, k.endsWith('PerTick') || k === 'regretMood' || k === 'completeMoodBonus' ? 10000 : 1000000);
    }
  }
  inRange('coping.threshold', p.coping.threshold, -10000, 0);
  inRange('coping.hangoverTicks', p.coping.hangoverTicks, 0, 100000);
  inRange('coping.hangoverEnergyDecay', p.coping.hangoverEnergyDecay, 0, 1000);
  inRange('coping.persDrinkBase', p.coping.persDrinkBase, 0, 300);
  inRange('build.wearThreshold', p.build.wearThreshold, 1, 1000000);
  inRange('build.maxExtraBeds', p.build.maxExtraBeds, 0, 10);
  inRange('build.deficit', p.build.deficit, 0, 10000);
  // §16
  for (const a of ['read', 'shop', 'fish', 'cook_eat']) {
    for (const [k, v] of Object.entries(p.actions[a])) {
      inRange(`actions.${a}.${k}`, v, k === 'duration' ? 1 : 0, 1000000);
    }
  }
  inRange('weather.sunnyW', p.weather.sunnyW, 0, 1000);
  inRange('weather.cloudyW', p.weather.cloudyW, 0, 1000);
  inRange('weather.rainW', p.weather.rainW, 0, 1000);
  if (p.weather.sunnyW + p.weather.cloudyW + p.weather.rainW <= 0) errors.push('weather 가중 합 0');
  inRange('weather.outdoorRainFactor', p.weather.outdoorRainFactor, 0, 100); // 축소만 허용 — §G 상한 보존
  inRange('items.spawnInterval', p.items.spawnInterval, 1, 1000000);
  inRange('items.spawnTries', p.items.spawnTries, 1, 64);
  inRange('items.spawnAreaW', p.items.spawnAreaW, 1, 1024);
  inRange('items.spawnAreaH', p.items.spawnAreaH, 1, 1024);
  inRange('items.amountMin', p.items.amountMin, 0, 1000000);
  inRange('items.amountSpan', p.items.amountSpan, 1, 1000000);
  inRange('items.expireTicks', p.items.expireTicks, 1, 1000000);
  inRange('items.pickupMood', p.items.pickupMood, 0, 10000);
  inRange('market.maxGroceries', p.market.maxGroceries, 1, 100);
  inRange('actions.construct.duration', p.actions.construct.duration, 1, 10000);
  inRange('construct.laborRequired', p.construct.laborRequired, 1, 1000000);
  inRange('construct.deficit', p.construct.deficit, 0, 10000);
  inRange('construct.persJDiv', p.construct.persJDiv, 1, 100);
  inRange('construct.cafeRatio', p.construct.cafeRatio, 1, 100);
  inRange('construct.parkRatio', p.construct.parkRatio, 1, 100);
  // §17
  inRange('actions.see_doctor.duration', p.actions.see_doctor.duration, 1, 10000);
  inRange('actions.see_doctor.cost', p.actions.see_doctor.cost, 0, 1000000);
  for (const [o, w] of Object.entries(p.workplace)) {
    const ok = typeof w === 'string'
      || (Array.isArray(w) && w.length > 0 && w.every((x) => typeof x === 'string')); // §18.T3 배열 허용
    if (!ok) errors.push(`workplace.${o} 문자열/문자열 배열 아님`);
  }
  inRange('society.immigrationIntervalDays', p.society.immigrationIntervalDays, 1, 1000);
  inRange('society.childCheckDays', p.society.childCheckDays, 1, 100000);
  inRange('construct.noPathCoolTicks', p.construct.noPathCoolTicks, 1, 100000);
  inRange('incidents.respondDeficit', p.incidents.respondDeficit, 0, 10000);
  inRange('incidents.fireBasePermille', p.incidents.fireBasePermille, 0, 1000);
  inRange('incidents.kitchenBonusPermille', p.incidents.kitchenBonusPermille, 0, 1000);
  inRange('incidents.selfOutTicks', p.incidents.selfOutTicks, 1, 100000);
  inRange('incidents.selfOutRepPenalty', p.incidents.selfOutRepPenalty, 0, 10000);
  inRange('incidents.heroAffinity', p.incidents.heroAffinity, 0, 10000);
  inRange('incidents.heroRadius', p.incidents.heroRadius, 0, 1000);
  for (const k of Object.keys(p.zone.costs)) inRange(`zone.costs.${k}`, p.zone.costs[k], 0, 1000000);
  inRange('pollution.repPerFactoryPerDay', p.pollution.repPerFactoryPerDay, 0, 10000);
  inRange('complaints.cap', p.complaints.cap, 1, 10000);
  inRange('complaints.lonelyMin', p.complaints.lonelyMin, 1, 1000);
  inRange('complaints.petitionPct', p.complaints.petitionPct, 1, 1000);
  inRange('complaints.petitionRepPenalty', p.complaints.petitionRepPenalty, 0, 10000);
  inRange('complaints.decayPct', p.complaints.decayPct, 1, 100);
  inRange('complaints.windowDays', p.complaints.windowDays, 1, 365);
  inRange('transport.longTripMin', p.transport.longTripMin, 1, 10000);
  inRange('transport.carTripsMin', p.transport.carTripsMin, 1, 100000);
  inRange('transport.carPrice', p.transport.carPrice, 0, 10000000);
  inRange('transport.carSpeedTiles', p.transport.carSpeedTiles, 1, 8);
  inRange('transport.stationDemand', p.transport.stationDemand, 1, 1000000);
  inRange('patrol.repPerPatrol', p.patrol.repPerPatrol, 0, 1000);
  inRange('honesty.base', p.honesty.base, 0, 100);
  if (p.honesty.base + Math.floor(100 / p.honesty.tfDiv) > 100) {
    errors.push('honesty: base + floor(100/tfDiv) ≤ 100 필요 (신고 확률 상한, 57차)');
  }
  inRange('honesty.tfDiv', p.honesty.tfDiv, 1, 1000);
  inRange('honesty.reportMood', p.honesty.reportMood, 0, 10000);
  inRange('honesty.holdDays', p.honesty.holdDays, 0, 1000);
  if (!Array.isArray(p.tiers) || p.tiers.length < 1) errors.push('tiers: 배열 필요');
  else p.tiers.forEach((tr, i) => inRange(`tiers[${i}].popMin`, tr.popMin, 0, 1000000));
  inRange('promotion.moodBonus', p.promotion.moodBonus, 0, 10000);
  inRange('promotion.repBonus', p.promotion.repBonus, 0, 100000);
  inRange('growth.headroomBeds', p.growth.headroomBeds, 0, 100);
  inRange('growth.repCap', p.growth.repCap, 0, 100000);
  inRange('growth.repDecayPct', p.growth.repDecayPct, 0, 100);
  inRange('growth.immigPerExtra', p.growth.immigPerExtra, 1, 100000);
  inRange('growth.immigWaveMax', p.growth.immigWaveMax, 1, 100);
  inRange('growth.slotPerTreasury', p.growth.slotPerTreasury, 1, 100000000);
  inRange('growth.maxProjectSlots', p.growth.maxProjectSlots, 1, 20);
  inRange('growth.repMarried', p.growth.repMarried, 0, 10000);
  inRange('growth.repFestival', p.growth.repFestival, 0, 10000);
  inRange('growth.repBuilt', p.growth.repBuilt, 0, 10000);
  inRange('growth.repChild', p.growth.repChild, 0, 10000);
  inRange('growth.repElection', p.growth.repElection, 0, 10000);
  inRange('growth.repGathering', p.growth.repGathering, 0, 10000);
  inRange('triad.perFriendBonus', p.triad.perFriendBonus, 0, 1000);
  inRange('triad.maxCommon', p.triad.maxCommon, 0, 100);
  inRange('economy.taxPct', p.economy.taxPct, 0, 90);
  inRange('economy.welfareThreshold', p.economy.welfareThreshold, 0, 100000);
  inRange('economy.welfareAmount', p.economy.welfareAmount, 0, 100000);
  inRange('economy.welfareDailyCap', p.economy.welfareDailyCap, 0, 1000);
  if (!Array.isArray(p.economy.privateWageOccupations)
      || p.economy.privateWageOccupations.some((o) => !(o in p.occupations))) {
    errors.push('economy.privateWageOccupations: occupations에 있는 직업 이름의 배열이어야 함');
  }
  inRange('economy.taxMoodPer', p.economy.taxMoodPer, 0, 1000);
  if (!Array.isArray(p.circadian?.energyPct) || p.circadian.energyPct.length !== 24) {
    errors.push('circadian.energyPct: 24칸 배열 필요');
  } else {
    p.circadian.energyPct.forEach((v, i) => inRange(`circadian.energyPct[${i}]`, v, 10, 400));
  }
  inRange('chrono.earlyMax', p.chrono.earlyMax, 0, 100);
  inRange('chrono.owlMin', p.chrono.owlMin, 0, 100);
  inRange('chrono.maxShiftMin', p.chrono.maxShiftMin, 0, 480);
  inRange('chrono.overtimeProbPct', p.chrono.overtimeProbPct, 0, 100);
  inRange('chrono.overtimeMinBase', p.chrono.overtimeMinBase, 0, 480);
  inRange('chrono.overtimeMinSpan', p.chrono.overtimeMinSpan, 0, 480);
  inRange('chrono.dayShiftStart', p.chrono.dayShiftStart, 0, 1439);
  inRange('chrono.dayShiftEnd', p.chrono.dayShiftEnd, 1, 1440);
  inRange('chrono.nightShiftStart', p.chrono.nightShiftStart, 0, 1439);
  inRange('chrono.nightShiftEnd', p.chrono.nightShiftEnd, 1, 2880);
  inRange('chrono.sleepStart', p.chrono.sleepStart, 0, 1439);
  inRange('chrono.sleepLenMin', p.chrono.sleepLenMin, 60, 1440);
  inRange('chrono.daySleepStart', p.chrono.daySleepStart, 0, 1439);
  inRange('chrono.daySleepEnd', p.chrono.daySleepEnd, 1, 1440);
  inRange('society.yearDays', p.society.yearDays, 30, 100000);
  inRange('society.graduateAge', p.society.graduateAge, 15, 90);
  inRange('society.retireAge', p.society.retireAge, 15, 91);
  inRange('society.festivalDays', p.society.festivalDays, 7, 100000);
  inRange('family.childPermille', p.family.childPermille, 0, 1000);
  inRange('family.familyBonus', p.family.familyBonus, 0, 1000);
  inRange('election.campaignPull', p.election.campaignPull, 100, 150);
  inRange('election.campaignDays', p.election.campaignDays, 0, 29);
  for (const k of ['basePermille', 'starvingBonus', 'rainBonus', 'lowEnergyBonus', 'contagionPermille']) {
    inRange(`disease.${k}`, p.disease[k], 0, 1000);
  }
  inRange('disease.durationTicks', p.disease.durationTicks, 1, 1000000);
  inRange('disease.decayFactorNum', p.disease.decayFactorNum, 0, 100);
  inRange('disease.decayFactorDen', p.disease.decayFactorDen, 1, 100);
  inRange('disease.doctorDeficit', p.disease.doctorDeficit, 0, 10000);
  inRange('election.intervalDays', p.election.intervalDays, 1, 10000);
  inRange('election.mayorLaborPct', p.election.mayorLaborPct, 1, 100);
  inRange('election.mayorStipend', p.election.mayorStipend, 0, 100000);
  inRange('romance.datingMin', p.romance.datingMin, 0, 10000);
  inRange('romance.marryMin', p.romance.marryMin, 0, 10000);
  inRange('romance.breakup', p.romance.breakup, 0, 10000);
  inRange('romance.datingInteractions', p.romance.datingInteractions, 0, 1000000);
  inRange('romance.marryInteractions', p.romance.marryInteractions, 0, 1000000);
  inRange('romance.breakupMood', p.romance.breakupMood, 0, 10000);
  inRange('romance.partnerSocialPct', p.romance.partnerSocialPct, 100, 500);
  inRange('romance.sweetTalkDelta', p.romance.sweetTalkDelta, 0, 1000);
  inRange('club.habitMin', p.club.habitMin, 0, 250000000000);
  inRange('club.pairBonus', p.club.pairBonus, 0, 1000);
  inRange('club.talkDelta', p.club.talkDelta, 0, 1000);
  inRange('influence.gossipDelta', p.influence.gossipDelta, 0, 1000);
}

function checkShape(ref, val, path, errors) {
  const refKeys = Object.keys(ref).sort();
  const valKeys = Object.keys(val ?? {}).sort();
  for (const k of refKeys) {
    if (!(k in (val ?? {}))) { errors.push(`누락 키: ${path}${k}`); continue; }
    const r = ref[k], v = val[k];
    if (typeof r === 'number') {
      if (!Number.isSafeInteger(v)) errors.push(`정수 아님: ${path}${k}=${v}`);
      else if (Math.abs(v) > 1e12) errors.push(`범위 초과: ${path}${k}=${v}`);
    } else if (Array.isArray(r)) {
      if (!Array.isArray(v) || v.length !== r.length) errors.push(`배열 길이 불일치: ${path}${k}`);
      else for (let i = 0; i < v.length; i++) {
        if (typeof r[i] === 'object' && r[i] !== null && !Array.isArray(r[i])) {
          // §18.T4: 객체 배열(tiers 등) — 원소별 형태 재귀
          if (typeof v[i] !== 'object' || v[i] === null) errors.push(`객체 아님: ${path}${k}[${i}]`);
          else checkShape(r[i], v[i], `${path}${k}[${i}].`, errors);
        } else if (typeof r[i] === 'string') {
          if (typeof v[i] !== 'string') errors.push(`문자열 아님: ${path}${k}[${i}]`);
        } else if (!Number.isSafeInteger(v[i])) errors.push(`정수 아님: ${path}${k}[${i}]`);
      }
    } else if (typeof r === 'object' && r !== null) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) errors.push(`객체 아님: ${path}${k}`);
      else checkShape(r, v, `${path}${k}.`, errors);
    }
  }
  for (const k of valKeys) {
    if (!(k in ref)) errors.push(`미지 키: ${path}${k}`);
  }
}

// §18.T1: 시장 정책 화이트리스트 — 필드·정수·범위 검증 (서버·시뮬 공유 단일 권위)
export const ZONEABLE = ['house', 'cafe', 'office', 'park', 'apartment', 'factory', 'mall', 'university']; // §18.T2/T3

export const POLICY_FIELDS = {
  taxPct: [5, 30],
  welfareAmount: [0, 1000],
  welfareThreshold: [0, 2000],
};
export function validatePolicy(p) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, error: '객체 필요' };
  const keys = Object.keys(p);
  if (keys.length === 0) return { ok: false, error: '변경 필드 없음' };
  for (const k of keys) {
    const range = POLICY_FIELDS[k];
    if (!range) return { ok: false, error: `허용되지 않은 필드: ${k}` };
    if (!Number.isSafeInteger(p[k]) || p[k] < range[0] || p[k] > range[1]) {
      return { ok: false, error: `${k}: ${range[0]}~${range[1]} 정수 필요` };
    }
  }
  return { ok: true };
}
