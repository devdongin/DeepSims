import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { actionBlockReason } from '../sim/tick.js';
import { takePublicMeal } from '../sim/food-aid.js';

function fixture() {
  const w=createWorld(57),s=w.sims[0];
  w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
  for(const x of w.sims)x.state={...x.state,kind:'performing',action:'idle',ticksLeft:10000};
  const f=w.map.facilities.find(f=>f.type==='city_hall'),r=f.resources[0];
  s.traits.age=18;s.traits.occupation='student';s.money=0;s.groceries=0;
  s.needs={hunger:1000,energy:9000,social:9000,fun:9000};
  s.x=r.x;s.y=r.y;s.state={...s.state,kind:'idle'};
  w.treasury=20000;
  return {w,s,f,r};
}

test('#57 food aid is limited to hungry residents without a paid meal or groceries', () => {
  const {w,s}=fixture();
  assert.equal(actionBlockReason(w,s,'seek_food_aid',601),null);
  s.money=w.logic.actions.eat.cost;assert.equal(actionBlockReason(w,s,'seek_food_aid',601),'not_needed');
  s.money=0;s.groceries=1;assert.equal(actionBlockReason(w,s,'seek_food_aid',601),'not_needed');
  s.groceries=0;s.needs.hunger=w.logic.needCritical;
  assert.equal(actionBlockReason(w,s,'seek_food_aid',601),'not_needed');
  s.needs.hunger=0;w.treasury=w.logic.actions.seek_food_aid.mealCost-1;
  assert.equal(actionBlockReason(w,s,'seek_food_aid',601),'no_funds');
});

test('#57 public meal requires real attendance and full performance before recovery or payment', () => {
  const {w,s}=fixture(),beforeTreasury=w.treasury,out=w.externalOutflow??0,events=[];
  events.push(...tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'seek_food_aid'}}]));
  assert.equal(s.state.action,'seek_food_aid');
  assert.ok(s.needs.hunger<1000);assert.equal(w.treasury,beforeTreasury);
  assert.equal(events.some(e=>e.type==='public_meal_taken'),false);
  for(let i=0;i<35;i++)events.push(...tick(w));
  const meals=events.filter(e=>e.type==='public_meal_taken'&&e.simId===s.id);
  assert.equal(meals.length,1);assert.ok(s.needs.hunger>8000);
  assert.equal(s.money,0);assert.equal(w.treasury,beforeTreasury-200);
  assert.equal(w.externalOutflow,out+200);
  assert.equal(w.treasury+w.externalOutflow,beforeTreasury+out,'closed boundary ledger');
  assert.equal(events.some(e=>e.type==='money_changed'&&e.simId===s.id),false);
});

test('#57 cancellation, invalid site and treasury exhaustion grant no free meal or debt', () => {
  for(const kind of ['cancel','wrong_site','treasury']) {
    const {w,s,f,r}=fixture();
    s.state={...s.state,kind:'performing',action:'seek_food_aid',facilityId:f.id,resourceId:r.id,ticksLeft:1};
    if(kind==='cancel')s.state={...s.state,kind:'performing',action:'idle',ticksLeft:10000};
    if(kind==='wrong_site')s.x++;
    if(kind==='treasury')w.treasury=199;
    const treasury=w.treasury,out=w.externalOutflow??0;
    const events=tick(w);
    assert.equal(events.some(e=>e.type==='public_meal_taken'&&e.simId===s.id),false,kind);
    assert.ok(s.needs.hunger<=1000,kind);assert.equal(w.treasury,treasury);
    assert.equal(w.externalOutflow??0,out);
  }
});

test('#57 simultaneous requests cannot overspend the last public meal', () => {
  const {w,s,f,r}=fixture(),other=w.sims[1];
  w.treasury=200;
  for(const x of [s,other]) {
    x.money=0;x.groceries=0;x.needs.hunger=1000;x.x=r.x;x.y=r.y;
    x.state={...x.state,kind:'performing',action:'seek_food_aid',facilityId:f.id,resourceId:r.id,ticksLeft:0};
  }
  assert.equal(takePublicMeal(w,s,()=>{}),true);
  assert.equal(takePublicMeal(w,other,()=>{}),false);
  assert.equal(w.treasury,0);assert.equal(other.needs.hunger,1000);
});

test('#57 walking to the service counter does not feed a resident remotely', () => {
  const {w,s}=fixture();
  const home=w.map.facilities.find(f=>f.id===s.homeId);
  s.x=home.door.x;s.y=home.door.y;
  const treasury=w.treasury;
  const events=tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'seek_food_aid'}}]);
  assert.equal(s.state.kind,'walking');assert.equal(s.state.action,'seek_food_aid');
  assert.ok(s.needs.hunger<1000);assert.equal(w.treasury,treasury);
  assert.equal(events.some(e=>e.type==='public_meal_taken'),false);
});

test('#57 autonomous choice and save/resume preserve the same meal and RNG trajectory', () => {
  const {w,s}=fixture();
  const b=deserialize(serialize(w));
  tick(w);tick(b);assert.equal(s.state.action,'seek_food_aid');
  const resumed=migrateWorld(deserialize(serialize(b)));
  for(let i=0;i<100;i++){tick(w);tick(resumed);}
  assert.equal(hashWorld(w),hashWorld(resumed));
  const old=fixture().w;old.schemaVersion=55;old.logic.logicSchemaVersion=50;delete old.logic.actions.seek_food_aid;
  const treasury=old.treasury;
  migrateWorld(old);assert.equal(old.logic.actions.seek_food_aid.mealCost,200);
  assert.equal(old.treasury,treasury);assert.equal(hashWorld(old),hashWorld(migrateWorld(deserialize(serialize(old)))));
});
