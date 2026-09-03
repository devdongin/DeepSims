import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseMigrationHome} from '../sim/migration-choice.js';
import {makeRng,rngNext} from '../sim/prng.js';
import {createWorld,serialize,deserialize,tick} from '../sim/index.js';
import {addBuilding,TILE} from '../sim/map.js';
import {newGovernment} from '../sim/government.js';
import {settleHousing} from '../sim/housing.js';
import {emptyState} from '../sim/simfactory.js';

function fixture(){
  const world={map:{w:64,h:64,tiles:Array(4096).fill(0),facilities:[],reachVersion:0},
    villages:[{id:'village:0'},{id:'village:1'},{id:'village:2'}],rngSim:makeRng(32),
    sims:[{villageId:'village:0'},...Array.from({length:20},(_,i)=>({villageId:i<10?'village:1':'village:2'}))]};
  const origin={id:'origin',villageId:'village:0',door:{x:2,y:2}};
  const options=[{home:{id:'near',villageId:'village:1',door:{x:12,y:2}},rent:10},
    {home:{id:'far',villageId:'village:2',door:{x:2,y:22}},rent:5}];
  return {world,origin,options};
}
test('conditional weights use observed destination population and actual path distance, with exactly one draw',()=>{
  const {world,origin,options}=fixture(),rng={...world.rngSim};
  const draw=rngNext(rng),choice=chooseMigrationHome(world,origin,options);
  assert.deepEqual(choice.evidence.candidates.map(c=>[c.population,c.distance,c.weight]),[[10,10,1000000],[10,20,500000]]);
  assert.equal(choice.evidence.draw,draw);assert.deepEqual(world.rngSim,rng);
  assert.equal(choice.home.id,BigInt(draw)*1500000n<1000000n*4294967296n?'near':'far');
  const again=fixture();again.world.sims.push(...Array.from({length:10},()=>({villageId:'village:2'})));
  assert.equal(chooseMigrationHome(again.world,again.origin,again.options).evidence.candidates[1].weight,1000000);
  const source=fixture();source.world.sims.push(...Array.from({length:50},()=>({villageId:'village:0'})));
  const sourceChoice=chooseMigrationHome(source.world,source.origin,source.options);
  assert.deepEqual(sourceChoice.evidence.candidates,choice.evidence.candidates,'source mass cancels conditionally');
  assert.equal(sourceChoice.home.id,choice.home.id);
});
test('input order and additional houses do not multiply a municipality population weight',()=>{
  const {world,origin,options}=fixture(),copy=structuredClone(world);
  const a=chooseMigrationHome(world,origin,options);
  const b=chooseMigrationHome(copy,origin,[{home:{id:'extra',villageId:'village:1',door:{x:15,y:2}},rent:20},...options].reverse());
  assert.deepEqual(a,b);assert.deepEqual(world.rngSim,copy.rngSim);
});
test('routing excludes disconnected homes and measures detours rather than straight-line distance',()=>{
  const a=fixture();for(let y=0;y<4;y++)a.world.map.tiles[y*64+7]=TILE.WATER;
  assert.equal(chooseMigrationHome(a.world,a.origin,a.options).evidence.candidates[0].distance,14);
  const b=fixture();for(let y=0;y<64;y++)b.world.map.tiles[y*64+7]=TILE.WATER;
  const before={...b.world.rngSim};const choice=chooseMigrationHome(b.world,b.origin,b.options);
  assert.equal(choice.home.id,'far');assert.equal(choice.evidence.fallback,'single_destination');
  assert.deepEqual(b.world.rngSim,before);
});
test('no alternatives, one town and no observed destination populations do not consume invented choice draws',()=>{
  const {world,origin,options}=fixture(),before={...world.rngSim};
  assert.equal(chooseMigrationHome(world,origin,[]),null);assert.deepEqual(world.rngSim,before);
  world.sims=[];const empty=chooseMigrationHome(world,origin,options);
  assert.equal(empty.home.id,'far');assert.equal(empty.evidence.fallback,'zero_population');
  assert.deepEqual(world.rngSim,before);
  world.sims=[{villageId:'village:1'}];
  const onlyPositive=chooseMigrationHome(world,origin,options);
  assert.equal(onlyPositive.home.id,'near');assert.equal(onlyPositive.evidence.fallback,'single_positive_destination');
  assert.deepEqual(world.rngSim,before);
  world.villages=world.villages.slice(0,1);
  assert.deepEqual(chooseMigrationHome(world,origin,options),{home:options[1].home});
  assert.deepEqual(world.rngSim,before);
});
test('real rent evaluation excludes a cheap home too small for the linked spouse and child and persists choice evidence',()=>{
  const w=createWorld(32);w.map={w:80,h:64,tiles:Array(5120).fill(0),facilities:[],reachVersion:0};
  const source=addBuilding(w.map,'apartment',{x:5,y:5},0);
  const large=addBuilding(w.map,'apartment',{x:40,y:5,villageId:'village:1'},0);
  addBuilding(w.map,'house',{x:65,y:5,villageId:'village:1'},0);
  addBuilding(w.map,'park',{x:5,y:15},0);
  w.villages.push({id:'village:1',center:{...large.door},government:newGovernment()});
  w.sims=w.sims.slice(0,3);w.partners={0:1,1:0};w.partnerStage={0:'married',1:'married'};w.parents={2:[0,1]};
  for(const [i,s] of w.sims.entries()){
    s.homeId=source.id;s.villageId='village:0';s.householdId=i===1?'spouse':'family';s.traits.age=i===2?10:25;
  }
  Object.assign(w.logic.housing,{moveAfterDays:1,maxIncomePct:0,proximityPoint:100,landRentPct:100});
  const b=deserialize(serialize(w)),events=[],other=[];
  settleHousing(w,1,0,(...e)=>events.push(e));settleHousing(b,1,0,(...e)=>other.push(e));
  assert.deepEqual(events,other);assert.equal(serialize(w),serialize(b));
  assert.equal(w.householdIntents.length,1);assert.equal(w.householdIntents[0].targetHomeId,large.id);
  assert.equal(w.householdIntents[0].migrationChoice.selectedVillageId,'village:1');
  assert.equal(serialize(deserialize(serialize(w))),serialize(w));
});
test('real rent pressure chooses between populated towns, then the selected family arrival survives replay',()=>{
  const w=createWorld(32);w.map={w:100,h:64,tiles:Array(6400).fill(0),facilities:[],reachVersion:0};
  const source=addBuilding(w.map,'apartment',{x:5,y:5},0);
  const destinations=[1,2].map((n)=>addBuilding(w.map,'apartment',{x:20+n*20,y:5,villageId:`village:${n}`},0));
  const occupied=[1,2].map((n)=>addBuilding(w.map,'house',{x:20+n*20,y:20,villageId:`village:${n}`},0));
  addBuilding(w.map,'park',{x:5,y:15},0);
  for(const [n,home] of destinations.entries())w.villages.push({id:`village:${n+1}`,center:{...home.door},government:newGovernment()});
  w.sims=w.sims.slice(0,5);w.partners={0:1,1:0};w.partnerStage={0:'married',1:'married'};w.parents={2:[0,1]};
  for(const [n,s] of w.sims.entries()){
    const home=n<3?source:occupied[n-3];s.homeId=home.id;s.villageId=home.villageId;
    s.householdId=n<3?'family':`household:${n}`;s.traits.age=n===2?10:25;s.traits.occupation=n===2?'student':'jobless';
    s.x=home.door.x;s.y=home.door.y;s.state=emptyState();s.needs.hunger=10000;s.needs.energy=10000;
  }
  w.lastDailyDay=0;w.lastPlanDay=0;w.plots=[];
  Object.assign(w.logic.housing,{moveAfterDays:1,maxIncomePct:0});
  settleHousing(w,0,0,()=>{});
  const intent=w.householdIntents.find(i=>i.simId===0);
  assert.ok(intent);assert.equal(intent.migrationChoice.candidates.length,2);
  assert.equal(typeof intent.migrationChoice.draw,'number');
  const target=intent.targetHomeId,village=intent.migrationChoice.selectedVillageId;
  const b=deserialize(serialize(w));
  for(let n=0;n<150&&w.sims[0].homeId!==target;n++)assert.deepEqual(tick(w),tick(b));
  assert.ok(w.sims.slice(0,3).every(s=>s.homeId===target&&s.villageId===village));
  assert.equal(serialize(w),serialize(b));
});
