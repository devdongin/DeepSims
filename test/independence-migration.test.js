import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {addBuilding,TILE,isAvailableResidence} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {evaluateHouseholds,applyHouseholdIntents} from '../sim/household.js';
import {advanceHouseholdMigrations,completeHouseholdMigrations} from '../sim/household-migration.js';
import {planIndependentHousehold} from '../sim/independent-household.js';

function fixture(){
  const w=createWorld(32);
  w.map={w:96,h:64,tiles:Array(96*64).fill(TILE.GRASS),facilities:[],reachVersion:0};
  const from=addBuilding(w.map,'apartment',{x:5,y:5},0);
  const small=addBuilding(w.map,'house',{x:40,y:5,villageId:'village:1'},0);
  const to=addBuilding(w.map,'apartment',{x:60,y:5,villageId:'village:1'},0);
  small.id='a-small';to.id='b-family'; // Exercise the undersized home BEFORE the family-sized one in ID order.
  w.villages.push({id:'village:1',name:'새마을',center:{...to.door},government:newGovernment()});
  w.sims=w.sims.slice(0,5);w.partners={1:2,2:1};w.partnerStage={1:'married',2:'married'};
  w.parents={1:[0],3:[1,2],4:[0]};
  for(const [i,s] of w.sims.entries()){
    s.homeId=from.id;s.householdId=i===2?'spouse':'parents';s.villageId='village:0';
    s.traits.age=[55,25,25,5,15][i];s.traits.occupation=i===1?'office_worker':i>=3?'student':'jobless';
    s.education.course=null;s.money=10000;s.x=from.door.x;s.y=from.door.y;
    s.needs.hunger=10000;s.needs.energy=10000;s.state=emptyState();
  }
  w.sims[1].hasCar=true;w.logic.household.stableDays=1;
  w.plots=[];w.projects=[];w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,from,small,to,adult:w.sims[1]};
}
const money=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
function prepare(w){evaluateHouseholds(w,0,0,()=>{});assert.equal(w.householdIntents.length,1);}

