// §22.24 부재중 연대기 — Dwarf Fortress 레전드 방식 (이슈 #90)
//
// 문제 (§22.11 지적 5, 가상 플레이어 실측): 부재중 리포트 74줄 중 61줄이 심별 식사
// 횟수 목록이었고, highlights 50칸 중 48칸을 `lonely`가 먹었다. ×48 배속에서 부재중
// 1시간 = 게임 1년인데(§22.1), 그 사이의 사망·사별·결혼·선거·화재를 식사 횟수
// 나열로 받는 것과 시간순 이야기로 받는 것은 **같은 데이터의 다른 배열**이다.
//
// 이 모듈은 §22.8(view.js)과 같은 계층의 **읽기 전용 투영**이다 — 이미 커밋된 이벤트를
// 이야기 순서로 재배열할 뿐, 시뮬 상태·rngSim·리플레이에는 손대지 않는다(결정성 리스크 0).
// 이벤트 스키마에 없는 것을 지어내지 않는다 — 로그에 있는 사실만 고른다.
//
// 선별 규칙은 전부 결정적이다:
// 1. 연대기에 오르는 종류는 아래 우선순위 테이블에 있는 것뿐이다. lonely·starving·
//    argument·식사 같은 고빈도 이벤트는 연대기가 아니라 **집계 한 줄**로 접힌다(§0.1 —
//    수치를 숨기는 게 아니라 자리를 정해주는 것. 총계는 counts로 그대로 나간다).
// 2. 종류별 상한(PER_KIND_CAP): 한 종류가 자리를 다 먹지 않는다. 넘치면 **최근 것**을
//    남긴다 — 지금 세계 상태와 이어지는 사건이 이야기의 끝이다. 접힌 개수는
//    클라이언트가 counts와의 차로 계산해 "접힌 사건 +N"으로 표시한다.
// 3. 총 예산(TOTAL_BUDGET)을 넘으면 우선순위 낮은 종류부터 오래된 것을 줄인다 —
//    1차 패스는 종류당 1건은 남기고, 그래도 넘치면 2차 패스가 종류째 비운다.
// 4. 출력은 (tick, ordinal) 오름차순 — 시간순 서사.

// 우선순위 테이블 (위 = 큰 사건). 이슈 #90의 서사 선별 규칙:
// 사망 > 결혼·출생 > 선거 > 화재·구조 > 승격·전직·정책 > 관계 변화 > 이주·생애 전환 > 그 외.
export const CHRONICLE_PRIORITY = [
  'died', 'bereaved', 'child_settled', 'married', 'election',
  'heroic_save', 'fire_started', 'fire_out',
  'city_promoted', 'job_changed', 'policy_changed',
  'started_dating', 'broke_up', 'helped', 'money_shared',
  'immigrated', 'grew_up', 'graduated', 'retired_now',
  'facility_built', 'festival', 'petition', 'car_bought', 'fell_sick',
];
const PRIORITY_INDEX = new Map(CHRONICLE_PRIORITY.map((k, i) => [k, i]));

export const PER_KIND_CAP = 8; // 종류별 상한 — lonely 편중(48/50)의 재발 방지
export const TOTAL_BUDGET = 48; // 연대기 전체 상한 — 리포트가 다시 벽이 되지 않게

// rows: (tick, ordinal) 오름차순으로 정렬된 이벤트 [{tick, ordinal, type, sim_id, payload}].
// 반환: 같은 형태로 선별된 시간순 연대기. 순수 함수 — 같은 입력이면 항상 같은 출력.
export function selectChronicle(rows, { perKindCap = PER_KIND_CAP, budget = TOTAL_BUDGET } = {}) {
  const byKind = new Map();
  for (const r of rows) {
    if (!PRIORITY_INDEX.has(r.type)) continue;
    let list = byKind.get(r.type);
    if (!list) byKind.set(r.type, (list = []));
    list.push(r);
  }
  let total = 0;
  for (const [kind, list] of byKind) {
    // 종류별 상한: 최근 것을 남긴다 (rows가 오름차순이므로 뒤쪽이 최근)
    if (list.length > perKindCap) byKind.set(kind, list.slice(list.length - perKindCap));
    total += Math.min(list.length, perKindCap);
  }
  // 총 예산: 낮은 우선순위부터, 오래된 것부터 줄인다. floor 1 → floor 0 두 패스라 항상 끝난다.
  for (const floor of [1, 0]) {
    if (total <= budget) break;
    for (let i = CHRONICLE_PRIORITY.length - 1; i >= 0 && total > budget; i--) {
      const list = byKind.get(CHRONICLE_PRIORITY[i]);
      if (!list) continue;
      while (list.length > floor && total > budget) { list.shift(); total--; }
    }
  }
  const out = [];
  for (const kind of CHRONICLE_PRIORITY) {
    const list = byKind.get(kind);
    if (list) out.push(...list);
  }
  out.sort((a, b) => (a.tick - b.tick) || (a.ordinal - b.ordinal));
  return out;
}
