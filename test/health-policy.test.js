import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, hashWorld, migrateWorld } from '../sim/index.js';
import { validatePolicy } from '../sim/logic.js';
import { actionBlockReason } from '../sim/tick.js';
import { medicalQuote, completeMedicalVisit } from '../sim/health-policy.js';
import { remitPublicRevenue } from '../sim/society.js';

function fixture() {
  const w = createWorld(71), s = w.sims[0];
  w.worldTick = 600; w.lastDailyDay = 0; w.lastPlanDay = 0;
  for (const p of w.sims) p.state = { ...p.state, kind: 'performing', action: 'idle', ticksLeft: 10000 };
  const f = w.map.facilities.find(f => f.type === 'hospital'), r = f.resources[0];
  s.traits.age = 30; s.traits.occupation = 'office_worker'; s.money = 1000;
  s.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 };
  s.sick = { kind: 'cold', untilTick: 10000 }; s.x = r.x; s.y = r.y;
  s.state = { ...s.state, kind: 'performing', action: 'see_doctor', facilityId: f.id, resourceId: r.id, ticksLeft: 0 };
  w.reservations[`${f.id}:${r.id}`] = s.id; f.revenue = 0; w.treasury = 1000;
  return { w, s, f, r };
}
const wealth = w => w.treasury + w.sims.reduce((n,s) => n+s.money,0) + w.map.facilities.reduce((n,f) => n+(f.revenue??0),0);

test('#71 copay policy accepts only integer percentages and migrates without retroactive money', () => {
  for (const n of [0, 25, 100]) assert.equal(validatePolicy({ healthCopayPct: n }).ok, true);
  for (const n of [-1, 101, 0.5, '50', null]) assert.equal(validatePolicy({ healthCopayPct: n }).ok, false);
  const { w } = fixture(), before = wealth(w), rng = serialize(w.rngSim);
  w.schemaVersion = 57; w.logic.logicSchemaVersion = 52; delete w.logic.economy.healthCopayPct;
  migrateWorld(w);
  assert.equal(w.schemaVersion, 64); assert.equal(w.logic.economy.healthCopayPct, 100);
  assert.equal(wealth(w), before); assert.equal(serialize(w.rngSim), rng);
});

test('#71 attended visit conserves funds and distinguishes gross subsidy from remittance', () => {
  const { w, s, f } = fixture(); w.policy.healthCopayPct = 25;
  const before = wealth(w), events = [];
  assert.equal(completeMedicalVisit(w, s, (type,id,payload) => events.push({ type,id,payload })), true);
  assert.equal(s.money, 800); assert.equal(w.treasury, 400); assert.equal(f.revenue, 800);
  assert.equal(s.sick, null); assert.equal(wealth(w), before);
  assert.equal(events.find(e=>e.type==='medical_visit_paid').payload.subsidy, 600);
  remitPublicRevenue(w, 1440, () => {});
  assert.equal(w.treasury, 1200, 'public transfer returns; net receipt is patient 200');
  assert.equal(wealth(w), before);
  assert.equal(completeMedicalVisit(w, s, () => {}), false, 'no duplicate payment');
});

test('#71 family payment uses live cohabiting parents, never roommates or absent parents', () => {
  const { w, s } = fixture(); s.traits.age = 18; s.traits.occupation = 'student'; s.money = 0;
  const [a,b] = w.sims.slice(1,3); a.homeId = s.homeId; a.money = 500; b.homeId = s.homeId; b.money = 500;
  w.parents[s.id] = [b.id,a.id,a.id];
  const q = medicalQuote(w,s);
  assert.deepEqual(q.payments, [{ simId:a.id, amount:500 }, { simId:b.id, amount:300 }]);
  b.homeId = 'elsewhere'; assert.equal(medicalQuote(w,s).ok,false);
  w.parents[s.id] = []; assert.equal(medicalQuote(w,s).ok,false);
  w.parents[s.id] = [a.id]; w.sims = w.sims.filter(p=>p!==a);
  assert.equal(medicalQuote(w,s).ok,false);
  assert.notEqual(actionBlockReason(w,s,'work',601),null);
});

test('#71 cancellation, invalid location, reservation loss and depleted funds cannot heal', () => {
  for (const mutate of [
    ({s})=>{s.state.kind='walking';}, ({s})=>{s.state.ticksLeft=1;},
    ({s})=>{s.x++;}, ({w})=>{w.reservations={};},
    ({s})=>{s.money=0;}, ({w,s})=>{w.policy.healthCopayPct=0;w.treasury=0;s.money=0;},
  ]) {
    const x=fixture(); mutate(x); const before=serialize(x.w);
    assert.equal(completeMedicalVisit(x.w,x.s,()=>assert.fail('unexpected event')),false);
    assert.equal(serialize(x.w),before);
  }
});

test('#71 treasury exhaustion falls back to actual patient funds without debt', () => {
  const {w,s}=fixture(); w.policy.healthCopayPct=0; w.treasury=300; s.money=500;
  assert.equal(completeMedicalVisit(w,s,()=>{}),true);
  assert.equal(w.treasury,0); assert.equal(s.money,0);
});

test('#71 durable policy, actual completion and save/resume use the same funds and RNG', () => {
  const {w,s}=fixture(); s.money=200; s.state.ticksLeft=2;
  const saved=deserialize(serialize(w));
  const input={sequence:1,command:'policy',payload:{healthCopayPct:25}};
  const a=[...tick(w,[input]),...tick(w,[])], b=[...tick(saved,[input]),...tick(saved,[])];
  assert.deepEqual(a,b); assert.equal(hashWorld(w),hashWorld(saved));
  assert.equal(s.sick,null); assert.equal(s.money,0);
  assert.equal(a.filter(e=>e.type==='medical_visit_paid').length,1);
  assert.ok(a.some(e=>e.type==='policy_changed' && e.payload.changes.healthCopayPct===25));
});
