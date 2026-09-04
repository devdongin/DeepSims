import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {addBuilding,TILE,isAvailableResidence} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {assignCompletedResidence} from '../sim/construction-relocation.js';
import {advanceHouseholdMigrations,completeHouseholdMigrations} from '../sim/household-migration.js';
import {maybeImmigration} from '../sim/society.js';

function fixture(count=3){
  const w=createWorld(32);
  w.map={w:112,h:64,tiles:Array(112*64).fill(TILE.GRASS),facilities:[],reachVersion:0};
  const from=addBuilding(w.map,'apartment',{x:5,y:5},0);from.resources.length=2;
  w.villages.push({id:'village:1',name:'새마을',center:{x:45,y:10},government:newGovernment()});
  w.sims=w.sims.slice(0,count);w.partners={0:1,1:0};w.partnerStage={0:'married',1:'married'};w.parents={2:[0,1]};
  for(const [i,s] of w.sims.entries()){
    s.homeId=from.id;s.householdId='family';s.villageId='village:0';
    s.traits.age=i===2?10:25;s.traits.occupation=i===2?'student':'jobless';s.education.course=null;
    s.x=from.door.x;s.y=from.door.y;s.needs.hunger=10000;s.needs.energy=10000;
    s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:99999};
  }
  w.sims[0].hasCar=true;
  w.plots=[{plotId:100,x:40,y:5,used:false,villageId:'village:1'}];
  w.projects=[{plotId:100,type:'apartment',progress:10,required:10}];
  w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,from};
}
const closed=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
const completedHome=(w,events)=>w.map.facilities.find(f=>f.id===events.find(e=>e.type==='facility_built').payload.facilityId);
const newBedMemories=s=>s.memories.filter(m=>m.kind==='built_bed');

