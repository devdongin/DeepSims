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
  let oracleWorld = w;
  // #71 adds schema metadata and an accounting event even at the unchanged 100%
  // copay default. Keep the PRE-optimization vectors, not newly generated golden values.
  // Normalize only these documented observational additions. A real subsidy, family
  // payment, changed choice or changed balance must still fail the old-world oracle.
  if (w.schemaVersion === 58 && w.logic.logicSchemaVersion === 53) {
    assert.equal(w.logic.economy.healthCopayPct, 100);
    assert.equal(w.policy.healthCopayPct, undefined);
    assert.equal(w.logic.economy.childAllowance, 0);
    assert.equal(w.policy.childAllowance, undefined);
    assert.equal(w.childAllowanceDay, -1);
    oracleWorld = structuredClone(w);
    oracleWorld.schemaVersion = 57; oracleWorld.logic.logicSchemaVersion = 52;
    delete oracleWorld.logic.economy.healthCopayPct;
    delete oracleWorld.logic.economy.childAllowance;
    delete oracleWorld.childAllowanceDay;
    let lastTick = -1, ordinal = 0;
    events = events.filter(e => {
      if (e.type !== 'medical_visit_paid') return true;
      assert.equal(e.payload.subsidy, 0); assert.equal(e.payload.copayPct, 100);
      assert.deepEqual(e.payload.payments, [{ simId: e.simId, amount: e.payload.cost }]);
      return false;
    }).map(e => {
      const normalized = structuredClone(e);
      if (normalized.type === 'money_changed' && normalized.payload.patientId !== undefined) {
        assert.equal(normalized.payload.action, 'see_doctor');
        assert.equal(normalized.payload.patientId, normalized.simId);
        delete normalized.payload.patientId;
      }
      if (e.tick !== lastTick) { lastTick = e.tick; ordinal = 0; }
      normalized.ordinal = ordinal++;
      return normalized;
    });
  }
  return {
    candidates: fnv1a(serialize(before)),
    choices: fnv1a(serialize(events.filter(e => e.type === 'action_started'))),
    events: fnv1a(serialize(events)), world: hashWorld(oracleWorld),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const pop of [10, 50, 200]) console.log(pop, candidateContract(pop));
}
