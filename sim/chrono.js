// §17.13 생활 리듬: 크로노타입·교대근무·야근 — 전부 무드로우 순수 함수 (traits/logic만 입력).
function floorDiv(a, b) { return Math.floor(a / b); }

// 크로노타입 (저장 안 함): traits에서 유도 — 나이가 들면 값이 이동하는 창발 포함.
export function chronotypeOf(traits, L) {
  const v = (traits.mbti.EI * 3 + traits.mbti.JP * 5 + traits.age * 7) % 100;
  if (v < L.chrono.earlyMax) return 'early';
  if (v >= L.chrono.owlMin) return 'owl';
  return 'normal';
}

function chronoOffset(traits, L) {
  const c = chronotypeOf(traits, L);
  if (c === 'early') return -L.chrono.earlyShiftMin;
  if (c === 'owl') return L.chrono.owlShiftMin;
  return 0;
}

// 개인 근무 창 { from, to } — to > 1440 은 자정 랩. wagePct 0(은퇴)은 null.
export function workWindowFor(sim, L) {
  const occ = L.occupations[sim.traits.occupation];
  if (!occ || occ.wagePct === 0) return null;
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
    if (sim.traits.mbti.JP <= L.chrono.overtimeJpMax) to += L.chrono.overtimeMin; // J형 야근
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
  return { from, to: from + L.chrono.sleepLenMin };
}

// 슬롯-시각 매칭 (to > 1440 자정 랩 지원) — planFactor·워크 게이트 공용.
export function slotMatches(slot, tod) {
  if (slot.to > 1440) return tod >= slot.from || tod < slot.to - 1440;
  return tod >= slot.from && tod < slot.to;
}