test('the real completion stage reserves a foreign home for the whole family instead of teleporting its highest-ID child',()=>{
  const {w,from}=fixture(),money=closed(w),events=tick(w),home=completedHome(w,events),i=w.householdIntents[0];
  assert.equal(i.kind,'construction_move');assert.equal(i.simId,2);assert.deepEqual(i.memberIds,[0,1,2]);
  assert.equal(i.relocation.phase,'gathering');assert.equal(i.applyTick,w.worldTick+1);
  assert.equal(home.migrationIntentId,i.intentId);assert.equal(isAvailableResidence(home),false);
  assert.ok(w.sims.every(s=>s.homeId===from.id));assert.ok(!events.some(e=>e.type==='moved_home'));
  assert.ok(w.sims.every(s=>newBedMemories(s).length===0));assert.equal(closed(w),money);
  const population=w.sims.length;maybeImmigration(w,1440*w.logic.society.immigrationIntervalDays,w.logic.society.immigrationIntervalDays,()=>{});
  assert.equal(w.sims.length,population,'same-tick immigration cannot consume the reserved family home');
});
test('construction relocation walks and commits residency and new-home memories only at full arrival, with save replay',()=>{
  const {w,from}=fixture(),money=closed(w),events=tick(w),home=completedHome(w,events);
  let b=deserialize(serialize(w));assert.equal(serialize(migrateWorld(b)),serialize(w));
  assert.deepEqual(tick(w),tick(b));assert.equal(w.householdIntents[0].relocation.phase,'travelling');
  b=deserialize(serialize(w));
  for(let n=0;n<150&&w.householdIntents.length;n++){
    const positions=w.sims.map(s=>({x:s.x,y:s.y})),ev=tick(w);events.push(...ev);assert.deepEqual(ev,tick(b));
    for(const [i,s] of w.sims.entries())assert.ok(Math.abs(s.x-positions[i].x)+Math.abs(s.y-positions[i].y)<=1);
    if(w.householdIntents.length)assert.ok(w.sims.every(s=>s.homeId===from.id&&newBedMemories(s).length===0));
  }
  assert.equal(w.householdIntents.length,0);assert.equal(serialize(w),serialize(b));
  for(const s of w.sims){assert.equal(s.homeId,home.id);assert.equal(s.villageId,'village:1');assert.equal(s.householdId,'family');
    assert.equal(newBedMemories(s).length,1);assert.equal(newBedMemories(s)[0].placeId,home.id);}
  assert.equal(events.filter(e=>e.type==='moved_home'&&e.payload.reason==='new_construction').length,3);
  assert.equal(home.migrationIntentId,undefined);assert.equal(closed(w),money);
});
test('a completed small home never separates a child from a family that cannot fit',()=>{
  const {w,from}=fixture();w.projects[0].type='house';
  const events=tick(w),home=completedHome(w,events);
  assert.equal(w.householdIntents.length,0);assert.ok(w.sims.every(s=>s.homeId===from.id));
  assert.equal(home.migrationIntentId,undefined);
  assert.equal(events.find(e=>e.type==='construction_relocation_deferred').payload.reasons.household_capacity,1);
});
test('an infeasible most-crowded family does not block a lower-priority family that fits the new home',()=>{
  const {w,from}=fixture(5);from.resources.length=0;w.projects[0].type='house';
  const other=addBuilding(w.map,'house',{x:5,y:25},0);other.resources.length=1;
  for(const s of w.sims.slice(3)){s.homeId=other.id;s.householdId='other';s.x=other.door.x;s.y=other.door.y;}
  tick(w);assert.deepEqual(w.householdIntents[0].memberIds,[3,4]);assert.equal(w.householdIntents[0].simId,4);
  assert.ok(w.sims.slice(0,3).every(s=>s.homeId===from.id));
});
test('simultaneous completions cannot claim the same family twice',()=>{
  const {w}=fixture();w.plots.push({plotId:101,x:70,y:5,used:false,villageId:'village:1'});
  w.projects.push({plotId:101,type:'apartment',progress:10,required:10});
  const events=tick(w);assert.equal(events.filter(e=>e.type==='facility_built').length,2);
  assert.equal(w.householdIntents.length,1);assert.equal(w.map.facilities.filter(f=>f.migrationIntentId!=null).length,1);
});
test('resolved crowding, changed family, target fire and blocked travel cancel without new-home memories',()=>{
  for(const kind of ['crowding','family','fire','route']){
    const {w,from}=fixture(),home=completedHome(w,tick(w));
    if(kind==='crowding')from.resources.push({...from.resources[0],id:'extra'});
    if(kind==='family')w.sims[1].householdId='changed';
    if(kind==='fire')w.incidents.push({facilityId:home.id});
    if(kind==='route'){tick(w);const p=w.sims[0].state.path[0];w.map.tiles[p.y*w.map.w+p.x]=TILE.WATER;w.map.reachVersion++;}
    const events=[];advanceHouseholdMigrations(w,w.worldTick+1,(type,id,payload)=>events.push({type,id,payload}),()=>assert.fail('must cancel'));
    assert.equal(w.householdIntents.length,0,kind);assert.equal(home.migrationIntentId,undefined);
    assert.ok(w.sims.every(s=>s.homeId===from.id&&newBedMemories(s).length===0));
    assert.equal(events[0].payload.reason,kind==='crowding'?'crowding_resolved':kind==='family'?'household_changed':kind==='fire'?'target_unavailable':'route_changed');
  }
});
test('an unreachable completed home leaves a diagnostic instead of changing residence',()=>{
  const {w,from}=fixture();for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+30]=TILE.WATER;w.map.reachVersion++;
  const events=tick(w);assert.equal(w.householdIntents.length,0);assert.ok(w.sims.every(s=>s.homeId===from.id));
  assert.equal(events.find(e=>e.type==='construction_relocation_deferred').payload.reasons.route_changed,1);
});
test('founding reservations and partial family arrivals cannot be mistaken for completed residence assignment',()=>{
  const {w,from}=fixture(),home=completedHome(w,tick(w));tick(w);
  for(const s of w.sims.slice(0,2)){s.x=home.door.x;s.y=home.door.y;}
  completeHouseholdMigrations(w,w.worldTick,()=>assert.fail('child has not arrived'));
  assert.ok(w.sims.every(s=>s.homeId===from.id));
  const other=addBuilding(w.map,'apartment',{x:70,y:5,villageId:'village:1'},0);other.foundingPetitionId=44;
  assignCompletedResidence(w,other,w.worldTick,()=>assert.fail('founding reservation is not available'));
  assert.equal(other.migrationIntentId,undefined);
});
test('same-town completion preserves the existing highest-resident-ID immediate assignment contract',()=>{
  const {w,from}=fixture();w.plots[0].villageId='village:0';
  const events=tick(w),home=completedHome(w,events);
  assert.equal(w.householdIntents.length,0);assert.equal(w.sims[2].homeId,home.id);
  assert.equal(w.sims[0].homeId,from.id);assert.equal(events.find(e=>e.type==='moved_home').simId,2);
});
