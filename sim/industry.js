// §22.18 산업 분류 — 한국표준산업분류(KSIC) 대분류 A~U.
//
// **산업은 건물이 아니라 개념으로 먼저 존재한다** (사용자 지시: "산업은 개념만 일단
// 존재하고 사람들이 필요에 의해 발전하게 해야 돼").
//
// 그래서 이 파일은 건물을 만들지 않는다. 하는 일은 셋뿐이다:
//   ① 21개 대분류를 이름 붙여 두고,
//   ② 지금 세계의 시설·직업이 어느 분류에 속하는지 알려주고,
//   ③ 심이 **시설이 없어서** 하려던 일을 못 했을 때 그 좌절을 분류별로 적립한다.
//
// 병렬 설계 검증 3인이 각각 같은 결론을 냈다: 15채를 미리 세워도 플레이어의 새 동사는
// 0개이고, 국고 116만에 빈 공터 51개라 희소성이 없어 23개짜리 메뉴는 선택이 아니라
// 체크리스트가 된다. 그래서 먼저 **무엇이 없어서 아쉬운지**를 세계가 기록하게 한다.
//
// 결정성: 정수 카운터, 고정된 문자열 키, rng 미소비. 값은 tick의 기존 고정 단계에서만
// 갱신한다.

// 각 대분류의 상태는 셋 중 하나다.
//   active  — 시설도 있고 그 일을 하는 심도 있다
//   nascent — 행동은 세계에 있는데 사업체나 종사자가 아직 없다 (예: 집밥은 하는데
//             가사 고용은 없다, 공사는 하는데 건설사는 없다)
//   absent  — 아직 아무것도 없다
export const KSIC = [
  {
    code: 'A', nameKo: '농업, 임업 및 어업',
    facilityTypes: ['pond'], occupations: [], actions: ['fish'],
    note: '낚시터가 1차 산업의 유일한 접점이다. 농장·임업은 아직 없다.',
  },
  {
    code: 'B', nameKo: '광업',
    facilityTypes: [], occupations: [], actions: [],
    note: '채굴이 세계에 없다. 건설 자재 수요가 생기면 그때 열릴 자리다.',
  },
  {
    code: 'C', nameKo: '제조업',
    facilityTypes: ['factory'], occupations: ['worker'], actions: [],
    note: '공장은 정의돼 있으나 살아 있는 마을에 아직 지어지지 않았다.',
  },
  {
    code: 'D', nameKo: '전기, 가스, 증기 및 공기조절 공급업',
    facilityTypes: [], occupations: [], actions: [],
    note: '전력이 세계에 없다. 시설 유지비가 도입되면 여기가 그 수취자가 된다.',
  },
  {
    code: 'E', nameKo: '수도, 하수 및 폐기물 처리, 원료재생업',
    facilityTypes: [], occupations: [], actions: [],
    note: '상하수·폐기물이 세계에 없다.',
  },
  {
    code: 'F', nameKo: '건설업',
    facilityTypes: [], occupations: [], actions: ['build'],
    note: '심이 집에 침대를 만들고 공사(projects)에 노동을 보태지만, 건설사도 건설 노동자 직업도 없다.',
  },
  {
    code: 'G', nameKo: '도매 및 소매업',
    facilityTypes: ['market', 'mall'], occupations: ['clerk'], actions: ['shop'],
    note: '장보기가 이 분류의 소비 접점이다.',
  },
  {
    code: 'H', nameKo: '운수 및 창고업',
    facilityTypes: [], occupations: [], actions: [],
    note: '차는 개인 소유물일 뿐 운수업이 아니다. 창고·대중교통이 없다. '
      + '이동 수요는 transit 필드로 따로 관측한다(§19.12) — 시설 부재 좌절(directUnmet)과 다른 축이다.',
  },
  {
    code: 'I', nameKo: '숙박 및 음식점업',
    facilityTypes: ['cafe', 'restaurant', 'bar'], occupations: ['barista', 'chef'],
    actions: ['eat', 'drink'],
    note: '숙박은 없다 — 음식점만으로 절반만 덮인다.',
  },
  {
    code: 'J', nameKo: '정보통신업',
    facilityTypes: [], occupations: [], actions: [],
    note: '소문이 입에서 입으로만 퍼진다. 통신 수단이 생기면 확산 구조가 바뀔 자리다.',
  },
  {
    code: 'K', nameKo: '금융 및 보험업',
    facilityTypes: [], occupations: [], actions: [],
    note: '현금뿐이고 예금·대출·보험이 없다. 국고가 73%를 쥔 채 도는 구조와 직결된다.',
  },
  {
    code: 'L', nameKo: '부동산업',
    facilityTypes: [], occupations: [], actions: [],
    // 109차 ③: 주거 **시설이 있다는 것**과 **부동산업이 있다는 것**은 다르다.
    // 집은 배정될 뿐 거래·임대되지 않으므로 사업체가 성립하지 않는다. 집을 이 분류의
    // 시설로 세면 30채짜리 마을이 부동산업 활성으로 잘못 보고된다.
    housingFacilityTypes: ['house', 'apartment'],
    note: '집 30채가 있지만 배정될 뿐 거래되지 않는다 — 임대·매매가 없어 산업이 아니다.',
  },
  {
    code: 'M', nameKo: '전문, 과학 및 기술 서비스업',
    facilityTypes: ['office'], occupations: ['office_worker', 'freelancer'], actions: [],
    // 109차 ③: office를 M에 넣은 것은 편의적 배정이다. 실제로는 사무직이 무슨 일을
    // 하는지가 세계에 없어서 J(정보통신)·K(금융)·N(사업지원) 어디로도 갈 수 있다.
    note: '사무직의 일이 무엇인지가 아직 추상이라 M에 임시 배정했다. '
      + '사무 노동의 산출이 정해지면 J·K·N으로 갈릴 자리다.',
  },
  {
    code: 'N', nameKo: '사업시설 관리, 사업 지원 및 임대 서비스업',
    facilityTypes: [], occupations: [], actions: [],
    note: '시설 관리·임대가 없다. 유지비가 생기면 여기가 그 일을 맡는다.',
  },
  {
    code: 'O', nameKo: '공공행정, 국방 및 사회보장 행정',
    facilityTypes: ['city_hall', 'police_station', 'fire_station'],
    occupations: ['civil_servant', 'police', 'firefighter', 'politician'], actions: [],
    // 순찰·소방 대응은 ACTIONS가 아니라 work의 특수 분기이고 가상 자원을 쓴다 —
    // 행동으로 등록하면 수요 판정이 후보 생성과 어긋난다 (이슈 #88).
    note: '세금·복지·선거·치안·소방이 모두 여기 있다. 가장 두꺼운 분류다. '
      + '순찰·소방은 가상 자원을 써서 수요를 판정할 수 없다 (#88).',
  },
  {
    code: 'P', nameKo: '교육 서비스업',
    facilityTypes: ['school', 'university', 'library'], occupations: ['teacher'],
    actions: ['read'],
    // 109차 ②: student를 종사자로 세면 **고용 없이도 학교가 active**가 된다. 학생은
    // 이 산업의 이용자이지 종사자가 아니다. 별도로 participants에 센다.
    participantOccupations: ['student'],
    note: '학교·도서관이 있고 교사가 일한다. 학생은 이용자로 따로 센다. '
      + '도서관을 교육에 넣은 것은 이 세계에서 read 행동이 학습에 가깝기 때문이고, '
      + '엄밀한 KSIC에서는 문화·정보 서비스에 더 가깝다.',
  },
  {
    code: 'Q', nameKo: '보건업 및 사회복지 서비스업',
    facilityTypes: ['hospital'], occupations: ['doctor', 'nurse'], actions: ['see_doctor'],
    note: '병원이 있다. 사회복지 시설은 없고 복지는 국고 이전으로만 이뤄진다.',
  },
  {
    code: 'R', nameKo: '예술, 스포츠 및 여가관련 서비스업',
    facilityTypes: ['park', 'gym', 'cinema'], occupations: [], actions: ['play', 'exercise'],
    note: '여가 시설은 있는데 그 시설에서 일하는 직업이 없다 — 손님만 있고 종사자가 없다.',
  },
  {
    code: 'S', nameKo: '협회 및 단체, 수리 및 기타 개인 서비스업',
    facilityTypes: [], occupations: [], actions: [],
    note: '동아리(clubs)가 협회의 씨앗이지만 사업체가 아니다. 미용·수리업이 없다.',
  },
  {
    code: 'T', nameKo: '가구내 고용활동 및 자가소비 생산활동',
    facilityTypes: [], occupations: [], actions: ['cook_eat'],
    note: '집밥이 자가소비 생산활동(T98)이다. 유급 가사노동(T97)은 없다.',
  },
  {
    code: 'U', nameKo: '국제 및 외국기관',
    facilityTypes: [], occupations: [], actions: [],
    note: '이민자가 마을 밖에서 오지만 그건 경계 유입이지 산업이 아니다.',
  },
];

