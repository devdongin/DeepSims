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

// The original hash remains the potential. Current values and observed experience are saved.
export function initializeDevelopment(sim, seed, L, preserveCurrent = false) {
  sim.potential ??= makeAbilities(seed, sim.id);
  sim.development ??= { studyTicks: 0, careerTicks: {}, progress: {}, lastAge: sim.traits.age };
  if (!preserveCurrent) {
    const G = L.development;
    const pct = G.birthPct + Math.floor(Math.min(sim.traits.age, G.matureAge) * (G.adultPct - G.birthPct) / G.matureAge);
    sim.abilities = Object.fromEntries(ABILITIES.map(k => [k, Math.floor(sim.potential[k] * pct / 100)]));
  }
}

export function developFromActivity(world, sim, t, emit) {
  const s = sim.state, D = sim.development, G = world.logic.development;
  if (!D || s.kind !== 'performing') return;
  let key = null, source = null;
  if (s.action === 'read' || s.action === 'study') { key = 'intellect'; source = 'study'; }
  else if (s.action === 'work') {
    key = world.logic.abilities.keyAbility[sim.traits.occupation];
    source = sim.traits.occupation === 'student' ? 'study' : 'career';
  } else if (s.action === 'exercise') { key = 'stamina'; source = 'exercise'; }
  // §23.8 여가도 사람을 기른다. 노는 시간이 그저 사라지지 않게 한다.
  else if (s.action === 'music') { key = 'dexterity'; source = 'exercise'; }
  else if (s.action === 'garden') { key = 'dexterity'; source = 'exercise'; }
  else if (s.action === 'stroll') { key = 'stamina'; source = 'exercise'; }
  else if (s.action === 'volunteer') { key = 'charisma'; source = 'exercise'; }
  else if (s.action === 'board_game') { key = 'intellect'; source = 'study'; }
  if (!key || !source) return;
  if (source === 'study') D.studyTicks = Math.min(1000000000, D.studyTicks + 1);
  if (source === 'career') {
    const occupation = sim.traits.occupation;
    D.careerTicks[occupation] = Math.min(1000000000, (D.careerTicks[occupation] ?? 0) + 1);
  }
  // Experience is observed even in hardship, but hunger/illness can prevent learning.
  if (sim.sick || sim.needs.hunger < world.logic.needCritical || sim.needs.energy < world.logic.needCritical) return;
  const cap = abilityCap(sim, key, G);
  if (sim.abilities[key] >= cap) return;
  D.progress[key] = (D.progress[key] ?? 0) + 1;
  if (D.progress[key] < G.ticksPerPoint) return;
  D.progress[key] -= G.ticksPerPoint;
  sim.abilities[key]++;
  emit('ability_changed', sim.id, { ability: key, value: sim.abilities[key], potential: sim.potential[key], source });
}

function abilityCap(sim, key, G) {
  const onset = key === 'stamina' || key === 'dexterity' ? G.physicalDeclineAge : G.mentalDeclineAge;
  const decline = Math.max(0, sim.traits.age - onset) * G.declinePctPerYear;
  return Math.floor(sim.potential[key] * Math.max(G.minAgePct, 100 - decline) / 100);
}

export function developWithAge(world, sim, t, emit) {
  const D = sim.development, G = world.logic.development;
  if (!D || D.lastAge >= sim.traits.age) return;
  const nourished = !sim.sick && sim.needs.hunger >= world.logic.needCritical;
  for (const key of ABILITIES) {
    const before = sim.abilities[key];
    const naturalAt = age => Math.floor(sim.potential[key] * Math.min(age, G.matureAge) * (G.adultPct - G.birthPct) / (100 * G.matureAge));
    const delta = nourished ? naturalAt(sim.traits.age) - naturalAt(D.lastAge) : 0;
    const onset = key === 'stamina' || key === 'dexterity' ? G.physicalDeclineAge : G.mentalDeclineAge;
    const lossAt = age => Math.floor(sim.potential[key] * Math.min(100 - G.minAgePct,
      Math.max(0, age - onset) * G.declinePctPerYear) / 100);
    const loss = lossAt(sim.traits.age) - lossAt(D.lastAge);
    sim.abilities[key] = Math.max(0, Math.min(abilityCap(sim, key, G), before + delta - loss));
    if (sim.abilities[key] !== before) emit('ability_changed', sim.id,
      { ability: key, value: sim.abilities[key], potential: sim.potential[key], source: 'age' });
  }
  D.lastAge = sim.traits.age;
}

// 그 직업이 요구하는 핵심 능력값 (0~99). 매핑에 없는 직업은 50(중립) — 이분 컷이 아니라 기준선이다.
export function aptitudeFor(sim, occupation, L) {
  const key = L.abilities.keyAbility[occupation];
  if (key === undefined) return 50;
  return sim.abilities?.[key] ?? 50;
}
