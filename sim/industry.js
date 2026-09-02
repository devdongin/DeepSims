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
    note: '차는 개인 소유물일 뿐 운수업이 아니다. 창고·대중교통이 없다.',
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
    facilityTypes: ['house', 'apartment'], occupations: [], actions: ['sleep'],
    note: '집은 배정될 뿐 거래되지 않는다 — 임대·매매가 없어 중개업이 성립하지 않는다.',
  },
  {
    code: 'M', nameKo: '전문, 과학 및 기술 서비스업',
    facilityTypes: ['office'], occupations: ['office_worker', 'freelancer'], actions: [],
    note: '사무직의 일이 무엇인지는 아직 추상이다.',
  },
  {
    code: 'N', nameKo: '사업시설 관리, 사업 지원 및 임대 서비스업',
    facilityTypes: [], occupations: [], actions: [],
    note: '시설 관리·임대가 없다. 유지비가 생기면 여기가 그 일을 맡는다.',
  },
  {
    code: 'O', nameKo: '공공행정, 국방 및 사회보장 행정',
    facilityTypes: ['city_hall', 'police_station', 'fire_station'],
    occupations: ['civil_servant', 'police', 'firefighter', 'politician'], actions: ['patrol'],
    note: '세금·복지·선거·치안·소방이 모두 여기 있다. 가장 두꺼운 분류다.',
  },
  {
    code: 'P', nameKo: '교육 서비스업',
    facilityTypes: ['school', 'university', 'library'], occupations: ['teacher', 'student'],
    actions: ['read'],
    note: '학교와 도서관이 있다.',
  },
  {
    code: 'Q', nameKo: '보건업 및 사회복지 서비스업',
    facilityTypes: ['hospital'], occupations: ['doctor', 'nurse'], actions: ['treat'],
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
for (const s of KSIC) {
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
  for (const f of world.map?.facilities ?? []) {
    const c = industryOfFacilityType(f.type);
    if (c !== null) facCount.set(c, (facCount.get(c) ?? 0) + 1);
  }
  const workerCount = new Map();
  for (const s of world.sims ?? []) {
    const c = industryOfOccupation(s.traits?.occupation);
    if (c !== null) workerCount.set(c, (workerCount.get(c) ?? 0) + 1);
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
      workers,
      unmet: dem?.unmet ?? 0,
      complaintUnmet: fromComplaints,
      firstDay: dem?.firstDay ?? -1,
      lastDay: dem?.lastDay ?? -1,
      note: s.note,
    };
  });
}
