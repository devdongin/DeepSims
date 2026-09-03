import { makeRng, rngNext } from './prng.js';
import { ABILITIES } from './abilities.js';

// A private stream keyed by this birth: never advance world.rngSim/rngWorldgen.
// Rejection sampling avoids both a percent-resolution floor and modulo bias.
export function geniusAtBirth(seed, id, day, population) {
  const denominator = Math.max(1, population) * 10;
  if (!Number.isSafeInteger(denominator) || denominator > 0x100000000) return false;
  let h = Math.imul(seed + 1, 2654435761) ^ Math.imul(id + 1, 1597334677)
    ^ Math.imul(day + 1, 40503) ^ 0x47454e49;
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  const stream = makeRng(h ^ (h >>> 13));
  const limit = Math.floor(0x100000000 / denominator) * denominator;
  let draw;
  do { draw = rngNext(stream); } while (draw >= limit);
  return draw % denominator === 0;
}

export function applyBirthTalent(world, child, day, t, emit) {
  const population = world.sims.length; // before this newborn is added
  if (!geniusAtBirth(world.seed, child.id, day, population)) return;
  const G = world.logic.development;
  // Special talent is one domain, not an instant all-round maximized adult.
  const ability = ABILITIES.reduce((best, k) => child.potential[k] > child.potential[best] ? k : best);
  const cap = G.geniusMin + child.potential[ability] % (G.geniusMax - G.geniusMin + 1);
  child.isGenius = true;
  child.geniusBirth = { population, denominator: Math.max(1, population) * 10, day, ability, cap };
  child.potential[ability] = cap;
  child.abilities[ability] = Math.floor(cap * G.birthPct / 100);
  emit('genius_born', child.id, { ...child.geniusBirth });
}
