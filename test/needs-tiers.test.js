import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick, actionBlockReason, collectCandidates } from '../sim/tick.js';
import { updateNeedsTier, completeCultureVisit, CULTURE_ACTION } from '../sim/needs-tiers.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { emptyState } from '../sim/simfactory.js';

test('#91 promotion counts actual fulfilled ticks, never wealth, age, occupation or degree', () => {
  const w=createWorld(91), s=w.sims[0], events=[];
  const traits=serialize(s.traits), education=serialize(s.education);
  w.logic.needsTiers.promoteTicks=3;
  s.money=1000000;s.needs={hunger:5000,energy:5000,social:5000,fun:3999};
  for(let i=0;i<5;i++)updateNeedsTier(s,w.logic,(...a)=>events.push(a));
  assert.equal(s.needsTier.fulfilledTicks,0);assert.equal(s.needsTier.level,0);
  s.needs.fun=4000;
  for(let i=0;i<2;i++)updateNeedsTier(s,w.logic,(...a)=>events.push(a));
  assert.equal(s.needsTier.level,0);updateNeedsTier(s,w.logic,(...a)=>events.push(a));
  assert.equal(s.needsTier.level,1);assert.equal(events.length,1);
  assert.equal(serialize(s.traits),traits);assert.equal(serialize(s.education),education);assert.equal(s.money,1000000);
});

test('#91 only consecutive basic deprivation demotes; culture deficit alone cannot demote', () => {
  const w=createWorld(91),s=w.sims[0];s.needsTier.level=1;s.needsTier.culture=0;
  w.logic.needsTiers.demoteTicks=3;s.needs={hunger:5000,energy:5000,social:5000,fun:0};
  for(let i=0;i<5;i++)updateNeedsTier(s,w.logic,()=>{});assert.equal(s.needsTier.level,1);
  s.needs.hunger=0;updateNeedsTier(s,w.logic,()=>{});updateNeedsTier(s,w.logic,()=>{});
  s.needs.hunger=5000;updateNeedsTier(s,w.logic,()=>{});assert.equal(s.needsTier.deprivedTicks,0);
  s.needs.hunger=0;for(let i=0;i<3;i++)updateNeedsTier(s,w.logic,()=>{});
  assert.equal(s.needsTier.level,0);assert.equal(s.needsTier.fulfilledTicks,0);
});

test('#91 culture is a real facility-to-consumer service with conserved payment and completion revalidation', () => {
  const w=createWorld(91),s=w.sims[0],f=w.map.facilities.find(f=>f.type==='library');
  s.needsTier.level=1;s.needsTier.culture=0;s.money=1000;f.revenue=0;
  assert.equal(actionBlockReason(w,s,CULTURE_ACTION,1),null);
  assert.ok(collectCandidates(w,s,[CULTURE_ACTION],1).length>0);
  assert.equal(completeCultureVisit(w,s,f.id,()=>{}).ok,true);
  assert.equal(s.money+f.revenue,1000);assert.equal(s.needsTier.visits,1);
  s.needsTier.culture=0;s.money=200;
  assert.equal(completeCultureVisit(w,s,f.id,()=>{}).reason,'no_money');
  assert.equal(s.needsTier.culture,0);assert.equal(s.money,200);
  s.money=1000;assert.equal(completeCultureVisit(w,s,'missing',()=>{}).ok,false);
});

test('#91 old saves receive no fabricated past fulfillment and preserve RNG', () => {
  const w=createWorld(91);w.schemaVersion=64;w.logic.logicSchemaVersion=61;
  delete w.logic.needsTiers;delete w.logic.actions[CULTURE_ACTION];
  for(const s of w.sims)delete s.needsTier;const rng=serialize(w.rngSim);
  migrateWorld(w);assert.equal(w.schemaVersion,65);assert.equal(w.logic.logicSchemaVersion,62);
  assert.ok(w.sims.every(s=>s.needsTier.level===0&&s.needsTier.fulfilledTicks===0));
  assert.equal(serialize(w.rngSim),rng);const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
});

test('#91 live ticks and save/resume preserve promotion and all events exactly', () => {
  const a=createWorld(91);a.logic.needsTiers.promoteTicks=2;
  for(const s of a.sims)s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  const b=deserialize(serialize(a));const events=[];
  for(let i=0;i<10;i++){const ea=tick(a),eb=tick(b);assert.deepEqual(ea,eb);events.push(...ea);}
  assert.ok(events.some(e=>e.type==='needs_tier_changed'));assert.equal(hashWorld(a),hashWorld(b));
});

test('#91 culture visits require actual travel and survive saving on the way', () => {
  const w=createWorld(91),s=w.sims[0];w.lastDailyDay=0;
  for(const p of w.sims)p.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:10000};
  s.state=emptyState();s.needsTier.level=1;s.needsTier.culture=0;s.money=1000;
  s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  const events=tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:CULTURE_ACTION}}]);
  assert.ok(events.some(e=>e.type==='action_started'&&e.payload.action===CULTURE_ACTION));
  assert.equal(s.state.kind,'walking');assert.equal(s.needsTier.visits,0);
  const copy=deserialize(serialize(w));
  for(let i=0;i<300;i++)assert.deepEqual(tick(w),tick(copy));
  assert.ok(s.needsTier.visits>0);assert.equal(hashWorld(w),hashWorld(copy));
});

test('#91 missing cultural service records a real wish, but inability to pay does not request construction', () => {
  for(const money of [1000,0]){
    const w=createWorld(91),s=w.sims[0];w.lastDailyDay=0;
    w.map.facilities=w.map.facilities.filter(f=>!['library','cinema'].includes(f.type));
    for(const p of w.sims)p.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:10000};
    s.state=emptyState();s.needsTier.level=1;s.needsTier.culture=0;s.money=money;
    s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
    tick(w);assert.equal(s.wantedActions.includes(CULTURE_ACTION),money>0);
  }
});
