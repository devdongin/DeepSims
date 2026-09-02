// §21.1 심 능력치 (이슈 #62) — 사람마다 잘하는 게 다르다.
//
// **RNG를 소비하지 않는다.** dayHash와 같은 Math.imul 믹서로 (seed, simId, 능력)에서 유도하므로
// §17.8 드로우 순서 계약이 전혀 바뀌지 않고, 기존 세이브의 심도 마이그레이션에서 즉시 값을 갖는다.
// 값은 sim.abilities에 저장해 스냅샷·UI에서 보이게 하고, 나중에 경험으로 자라날 자리를 남긴다.

export const ABILITIES = ['stamina', 'dexterity', 'intellect', 'charisma'];

// seed가 없는 아주 오래된 세이브 대비 폴백 (82차 ②). 그냥 두면 undefined + 1 = NaN이 되고
// Math.imul(NaN, x) = 0이라, **다른 시드의 세계가 같은 능력치를 갖는** 조용한 오류가 된다.
// 마이그레이션을 실패시키지 않되(세이브를 못 쓰게 만들 수는 없다) 값이 우연히 맞아떨어지지
// 않도록 명시적인 상수를 쓴다.
export const FALLBACK_SEED = 0x5EED1;

// 0~99. seed·simId·능력 인덱스에서 결정적으로 유도 (chrono.js dayHash와 같은 믹서 계열).
export function abilityValue(seed, simId, idx) {
  const s = Number.isSafeInteger(seed) ? seed : FALLBACK_SEED;
  let h = Math.imul(s + 1, 2654435761) ^ Math.imul(simId + 1, 40503) ^ Math.imul(idx + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 15), 3266489917);
  h = Math.imul(h ^ (h >>> 13), 668265263);
  return ((h ^ (h >>> 16)) >>> 0) % 100;
}

export function makeAbilities(seed, simId) {
  const out = {};
  for (let i = 0; i < ABILITIES.length; i++) out[ABILITIES[i]] = abilityValue(seed, simId, i);
  return out;
}

// 그 직업이 요구하는 핵심 능력값 (0~99). 매핑에 없는 직업은 50(중립) — 이분 컷이 아니라 기준선이다.
export function aptitudeFor(sim, occupation, L) {
  const key = L.abilities.keyAbility[occupation];
  if (key === undefined) return 50;
  return sim.abilities?.[key] ?? 50;
}