test('independence plans the adult spouse and cohabiting minor descendants, not parents or siblings',()=>{
  const {w}=fixture();
  assert.deepEqual(planIndependentHousehold(w,1,'village:0').residents.map(s=>s.simId),[1,2,3]);
  w.sims[2].villageId='village:1';
  assert.equal(planIndependentHousehold(w,1,'village:0').reason,'household_split');
});
test('real independence evaluation reserves a family-sized home without instantly separating the household',()=>{
  const {w,from,to,small}=fixture(),before=money(w);prepare(w);
  const events=[];applyHouseholdIntents(w,1,(type,id,payload)=>events.push({type,id,payload}));
  const i=w.householdIntents[0];assert.equal(i.kind,'separate');assert.equal(i.relocation.phase,'gathering');
  assert.deepEqual(i.memberIds,[1,2,3]);assert.equal(i.targetHomeId,to.id);
  assert.equal(isAvailableResidence(to),false);assert.equal(isAvailableResidence(small),true);
  assert.ok(w.sims.every(s=>s.homeId===from.id));assert.equal(w.sims[1].householdId,'parents');
  assert.equal(events[0].type,'household_migration_gathering');assert.equal(money(w),before);
});
test('independent family actually walks, leaves parents behind, and changes household only after everyone arrives',()=>{
  const {w,from,to}=fixture(),before=money(w);prepare(w);tick(w);
  assert.equal(w.householdIntents[0].relocation.phase,'travelling');
  const b=deserialize(serialize(w));assert.equal(serialize(migrateWorld(b)),serialize(w));
  const events=[];
  for(let n=0;n<150&&w.householdIntents.length;n++){
    const old=w.sims.map(s=>({x:s.x,y:s.y})),ev=tick(w);events.push(...ev);assert.deepEqual(ev,tick(b));
    for(const id of [1,2,3])assert.ok(Math.abs(w.sims[id].x-old[id].x)+Math.abs(w.sims[id].y-old[id].y)<=1);
    if(w.householdIntents.length){assert.equal(w.sims[1].homeId,from.id);assert.equal(w.sims[1].householdId,'parents');}
  }
  assert.equal(w.householdIntents.length,0);assert.equal(serialize(w),serialize(b));
  for(const id of [1,2,3]){const s=w.sims[id];assert.equal(s.homeId,to.id);assert.equal(s.villageId,'village:1');
    assert.equal(s.householdId,'household:1:0');assert.equal(s.x,to.door.x);assert.equal(s.y,to.door.y);}
  for(const id of [0,4]){assert.equal(w.sims[id].homeId,from.id);assert.equal(w.sims[id].householdId,'parents');}
  assert.equal(events.filter(e=>e.type==='moved_home'&&e.payload.reason==='independence').length,3);
  assert.equal(events.find(e=>e.type==='household_intent_applied').payload.householdId,'household:1:0');
  assert.equal(to.migrationIntentId,undefined);assert.equal(money(w),before);
});
test('partial independent-family arrival cannot assign the new household',()=>{
  const {w,from,to}=fixture();prepare(w);tick(w);
  for(const id of [1,2]){w.sims[id].x=to.door.x;w.sims[id].y=to.door.y;}
  completeHouseholdMigrations(w,2,()=>assert.fail('child has not arrived'));
  assert.equal(w.sims[1].homeId,from.id);assert.equal(w.sims[1].householdId,'parents');
});
test('independence cancels on changed family, lost home, or blocked route without changing addresses',()=>{
  for(const cause of ['spouse','child','home','route']){
    const {w,from,to}=fixture();prepare(w);tick(w);
    if(cause==='spouse')w.partnerStage[1]='dating';
    if(cause==='child')w.parents[3]=[0];
    if(cause==='home')w.incidents.push({facilityId:to.id});
    if(cause==='route'){const p=w.sims[1].state.path[0];w.map.tiles[p.y*w.map.w+p.x]=TILE.WATER;w.map.reachVersion++;}
    const events=[];advanceHouseholdMigrations(w,2,(type,id,payload)=>events.push({type,id,payload}),()=>assert.fail('must cancel'));
    assert.equal(w.householdIntents.length,0,cause);assert.equal(to.migrationIntentId,undefined);
    assert.equal(w.sims[1].homeId,from.id);assert.equal(w.sims[1].householdId,'parents');
    assert.equal(events[0].type,'household_intent_failed');
  }
});
test('a student or adult losing reserves during gathering cannot depart independently',()=>{
  for(const cause of ['student','reserve']){
    const {w,to,adult}=fixture();prepare(w);applyHouseholdIntents(w,1,()=>{});
    if(cause==='student'){adult.education.course='doctorate';adult.education.completed=false;}
    else adult.money=0;
    const events=[];advanceHouseholdMigrations(w,2,(type,id,payload)=>events.push({type,id,payload}),()=>assert.fail('ineligible departure'));
    assert.equal(events[0].payload.reason,cause==='student'?'income_unstable':'reserve_short');
    assert.equal(w.householdIntents.length,0);assert.equal(to.migrationIntentId,undefined);assert.equal(adult.independenceDays,0);
  }
});
test('independence skips a disconnected foreign home and rejects insufficient family capacity',()=>{
  const {w,to}=fixture();prepare(w);
  for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+30]=TILE.WATER;
  w.map.reachVersion++;const events=[];applyHouseholdIntents(w,1,(...e)=>events.push(e));
  assert.equal(w.householdIntents.length,0);assert.equal(events.at(-1)[2].reason,'no_vacant_home');
  const a=fixture();a.to.resources.length=2;prepare(a.w);
  applyHouseholdIntents(a.w,1,()=>{});assert.equal(a.w.householdIntents.length,0);
  assert.equal(to.migrationIntentId,undefined);
});

test('a single independent adult uses the smaller home and does not move unrelated household members',()=>{
  const {w,small,from}=fixture();w.partners={};w.partnerStage={};w.parents[3]=[0];
  prepare(w);tick(w);assert.deepEqual(w.householdIntents[0].memberIds,[1]);
  for(let n=0;n<100&&w.householdIntents.length;n++)tick(w);
  assert.equal(w.householdIntents.length,0);assert.equal(w.sims[1].homeId,small.id);
  assert.ok(w.sims.filter(s=>s.id!==1).every(s=>s.homeId===from.id));
});
test('a parent rent intent cannot reserve a second home for a family already gathering to separate',()=>{
  const {w,from}=fixture();prepare(w);applyHouseholdIntents(w,1,()=>{});
  const destination=addBuilding(w.map,'apartment',{x:60,y:25,villageId:'village:1'},0);
  w.householdIntents.push({intentId:1,kind:'rent_move',simId:0,memberIds:[0,1,3,4],
    fromHomeId:from.id,fromHouseholdId:'parents',targetHomeId:destination.id,maxRent:100000,applyTick:1});
  const events=[];applyHouseholdIntents(w,1,(type,id,payload)=>events.push({type,id,payload}));
  assert.equal(w.householdIntents.length,1);assert.equal(w.householdIntents[0].kind,'separate');
  assert.equal(events.at(-1).payload.reason,'migration_conflict');assert.equal(destination.migrationIntentId,undefined);
});
