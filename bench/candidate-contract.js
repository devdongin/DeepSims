// #97 baseline oracle: ordered candidates (including every score/modifier), choices,
// emitted events and world hash. Run before/after the optimization on the same seed.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createWorld, advance, hashWorld, serialize, fnv1a } from '../sim/index.js';
import { collectCandidates } from '../sim/tick.js';
import { ACTIONS } from '../sim/constants.js';
import { makeSynthWorld } from './synthpop.js';

export function candidateContract(pop = 50) {
  const w = pop === 10 ? createWorld(20260831) : makeSynthWorld(20260831, pop);
  const before = [];
  const sample = () => {
    for (const sim of w.sims.slice(0, 10)) {
      before.push(collectCandidates(w, sim, ACTIONS, w.worldTick + 1, true));
    }
  };
  sample();
  // Foreign reservations, self reservations and cooldown expiry are deliberately mixed.
  for (const [i, fac] of w.map.facilities.entries()) {
    for (const [j, res] of fac.resources.entries()) {
      const key = `${fac.id}:${res.id}`;
      if ((i + j) % 3 === 0) w.reservations[key] = 0;
      else if ((i + j) % 3 === 1) w.reservations[key] = 99999;
      w.sims[0].noPathCool[key] = j % 2 ? 0 : 10;
    }
  }
  sample();
  w.reservations = {};
  let events = advance(w, {}, 240);
  sample();
  // #48 adds observation only: remove precisely the new ledger fields to retain
  // the pre-instrumentation behavior oracle (candidate/choice/event vectors unchanged).
  const baseline = { ...w, schemaVersion: 60 };
  delete baseline.transportStats;
  baseline.statsHistory = w.statsHistory.map(({ transport, ...row }) => row);
  return {
    candidates: fnv1a(serialize(before)),
    choices: fnv1a(serialize(events.filter(e => e.type === 'action_started'))),
    events: fnv1a(serialize(events)), world: hashWorld(baseline),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const pop of [10, 50, 200]) console.log(pop, candidateContract(pop));
}
