// §17.13 생활 리듬: 크로노타입·교대근무·야근 — 전부 무드로우 순수 함수 (traits/logic만 입력).
// 이분 컷 금지 원칙: 특성은 가중치(그라데이션)로, 일별 변주는 dayHash 의사확률로.
// dayHash는 rngSim 스트림을 소비하지 않는 결정적 해시 — 리플레이·따라잡기 안전.
function floorDiv(a, b) { return Math.floor(a / b); }

// (simId, day, salt) → 0..99 — 정수 믹서 (Math.imul 32비트 결정적)
export function dayHash(simId, day, salt) {
  let h = Math.imul(simId + 1, 2654435761) ^ Math.imul(day + 1, 40503) ^ Math.imul(salt + 1, 97919);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

// 크로노 값 0..99 (연속): 나이가 들면 값이 이동하는 창발 포함.
export function chronoValue(traits) {
  return (traits.mbti.EI * 3 + traits.mbti.JP * 5 + traits.age * 7) % 100;
}

// 크로노타입 라벨 (표시·테스트 서술용 — 로직은 연속 오프셋 사용)
export function chronotypeOf(traits, L) {
  const v = chronoValue(traits);
  if (v < L.chrono.earlyMax) return 'early';
  if (v >= L.chrono.owlMin) return 'owl';
  return 'normal';
}

// 연속 오프셋 (이분 버킷 금지): v 0..99 → -maxShiftMin .. +maxShiftMin 선형
function chronoOffset(traits, L) {
  return floorDiv((chronoValue(traits) - 50) * L.chrono.maxShiftMin, 50);
}

// §17.17 주중/주말: day%7 — 0..4 주중, 5..6 주말. 교대 직업·프리랜서는 주말에도 근무(현실 반영).
export function isWeekend(day) { return day % 7 >= 5; }

// 개인 근무 창 { from, to } — to > 1440 은 자정 랩. wagePct 0(은퇴)·주말 비근무 직업은 null.
// day 의존(필수 인자): 야근 여부가 일별 의사확률(J 성향 가중) — '오늘은 야근, 내일은 칼퇴'.
export function workWindowFor(sim, L, day) {
  const occ = L.occupations[sim.traits.occupation];
  if (!occ || occ.wagePct === 0) return null;
  if (isWeekend(day) && occ.shift !== 'rotating' && !occ.weekendWork) return null; // §17.17 주말 휴무
  if (occ.shift === 'rotating') {
    // 교대: 조 = id 짝홀 (결정적). A조 주간, B조 야간(랩).
    return sim.id % 2 === 0
      ? { from: L.chrono.dayShiftStart, to: L.chrono.dayShiftEnd }
      : { from: L.chrono.nightShiftStart, to: L.chrono.nightShiftEnd };
  }
  let from = occ.workStart;
  let to = occ.workEnd;
  if (occ.flex) {
    const off = chronoOffset(sim.traits, L);
    from += off; to += off;
    // 야근 의사확률: p = (100-JP)×probPct/100 (J 강할수록 잦음), 길이도 JP 가중 그라데이션
    const pOver = floorDiv((100 - sim.traits.mbti.JP) * L.chrono.overtimeProbPct, 100);
    if (dayHash(sim.id, day, 1) < pOver) {
      to += L.chrono.overtimeMinBase + floorDiv((100 - sim.traits.mbti.JP) * L.chrono.overtimeMinSpan, 100);
    }
    if (from < 0) { from += 1440; to += 1440; } // early 음수 → 랩 표현으로 정규화
  }
  return { from, to };
}

// 개인 수면 슬롯 { from, to } (랩 허용) — 야간조는 주간 수면.
export function sleepWindowFor(sim, L) {
  const occ = L.occupations[sim.traits.occupation];
  if (occ?.shift === 'rotating' && sim.id % 2 === 1) {
    return { from: L.chrono.daySleepStart, to: L.chrono.daySleepEnd };
  }
  const off = chronoOffset(sim.traits, L);
  let from = L.chrono.sleepStart + off;
  if (from < 0) from += 1440;
  if (from >= 1440) from -= 1440; // owl 자정 넘김 정규화 (Codex 34차 항목 2)
  return { from, to: from + L.chrono.sleepLenMin };
}

// 슬롯-시각 매칭 (to > 1440 자정 랩 지원) — planFactor·워크 게이트 공용.
export function slotMatches(slot, tod) {
  if (slot.to > 1440) return tod >= slot.from || tod < slot.to - 1440;
  return tod >= slot.from && tod < slot.to;
}

// §17.16 서카디언: 개인 위상(크로노 오프셋 + 야간조 12h 반전)이 반영된 시각별 에너지 감쇠 가중(%).
// 생리 기반 rest/activity 모델의 '수면 압력' 곡선을 24칸 정수 테이블로 이산화 (논문 로드맵 P1-②).
export function circadianEnergyPct(sim, L, t) {
  const occ = L.occupations[sim.traits.occupation];
  const nightShift = occ?.shift === 'rotating' && sim.id % 2 === 1;
  const off = floorDiv((chronoValue(sim.traits) - 50) * L.chrono.maxShiftMin, 50);
  let tod = (t % 1440) - off + (nightShift ? 720 : 0);
  tod = ((tod % 1440) + 1440) % 1440;
  return L.circadian.energyPct[floorDiv(tod, 60)];
}

// §21.2 (83차 ④): 쌍 전용 의사확률. dayHash(a*97+b)는 서로 다른 쌍이 같은 키로 충돌해
// (예: 1*97+194 = 2*97+97) 쌍 간 확률이 상관된다. 두 id를 **각각 다른 상수로** 섞어 분리한다.
// 방향(주는 쪽/받는 쪽)도 구분한다 — A가 B를 돕는 것과 B가 A를 돕는 것은 다른 사건이다.
// rngSim 미소비.
export function pairHash(fromId, toId, day, salt) {
  let h = Math.imul(fromId + 1, 2654435761)
    ^ Math.imul(toId + 1, 1597334677)
    ^ Math.imul(day + 1, 40503)
    ^ Math.imul(salt + 1, 97919);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

// §22.2 사망 판정용 의사확률 (0..99,999). dayHash는 0..99라 하루 단위 사망 위험
// (수만 분의 일 수준)을 표현할 해상도가 없다. rngSim은 소비하지 않는다.
export function riskHash(simId, day, salt) {
  let h = Math.imul(simId + 1, 374761393)
    ^ Math.imul(day + 1, 668265263)
    ^ Math.imul(salt + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 2654435761);
  h = Math.imul(h ^ (h >>> 16), 1597334677);
  return ((h ^ (h >>> 15)) >>> 0) % 100000;
}
