import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { canWork } from '../sim/education.js';
import { planSettlementHouseholds, settlementHouseholdsUnchanged } from '../sim/settlement-households.js';
import { advanceSettlementPlans, completeSettlementArrivals } from '../sim/settlement.js';
import { TILE } from '../sim/map.js';
import { emptyState } from '../sim/simfactory.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyRomance } from '../sim/society.js';

function familyWorld(){
  const w=createWorld(32);
  for(const s of w.sims){
    s.householdId=`fixture:${s.id}`;s.traits.age=25;s.traits.occupation='office_worker';
    s.education.course=null;w.partners[s.id]=null;w.partnerStage[s.id]=null;w.parents[s.id]=[];
  }
  return w;
}

test('#32 children and graduate students relocate with family but are not construction labor',()=>{
  const w=familyWorld(),[a,b,child,student]=w.sims;
  for(const s of [a,b,child,student]){s.householdId=a.householdId;s.homeId=a.homeId;}
  child.traits.age=10;child.traits.occupation='student';
  student.traits.age=26;student.traits.occupation='student';student.education.course='doctorate';
  student.education.completed=false;
  const workers=[a,b,child,student].filter(canWork).map(s=>s.id);
  assert.deepEqual(workers,[a.id,b.id]);
  const before=serialize(w),plan=planSettlementHouseholds(w,workers,a.villageId);
  assert.equal(serialize(w),before);assert.equal(plan.ok,true);
  assert.deepEqual(plan.homes,[{type:'apartment',residentIds:[a.id,b.id,child.id,student.id]}]);
  const saved={...plan,settlerIds:workers};
  assert.equal(settlementHouseholdsUnchanged(deserialize(serialize(w)),deserialize(serialize(saved)),a.villageId),true);
  child.homeId='different-home';
  assert.equal(settlementHouseholdsUnchanged(w,saved,a.villageId),false);
});

test('#32 large households require an adult caregiver in each apartment',()=>{
  const w=familyWorld(),[a,b]=w.sims;
  for(const s of w.sims){s.householdId=a.householdId;s.homeId=a.homeId;s.traits.age=10;}
  a.traits.age=25;b.traits.age=25;
  const plan=planSettlementHouseholds(w,[a.id,b.id],a.villageId);
  assert.equal(plan.ok,true);assert.equal(plan.homes.length,2);
  assert.equal(new Set(plan.homes.flatMap(h=>h.residentIds)).size,w.sims.length);
  for(const home of plan.homes){
    assert.equal(home.type,'apartment');assert.ok(home.residentIds.length<=8);
    assert.ok(home.residentIds.some(id=>w.sims.find(s=>s.id===id).traits.age>=19));
  }
  b.traits.age=10;
  assert.deepEqual(planSettlementHouseholds(w,[a.id],a.villageId),{ok:false,reason:'household_capacity'});
});

test('#32 married partners and cohabiting dependent children remain together despite legacy household IDs',()=>{
  const w=familyWorld(),[a,b,child]=w.sims;
  w.partners[a.id]=b.id;w.partnerStage[a.id]='married';
  child.homeId=b.homeId;child.traits.age=17;w.parents[child.id]=[b.id];
  const plan=planSettlementHouseholds(w,[a.id],a.villageId);
  assert.deepEqual(plan.residents.map(r=>r.simId),[a.id,b.id,child.id]);
  b.villageId='another-village';
  assert.deepEqual(planSettlementHouseholds(w,[a.id],a.villageId),{ok:false,reason:'household_split'});
});