// 조회용 역인덱스 — 모듈 로드 시 1회. rng 미소비, 결정적.
const BY_FACILITY = new Map();
const BY_OCCUPATION = new Map();
const BY_ACTION = new Map();
const BY_PARTICIPANT = new Map();
for (const s of KSIC) {
  for (const p of s.participantOccupations ?? []) BY_PARTICIPANT.set(p, s.code);
  for (const f of s.facilityTypes) BY_FACILITY.set(f, s.code);
  for (const o of s.occupations) BY_OCCUPATION.set(o, s.code);
  for (const a of s.actions) BY_ACTION.set(a, s.code);
}

export const KSIC_CODES = KSIC.map((s) => s.code);
export function industryOfFacilityType(type) { return BY_FACILITY.get(type) ?? null; }
export function industryOfOccupation(occ) { return BY_OCCUPATION.get(occ) ?? null; }
export function industryOfAction(action) { return BY_ACTION.get(action) ?? null; }

// 수요 원장에 한 건 적립한다. **시설이 없어서 못 한 경우만** 부른다 —
// 돈이 없어서(no_money)나 시간이 아니어서(off_hours) 못 한 것은 시설 수요가 아니다.
// 그걸 섞으면 '식당을 더 지어라'는 잘못된 처방이 나온다 (§19.10에서 같은 이유로
// 불만 원인을 분화했다).
export function recordIndustryDemand(world, action, day) {
  const code = industryOfAction(action);
  if (code === null) return null;
  if (world.industryDemand === undefined) world.industryDemand = {};
  const d = world.industryDemand;
  if (d[code] === undefined) d[code] = { unmet: 0, firstDay: day, lastDay: day };
  d[code].unmet++;
  d[code].lastDay = day;
  return code;
}

