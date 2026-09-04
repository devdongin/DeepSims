// 판단 로직 파라미터 (PLAN §14.1) — 공식의 구조는 코드, 수치는 이 파라미터.
// world.logic에 전문이 직렬화되며, logic_update 입력으로만 교체된다.
import { fnv1a } from './serialize.js';

// v1 등가 + Phase 2 기본값. logic/params.json의 초기 내용이기도 하다.
export const DEFAULT_LOGIC = {
  logicSchemaVersion: 101, // Actual passenger access/flight/egress, visits and remote employment.
  founding: { petitionDays: 3, minSettlers: 2 },
  needsTiers: { fulfilledMin: 4000, deprivedMax: 1000, promoteTicks: 7200,
    demoteTicks: 720, cultureDecay: 1, cultureFun: 2000 },
  seasons: { winterHarvestPct: 50, winterFishPct: 50, winterOutdoorEnergy: 1,
    stockLeadDays: 10, stockTarget: 6, stockDeficit: 5000 },
  supply: { openingStock: 12, targetStock: 12, reorderAt: 6, keepReserve: 3, maxDelivery: 3, unitPrice: 40 },
  storyteller: { minGapDays: 2, windowDays: 7, maxEventsPerWindow: 3 },
  industryDevelopment: { workshop: 20, lab: 3000, warehouse: 300 },
  decay: { hunger: 6, energy: 4, social: 3, fun: 3 },
  ageDecay: { youngMax: 29, youngFunAdd: 2, oldMin: 60, oldEnergyAdd: 2 },
  actions: {
    seek_food_aid: { duration: 30, mealCost: 200, hungerGain: 9000 },
    study: { duration: 60, cost: 0 },
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
    escort_child_doctor: { duration: 1 },
    // §23.8 여가 확대 — 사람마다 다른 하루를 살게 하는 다섯 가지
    stroll: { duration: 30, recoverPerTick: 70, moodPerTick: 6 },
    garden: { duration: 45, recoverPerTick: 55, moodPerTick: 7, groceriesGain: 1 },
    music: { duration: 35, recoverPerTick: 90, moodPerTick: 8 },
    volunteer: { duration: 60, recoverPerTick: 90, moodPerTick: 10, repGain: 1 },
    board_game: { duration: 40, recoverPerTick: 110, moodPerTick: 6, socialPerTick: 40, cost: 100 },
    supply_groceries: { duration: 30, cost: 0 },
    grow_groceries: { duration: 120, cost: 0, groceriesGain: 3 },
    stock_food: { duration: 15, cost: 600, groceriesGain: 3 },
    visit_culture: { duration: 40, cost: 100 },
    settle_village: { duration: 1 },
  },
  occupations: {
    office_worker: { workStart: 540, workEnd: 1080, wagePct: 100, startMoney: 1000, flex: true },
    barista: { workStart: 420, workEnd: 960, wagePct: 90, startMoney: 1000, weekendWork: true }, // 카페는 주말도 연다
    freelancer: { workStart: 300, workEnd: 1260, wagePct: 80, startMoney: 1000, flex: true, weekendWork: true },
    student: { workStart: 540, workEnd: 900, wagePct: 0, startMoney: 500 },
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
    // §21.3 민간 서비스 — 손님이 있는 시설에서 일한다. 주말에도 문을 연다.
    chef: { workStart: 600, workEnd: 1260, wagePct: 100, startMoney: 1000, weekendWork: true },
    // §22.2 아동기 — 일하지 않는다. 먹고 자고 놀고 어울리며 자란다.
    child: { workStart: -1, workEnd: -1, wagePct: 0, startMoney: 0 },
    clerk: { workStart: 540, workEnd: 1140, wagePct: 85, startMoney: 1000, weekendWork: true },
    jobless: { workStart: -1, workEnd: -1, wagePct: 0, startMoney: 0 },
    artisan: { workStart: 540, workEnd: 1080, wagePct: 105, startMoney: 1000 },
    researcher: { workStart: 540, workEnd: 1080, wagePct: 120, startMoney: 1200, flex: true },
    logistician: { workStart: 420, workEnd: 1020, wagePct: 100, startMoney: 1000, shift: 'rotating' },
  },
  // §17.2: 직업 → 근무 시설 타입 (work 후보는 여기서만)
  workplace: {
    office_worker: 'office', barista: 'cafe', freelancer: 'office', student: ['primary_school', 'middle_school', 'high_school', 'university'],
    retired: 'office', doctor: 'hospital', civil_servant: 'city_hall', teacher: ['primary_school','middle_school','high_school','university'],
    police: 'police_station', firefighter: 'fire_station', nurse: 'hospital', politician: 'city_hall',
    worker: 'factory', // §18.T3
    chef: 'restaurant', clerk: 'market', // §21.3
    child: 'primary_school', // 근무하지 않지만 매핑 완결성
    jobless: null,
    artisan: 'workshop', researcher: 'lab', logistician: 'warehouse',
  },
  persFactor: { socializeBase: 150, playBase: 100, workBase: 150 },
  affinity: {
    tfScaleBase: 50, argumentBase: -3000, argumentTfCoef: 20,
    argClampMin: -5000, argClampMax: -1000, deltaMin: -20, deltaSpan: 61,
  },
  mood: {
    argument: -800, lonely: -400, starving: -1000, actionCompleted: 50, moneyGain: 100,
    decayPerTick: 5, lethargyThreshold: -5000, reliefScale: 25000000, lethargyScale: 50000000,
    // §23.25 기분이 가라앉는 자리. 0이 아니라 **그 사람의 삶**이다.
    // 항 하나하나는 작다 — 어느 조건도 혼자서 사람을 행복하게 만들지 않는다.
    baseline: {
      married: 900, dating: 500,
      perFriend: 150, friendCap: 900, perRival: 200, rivalCap: 800,
      home: 300, sick: -700, jobless: -500,
      perHabit: 120, habitCap: 480,
      // §23.29 돈 (Codex 지적: 기분 바닥선에 돈이 없어 저임금자와 여유 있는 사람이 같은
      // 자리로 갔다). **잔액이 아니라 며칠 버티는가**를 본다 — 같은 1,000원도 하루치가
      // 200원인 마을과 2,000원인 마을에서 뜻이 다르다.
      dailyNeed: 600,      // 하루치 필수 지출 어림 (식사 세 번 남짓)
      broke: -600,         // 이틀치도 없다
      secure: 300,         // 열흘치 넘게 있다
      unpaid: -400,        // 임금이 사흘 넘게 밀렸다
      span: 2500, // 바닥선 자체의 상한 — 사건이 주는 진폭(±10000)을 삼키지 않게
    },
  },
  // §21.1 심 능력치 (이슈 #62). 효과는 이분법이 아니라 **가중치**다.
  abilities: {
    // 직업이 요구하는 핵심 능력. 없는 직업은 중립(50) 취급 — 능력이 무의미한 직업도 있다.
    keyAbility: {
      office_worker: 'intellect', barista: 'dexterity', freelancer: 'intellect',
      student: 'intellect', doctor: 'intellect', civil_servant: 'intellect',
      teacher: 'charisma', police: 'stamina', firefighter: 'stamina',
      chef: 'dexterity', clerk: 'charisma', // §21.3
      child: 'stamina', // §22.2 (임금이 0이라 실효 없음 — 매핑 완결성용)
      nurse: 'charisma', politician: 'charisma', worker: 'stamina',
      artisan: 'dexterity', researcher: 'intellect', logistician: 'stamina',
    },
    // 임금 진폭(%): 능력 0 → -(span/2)%, 50 → 0%, 99 → +(span/2)% 로 완만하게 갈린다.
    wageSpanPct: 40,
    // 졸업 시 적성이 높은 직업이 뽑힐 확률을 얼마나 올릴지. 풀에 중복 삽입하는 방식이라
    // **rngInt 드로우 수는 1회 그대로**다 (§17.8 계약 불변).
    aptitudePoolWeight: 300,
  },
  development: {
    geniusMin: 120, geniusMax: 150,
    birthPct: 10, adultPct: 70, matureAge: 25, ticksPerPoint: 7200,
    physicalDeclineAge: 60, mentalDeclineAge: 75, declinePctPerYear: 1, minAgePct: 40,
  },
  education: { annualTuition: 2000, degreeStudyTicks: 20000, bachelorYears: 4, mastersYears: 2, doctorateYears: 4,
    mastersStudyTicks: 10000, doctorateStudyTicks: 20000, postgraduatePctFactor: 50,
    studyDeficit: 6500, dailyStudyTicks: 240, startMinute: 540, endMinute: 900 },
  household: { independenceAge: 19, stableDays: 7, reserveMoney: 2400 },
  housing: { baseLandValue:10, proximityRadius:64, proximityPoint:2, useCap:20, usePoint:2,
    baseRent:40, landRentPct:25, bedRent:10, maxIncomePct:40, moveAfterDays:3,
    serviceTypes:['primary_school','middle_school','high_school','university','hospital','police_station','fire_station','park','library','market'] },
  // §21.2 나눔 (사용자 규칙 §0.1: 지표를 누르지 말고 행동을 준다).
  // 은퇴자는 소득이 0이라 저축을 쓰면 굶는다 — 복지 캡을 올리는 대신 '만나서 나눠주는' 행동을 준다.
  sharing: {
    needyBelow: 300,        // 이 잔고 미만이면 곤경으로 본다 (복지 문턱과 같은 눈높이)
    giverKeepMin: 1500,     // 주는 쪽이 남겨야 할 최소 — 나눔이 새 빈곤을 만들면 안 된다
    amount: 400,            // 1회 나눔 액수 (끼니 두 번)
    basePct: 5,             // 낯선 사람이라도 아주 가끔은 돕는다
    friendBonusPct: 35,     // 친구면 훨씬 잘 돕는다
    householdBonusPct: 55,  // 한집 식구가 가장 잘 돕는다
    partnerBonusPct: 45,    // 연인·배우자
  },
  // §21.3 수요가 일자리를 만든다 (이슈 #63, 사용자 규칙 §0.1).
  // §20.2 매출 원장이 드러낸 문제: restaurant·market에 손님은 오는데 근무자가 없어 돈이 고인다.
  // 시설을 더 짓는 게 아니라 **사람이 그 일을 하러 가는 행동**을 준다.
  industry: {
    openings: { restaurant: 'chef', market: 'clerk', workshop:'artisan', lab:'researcher', warehouse:'logistician' },
    minRevenueToHire: 5000,   // 손님이 이만큼은 와야 사람을 쓴다 (수요에서 파생)
    workersPerFacility: 1,
    switchPctPerApt: 40,      // 적성 100이면 하루 40% — 이분 컷이 아니라 기울기
    switchMaxPct: 40,
    minAptGain: 10,           // 지금 일보다 이만큼은 더 잘해야 옮긴다 (잦은 이직 방지)
  },
  // §22.2 사망 (사용자 지시: "능력치나 외부 요인등으로 사망하는 시나리오").
  // 이분 컷이 아니라 **위험도의 가중 합**이다 — 나이·체력·질병·굶은 시간이 함께 작용한다.
  // 단위는 10만분율(per 100k), 하루 단위 판정. riskHash라 rngSim을 소비하지 않는다.
  mortality: {
    ageFloor: 40,            // 이 나이까지는 노화로 인한 위험이 0
    ageDivisor: 750,         // (나이-ageFloor)³ / 이 값 = 일일 노화 위험
                             //   50세 ≈ 0.16%/년, 60세 ≈ 1.3%/년, 90세 ≈ 20%/년
    starveGraceTicks: 2880,  // 굶은 채 이만큼(게임 2일)은 버틴다
    starvePer100kPer100Ticks: 3, // 그 뒤로는 굶은 시간에 비례해 위험이 붙는다
    sickMultPct: 250,        // 아프면 노화 위험 2.5배
    sickFlat: 4,             // 아프면 나이와 무관하게 붙는 기본 위험
    staminaSpanPct: 80,      // 체력 0 → +40%, 50 → 0%, 99 → -39% (기울기, 이분 컷 아님)
    maxPer100k: 3000,        // 하루 3% 상한 — 아무리 나빠도 즉사하지는 않는다
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
      new_neighbor: 3, club_joined: 4, heroic: 8, celebration: 7, milestone: 7, unmet: 6,
      welfare: 6, // §22.20 정부가 나를 도왔다 — 회고 투표의 재료
      helped: 5, was_helped: 6, // §22.21 이웃을 챙겼다 / 이웃이 나를 챙겼다
      governed: 4 }, // §22.22 정책을 조정했다 — 시장 자신의 통치 기록
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
    // §22.6 먼저 말 걸기 (이슈 #69). 지금 사교는 **수동**이다 — 같은 시설에서 socialize 중인
    // 심끼리 id 순으로 자동 페어링될 뿐이라, 옆에서 밥 먹는 사람은 영원히 남이다.
    // 혼자 남은 심이 **먼저 다가가 청한다**. 거절도 결과다 — 수치를 직접 깎지 않는다(§0.1).
    approachBasePct: 20,              // 낯선 사람도 가끔은 응한다
    approachFriendBonusPct: 45,       // 친구면 훨씬 잘 응한다
    approachAcquaintanceBonusPct: 20,
    approachNeedBonusMax: 25,         // 상대도 사교가 고플수록 잘 응한다 (결핍 비례, 이분 컷 아님)
    inviteTtlTicks: 240,              // 청을 받아들이면 이만큼 그 자리로 마음이 기운다 (4시간)
    invitePullPct: 120,               // 초대받은 곳의 사교 점수 가중 (%) — §20.3과 같은 곱셈 축
    // §22.14 동석 대화 (로드맵 P1, #69 확장). 헛걸음 199건 표본 중 **46.7%는 같은 시설에
    // 다른 심이 있었는데도 혼자 돌아왔다** — 시간 문제가 아니라 말을 안 트는 문제였다.
    // 청을 받아들인 사람이 하던 일을 바꾸지 않은 채 옆에서 말을 튼다. 식사·근무가
    // 끊기지 않으므로 경제·허기에 부작용이 없다. 정면 페어링보다 약하게 친다 —
    // 곁다리 대화가 마주 앉은 대화와 같으면 '아무나 붙잡기'가 최적 전략이 된다.
    sideTalkFactorPct: 30,            // 곁다리 대화의 사교 회복 강도 (정면 대비 %)
    // §22.21 먼저 돕기 (이슈 #69, 로드맵 P1). 혼자 남은 심이 말을 걸었는데 상대가
    // **곤경**(아픔·허기 위급·복지 문턱 미만)이면, 수다가 아니라 챙김이 된다.
    // KIND Challenge RCT(4,284명, CC BY)의 핵심은 **주는 쪽의 외로움이 준다**는 것 —
    // 그래서 회복 보정이 받는 쪽이 아니라 주는 쪽에 붙는다. 받는 쪽은 고마움을
    // 기억하고(was_helped) 호감이 한쪽 방향으로만 오른다 — 주는 쪽 호감은 그대로라
    // '아무나 붙잡고 돕기'가 사교 최적 전략이 되지 않는다.
    helpAcceptBonusPct: 25,           // 곤경일 때 승낙 확률 가산 (사람은 챙김을 더 잘 받는다)
    helpGiverSocialPct: 100,          // 주는 쪽 사교 회복 (정면 대비 %) — 곁다리(30)보다 크다
    helpGratitudeAffinity: 300,       // 받는 쪽 → 주는 쪽 호감 (한 방향)
    helpMoodGiver: 40,                // 챙긴 쪽 기분
    helpMoodTaker: 60,                // 챙김 받은 쪽 기분
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
    laborRequired: 600,  // 완공까지 누적 수행 틱 — requiredByType에 없는 타입의 폴백
    // §22.23 건물은 단숨에 지어지지 않는다 (사용자 지시). 실측으로 집 한 채가 게임
    // 10~24시간(×48 관람 0.2~0.5분)에 완공됐다 — required 540이 전 타입 동일했기 때문.
    // 현장은 이미 작업 스팟 4개로 동시 인원이 제한되므로(§16.5.B), 타입·규모별로
    // 노동량을 차등해 공기(工期)를 만든다. 목표: 집 ~7게임일, 대형 ~20게임일.
    // 진행 중 프로젝트는 시작 때 스냅샷한 required를 그대로 쓴다 — 소급하지 않는다(118차 D).
    requiredByType: {
      park: 3000, house: 5000,
      cafe: 6000, restaurant: 6000, market: 6000, bar: 6000,
      office: 8000, school: 8000, gym: 8000, library: 8000,
      primary_school: 8000, middle_school: 10000, high_school: 12000,
      hospital: 10000, city_hall: 10000, police_station: 10000, fire_station: 10000, cinema: 10000,
      apartment: 14000, mall: 14000,
      university: 20000, factory: 20000, workshop:10000, lab:16000, warehouse:14000, train_station:20000, airport:60000,
    },
    deficit: 4000,       // needValue = NEED_MAX - deficit (고정 급함)
    persJDiv: 4,         // persFactor = 100 + floorDiv(100 - JP, persJDiv)
    cafeRatio: 2,        // 심 수 > 좌석합×ratio → cafe 프로젝트
    parkRatio: 1,        // 심 수 > 스팟합×ratio → park 프로젝트
    noPathCoolTicks: 240,     // §17.23 no_path 재시도 쿨다운 (4시간)
  },
  // §17 사회 (logicSchemaVersion 9)
  society: {
    immigrationIntervalDays: 3,
    // §23.36 한 해를 120일 → 40일로. 사용자 지적: "1년이 너무 길어서 마을 성장이나 변화가
    // 느리다." 맞았다. 90일을 굴려도 **은퇴가 한 번도 안 일어나고** 졸업이 0.9회였다 —
    // 관측 창 안에서 생애가 한 칸도 못 움직인다.
    //
    // 8시드 × 90일 스윕 (생애사건 = 졸업+결혼+출생+은퇴+사망+성장, 100일당):
    //   120일  26.2 ± 2.8   졸업 0.9  은퇴  0.0   ← 지금까지
    //    60일  36.3 ± 3.6   졸업 1.5  은퇴  8.6
    //    40일  41.9 ± 4.6   졸업 2.0  은퇴 11.1   ← 채택 (+60%)
    //    30일  48.5 ± 5.6   졸업 5.5  은퇴 13.5   (+85%지만 졸업이 6배 — 직업이 너무 자주 바뀐다)
    //    20일  42.1 ± 5.6
    // 인구는 103~110으로 **전부 표본 편차 안**이고 평균 나이도 41.8~43.9로 평평하다 —
    // 성장을 깎지 않고 변화만 늘린다. 30일이 수치는 높지만 졸업이 6배로 뛰어 경력이
    // 의미를 잃는다. 40일은 계절이 10일이라 사계가 한눈에 돌고, 19→65세 한 경력이
    // 1,840일이라 한 세대가 관측 가능한 시간 안에 완결된다.
    yearDays: 40,            // §17.9 새해 주기 (전원 age+1)
    schoolAge: 7,
    graduateAge: 23,
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
    detourMinExtra: 8,
    detourRatioPct: 150,
    detourRepeat: 3,
    longTripMin: 40,      // 이 칸수 이상이면 '장거리' 1회 (출발 시점 누적)
    carTripsMin: 12,      // 자가용 구매 문턱
    carPrice: 6000,       // 실측 조정: 잔고 상한 ~9.8천 (soak 검증, 64차 (c))
    carSpeedTiles: 2,     // 틱당 최대 전진 칸수 (순서대로)
    stationDemand: 300,   // 가중 이동 수요 문턱 — 기차역 언락 (§19.12, 이슈 #52)
    // §19.12 언락 판정 가중치. 수요 = floorDiv(가중 longTrips × 거리 계수, 100).
    // 차 보유 심의 장거리 이동은 이미 수단이 있으므로 할인해 센다(0이 아닌 이유:
    // 4단계 모델의 수단 선택 — 철도는 자가용과 경쟁하지 소멸시키지 않는다).
    // 평균 장거리 칸수가 longTripMin을 크게 넘으면 철도의 경쟁 구간이라 가중한다.
    // Duranton & Turner 제약: 여기서는 수요를 **측정**하고 언락만 한다 — 역이 혼잡을
    // 풀어준다고 가정하지 않는다(유발 수요 계측은 #48 동반 과제).
    stationCarOwnerPct: 50,   // 차 보유 심의 longTrips 반영률 %
    stationDistBoostMin: 60,  // 평균 장거리 칸수가 이 이상이면 수요 가중
    stationDistBoostPct: 25,  // 그때 가중 % (100 + 이 값이 계수가 된다)
    railSpeedTiles: 4, railDwellTicks: 10, railCapacity: 8,
    airportTripsMin:12, airSpeedTiles:8, airDwellTicks:10, airTransferTicks:10, airCapacity:8,
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
    costs: { house: 2000, cafe: 3000, office: 3000, park: 1000, apartment: 6000, factory: 8000, mall: 8000, university: 10000, primary_school: 4000, middle_school: 5000, high_school: 6000, workshop:6000, lab:9000, warehouse:8000, train_station:8000, airport:30000 },
    demolitionCostPerTile: 200,
    plannedCenterCost: 5000,
    centerRadius: 32,
    centerMinResidents: 4,
  },
  // §17.21 도시 성장 드라이브: 행동 이벤트 → 평판 → 이민 웨이브 + 선제·일자리 건설
  growth: {
    headroomBeds: 2,        // 빈 침대가 이보다 적으면 선제 house 프로젝트
    repMarried: 40, repFestival: 30, repBuilt: 25, repChild: 30, repElection: 10, repGathering: 2,
    repCap: 500, repDecayPct: 95, // 일일 ×95% 감쇠
    immigPerExtra: 80, immigWaveMax: 3, // 웨이브 = 1 + floor(평판/80), 캡
    slotPerTreasury: 150000, // §19.3 국고 15만당 동시 건설 슬롯 +1 (돈이 시공 능력을 만든다)
    // §23.26 동시 착공 상한. 3이면 국고 45만을 넘는 순간부터 **돈이 아무것도 사지 않는다**
    // (Codex 지적: 1.4~1.9M 국고가 경제에 연결되지 않은 저수지). 라이브 마을은 국고 600만에
    // 침대가 18개 모자란 상태로 멈춰 있었다 — 살 돈이 있는데 집이 없다.
    // 상한을 올린다고 억지로 짓지는 않는다: 슬롯은 수요(neededSchool·침대 부족·책상 부족)가
    // 있을 때만 채워지고, 실제 진척은 심들이 construct에 쓰는 노동이 정한다.
    maxProjectSlots: 6,      // 동시 착공 상한
  },
  // §17.15 경제 순환: 소득세 → 국고 → 복지·시장 수당 (Lengnick baseline 차용, 드로우 0회)
  economy: {
    healthCopayPct: 100,    // 진료 자기부담률; 나머지는 현재 국고 범위 내 병원 이전
    childAllowance: 0,      // 아이당 일일 가구 지원금; 기본 비활성, 임금 아님
    taxPct: 15,             // 임금 원천징수율
    welfareThreshold: 300,  // 이 잔고 미만이면 복지 대상
    welfareAmount: 200,     // 1회 지급액
    welfareDailyCap: 5,     // 하루 최대 수급자 수 (필요도 순 — §20.1)
    // §20.2 임금이 '일한 시설의 매출'에서 나오는 민간 서비스 직군 (화이트리스트).
    // 여기 없는 직군은 기반 부문(외부 소득)·공공 부문으로 보고 기존대로 지급한다.
    privateWageOccupations: ['barista', 'chef', 'clerk'],
    // §22.4 (이슈 #43, 대목표 G1) 공공 부문 회계를 닫는다.
    // 시민이 병원·시청·학교에 낸 돈이 시설 원장에 고이기만 했다 — 라이브에서 hospital 매출이
    // 전체의 70%를 빨아들였다. 그 매출을 국고로 보내고, 공공 임금을 국고에서 지급한다.
    // 그러면 소비 → 국고 → 공공 임금 → 시민 → 소비 고리가 닫힌다.
    publicFacilityTypes: ['hospital', 'city_hall', 'school', 'primary_school','middle_school','high_school','university', 'police_station', 'fire_station'],
    publicWageOccupations: ['doctor', 'nurse', 'teacher', 'civil_servant', 'politician', 'police', 'firefighter'],
    // §23.13 공공 정원 — minPop 미만이면 그런 자리가 아예 없고, 있으면 인구 per명당 1자리.
    // 열 명 마을에 파출소도 소방서도 없는 것이 정상이다. 도시가 자라면 자리도 는다.
    // §23.17 연간 감축률(%) — 초과 공공직을 해마다 이 비율만큼 줄인다. 100이면 즉시,
    // 1이면 사실상 방치다. 25%면 초과 50명이 약 10년에 걸쳐 정리된다.
    publicTrimRatePct: 25,
    publicPosts: {
      civil_servant: { minPop: 0, per: 50 },
      teacher: { minPop: 14, per: 35 },
      doctor: { minPop: 18, per: 60 },
      police: { minPop: 20, per: 50 },
      nurse: { minPop: 30, per: 50 },
      firefighter: { minPop: 30, per: 70 },
      politician: { minPop: 12, per: 150 },
    },
    // §22.23 공공 임금 완전 보장 (사용자 지시: "공무원도 예외없이 일을 하면 반드시
    // 돈을 줘야 되고 공무원이면 국고에서 월급이 지급되어야 해"). 국고가 모자라면
    // 음수(공채)로 내려간다. maxDebt는 게임 장치가 아니라 **오버플로 가드**다 —
    // 여기 걸리면 insolvent 이벤트가 나고 그때만 부분 지급이 된다.
    maxDebt: 1000000000000, // 1e12
    // §22.78 마을은 빈손으로 시작하지 않는다 (사용자 지시: "초기국고는 0원이 아니고
    // 2000원정도는 있어야돼"). 예전엔 0이라 **첫날 첫 공공 임금부터 곧장 적자**였다
    // (실측: 5시드 전부 day 0, tick 281~842에 첫 treasury_debt).
    // 이건 지표를 누르는 게 아니라 **시작 조건**이다 — 적자 구조 자체는 그대로이고,
    // 마을이 첫 급여를 낼 정도의 종잣돈만 갖고 출발한다.
    initialTreasury: 2000,
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
    // §23.24 앓고 난 뒤의 면역 기간. 이게 없으면 모델에 '회복' 칸이 없어(감염↔건강만 있는
    // SIS 구조) 유병률이 구조적으로 높은 값에 고정된다 — 실측 46~47%, 90일에 1인당 19번.
    // 사람이 닷새에 한 번 앓는 마을은 관찰할 만한 마을이 아니다.
    // 값은 실측으로 골랐다 (90일 × 2시드, 유병률 / 90일 발병 수):
    //   0일 46~47% / 2,161~2,447   ← 지금까지. 사람이 닷새에 한 번 앓는다
    //   2일 12~23% /   649~673     ← 채택. 17일에 한 번 앓는다
    //   3일  0~15% /   381~402     ← 한 시드에서 병이 아예 사라진다
    //   5일  0~10% /   177~337
    // 3일 이상은 전염이 스스로 꺼져 병원·의사·see_doctor가 통째로 죽은 콘텐츠가 된다.
    // 병을 없애는 게 목적이 아니라 **감기가 감기답게** 도는 게 목적이다.
    immuneTicks: 2880,       // 2일 — 앓는 기간(3일)보다 짧다
    decayFactorNum: 1,       // 감쇠 가산 d += floorDiv(d × num, den) → +50%
    decayFactorDen: 2,
    doctorDeficit: 8500,     // see_doctor needValue = NEED_MAX - deficit (아플 때 최우선급)
  },
  // §22.22 시장의 재정 행동 — Bohn 1998 재정 반응 함수, Downs 1957 관직 추구,
  // Nordhaus 1975·Rogoff 1990 정치적 예산 순환. 시장은 §22.20의 hoardRatioPct와
  // 같은 조건을 보고 POLICY_FIELDS 범위 안에서 한 걸음씩 움직인다.
  fiscal: {
    reviewIntervalDays: 5,   // 15일 임기에 조정 기회 2~3회
    stepTaxPct: 3,           // 세율 한 걸음 (%p)
    stepWelfare: 100,        // 복지 금액·문턱 한 걸음
    lowRatioPct: 10,         // 국고 < 시민총현금 × 10% → 재정 위험(긴축)
  },
  // §22.26 공공사업 (사용자 지시: "도로나 광장등은 정부에서 국고를 써서…
  // 국고가 충분할 때 마을을 성장시키기 위한 도구"). 첫 슬라이스는 도로 포장 —
  // 사람들이 이미 걷어 마모가 쌓인 자리(desire path)를 정부가 앞당겨 포장한다.
  // 수요를 창조하지 않고 창발을 증폭한다(§0.1). 광장은 후속 슬라이스(120차 B).
  publicWorks: {
    bridgeCostPerTile: 500,
    routeWorkDays: 2,
    paveCostPerTile: 250,   // 칸당 포장비 — 국고에서 externalOutflow로 (자재는 마을 밖에서 산다)
    paveMaxPerDay: 8,       // 리뷰당 상한 — 마을이 하루 만에 확 바뀌지 않게
    pavePickPct: 50,        // wear가 자연 도로화 임계의 이 % 이상인 칸만 후보
  },
  election: {
    intervalDays: 15,
    mayorLaborPct: 90,       // 시장 재임 중 시작되는 프로젝트 노동량 ×90%
    mayorStipend: 200,       // 일일 수당
    campaignPull: 140,       // §17.9 유세: 후보의 socialize planFactor
    campaignDays: 3,         // 선거 D-3부터
    // §22.20 회고 투표 (사용자 지시). 지금까지 투표는 **순수 인기투표**였다 —
    // 유권자가 두 후보 중 자기가 더 좋아하는 쪽을 고를 뿐, 재임자가 무엇을 했는지는
    // 표에 전혀 안 들어갔다. 사람은 그렇게 투표하지 않는다.
    // 유권자가 **지난 임기에 자기가 겪은 일**로 재임자를 심판하게 한다
    // (Key 1966, Fiorina 1981의 회고 투표). 새 난수를 뽑지 않고 각자의 기억만 읽는다.
    judgeStarving: 3,        // 지난 임기에 굶었다 (1건당 재임자 감점)
    judgeNoMoney: 2,         // 돈이 없어 하려던 걸 못 했다
    judgeWelfare: 3,         // 정부가 나를 도왔다 (가점)
    // "나라에 돈이 있는데 나는 굶었다"는 더 화나는 일이다 — 돈이 없어서가 아니라
    // **안 쓴 것**이기 때문이다. 국고가 시민 전체 현금보다 많으면 원망이 커진다.
    // 절대 금액 문턱을 쓰지 않는다: 마을 규모가 커져도 뜻이 유지되는 비교다.
    hoardRatioPct: 100,      // 국고 > 시민 총현금 × 이 비율(%)이면 '쌓아두고 있다'
    hoardMultPct: 200,       // 그때 불만이 이 비율로 커진다
    retroCap: 40,            // 회고 점수 상한 — 인기 요소를 완전히 지워버리지 않는다
  },
  romance: {
    // §23.34 나이 조건. 여태 한 줄도 없어서 **15세가 65세와 결혼했다** (시드1 실측 커플:
    // [15,65,married] [15,43] [16,50] [27,85], 10시드 192커플 중앙 나이차 12~22세, 최대 69세).
    // 사람은 그렇게 짝을 짓지 않는다. 하한은 성인, 격차는 "젊은 쪽 나이의 절반 + 7" —
    // 통용되는 어림이고, 20세에 17세, 40세에 27세, 60세에 37세까지를 허용한다.
    minRomanceAge: 19,
    ageGapBase: 7,     // 허용 격차 = 젊은 쪽/2 + 이 값
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
  if ((oldLogic?.logicSchemaVersion ?? 1) < 50) {
    // Array merging normally preserves tuning. The old school type no longer exists,
    // so translate references rather than leaving teachers without a workplace.
    for (const [occupation, places] of Object.entries(merged.workplace)) {
      if (places === null) continue;
      const translated = [].concat(places).flatMap(type => type === 'school'
        ? (occupation === 'child' ? ['primary_school'] : ['primary_school', 'middle_school', 'high_school']) : [type]);
      merged.workplace[occupation] = Array.isArray(places) || translated.length > 1 ? translated : translated[0];
    }
    merged.economy.publicFacilityTypes = [...new Set([...merged.economy.publicFacilityTypes,
      'primary_school', 'middle_school', 'high_school', 'university'])];
    merged.occupations.student.wagePct = 0;
    merged.society.schoolAge = 7;
    merged.society.graduateAge = 23;
  }
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
  // 내구 입력 로그 비대화 방지용 상한. 세계가 시스템을 얻을 때마다 파라미터가 자라므로
  // (§21.2 나눔 추가 시점에 8,286 bytes로 8KB를 넘었다) 한도를 16KB로 올린다.
  // 이건 세계의 지표가 아니라 저장 계약의 상한이라 §0.1(지표를 누르지 않는다)의 대상이 아니다.
  // 로직 파일은 사람이 읽고 고치는 노브 모음이지 대용량 데이터가 아니므로 16KB면 충분히 넉넉하다.
  if (Buffer.byteLength(json, 'utf8') > 16384) errors.push('params 전문 > 16KB');
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
  inRange('actions.seek_food_aid.mealCost', p.actions.seek_food_aid.mealCost, 1, 1000000);
  inRange('actions.seek_food_aid.hungerGain', p.actions.seek_food_aid.hungerGain, 1, 10000);
  for (const [type, value] of Object.entries(p.industryDevelopment)) inRange(`industryDevelopment.${type}`, value, 1, 1000000000);
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
  for (const k of ['approachBasePct', 'approachFriendBonusPct', 'approachAcquaintanceBonusPct', 'approachNeedBonusMax']) {
    inRange(`social.${k}`, p.social[k], 0, 100);
  }
  inRange('social.inviteTtlTicks', p.social.inviteTtlTicks, 0, 100000);
  inRange('social.sideTalkFactorPct', p.social.sideTalkFactorPct, 0, 100);
  inRange('social.helpAcceptBonusPct', p.social.helpAcceptBonusPct, 0, 100);
  inRange('social.helpGiverSocialPct', p.social.helpGiverSocialPct, 0, 300);
  inRange('social.helpGratitudeAffinity', p.social.helpGratitudeAffinity, 0, 5000);
  inRange('social.helpMoodGiver', p.social.helpMoodGiver, 0, 1000);
  inRange('social.helpMoodTaker', p.social.helpMoodTaker, 0, 1000);
  inRange('social.invitePullPct', p.social.invitePullPct, 0, 500);
  inRange('abilities.wageSpanPct', p.abilities.wageSpanPct, 0, 200);
  inRange('development.birthPct', p.development.birthPct, 0, 100);
  inRange('education.annualTuition', p.education.annualTuition, 0, 1000000);
  inRange('education.degreeStudyTicks', p.education.degreeStudyTicks, 1, 10000000);
  for (const k of ['bachelorYears','mastersYears','doctorateYears']) inRange(`education.${k}`,p.education[k],1,20);
  for (const k of ['mastersStudyTicks','doctorateStudyTicks']) inRange(`education.${k}`,p.education[k],1,10000000);
  inRange('education.postgraduatePctFactor',p.education.postgraduatePctFactor,0,100);
  inRange('education.studyDeficit', p.education.studyDeficit, 1, 10000);
  inRange('education.dailyStudyTicks', p.education.dailyStudyTicks, 1, 1440);
  inRange('education.startMinute', p.education.startMinute, 0, 1439);
  inRange('education.endMinute', p.education.endMinute, p.education.startMinute + 1, 1440);
  inRange('development.geniusMin', p.development.geniusMin, 100, 150);
  inRange('development.geniusMax', p.development.geniusMax, p.development.geniusMin, 150);
  inRange('development.adultPct', p.development.adultPct, p.development.birthPct, 100);
  inRange('development.matureAge', p.development.matureAge, 1, 100);
  inRange('development.ticksPerPoint', p.development.ticksPerPoint, 1, 1000000);
  inRange('development.physicalDeclineAge', p.development.physicalDeclineAge, p.development.matureAge, 150);
  inRange('development.mentalDeclineAge', p.development.mentalDeclineAge, p.development.matureAge, 150);
  inRange('development.declinePctPerYear', p.development.declinePctPerYear, 0, 10);
  inRange('development.minAgePct', p.development.minAgePct, 0, 100);
  inRange('sharing.needyBelow', p.sharing.needyBelow, 0, 100000);
  inRange('sharing.giverKeepMin', p.sharing.giverKeepMin, 0, 1000000);
  inRange('sharing.amount', p.sharing.amount, 0, 100000);
  for (const k of ['basePct', 'friendBonusPct', 'householdBonusPct', 'partnerBonusPct']) {
    inRange(`sharing.${k}`, p.sharing[k], 0, 100);
  }
  inRange('industry.minRevenueToHire', p.industry.minRevenueToHire, 0, 10000000);
  inRange('industry.workersPerFacility', p.industry.workersPerFacility, 0, 100);
  inRange('industry.switchPctPerApt', p.industry.switchPctPerApt, 0, 100);
  inRange('industry.switchMaxPct', p.industry.switchMaxPct, 0, 100);
  inRange('industry.minAptGain', p.industry.minAptGain, 0, 100);
  // §21.3 (86차 ②) 교차 검증: 일자리를 여는 직업은 반드시
  //   ① 존재하는 직업이고 ② 그 시설에서 매출로 임금을 받으며 ③ 근무지 매핑이 일치해야 한다.
  // 하나라도 어긋나면 '손님은 있는데 임금이 안 나오는' 조용한 고장이 된다.
  // §22.4 공공 임금 직군은 민간 임금 화이트리스트와 겹치면 안 된다 — 재원이 둘로 갈린다
  // §23.13 공공 정원표 검증 — 임금 직군과 어긋나면 '정원은 없는데 국고가 임금을 대는'
  // 자리가 생긴다. 표에 없는 공공 직군은 정원 무제한이 되므로 조용히 새는 구멍이 된다.
  const posts = p.economy.publicPosts ?? {};
  // §23.14 공공 임금 직군인데 정원표에 없으면 정원이 Infinity가 된다 — 조용히 새는
  // 구멍이다(Codex 지적). 직군을 늘릴 때 정원도 같이 정하도록 여기서 막는다.
  for (const occ of p.economy.publicWageOccupations) {
    if (!(occ in posts)) errors.push(`economy.publicPosts: ${occ}의 정원이 없다 (정원 없는 공공직은 국고를 무제한으로 쓴다)`);
  }
  for (const [occ, spec] of Object.entries(posts)) {
    if (!p.economy.publicWageOccupations.includes(occ)) {
      errors.push(`economy.publicPosts: ${occ}는 공공 임금 직군이 아니다`);
    }
    if (!Number.isSafeInteger(spec.minPop) || spec.minPop < 0) errors.push(`economy.publicPosts.${occ}.minPop 범위 오류`);
    if (!Number.isSafeInteger(spec.per) || spec.per < 1) errors.push(`economy.publicPosts.${occ}.per 범위 오류`);
  }
  for (const occ of p.economy.publicWageOccupations) {
    if (!(occ in p.occupations)) errors.push(`economy.publicWageOccupations: 알 수 없는 직업 ${occ}`);
    if (p.economy.privateWageOccupations.includes(occ)) {
      errors.push(`economy: ${occ}가 공공·민간 임금 양쪽에 있다 (재원이 모호해진다)`);
    }
    // §22.4 (93차 ⑤) 공공 임금 직군의 근무지는 공공 시설이어야 한다.
    // 어긋나면 '민간 시설에서 일하는데 국고가 임금을 대는' 모순이 된다.
    const wp = p.workplace[occ];
    const places = Array.isArray(wp) ? wp : [wp];
    if (!places.some((f) => p.economy.publicFacilityTypes.includes(f))) {
      errors.push(`economy.publicWageOccupations: ${occ}의 근무지(${places.join('|')})가 공공 시설이 아니다`);
    }
  }
  for (const [facType, occ] of Object.entries(p.industry.openings)) {
    if (!(occ in p.occupations)) {
      errors.push(`industry.openings.${facType}: 알 수 없는 직업 ${occ}`);
      continue;
    }
    if (!['workshop','lab','warehouse'].includes(facType) && !p.economy.privateWageOccupations.includes(occ)) {
      errors.push(`industry.openings.${facType}: ${occ}는 economy.privateWageOccupations에 있어야 함 (매출에서 임금이 나온다)`);
    }
    if (p.workplace[occ] !== facType) {
      errors.push(`industry.openings.${facType}: workplace.${occ}=${p.workplace[occ]} 가 시설 타입과 불일치`);
    }
  }
  inRange('abilities.aptitudePoolWeight', p.abilities.aptitudePoolWeight, 0, 2000);
  inRange('economy.publicTrimRatePct', p.economy.publicTrimRatePct, 1, 100);
  for (const [o, k] of Object.entries(p.abilities.keyAbility)) {
    if (!(o in p.occupations)) errors.push(`abilities.keyAbility: 알 수 없는 직업 ${o}`);
    if (!['stamina', 'dexterity', 'intellect', 'charisma'].includes(k)) {
      errors.push(`abilities.keyAbility.${o}: 알 수 없는 능력 ${k}`);
    }
  }
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
  inRange('zone.plannedCenterCost', p.zone.plannedCenterCost, 0, 100000000);
  inRange('zone.centerRadius', p.zone.centerRadius, 1, 1024);
  inRange('zone.centerMinResidents', p.zone.centerMinResidents, 1, 100000);
  inRange('actions.construct.duration', p.actions.construct.duration, 1, 10000);
  // 119차 후속: MAX_SAFE_INTEGER까지 열면 차감 연산이 안전 정수를 벗어날 수 있다
  inRange('economy.maxDebt', p.economy.maxDebt, 0, 1e15);
  inRange('economy.initialTreasury', p.economy.initialTreasury, 0, 1e9);
  for (const [ft, req] of Object.entries(p.construct.requiredByType)) {
    inRange(`construct.requiredByType.${ft}`, req, 1, 10000000);
  }
  inRange('construct.laborRequired', p.construct.laborRequired, 1, 1000000);
  inRange('construct.deficit', p.construct.deficit, 0, 10000);
  inRange('construct.persJDiv', p.construct.persJDiv, 1, 100);
  inRange('construct.cafeRatio', p.construct.cafeRatio, 1, 100);
  inRange('construct.parkRatio', p.construct.parkRatio, 1, 100);
  // §17
  inRange('actions.see_doctor.duration', p.actions.see_doctor.duration, 1, 10000);
  inRange('actions.see_doctor.cost', p.actions.see_doctor.cost, 0, 1000000);
  inRange('actions.escort_child_doctor.duration', p.actions.escort_child_doctor.duration, 1, 10000);
  for (const [o, w] of Object.entries(p.workplace)) {
    if (o === 'jobless' && w === null) continue;
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
  inRange('zone.demolitionCostPerTile', p.zone.demolitionCostPerTile, 0, 1000000);
  inRange('pollution.repPerFactoryPerDay', p.pollution.repPerFactoryPerDay, 0, 10000);
  inRange('complaints.cap', p.complaints.cap, 1, 10000);
  inRange('complaints.lonelyMin', p.complaints.lonelyMin, 1, 1000);
  inRange('complaints.petitionPct', p.complaints.petitionPct, 1, 1000);
  inRange('complaints.petitionRepPenalty', p.complaints.petitionRepPenalty, 0, 10000);
  inRange('complaints.decayPct', p.complaints.decayPct, 1, 100);
  inRange('complaints.windowDays', p.complaints.windowDays, 1, 365);
  inRange('transport.longTripMin', p.transport.longTripMin, 1, 10000);
  inRange('transport.detourMinExtra', p.transport.detourMinExtra, 1, 10000);
  inRange('transport.detourRatioPct', p.transport.detourRatioPct, 101, 10000);
  inRange('transport.detourRepeat', p.transport.detourRepeat, 2, 1000);
  inRange('transport.carTripsMin', p.transport.carTripsMin, 1, 100000);
  inRange('transport.carPrice', p.transport.carPrice, 0, 10000000);
  inRange('transport.carSpeedTiles', p.transport.carSpeedTiles, 1, 8);
  inRange('transport.stationDemand', p.transport.stationDemand, 1, 1000000);
  // §19.12: 반영률은 0~100%(할인만 허용 — 100 초과면 차가 수요를 부풀린다),
  // 거리 가중은 0~1000%로 묶어 fulfillmentPct 오버플로를 막는다.
  inRange('transport.stationCarOwnerPct', p.transport.stationCarOwnerPct, 0, 100);
  inRange('transport.stationDistBoostMin', p.transport.stationDistBoostMin, 1, 10000);
  inRange('transport.stationDistBoostPct', p.transport.stationDistBoostPct, 0, 1000);
  inRange('transport.railSpeedTiles', p.transport.railSpeedTiles, 1, 8);
  inRange('transport.railDwellTicks', p.transport.railDwellTicks, 1, 120);
  inRange('transport.railCapacity', p.transport.railCapacity, 1, 64);
  inRange('transport.airportTripsMin', p.transport.airportTripsMin, 1, 1000000);
  inRange('transport.airSpeedTiles', p.transport.airSpeedTiles, 1, 64);
  inRange('transport.airDwellTicks', p.transport.airDwellTicks, 1, 120);
  inRange('transport.airTransferTicks', p.transport.airTransferTicks, 1, 120);
  inRange('transport.airCapacity', p.transport.airCapacity, 1, 64);
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
  inRange('economy.healthCopayPct', p.economy.healthCopayPct, 0, 100);
  inRange('economy.childAllowance', p.economy.childAllowance, 0, 1000);
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
  inRange('society.schoolAge', p.society.schoolAge, 0, 90);
  inRange('mortality.ageFloor', p.mortality.ageFloor, 0, 120);
  inRange('mortality.ageDivisor', p.mortality.ageDivisor, 1, 10000000);
  inRange('mortality.starveGraceTicks', p.mortality.starveGraceTicks, 0, 10000000);
  inRange('mortality.starvePer100kPer100Ticks', p.mortality.starvePer100kPer100Ticks, 0, 100000);
  inRange('mortality.sickMultPct', p.mortality.sickMultPct, 100, 10000);
  inRange('mortality.sickFlat', p.mortality.sickFlat, 0, 100000);
  inRange('mortality.staminaSpanPct', p.mortality.staminaSpanPct, 0, 200);
  inRange('mortality.maxPer100k', p.mortality.maxPer100k, 0, 100000);
  inRange('society.retireAge', p.society.retireAge, 15, 91);
  inRange('society.festivalDays', p.society.festivalDays, 7, 100000);
  inRange('family.childPermille', p.family.childPermille, 0, 1000);
  inRange('family.familyBonus', p.family.familyBonus, 0, 1000);
  inRange('household.independenceAge', p.household.independenceAge, 19, 100);
  inRange('household.stableDays', p.household.stableDays, 1, 3650);
  inRange('storyteller.minGapDays', p.storyteller.minGapDays, 1, 120);
  inRange('storyteller.windowDays', p.storyteller.windowDays, 1, 120);
  inRange('storyteller.maxEventsPerWindow', p.storyteller.maxEventsPerWindow, 1, 120);
  inRange('supply.openingStock', p.supply.openingStock, 0, 10000);
  inRange('supply.targetStock', p.supply.targetStock, 1, 10000);
  inRange('supply.reorderAt', p.supply.reorderAt, 0, p.supply.targetStock - 1);
  inRange('supply.keepReserve', p.supply.keepReserve, 0, 100);
  inRange('supply.maxDelivery', p.supply.maxDelivery, 1, 100);
  inRange('supply.unitPrice', p.supply.unitPrice, 1, 1000000);
  inRange('seasons.winterHarvestPct', p.seasons.winterHarvestPct, 0, 100);
  inRange('needsTiers.fulfilledMin', p.needsTiers.fulfilledMin, 1, 10000);
  inRange('founding.petitionDays', p.founding.petitionDays, 1, 3650);
  inRange('founding.minSettlers', p.founding.minSettlers, 1, 100000);
  inRange('needsTiers.deprivedMax', p.needsTiers.deprivedMax, 0, p.needsTiers.fulfilledMin);
  inRange('needsTiers.promoteTicks', p.needsTiers.promoteTicks, 1, 10000000);
  inRange('needsTiers.demoteTicks', p.needsTiers.demoteTicks, 1, 10000000);
  inRange('needsTiers.cultureDecay', p.needsTiers.cultureDecay, 0, 10000);
  inRange('needsTiers.cultureFun', p.needsTiers.cultureFun, 0, 10000);
  inRange('seasons.winterFishPct', p.seasons.winterFishPct, 0, 100);
  inRange('seasons.winterOutdoorEnergy', p.seasons.winterOutdoorEnergy, 0, 100);
  inRange('seasons.stockLeadDays', p.seasons.stockLeadDays, 0, 120);
  inRange('seasons.stockTarget', p.seasons.stockTarget, 1, 100);
  inRange('seasons.stockDeficit', p.seasons.stockDeficit, 0, 10000);
  inRange('actions.stock_food.groceriesGain', p.actions.stock_food.groceriesGain, 1, 100);
  inRange('actions.grow_groceries.groceriesGain', p.actions.grow_groceries.groceriesGain, 1, 100);
  inRange('household.reserveMoney', p.household.reserveMoney, 0, 1000000000);
  inRange('housing.baseLandValue',p.housing.baseLandValue,0,1000000);
  inRange('housing.proximityRadius',p.housing.proximityRadius,1,10000);
  inRange('housing.proximityPoint',p.housing.proximityPoint,0,10000);
  inRange('housing.useCap',p.housing.useCap,0,1000000);
  inRange('housing.usePoint',p.housing.usePoint,0,10000);
  inRange('housing.baseRent',p.housing.baseRent,0,1000000);
  inRange('housing.landRentPct',p.housing.landRentPct,0,1000);
  inRange('housing.bedRent',p.housing.bedRent,0,1000000);
  inRange('housing.maxIncomePct',p.housing.maxIncomePct,0,1000);
  inRange('housing.moveAfterDays',p.housing.moveAfterDays,1,3650);
  if(!Array.isArray(p.housing.serviceTypes)||p.housing.serviceTypes.some(x=>typeof x!=='string'))errors.push('housing.serviceTypes: 문자열 배열이어야 함');
  inRange('election.campaignPull', p.election.campaignPull, 100, 150);
  inRange('election.campaignDays', p.election.campaignDays, 0, 29);
  for (const k of ['judgeStarving', 'judgeNoMoney', 'judgeWelfare']) inRange(`election.${k}`, p.election[k], 0, 100);
  inRange('election.hoardRatioPct', p.election.hoardRatioPct, 1, 10000);
  inRange('election.hoardMultPct', p.election.hoardMultPct, 100, 1000);
  inRange('election.retroCap', p.election.retroCap, 0, 10000);
  inRange('fiscal.reviewIntervalDays', p.fiscal.reviewIntervalDays, 1, 120);
  inRange('fiscal.stepTaxPct', p.fiscal.stepTaxPct, 0, 25);
  inRange('fiscal.stepWelfare', p.fiscal.stepWelfare, 0, 1000);
  inRange('fiscal.lowRatioPct', p.fiscal.lowRatioPct, 0, 100);
  inRange('publicWorks.paveCostPerTile', p.publicWorks.paveCostPerTile, 0, 100000);
  inRange('publicWorks.bridgeCostPerTile', p.publicWorks.bridgeCostPerTile, 1, 100000);
  inRange('publicWorks.routeWorkDays', p.publicWorks.routeWorkDays, 1, 365);
  inRange('publicWorks.paveMaxPerDay', p.publicWorks.paveMaxPerDay, 0, 1000);
  inRange('publicWorks.pavePickPct', p.publicWorks.pavePickPct, 1, 100);
  for (const k of ['basePermille', 'starvingBonus', 'rainBonus', 'lowEnergyBonus', 'contagionPermille']) {
    inRange(`disease.${k}`, p.disease[k], 0, 1000);
  }
  inRange('disease.durationTicks', p.disease.durationTicks, 1, 1000000);
  inRange('disease.immuneTicks', p.disease.immuneTicks, 0, 1000000);
  // §23.25 바닥선 검증 — span이 사건 진폭(±10000)에 가까워지면 기분이 사건에 반응하지 않는다.
  for (const k of ['married', 'dating', 'perFriend', 'friendCap', 'perRival', 'rivalCap',
    'home', 'perHabit', 'habitCap']) inRange(`mood.baseline.${k}`, p.mood.baseline[k], 0, 5000);
  for (const k of ['sick', 'jobless', 'broke', 'unpaid']) inRange(`mood.baseline.${k}`, p.mood.baseline[k], -5000, 0);
  inRange('mood.baseline.dailyNeed', p.mood.baseline.dailyNeed, 1, 1000000);
  inRange('mood.baseline.secure', p.mood.baseline.secure, 0, 5000);
  inRange('mood.baseline.span', p.mood.baseline.span, 0, 5000);
  inRange('romance.minRomanceAge', p.romance.minRomanceAge, 15, 60);
  inRange('romance.ageGapBase', p.romance.ageGapBase, 0, 60);
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
export const ZONEABLE = ['house', 'cafe', 'office', 'park', 'apartment', 'factory', 'mall', 'university', 'primary_school','middle_school','high_school','workshop','lab','warehouse','train_station','airport'];

export const POLICY_FIELDS = {
  healthCopayPct: [0, 100],
  childAllowance: [0, 1000],
  taxPct: [5, 30],
  welfareAmount: [0, 1000],
  welfareThreshold: [0, 2000],
};
export function validatePolicy(p) {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return { ok: false, error: '객체 필요' };
  const keys = Object.keys(p);
  if (keys.length === 0) return { ok: false, error: '변경 필드 없음' };
  for (const k of keys) {
    const range = Object.hasOwn(POLICY_FIELDS,k)?POLICY_FIELDS[k]:null;
    if (!range) return { ok: false, error: `허용되지 않은 필드: ${k}` };
    if (!Number.isSafeInteger(p[k]) || p[k] < range[0] || p[k] > range[1]) {
      return { ok: false, error: `${k}: ${range[0]}~${range[1]} 정수 필요` };
    }
  }
  return { ok: true };
}
