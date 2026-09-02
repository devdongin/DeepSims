// §22.16 성씨 — 한국 성씨 분포를 확률로 바꿔 심에게 성을 준다.
//
// **rngSim·rngWorldgen을 소비하지 않는다.** §21.1 능력치와 같은 Math.imul 믹서로
// (seed, simId)에서 0~99,999를 유도해 누적분포에 대응시킨다. 그래서 드로우 순서 계약
// (§17.8)이 전혀 바뀌지 않고, 기존 세이브의 심도 마이그레이션에서 즉시 성을 갖는다.
// 이민자마다 rngSim을 한 번 더 뽑았다면 그 시점부터 모든 리플레이가 어긋났을 것이다.
//
// 수치는 통계청 2015 인구주택총조사 성씨 집계의 **인구수(천 명 단위, 근사)**다.
// 비율을 손으로 적지 않고 인구수에서 계산한다 — 그래야 성씨를 넣고 빼도 나머지의
// 상대 비율이 저절로 맞고, 적어 둔 백분율의 합이 눈금과 어긋나는 일이 없다.
//
// **500명 미만 성씨는 제외한다** (사용자 지시). 여기 실린 84개는 전부 수천 명 이상이고
// 남한 인구의 **98.8%**를 덮는다. 빠진 1.2%는 정규화 과정에서 남은 성씨에 비례 배분되므로
// 서로의 상대 비율은 보존되고, 표에 실린 성씨는 실제보다 아주 조금씩 흔해진다.
const COUNTS = [
  ['김', 'Kim', 10690], ['이', 'Lee', 7307], ['박', 'Park', 4192], ['최', 'Choi', 2334],
  ['정', 'Jung', 2152], ['강', 'Kang', 1177], ['조', 'Jo', 1056], ['윤', 'Yoon', 1021],
  ['장', 'Jang', 993], ['임', 'Lim', 824], ['한', 'Han', 773], ['오', 'Oh', 763],
  ['서', 'Seo', 751], ['신', 'Shin', 741], ['권', 'Kwon', 706], ['황', 'Hwang', 697],
  ['안', 'Ahn', 686], ['송', 'Song', 683], ['전', 'Jeon', 559], ['홍', 'Hong', 558],
  ['유', 'Yoo', 543], ['양', 'Yang', 486], ['고', 'Ko', 471], ['문', 'Moon', 464],
  ['손', 'Son', 457], ['배', 'Bae', 401], ['백', 'Baek', 382], ['허', 'Heo', 326],
  ['노', 'Noh', 290], ['심', 'Shim', 272], ['주', 'Joo', 232], ['하', 'Ha', 230],
  ['곽', 'Kwak', 203], ['구', 'Koo', 196], ['차', 'Cha', 194], ['우', 'Woo', 194],
  ['성', 'Sung', 189], ['진', 'Jin', 172], ['나', 'Na', 172], ['지', 'Ji', 160],
  ['민', 'Min', 159], ['남', 'Nam', 153], ['엄', 'Uhm', 144], ['변', 'Byun', 138],
  ['원', 'Won', 132], ['채', 'Chae', 131], ['천', 'Cheon', 118], ['방', 'Bang', 96],
  ['공', 'Kong', 89], ['현', 'Hyun', 88], ['함', 'Ham', 79], ['염', 'Yeom', 69],
  ['여', 'Yeo', 63], ['추', 'Chu', 61], ['석', 'Seok', 56], ['도', 'Do', 55],
  ['소', 'So', 52], ['선', 'Sun', 46], ['설', 'Seol', 46], ['명', 'Myung', 39],
  ['위', 'Wi', 39], ['마', 'Ma', 38], ['길', 'Gil', 38], ['연', 'Yeon', 33],
  ['표', 'Pyo', 30], ['반', 'Ban', 27], ['기', 'Ki', 26], ['왕', 'Wang', 25],
  ['금', 'Keum', 24], ['옥', 'Ok', 23], ['육', 'Yook', 22], ['인', 'In', 22],
  ['맹', 'Maeng', 21], ['모', 'Mo', 21], ['탁', 'Tak', 21], ['제', 'Je', 20],
  ['국', 'Kook', 20], ['남궁', 'Namgung', 20], ['어', 'Eo', 18], ['피', 'Pi', 17],
  ['봉', 'Bong', 12], ['황보', 'Hwangbo', 10], ['제갈', 'Jegal', 5], ['선우', 'Sunwoo', 3],
];