// 만석 원장 — **시설을 더 지으라**가 아니라 **있는 시설을 키우라**는 신호다 (110차 ①).
export function recordCapacityShortfall(world, action, day) {
  const code = industryOfAction(action);
  if (code === null) return null;
  if (world.capacityShortfall === undefined) world.capacityShortfall = {};
  const d = world.capacityShortfall;
  if (d[code] === undefined) d[code] = { full: 0, firstDay: day, lastDay: day };
  d[code].full++;
  d[code].lastDay = day;
  return code;
}

// 일상 수요 원장 (§22.19, 이슈 #87) — **위급 원장과 섞지 않는다.** 강도가 다른 신호다.
// 위급 원장: 굶어 죽게 생겼는데 갈 데가 없었다.
// 일상 원장: 지금 하는 일보다 더 하고 싶었는데 갈 데가 없었다.
// 산업이 생기는 이유의 절반은 후자다 — 도서관도 영화관도 굶주림에서 나오지 않는다.
export function recordIndustryWant(world, action, day, kind) {
  const code = industryOfAction(action);
  if (code === null) return null;
  if (world.industryWant === undefined) world.industryWant = {};
  const d = world.industryWant;
  if (d[code] === undefined) d[code] = { noFacility: 0, capacityFull: 0, firstDay: day, lastDay: day };
  if (kind === 'no_facility') d[code].noFacility++;
  else if (kind === 'capacity_full') d[code].capacityFull++;
  else return null;
  d[code].lastDay = day;
  return code;
}

// 세계가 이미 집계해 둔 불만(§19.5 complaints)에서 분류별 신호를 읽는다.
// complaints는 회고에서 커서 기반으로 모이므로 틱 잡음이 없고 이미 중복 제거돼 있다.
//   no_facility → 시설이 없어서 못 했다 = 진짜 산업 수요
//   no_money    → 시설은 있는데 돈이 없어서 못 했다 = **산업 수요가 아니다**
// 살아 있는 마을의 실제 값이 이 구분의 이유다: no_facility 0건, no_money@eat 415건.
// 이 세계에 부족한 것은 건물이 아니라 사람 손에 가는 돈이다. 둘을 섞었다면
// '식당을 더 지어라'는 정반대 처방이 나왔을 것이다.
function complaintSignals(world) {
  const byIndustry = new Map();
  let noMoneyTotal = 0;
  for (const c of world.complaints ?? []) {
    if (c.kind === 'no_money') { noMoneyTotal += c.count ?? 0; continue; }
    if (c.kind !== 'no_facility') continue;
    // no_facility의 placeId에는 막힌 **행동**이 들어간다 (§19.5 주석)
    const code = industryOfAction(c.placeId);
    if (code === null) continue;
    byIndustry.set(code, (byIndustry.get(code) ?? 0) + (c.count ?? 0));
  }
  return { byIndustry, noMoneyTotal };
}