function travellingWorld(){
  const w=familyWorld(),s=w.sims[0];
  w.map.tiles.fill(TILE.GRASS);w.map.reachVersion=(w.map.reachVersion??0)+1;
  const household=planSettlementHouseholds(w,[s.id],s.villageId);
  const home={id:'fixture-new-home',type:'house',door:{x:80,y:80},resources:[{},{}],foundingPetitionId:0};
  w.map.facilities.push(home);
  const p={id:0,status:'awaiting_settlement',petitionerId:s.id,villageId:s.villageId,
    plan:{name:'새솔',settlerIds:[s.id],residents:household.residents,
      homes:household.homes.map(h=>({...h,plotId:1})),completedHomes:[{plotId:1,homeId:home.id}],
      relocation:{phase:'travelling'}}};
  w.founding.petitions=[p];s.x=70;s.y=80;s.state=emptyState();
  return {w,s,p,home};
}

test('#32 an interrupted trip with no remaining route cancels without refunds or invented arrivals',()=>{
  const {w,s,p,home}=travellingWorld(),before={home:s.homeId,money:w.treasury,pop:w.sims.length};
  for(const [x,y] of [[79,80],[81,80],[80,79],[80,81]])w.map.tiles[y*w.map.w+x]=TILE.WALL;
  w.map.reachVersion++;
  const events=[];
  advanceSettlementPlans(w,3000,(...e)=>events.push(e),()=>assert.fail('unreachable route must not retry forever'));
  assert.equal(p.status,'cancelled');assert.equal(p.reason,'route_changed');
  assert.equal(s.homeId,before.home);assert.equal(w.treasury,before.money);assert.equal(w.sims.length,before.pop);
  assert.equal(w.villages.length,1);assert.ok(w.map.facilities.includes(home));
  assert.equal(home.foundingPetitionId,undefined);assert.equal(p.plan.refundedCost,0);
  assert.equal(events[0][0],'founding_cancelled');
});

test('#32 settlement membership changes only at the destination and completion is exactly once',()=>{
  const {w,s,p,home}=travellingWorld(),oldHome=s.homeId,events=[];
  const emit=(...e)=>events.push(e);
  completeSettlementArrivals(w,3000,emit);
  assert.equal(w.villages.length,1);assert.equal(s.homeId,oldHome);assert.equal(events.length,0);
  // Unit fixture supplies an arrival; real one-tile movement is covered by the benchmark.
  s.x=home.door.x;s.y=home.door.y;
  completeSettlementArrivals(w,3001,emit);completeSettlementArrivals(w,3002,emit);
  assert.equal(p.status,'completed');assert.equal(w.villages.length,2);
  assert.equal(s.homeId,home.id);assert.equal(s.villageId,w.villages[1].id);
  assert.equal(events.filter(e=>e[0]==='village_founded').length,1);
});

for(const family of [false,true])test(`#32 autonomous ${family?'family apartment':'house'} construction and settlement replay through both saved phases`,()=>{
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../bench/founding-construction.js',import.meta.url)),
    '32','--settle',...(family?['--family']:[])],{encoding:'utf8',timeout:60000});
  const result=JSON.parse(output);
  assert.equal(result.founded,1);assert.equal(result.population,10);assert.equal(result.ineligibleWork,0);
  assert.ok(result.starts>0);assert.equal(result.status,'completed');
});

test('#32 school enrollment cannot make a minor eligible for dating or marriage',()=>{
  const w=createWorld(32),[adult,child]=w.sims,events=[];
  w.partners={};w.partnerStage={};
  adult.traits.age=25;child.traits.age=12;child.traits.occupation='student';
  w.affinity[adult.id][child.id]=w.affinity[child.id][adult.id]=10000;
  w.interactions[adult.id][child.id]=w.interactions[child.id][adult.id]=100000;
  applyRomance(w,adult,0,(...e)=>events.push(e));applyRomance(w,child,0,(...e)=>events.push(e));
  assert.equal(w.partners[adult.id],undefined);assert.equal(w.partners[child.id],undefined);
  w.partners[adult.id]=child.id;w.partners[child.id]=adult.id;
  w.partnerStage[adult.id]=w.partnerStage[child.id]='dating';
  applyRomance(w,adult,1,(...e)=>events.push(e));applyRomance(w,child,1,(...e)=>events.push(e));
  assert.equal(w.partnerStage[adult.id],'dating');assert.equal(events.length,0);
});
