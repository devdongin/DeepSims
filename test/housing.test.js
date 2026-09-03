import {test} from 'node:test';import assert from 'node:assert/strict';
import {createWorld} from '../sim/world.js';import {landValue,askingRent,settleHousing} from '../sim/housing.js';
import {applyHouseholdIntents} from '../sim/household.js';import {migrateWorld} from '../sim/migrate.js';

const emitter=()=>{const events=[];return{events,emit:(type,simId,payload)=>events.push({type,simId,payload})};};
function oneHousehold(){const w=createWorld(93),home=w.map.facilities.find(f=>f.id==='house0');
 const residents=w.sims.filter(s=>s.homeId===home.id);for(const s of w.sims.filter(s=>s.homeId!==home.id))s.homeId='house1';
 for(const s of residents){s.householdId='hh';s.money=1000;}return{w,home,residents};}

test('#93 land value and asking rent are integer pure functions of proximity and recorded use',()=>{
 const w=createWorld(93),a=w.map.facilities.find(f=>f.id==='house0'),b=w.map.facilities.find(f=>f.id==='house4');
 const before=JSON.stringify(w);const va=landValue(w,a,{}),vb=landValue(w,b,{}),used=landValue(w,a,{market:5});
 assert.equal(Number.isSafeInteger(va)&&Number.isSafeInteger(askingRent(w,a,{})),true);assert.notEqual(va,vb);
 assert.ok(used>va);assert.equal(JSON.stringify(w),before);
});

test('#93 public rent moves exact resident funds to treasury without minting or loss',()=>{
 const{w,residents}=oneHousehold(),{events,emit}=emitter(),before=w.treasury+w.sims.reduce((n,s)=>n+s.money,0);
 settleHousing(w,1,0,emit);const ev=events.find(e=>e.type==='rent_paid'&&e.payload.householdId==='hh');
 assert.ok(ev.payload.paid>0);
 const rent=events.find(e=>e.type==='rent_paid'&&e.payload.householdId==='hh').payload;
 assert.equal(w.treasury+w.sims.reduce((n,s)=>n+s.money,0),before);assert.equal(rent.paid,rent.charged);
});

test('#93 private owner receives exactly what tenants pay',()=>{
 const{w,home,residents}=oneHousehold(),owner=w.sims.find(s=>!residents.includes(s));owner.money=10;home.ownerSimId=owner.id;
 const before=w.sims.reduce((n,s)=>n+s.money,0)+w.treasury,{events,emit}=emitter();settleHousing(w,1,0,emit);
 const p=events.find(e=>e.type==='rent_paid'&&e.payload.householdId==='hh').payload;
 assert.equal(p.recipient,`sim:${owner.id}`);assert.equal(w.sims.reduce((n,s)=>n+s.money,0)+w.treasury,before);
});

test('#93 sustained rent pressure creates a durable intent and moves the whole household next tick',()=>{
 const{w,home,residents}=oneHousehold(),{events,emit}=emitter();w.logic.housing.moveAfterDays=1;w.logic.housing.maxIncomePct=0;
 const cheap=w.map.facilities.find(f=>f.id==='house4');for(const s of w.sims.filter(s=>s.homeId===cheap.id))s.homeId='house1';
 // Make the current home uniquely expensive through nearby recorded use.
 const service=w.map.facilities.find(f=>f.type==='market');service.door={...home.door};w.facilityUseToday[service.id]=20;
 settleHousing(w,100,1,emit);const intent=w.householdIntents.find(i=>i.kind==='rent_move'&&i.fromHouseholdId==='hh');assert.ok(intent);
 applyHouseholdIntents(w,100,emit);assert.equal(residents.every(s=>s.homeId===home.id),true);
 applyHouseholdIntents(w,101,emit);assert.equal(residents.every(s=>s.homeId===intent.targetHomeId),true);
 assert.ok(events.some(e=>e.type==='household_intent_applied'&&e.payload.kind==='rent_move'));
});

test('#93 target occupancy invalidation fails without moving or losing residents',()=>{
 const{w,home,residents}=oneHousehold(),{events,emit}=emitter();w.logic.housing.moveAfterDays=1;w.logic.housing.maxIncomePct=0;
 const cheap=w.map.facilities.find(f=>f.id==='house4');for(const s of w.sims.filter(s=>s.homeId===cheap.id))s.homeId='house1';
 const service=w.map.facilities.find(f=>f.type==='market');service.door={...home.door};w.facilityUseToday[service.id]=20;
 settleHousing(w,100,1,emit);const intent=w.householdIntents.find(i=>i.kind==='rent_move'&&i.fromHouseholdId==='hh');assert.ok(intent);
 w.sims.find(s=>!residents.includes(s)).homeId=intent.targetHomeId;applyHouseholdIntents(w,101,emit);
 assert.equal(residents.every(s=>s.homeId===home.id),true);assert.ok(events.some(e=>e.payload?.reason==='target_unavailable'));
});

test('#93 partial rent transfers only available cash and records the exact shortfall',()=>{
 const{w,residents}=oneHousehold(),{events,emit}=emitter();for(const s of w.sims)s.money=0;residents[0].money=7;
 const before=w.treasury+w.sims.reduce((n,s)=>n+s.money,0);settleHousing(w,1,0,emit);
 const p=events.find(e=>e.type==='rent_paid'&&e.payload.householdId==='hh').payload;
 assert.equal(p.paid,7);assert.equal(p.shortfall,p.charged-7);
 assert.equal(w.treasury+w.sims.reduce((n,s)=>n+s.money,0),before);
 assert.ok(events.some(e=>e.type==='rent_shortfall'&&e.payload.shortfall===p.shortfall));
});

test('#93 v59 migration adds public ownership and empty market ledgers without RNG draws',()=>{
 const w=createWorld(93),rng=JSON.stringify(w.rngSim);w.schemaVersion=59;delete w.facilityUseToday;delete w.housingMarket;delete w.rentPressure;
 w.logic.logicSchemaVersion=56;delete w.logic.housing;
 for(const f of w.map.facilities)delete f.ownerSimId;migrateWorld(w);
 assert.equal(w.schemaVersion,60);assert.ok(w.map.facilities.filter(f=>['house','apartment'].includes(f.type)).every(f=>f.ownerSimId===null));
 assert.equal(JSON.stringify(w.rngSim),rng);assert.deepEqual(w.rentPressure,{});
 assert.equal(w.logic.logicSchemaVersion,57);assert.ok(w.logic.housing.baseRent>0);
});