// 구매력 부족 총량 — 산업 수요와 **따로** 보고한다.
export function purchasingPowerGap(world) {
  return complaintSignals(world).noMoneyTotal;
}

// 지금 세계의 산업 현황. 읽기 전용 — 세계를 바꾸지 않는다.
export function industryStatus(world) {
  const sig = complaintSignals(world);
  const facCount = new Map();
  const rawFacCount = new Map();
  for (const f of world.map?.facilities ?? []) {
    rawFacCount.set(f.type, (rawFacCount.get(f.type) ?? 0) + 1);
    const c = industryOfFacilityType(f.type);
    if (c !== null) facCount.set(c, (facCount.get(c) ?? 0) + 1);
  }
  const workerCount = new Map();
  const participantCount = new Map();
  for (const s of world.sims ?? []) {
    const occ = s.traits?.occupation;
    const c = industryOfOccupation(occ);
    if (c !== null) workerCount.set(c, (workerCount.get(c) ?? 0) + 1);
    const pc = BY_PARTICIPANT.get(occ);
    if (pc !== undefined) participantCount.set(pc, (participantCount.get(pc) ?? 0) + 1);
  }
  return KSIC.map((s) => {
    const facilities = facCount.get(s.code) ?? 0;
    const workers = workerCount.get(s.code) ?? 0;
    const dem = world.industryDemand?.[s.code];
    const fromComplaints = sig.byIndustry.get(s.code) ?? 0;
    // active: 시설과 종사자가 둘 다 있다.
    // nascent: 행동이나 시설 중 하나만 있다 — 세계에 흔적은 있는데 업으로 서지 않았다.
    // absent: 아무것도 없다.
    let state = 'absent';
    if (facilities > 0 && workers > 0) state = 'active';
    else if (facilities > 0 || workers > 0 || s.actions.length > 0) state = 'nascent';
    return {
      code: s.code,
      nameKo: s.nameKo,
      state,
      facilities,
      // 110차 ③: '부동산업 부재'와 '주택 부족'을 혼동하지 않게 주거 시설 수를 따로 싣는다.
      housing: (s.housingFacilityTypes ?? []).reduce((n, ft) => n + (rawFacCount.get(ft) ?? 0), 0),
      workers,
      participants: participantCount.get(s.code) ?? 0, // 이용자 (학생 등) — 종사자가 아니다
      directUnmet: dem?.unmet ?? 0,      // 시설이 없어서 못 했다 → 새로 지어야 한다
      capacityFull: world.capacityShortfall?.[s.code]?.full ?? 0, // 자리가 없어서 못 했다 → 키워야 한다
      // §22.19 일상 수요 — 위급하지 않은 아쉬움. 위급 수요와 **더하지 않는다**.
      wantNoFacility: world.industryWant?.[s.code]?.noFacility ?? 0,
      wantCapacityFull: world.industryWant?.[s.code]?.capacityFull ?? 0,
      complaintEvidence: fromComplaints, // 세계가 불만으로 집계한 것 (같은 사건의 다른 표현일 수 있다)
      firstDay: dem?.firstDay ?? -1,
      lastDay: dem?.lastDay ?? -1,
      note: s.note,
      // §19.12 H(운수·창고업)에만: **이동 수요** — directUnmet(시설이 없어서 못 한 좌절)과
      // 다른 축이다. 심은 '역이 없어서 못 갔다'고 좌절한 적이 없지만(걷거나 차로 갔다),
      // 장거리 이동의 누적 자체가 운수업이 설 자리를 말한다. 섞지 않고 따로 싣는다.
      ...(s.code === 'H' ? { transit: {
        stationUnlocked: world.transit?.stationUnlocked ?? false,
        unlockedDay: world.transit?.unlockedDay ?? -1,
        fulfillmentPct: world.transit?.fulfillmentPct ?? 0,
        demand: world.transit?.demand ?? 0,
        stationDemand: world.logic?.transport?.stationDemand ?? 0,
        totalLongTrips: world.transit?.totalLongTrips ?? 0,
        weightedTrips: world.transit?.weightedTrips ?? 0,
        carsOwned: world.transit?.carsOwned ?? 0,
        avgTripTiles: world.transit?.avgTripTiles ?? 0,
      } } : {}),
    };
  });
}