// 인구수 → 10만분율(share). **최대잉여법(largest remainder)**으로 반올림해 합계를 정확히
// SCALE로 맞춘다. 그냥 반올림하면 합이 어긋나고, 그 오차가 누적분포 끝에서 확률이
// 새는 구멍이 된다.
//
// 1000분율로는 부족했다 — 선우(3천 명)·제갈(5천 명) 같은 성씨가 0으로 잘려 **아예
// 등장하지 않았다**(84개 중 70개만 나왔다). 500명 이상은 다 넣기로 했으므로 눈금을
// 100배 촘촘하게 한다.
const SCALE = 100000;

export const SURNAMES = (() => {
  const total = COUNTS.reduce((a, c) => a + c[2], 0);
  const rows = COUNTS.map(([hangul, roman, count]) => {
    const exact = (count * SCALE) / total;
    const base = Math.floor(exact);
    return { hangul, roman, count, share: base, rem: exact - base };
  });
  let left = SCALE - rows.reduce((a, r) => a + r.share, 0);
  // 잔여는 소수부가 큰 순으로 나눠준다. 동률은 인구 많은 쪽 → 가나다 순 — 완전 순서라
  // 실행 환경이 달라도 같은 표가 나온다.
  const order = rows.map((_, i) => i).sort((a, b) => (rows[b].rem - rows[a].rem)
    || (rows[b].count - rows[a].count)
    || (rows[a].hangul < rows[b].hangul ? -1 : 1));
  for (let k = 0; left > 0; k++, left--) rows[order[k % rows.length]].share++;
  return rows.map(({ hangul, roman, count, share }) => ({ hangul, roman, count, share }));
})();

// 누적분포 (10만분율). 모듈 로드 시 1회 계산 — 결정적이고 rng와 무관하다.
const CUM = (() => {
  const out = [];
  let acc = 0;
  for (const s of SURNAMES) { acc += s.share; out.push(acc); }
  return out;
})();

export const SURNAME_TOTAL = CUM.length > 0 ? CUM[CUM.length - 1] : 0;

// seed가 없는 아주 오래된 세이브 대비 폴백 (§21.1과 같은 이유 — undefined가 들어가면
// Math.imul(NaN, x) = 0이라 **모든 시드의 세계가 같은 성씨를 갖는** 조용한 오류가 된다).
export const FALLBACK_SEED = 0x5EED2;

// 0 ~ SCALE-1. abilityValue와 다른 상수를 써서 능력치와 성씨가 상관되지 않게 한다.
export function surnameHash(seed, simId) {
  const s = Number.isSafeInteger(seed) ? seed : FALLBACK_SEED;
  let h = Math.imul(s + 1, 2246822519) ^ Math.imul(simId + 1, 3266489917) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 2654435761);
  h = Math.imul(h ^ (h >>> 13), 668265263);
  return ((h ^ (h >>> 16)) >>> 0) % SCALE;
}

// (seed, simId) → 성씨. 같은 심은 언제나 같은 성을 받는다.
export function surnameFor(seed, simId) {
  const r = surnameHash(seed, simId);
  // 선형 탐색 — 표가 80여 개고 심 생성은 드물다. 이분 탐색은 경계 실수를 부른다.
  for (let i = 0; i < CUM.length; i++) if (r < CUM[i]) return SURNAMES[i].hangul;
  return SURNAMES[SURNAMES.length - 1].hangul; // 합계가 SCALE이면 도달하지 않는다
}

// 표시 이름. 성이 없는 아주 오래된 세이브도 이름만으로 표시된다.
export function fullName(sim) {
  if (!sim) return '';
  return `${sim.surname ?? ''}${sim.name ?? ''}`;
}
