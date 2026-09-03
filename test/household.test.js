import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { migrateWorld } from '../sim/migrate.js';
import { evaluateHouseholds, applyHouseholdIntents } from '../sim/household.js';
import { simView } from '../server/view.js';
import { serialize, deserialize } from '../sim/serialize.js';

function fixture() {
  const w=createWorld(51),parent=w.sims[0],child=w.sims[1];
  parent.traits.age=50; child.traits.age=19; child.traits.occupation='office_worker'; child.money=5000;
  child.homeId=parent.homeId; child.householdId=parent.householdId; w.parents[child.id]=[parent.id];
  w.logic.household={independenceAge:19,stableDays:2,reserveMoney:2400};
  for(const s of w.sims.filter(s=>s.homeId==='house4'))s.homeId='house3';
  const events=[],emit=(type,simId,payload)=>events.push({type,simId,payload});
  return{w,parent,child,events,emit};
}

test('#51 stable employed adult child creates a durable intent, then separates on the next tick',()=>{
  const{w,child,events,emit}=fixture();
  evaluateHouseholds(w,100,1,emit);assert.equal(w.householdIntents.length,0);
  evaluateHouseholds(w,200,2,emit);assert.equal(w.householdIntents.length,1);assert.equal(child.homeId,'house0');
  const intent=w.householdIntents[0];assert.equal(intent.applyTick,201);
  applyHouseholdIntents(w,200,emit);assert.equal(child.homeId,'house0');
  applyHouseholdIntents(w,201,emit);assert.equal(child.homeId,'house4');
  assert.notEqual(child.householdId,w.sims[0].householdId);
  assert.deepEqual(events.filter(e=>e.type.startsWith('household_intent')).map(e=>e.type),
    ['household_intent_created','household_intent_applied']);
});

test('#51 next-tick revalidation rejects lost reserves without moving or inventing money',()=>{
  const{w,child,events,emit}=fixture();
  evaluateHouseholds(w,100,1,emit);evaluateHouseholds(w,200,2,emit);
  const total=w.sims.reduce((n,s)=>n+s.money,0);child.money=0;
  applyHouseholdIntents(w,201,emit);
  assert.equal(child.homeId,'house0');assert.equal(child.independenceDays,0);
  assert.equal(events.at(-1).payload.reason,'reserve_short');
  assert.equal(w.sims.reduce((n,s)=>n+s.money,0),total-5000);
});

test('#51 roommates and students do not become adult-child separation candidates',()=>{
  const{w,parent,child,emit}=fixture();w.logic.household.stableDays=1;
  w.parents[child.id]=[];evaluateHouseholds(w,100,1,emit);assert.equal(w.householdIntents.length,0);
  w.parents[child.id]=[parent.id];child.traits.occupation='student';evaluateHouseholds(w,200,2,emit);
  assert.equal(w.householdIntents.length,0);assert.equal(child.independenceDays,0);
});

test('#51 daily household observation reports family, money, income, employment and bed capacity',()=>{
  const{w,child,emit}=fixture();evaluateHouseholds(w,100,1,emit);
  const row=w.householdDaily.households.find(h=>h.householdId===child.householdId);
  assert.deepEqual(row.members,[0,1]);assert.equal(row.money,w.sims[0].money+child.money);
  assert.equal(Number.isSafeInteger(row.employed),true);assert.equal(row.beds,2);assert.equal(row.freeBeds,0);
  assert.equal(row.income,row.residents.reduce((n,r)=>n+r.income,0));
  assert.equal(row.residents.every(r=>Number.isSafeInteger(r.income)),true);
  assert.deepEqual(row.residents[1].parentIds,[0]);
  w.logic.household.stableDays=1;evaluateHouseholds(w,200,2,emit);child.money=0;applyHouseholdIntents(w,201,emit);
  assert.equal(w.householdDaily.failures.reserve_short,1);
});

test('#51 no vacant residence prevents stability from accumulating',()=>{
  const { w,child,emit }=fixture();
  const homes=w.map.facilities.filter(f=>f.type==='house'&&f.id!=='house0');
  homes.forEach((home,i)=>{w.sims[i+2].homeId=home.id;});
  evaluateHouseholds(w,100,1,emit);
  assert.equal(child.independenceDays,0);assert.equal(w.householdIntents.length,0);
});

test('#51 client projection exposes residence and household identity',()=>{
  const { child }=fixture();const view=simView(child);
  assert.equal(view.homeId,child.homeId);assert.equal(view.householdId,child.householdId);
});

test('#51 v58 migration derives households deterministically and preserves married households across homes',()=>{
  const w=createWorld(51),rng=JSON.stringify(w.rngSim);w.schemaVersion=58;
  for(const s of w.sims){delete s.householdId;delete s.independenceDays;}
  delete w.householdIntents;delete w.nextHouseholdIntentId;delete w.householdDaily;
  w.partners[0]=2;w.partners[2]=0;w.partnerStage[0]='married';w.partnerStage[2]='married';
  const m=migrateWorld(w);
  assert.equal(m.sims[0].householdId,m.sims[2].householdId);
  assert.equal(m.sims[1].householdId,'household:house0');
  assert.deepEqual(m.householdIntents,[]);assert.equal(JSON.stringify(m.rngSim),rng);
});

test('#51 pending intent survives canonical save/resume and applies identically',()=>{
  const {w,emit}=fixture();evaluateHouseholds(w,100,1,emit);evaluateHouseholds(w,200,2,emit);
  const resumed=migrateWorld(deserialize(serialize(w))),a=[],b=[];
  applyHouseholdIntents(w,201,(...e)=>a.push(e));applyHouseholdIntents(resumed,201,(...e)=>b.push(e));
  assert.equal(serialize(resumed),serialize(w));assert.deepEqual(b,a);
});
