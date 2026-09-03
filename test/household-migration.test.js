import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,migrateWorld} from '../sim/index.js';
import {addBuilding,isAvailableResidence,TILE} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {applyHouseholdIntents} from '../sim/household.js';
import {advanceHouseholdMigrations,completeHouseholdMigrations} from '../sim/household-migration.js';
import {settleHousing} from '../sim/housing.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(){
  const w=createWorld(32);
  w.map={w:80,h:64,tiles:Array(80*64).fill(TILE.GRASS),facilities:[],reachVersion:0};
  const from=addBuilding(w.map,'apartment',{x:5,y:5},0),to=addBuilding(w.map,'apartment',{x:40,y:5,villageId:'village:1'},0);
  w.villages.push({id:'village:1',name:'도착마을',center:{...to.door},government:newGovernment()});
  w.sims=w.sims.slice(0,3);w.partners={0:1,1:0};w.partnerStage={0:'married',1:'married'};w.parents={2:[0,1]};
  for(const [i,s] of w.sims.entries()){
    s.homeId=from.id;s.villageId='village:0';s.householdId=i===1?'spouse':'family';
    s.traits.age=i===2?10:25;s.traits.occupation=i===2?'student':'jobless';
    s.x=from.door.x;s.y=from.door.y;s.needs.hunger=10000;s.needs.energy=10000;s.state=emptyState();
  }
  w.sims[0].hasCar=true;w.plots=[];w.projects=[];w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  const intent={intentId:0,kind:'rent_move',simId:0,memberIds:[0,2],fromHouseholdId:'family',fromHomeId:from.id,
    targetHomeId:to.id,maxRent:100000,pressureKey:`family@${from.id}`,createdTick:0,applyTick:1};
  w.householdIntents=[intent];w.nextHouseholdIntentId=1;
  return {w,from,to,intent};
}
const closed=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
test('cross-town rent move reserves a home and gathers the whole linked family, including a separately identified spouse',()=>{
  const {w,from,to,intent}=fixture(),before=closed(w),events=[];
  applyHouseholdIntents(w,1,(...e)=>events.push(e));
  assert.equal(intent.relocation.phase,'gathering');assert.deepEqual(intent.memberIds,[0,1,2]);
  assert.ok(w.sims.every(s=>s.homeId===from.id&&s.villageId==='village:0'));
  assert.equal(isAvailableResidence(to),false);assert.equal(to.migrationIntentId,0);
  assert.equal(closed(w),before);assert.equal(events[0][0],'household_migration_gathering');
});
test('actual one-tile family travel commits residency only on arrival and replays from an in-flight save',()=>{
  const {w,from,to}=fixture(),money=closed(w),events=[];
  for(let n=0;n<5;n++)events.push(...tick(w));
  assert.equal(w.householdIntents[0].relocation.phase,'travelling');
  assert.ok(w.sims.every(s=>s.homeId===from.id));
  const b=deserialize(serialize(w));
  for(let n=0;n<100&&w.householdIntents.length;n++){
    const positions=w.sims.map(s=>({x:s.x,y:s.y})),a=tick(w);
    assert.deepEqual(a,tick(b));events.push(...a);
    for(const [i,s] of w.sims.entries())assert.ok(Math.abs(s.x-positions[i].x)+Math.abs(s.y-positions[i].y)<=1);
    if(w.householdIntents.length)assert.ok(w.sims.every(s=>s.homeId===from.id));
  }
  assert.equal(w.householdIntents.length,0);assert.equal(hashWorld(w),hashWorld(b));
  assert.ok(w.sims.every(s=>s.homeId===to.id&&s.villageId==='village:1'&&s.x===to.door.x&&s.y===to.door.y));
  assert.equal(to.migrationIntentId,undefined);assert.equal(closed(w),money);
  assert.equal(events.filter(e=>e.type==='moved_home').length,3);
  assert.equal(w.transportStats.today.municipalVisits,undefined,'relocation is not a service visit');
});
test('family changes, occupied homes, fire and route changes cancel safely and release the reserved home',()=>{
  for(const kind of ['family','occupied','fire','route']){
    const {w,from,to}=fixture();tick(w);const events=[];
    if(kind==='family')w.sims[1].householdId='changed';
    if(kind==='occupied')w.sims[2].homeId=to.id;
    if(kind==='fire')w.incidents.push({facilityId:to.id});
    if(kind==='route'){
      const p=w.sims[0].state.path[0];w.map.tiles[p.y*w.map.w+p.x]=TILE.WATER;w.map.reachVersion++;
    }
    advanceHouseholdMigrations(w,2,(type,id,payload)=>events.push({type,id,payload}),()=>assert.fail('must cancel'));
    assert.equal(w.householdIntents.length,0,kind);assert.equal(to.migrationIntentId,undefined,kind);
    assert.equal(w.sims[0].homeId,from.id,kind);assert.equal(events[0].type,'household_intent_failed');
  }
});
test('expanded family must fit the destination and exhausted members are not forcibly marched',()=>{
  const a=fixture();a.to.resources=a.to.resources.slice(0,2);
  const events=[];applyHouseholdIntents(a.w,1,(type,id,payload)=>events.push({type,id,payload}));
  assert.equal(events[0].payload.reason,'household_capacity');assert.equal(a.to.migrationIntentId,undefined);
  const b=fixture();b.w.sims[2].needs.energy=0;tick(b.w);
  assert.equal(b.intent.relocation.phase,'gathering');assert.ok(b.w.sims.every(s=>s.homeId===b.from.id));
});
test('real sustained rent-pressure evaluation creates the intent that physically crosses municipalities',()=>{
  const {w,from,to}=fixture();w.householdIntents=[];
  for(const s of w.sims)s.householdId='family';
  addBuilding(w.map,'park',{x:5,y:15},0);
  w.logic.housing.moveAfterDays=1;w.logic.housing.maxIncomePct=0;
  settleHousing(w,0,0,()=>{});
  assert.equal(w.householdIntents.length,1);assert.equal(w.householdIntents[0].targetHomeId,to.id);
  const events=tick(w);
  assert.ok(events.some(e=>e.type==='household_migration_departed'));
  assert.ok(w.sims.every(s=>s.homeId===from.id));
  for(let n=0;n<100&&w.householdIntents.length;n++)tick(w);
  assert.ok(w.sims.every(s=>s.homeId===to.id&&s.villageId==='village:1'));
});
test('partial arrival cannot commit a family and an in-flight save migration is a fixed point',()=>{
  const {w,from,to}=fixture();tick(w);
  const saved=serialize(w);assert.equal(serialize(migrateWorld(deserialize(saved))),saved);
  for(const s of w.sims.slice(0,2)){s.x=to.door.x;s.y=to.door.y;}
  completeHouseholdMigrations(w,2,()=>assert.fail('family not all arrived'));
  assert.ok(w.sims.every(s=>s.homeId===from.id));assert.equal(to.migrationIntentId,0);
});
test('actual client handler mirrors reservation and releases it only for the matching intent',()=>{
  const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const start=source.indexOf("if(e.type==='household_migration_gathering')"),end=source.indexOf("if (e.type === 'plot_relocated')",start);
  assert.ok(start>=0&&end>start);
  const world={map:{facilities:[{id:'home'},{id:'other',migrationIntentId:9}]}};
  const run=e=>vm.runInNewContext(source.slice(start,end),{world,e});
  run({type:'household_migration_gathering',payload:{targetHomeId:'home',intentId:0}});
  assert.equal(world.map.facilities[0].migrationIntentId,0);
  run({type:'household_intent_failed',payload:{intentId:0}});
  assert.equal(world.map.facilities[0].migrationIntentId,undefined);assert.equal(world.map.facilities[1].migrationIntentId,9);
});
test('a second intent cannot reserve another destination for the same linked family',()=>{
  const {w,from,intent}=fixture();applyHouseholdIntents(w,1,()=>{});
  const target=addBuilding(w.map,'apartment',{x:60,y:5,villageId:'village:1'},0);
  w.householdIntents.push({intentId:1,kind:'rent_move',simId:1,memberIds:[1],fromHouseholdId:'spouse',
    fromHomeId:from.id,targetHomeId:target.id,maxRent:100000,createdTick:0,applyTick:1});
  const events=[];applyHouseholdIntents(w,1,(type,id,payload)=>events.push({type,id,payload}));
  assert.equal(w.householdIntents.length,1);assert.equal(w.householdIntents[0],intent);
  assert.equal(events[0].payload.reason,'migration_conflict');assert.equal(target.migrationIntentId,undefined);
});
test('a relocating mayor vacates the source office only after the family arrives',()=>{
  const {w}=fixture();w.mayorId=0;
  tick(w);assert.equal(w.mayorId,0);
  for(let n=0;n<100&&w.householdIntents.length;n++)tick(w);
  assert.equal(w.householdIntents.length,0);assert.equal(w.mayorId,null);
  assert.equal(w.villages[1].government.mayorId,null);
});
