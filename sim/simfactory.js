// §22.16 심 생성 단일 창구.
//
// 예전에는 심을 만드는 자리가 넷이었고(월드젠 sim/world.js, 이민 sim/society.js,
// 출생 sim/society.js, 플레이어 sim/tick.js) **넷의 필드가 서로 달랐다**:
//   - 플레이어에게 groceries·sick이 없어 NaN이 됐고, 직렬화가 그걸 null로 바꿔
//     서버 재시작이 세계를 바꿨다 (§22.13, 3000틱 뒤 국고 115 vs 380).
//   - 이민자에게 hungerZeroTicks·approachedDay·approachedTo가 없다. 지금은 읽는 쪽이
//     `?? 0`이나 `!== day` 가드로 우연히 버티고 있을 뿐이다.
//   - 출생·이민 state에 sideTalkTicks가 없다 (§22.14).
//
// 필드를 하나 늘릴 때마다 네 곳을 똑같이 고쳐야 하는 구조는 언젠가 반드시 어긋난다.
// 창구를 하나로 두면 그 부류의 버그가 **생길 자리 자체가 없어진다.**
//
// 주의: 이 팩토리는 rng를 소비하지 않는다. 월드젠의 rngWorldgen 소비 순서
// (traits → needs×4 → money)는 호출자가 그대로 유지하고 결과 값만 넘긴다.
import { makeAbilities } from './abilities.js';

// 행동 상태의 빈 값. undefined 필드는 직렬화가 삼켜 왕복이 고정점이 아니게 되므로
// 전부 명시적인 값을 둔다 (§22.13).
export function emptyState() {
  return {
    kind: 'idle',
    action: null,
    facilityId: null,
    resourceId: null,
    path: [],
    ticksLeft: 0,
    pairedTicks: 0,
    sideTalkTicks: 0, // §22.14 옆 사람과 말이 트인 횟수
  };
}

// 모든 생성 경로가 이 함수를 쓴다. 필드가 하나라도 빠지면 그건 여기서 빠지는 것이고,
// test/qa.test.js가 네 경로의 키 집합이 같은지 검사한다.
export function makeSim({
  id, name, surname, homeId, traits, seed,
  x, y, needs, money,
  isPlayer = false,
}) {
  return {
    id,
    name,
    surname,              // §22.16 성 — 표시는 `${surname}${name}`
    homeId,
    isPlayer,
    traits,
    abilities: makeAbilities(seed, id), // §21.1 드로우 없이 seed·id에서 유도
    mood: 0,
    x,
    y,
    needs,
    money,
    state: emptyState(),
    // Phase 3 인지 (PLAN §2.5)
    memories: [],
    memorySeq: 0,
    habit: {},
    relTiers: {},
    lastReflectedDay: -1,
    reflectionMemoryCursor: 0,
    pendingMood: null,
    // Phase 4 (PLAN §2.5 D/F)
    knownTokens: [],
    plan: null,
    lastPlannedDay: -1,
    // 생활 상태
    hangoverUntil: -1,
    groceries: 0,
    sick: null,
    noPathCool: {},
    patrolIdx: 0,
    hasCar: false,
    longTrips: 0,
    longTripTiles: 0,     // §19.12 장거리 이동 칸수 누적 (거리 분포 관측 — 이슈 #52)
    complaintCursor: 0,
    complaintDays: {},
    sharedDay: -1,
    sharedTo: [],         // §21.2 나눔: 쌍당 하루 1회
    conversationTopics: {}, // §22.90 상대별 최근 대화 주제
    hungerZeroTicks: 0,   // §22.2 굶은 채 머문 시간
    approachedDay: -1,
    approachedTo: [],     // §22.6 하루에 같은 사람에게 거듭 말 걸지 않기
    // §22.6 초대받은 자리. 예전에는 **초대받은 심에게만** 생기는 필드였다 —
    // 같은 심 집합인데 키가 갈리면 그 자체가 §22.13이 가르쳐 준 버그의 씨앗이다.
    invitedTo: null,
    // §22.19 일상 수요를 심·행동당 하루 1회로 묶는 가드
    wantDay: -1,
    wantedActions: [],
  };
}
