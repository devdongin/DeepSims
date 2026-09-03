import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { ABILITIES, makeAbilities, initializeDevelopment, developFromActivity, developWithAge } from '../sim/abilities.js';
import { simView } from '../server/view.js';

test('#96 potential preserves original hashes, current values leave room for development', () => {
  const w = createWorld(96);
  for (const s of w.sims) {
    assert.deepEqual(s.potential, makeAbilities(w.seed, s.id));
    for (const k of ABILITIES) assert.ok(s.abilities[k] >= 0 && s.abilities[k] <= s.potential[k]);
  }
  assert.deepEqual(simView(w.sims[0]).abilities, w.sims[0].abilities);
});

test('#96 real performing ticks teach; walking, hunger and illness cannot fabricate growth', () => {
  const w = createWorld(96), s = w.sims[0];
  w.logic.development.ticksPerPoint = 2;
  s.abilities.intellect = 1; s.potential.intellect = 80;
  s.state = { ...s.state, kind:'walking', action:'read' };
  const evs = [], emit = (type,simId,payload) => evs.push({type,simId,payload});
  developFromActivity(w,s,1,emit);
  assert.equal(s.development.studyTicks, 0);
  s.state.kind = 'performing'; s.needs.hunger = 0;
  developFromActivity(w,s,2,emit);
  assert.equal(s.development.studyTicks, 1);
  assert.equal(s.abilities.intellect, 1);
  s.needs.hunger = 9000; s.needs.energy = 9000; s.sick = {kind:'cold'};
  developFromActivity(w,s,3,emit);
  assert.equal(s.abilities.intellect, 1);
  s.sick = null;
  developFromActivity(w,s,4,emit); developFromActivity(w,s,5,emit);
  assert.equal(s.abilities.intellect, 2);
  assert.equal(evs.length, 1);
  s.state.action = 'work'; s.traits.occupation = 'doctor';
  developFromActivity(w,s,6,emit); developFromActivity(w,s,7,emit);
  assert.equal(s.development.careerTicks.doctor, 2);
  assert.equal(s.abilities.intellect, 3);
  s.traits.occupation = 'clerk'; s.abilities.charisma = 1;
  developFromActivity(w,s,8,emit);
  assert.equal(s.development.careerTicks.clerk, 1);
  assert.equal(s.development.careerTicks.doctor, 2);
});

test('#96 age growth accumulates fractional years, declines later and never exceeds potential', () => {
  const w = createWorld(96), s = w.sims[0];
  s.traits.age = 0; initializeDevelopment(s,w.seed,w.logic);
  s.development.lastAge = 0;
  s.potential = Object.fromEntries(ABILITIES.map(k => [k, 20]));
  s.abilities = Object.fromEntries(ABILITIES.map(k => [k, 2]));
  s.sick = null; s.needs.hunger = 9000;
  for (let age=1;age<=25;age++) { s.traits.age=age; developWithAge(w,s,age,()=>{}); }
  assert.equal(s.abilities.intellect, 14, 'small yearly fractions must accumulate, not round to zero every year');
  s.traits.age = 70; developWithAge(w,s,70,()=>{});
  assert.ok(s.abilities.stamina < 14);
  assert.equal(s.abilities.intellect, 14);
  w.logic.development.ticksPerPoint = 1;
  s.state.kind='performing'; s.state.action='read';
  for(let t=0;t<100;t++) developFromActivity(w,s,t,()=>{});
  assert.equal(s.abilities.intellect, s.potential.intellect);
});

test('#96 actual tick integration, RNG independence and save/resume preserve development', () => {
  const run = restore => {
    let w = createWorld(96);
    w.lastDailyDay=0;w.lastPlanDay=0;
    w.logic.development.ticksPerPoint=2;
    const s=w.sims[0];
    s.potential.intellect=80;s.abilities.intellect=1;
    s.state={...s.state,kind:'performing',action:'read',ticksLeft:100};
    const evs = [...tick(w)];
    if(restore) w=migrateWorld(deserialize(serialize(w)));
    evs.push(...tick(w));
    assert.ok(evs.some(e=>e.type==='ability_changed'));
    return { hash:hashWorld(w),evs };
  };
  assert.deepEqual(run(true),run(false));
  const w=createWorld(96), rng=JSON.stringify(w.rngSim);
  w.sims[0].state={...w.sims[0].state,kind:'performing',action:'read'};
  developFromActivity(w,w.sims[0],1,()=>{});
  assert.equal(JSON.stringify(w.rngSim),rng);
});

test('#96 v52 migration preserves current values exactly without invented experience', () => {
  const w=createWorld(96);w.schemaVersion=52;
  for(const s of w.sims){delete s.potential;delete s.development;}
  const before=w.sims.map(s=>({...s.abilities}));
  const migrated=migrateWorld(w);
  assert.deepEqual(migrated.sims.map(s=>s.abilities),before);
  assert.ok(migrated.sims.every(s=>s.development.studyTicks===0));
  assert.equal(hashWorld(migrated),hashWorld(migrateWorld(deserialize(serialize(migrated)))));
});
