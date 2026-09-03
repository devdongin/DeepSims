import { test } from 'node:test';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { initializeVillages, villageSummary, syncResidenceVillage, PRIMARY_VILLAGE_ID } from '../sim/villages.js';
import { migrateWorld } from '../sim/migrate.js';
import { makeSim } from '../sim/simfactory.js';
import { addBuilding } from '../sim/map.js';
import { applyHouseholdIntents } from '../sim/household.js';

test('#32 existing world receives one real settlement, without adding population, money or RNG draws', () => {
  const w=createWorld(32),before=serialize(w);
  initializeVillages(w);assert.equal(serialize(w),before);
  assert.equal(w.villages.length,1);assert.equal(w.villages[0].id,PRIMARY_VILLAGE_ID);
  assert.ok(w.sims.every(s=>s.villageId===PRIMARY_VILLAGE_ID));
  assert.ok(w.map.facilities.every(f=>f.villageId===PRIMARY_VILLAGE_ID));
  const stats=villageSummary(w);assert.equal(stats[0].population,w.sims.length);
  assert.equal(stats[0].facilities,w.map.facilities.length);assert.equal(serialize(w),before);
  assert.ok(!('treasury' in stats[0]),'shared treasury must not be duplicated as village cash');
  stats[0].center.x=-999;assert.notEqual(w.villages[0].center.x,-999);
});

test('#32 old save migration assigns existing homes only and creates no historical migration', () => {
  const w=createWorld(32);w.schemaVersion=65;delete w.villages;delete w.nextVillageId;
  for(const s of w.sims)delete s.villageId;for(const f of w.map.facilities)delete f.villageId;
  const rng=serialize(w.rngSim),money=w.sims.map(s=>s.money),pop=w.sims.length,treasury=w.treasury;
  migrateWorld(w);assert.equal(w.schemaVersion, SCHEMA_VERSION);assert.equal(w.logic.logicSchemaVersion, DEFAULT_LOGIC.logicSchemaVersion);
  assert.equal(w.sims.length,pop);assert.deepEqual(w.sims.map(s=>s.money),money);assert.equal(w.treasury,treasury);
  assert.equal(serialize(w.rngSim),rng);const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
});

test('#32 common factory and construction carry explicit village ownership, residence ignores work destinations', () => {
  const w=createWorld(32),s=w.sims[0],home=w.map.facilities.find(f=>f.id===s.homeId);
  home.villageId='village:test';syncResidenceVillage(w,s.id);assert.equal(s.villageId,'village:test');
  s.state.facilityId=w.map.facilities.find(f=>f.type==='office').id;
  syncResidenceVillage(w,s.id);assert.equal(s.villageId,'village:test');
  const copy=makeSim({id:999,name:'test',surname:'',homeId:home.id,villageId:home.villageId,
    traits:structuredClone(s.traits),seed:32,x:s.x,y:s.y,needs:structuredClone(s.needs),money:0});
  assert.equal(copy.villageId,'village:test');
  const fac=addBuilding(w.map,'house',{x:400,y:400,villageId:'village:test'});
  assert.equal(fac.villageId,'village:test');
});

test('#32 actual tick save/resume preserves village assignments and entire world', () => {
  const a=createWorld(32),b=deserialize(serialize(a));
  for(let i=0;i<1500;i++)assert.deepEqual(tick(a),tick(b));
  assert.equal(hashWorld(a),hashWorld(b));
  assert.equal(villageSummary(a).reduce((n,v)=>n+v.population,0),a.sims.length);
  assert.ok(a.map.facilities.every(f=>f.villageId===PRIMARY_VILLAGE_ID));
});

test('#32 actual household relocation moves every member village, not only the intent owner', () => {
  const w=createWorld(32),s=w.sims[0];
  const members=w.sims.filter(p=>p.homeId===s.homeId&&p.householdId===s.householdId);
  const target=addBuilding(w.map,'house',{x:400,y:400,villageId:'village:test'});
  w.villages.push({id:'village:test',name:'fixture',foundedTick:0,center:{x:400,y:400}});
  w.householdIntents=[{kind:'rent_move',intentId:0,applyTick:1,simId:s.id,
    fromHomeId:s.homeId,fromHouseholdId:s.householdId,memberIds:members.map(p=>p.id),targetHomeId:target.id,maxRent:1000000}];
  const events=[];applyHouseholdIntents(w,1,(...a)=>events.push(a));
  assert.ok(members.every(p=>p.homeId===target.id&&p.villageId==='village:test'));
  assert.equal(events.filter(e=>e[0]==='moved_home').length,members.length);
  assert.equal(villageSummary(w).find(v=>v.id==='village:test').population,members.length);
});
