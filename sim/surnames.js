// §22.16 성씨 — 한국 성씨 분포를 확률로 바꿔 심에게 성을 준다.
//
// **rngSim·rngWorldgen을 소비하지 않는다.** §21.1 능력치와 같은 Math.imul 믹서로
// (seed, simId)에서 0~99,999를 유도해 누적분포에 대응시킨다. 그래서 드로우 순서 계약
// (§17.8)이 전혀 바뀌지 않고, 기존 세이브의 심도 마이그레이션에서 즉시 성을 갖는다.
// 이민자마다 rngSim을 한 번 더 뽑았다면 그 시점부터 모든 리플레이가 어긋났을 것이다.
//
// 수치는 통계청 2015 인구주택총조사 성씨·본관 집계의 **인구수(천 명 단위)**다.
// 이 집계는 표본이 아니라 등록센서스(주민등록부+가족관계등록부 전수)다.
//   · 통계청 공표(2016-09-07): https://www.korea.kr/briefing/policyBriefingView.do?newsId=156153833
//   · KOSIS 성씨·본관별 인구(5인 이상): 기관 101, tblId DT_1IN15SD
// 분모는 총인구가 아니라 **5인 이상 성씨 합계 49,705,663명**이다 —
// 김 10,689,959 / 49,705,663 = 21.507%로 공표치 21.5%와 맞는다.
// 비율을 손으로 적지 않고 인구수에서 계산한다 — 그래야 성씨를 넣고 빼도 나머지의
// 상대 비율이 저절로 맞고, 적어 둔 백분율의 합이 눈금과 어긋나는 일이 없다.
//
// **500명 미만 성씨는 제외한다** (사용자 지시). 전체 성씨는 5,582개지만 그중 1,000명
// 이상은 153개뿐이고 그 153개가 인구의 99.8%다 — 나머지 5,429개(대부분 귀화 성씨)는
// 다 합쳐도 0.2%다. 여기 실린 성씨는 전부 수천 명 이상이다.
// 빠진 몫은 정규화에서 남은 성씨에 비례 배분되므로 서로의 상대 비율은 보존되고,
// 표에 실린 성씨가 실제보다 아주 조금씩 흔해진다.
const COUNTS = [
  // 한자가 달라도 **한글이 같으면 합산**한다. 심 이름은 한글로만 보이므로 화면에
  // 나타나는 단위가 곧 한글 성씨다. KOSIS 원표는 (한글, 한자, 본관) 단위라
  // 정(鄭)·정(丁)·정(程)이 따로 잡히는데, 그걸 그대로 쓰면 정씨가 실제보다 10%
  // 드물어지고 유(柳+劉+兪)는 **1.75배나 드물어진다**.
  ['김', 'Kim', 10690], ['이', 'Lee', 7307], ['박', 'Park', 4192],
  ['정', 'Jung', 2399],   // 鄭 2152 + 丁 244 + 程
  ['최', 'Choi', 2334],
  ['조', 'Jo', 1454],     // 趙 1056 + 曺 398
  ['강', 'Kang', 1269],   // 姜 1177 + 康 92 + 強
  ['윤', 'Yoon', 1021],
  ['장', 'Jang', 1015],   // 張 993 + 蔣 22 + 章
  ['임', 'Lim', 1015],    // 林 824 + 任 191
  ['신', 'Shin', 986],    // 申 741 + 辛 193 + 愼 52
  ['유', 'Yoo', 951],     // 柳 479 + 劉 303 + 兪 168 + 庾
  ['한', 'Han', 773], ['오', 'Oh', 763],
  ['전', 'Jeon', 752],    // 全 559 + 田 186 + 錢
  ['서', 'Seo', 751], ['권', 'Kwon', 706], ['황', 'Hwang', 697],
  ['안', 'Ahn', 686], ['송', 'Song', 683], ['홍', 'Hong', 558],
  ['양', 'Yang', 530],    // 梁 461 + 楊 69
  ['고', 'Ko', 471], ['문', 'Moon', 464], ['손', 'Son', 457],
  ['배', 'Bae', 401], ['백', 'Baek', 382], ['허', 'Heo', 326],
  ['노', 'Noh', 315],     // 盧 256 + 魯 59
  ['심', 'Shim', 272],
  ['주', 'Joo', 232],     // 朱 195 + 周 37
  ['하', 'Ha', 230], ['곽', 'Kwak', 203], ['구', 'Koo', 196],
  ['차', 'Cha', 194], ['우', 'Woo', 194], ['성', 'Sung', 189],
  ['진', 'Jin', 179],     // 陳 158 + 秦 19 + 晉
  ['나', 'Na', 172], ['지', 'Ji', 160], ['민', 'Min', 159], ['남', 'Nam', 153],
  ['엄', 'Uhm', 144],
  ['변', 'Byun', 139],    // 卞 78 + 邊 61
  ['원', 'Won', 132], ['채', 'Chae', 131],
  ['방', 'Bang', 128],    // 方 95 + 房 34
  ['천', 'Chun', 118], ['공', 'Kong', 89], ['현', 'Hyun', 88],
  ['여', 'Yeo', 81],      // 呂 61 + 余 20
  ['함', 'Ham', 79], ['염', 'Yeom', 69], ['추', 'Chu', 61],
  ['석', 'Seok', 56], ['도', 'Do', 55], ['소', 'So', 52],
  ['선', 'Sun', 46], ['설', 'Seol', 46], ['명', 'Myung', 39],
  ['위', 'Wi', 39], ['마', 'Ma', 38], ['길', 'Gil', 38],
  ['연', 'Yeon', 33], ['표', 'Pyo', 30], ['반', 'Ban', 27],
  ['기', 'Ki', 26], ['왕', 'Wang', 25], ['금', 'Keum', 24],
  ['옥', 'Ok', 23], ['육', 'Yook', 22], ['인', 'In', 22],
  ['맹', 'Maeng', 21], ['모', 'Mo', 21], ['탁', 'Tak', 21],
  ['제', 'Je', 20], ['국', 'Kook', 20], ['남궁', 'Namgung', 20],
  ['어', 'Eo', 18], ['피', 'Pi', 17], ['봉', 'Bong', 12],
  ['황보', 'Hwangbo', 10], ['제갈', 'Jegal', 5], ['선우', 'Sunwoo', 3],
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
