import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {addBuilding,TILE,isAvailableResidence} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {applyRomance} from '../sim/society.js';
import {applyHouseholdIntents} from '../sim/household.js';
import {completeHouseholdMigrations,advanceHouseholdMigrations} from '../sim/household-migration.js';
import {rngNext} from '../sim/prng.js';

function fixture(){
  const w=createWorld(32);
  w.map={w:112,h:64,tiles:Array(112*64).fill(TILE.GRASS),facilities:[],reachVersion:0};
  const a=addBuilding(w.map,'apartment',{x:5,y:5},0);
  const b=addBuilding(w.map,'apartment',{x:40,y:5,villageId:'village:1'},0);
  const fresh=addBuilding(w.map,'apartment',{x:80,y:5,villageId:'village:2'},0);
  for(const [id,home] of [['village:1',b],['village:2',fresh]])w.villages.push({id,name:id,center:{...home.door},government:newGovernment()});
  w.sims=w.sims.slice(0,5);w.partners={0:1,1:0};w.partnerStage={0:'dating',1:'dating'};
  w.parents={0:[3],2:[1],4:[0]};
  for(const [id,s] of w.sims.entries()){
    const home=[1,2].includes(id)?b:a;
    s.homeId=home.id;s.villageId=home.villageId;s.householdId=home.id;
    s.traits.age=[25,25,6,55,8][id];s.traits.occupation=[2,4].includes(id)?'student':'jobless';
    s.education.course=null;s.money=10000;s.x=home.door.x;s.y=home.door.y;
    s.needs.hunger=10000;s.needs.energy=10000;s.state=emptyState();
  }
  w.sims[1].hasCar=true;w.affinity[0][1]=w.affinity[1][0]=10000;
  w.interactions[0][1]=w.interactions[1][0]=10000;
  w.plots=[];w.projects=[];w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,a,b,fresh};
}
const closed=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
const marry=w=>{const events=[];applyRomance(w,w.sims[0],0,(type,simId,payload)=>events.push({type,simId,payload}));return events;};

test('the wedding occurs now but cross-town spouse and children only receive a next-tick relocation intent',()=>{
  const {w,a,b}=fixture(),events=marry(w);
  assert.ok(events.some(e=>e.type==='married'));assert.ok(events.some(e=>e.type==='token_created'));
  assert.ok(!events.some(e=>e.type==='moved_home'));
  const i=w.householdIntents[0];assert.equal(i.kind,'marriage_move');assert.equal(i.applyTick,1);
  assert.deepEqual(i.memberIds,[1,2]);assert.deepEqual(i.familyResidents.map(s=>s.simId),[0,1,2,4]);
  assert.deepEqual(i.destinationResidents,[0,3,4]);assert.equal(i.targetHomeId,a.id);
  assert.equal(w.sims[1].homeId,b.id);assert.equal(w.sims[2].householdId,b.id);
  applyHouseholdIntents(w,0,()=>assert.fail('not due'));
  applyHouseholdIntents(w,1,()=>{});assert.equal(i.relocation.phase,'gathering');assert.equal(isAvailableResidence(a),false);
});
test('actual marriage travel preserves existing residents, waits for children and replays pending and in-flight saves',()=>{
  const {w,a,b}=fixture(),money=closed(w);marry(w);
  let saved=deserialize(serialize(w));assert.equal(serialize(migrateWorld(saved)),serialize(w));
  const events=tick(w);assert.deepEqual(events,tick(saved));
  assert.equal(w.householdIntents[0].relocation.phase,'travelling');
  saved=deserialize(serialize(w));
  for(let n=0;n<150&&w.householdIntents.length;n++){
    const before=[1,2].map(id=>({x:w.sims[id].x,y:w.sims[id].y})),ev=tick(w);events.push(...ev);
    assert.deepEqual(ev,tick(saved));
    for(const [n,id] of [1,2].entries())assert.ok(Math.abs(w.sims[id].x-before[n].x)+Math.abs(w.sims[id].y-before[n].y)<=1);
    if(w.householdIntents.length)assert.equal(w.sims[1].homeId,b.id);
  }
  assert.equal(w.householdIntents.length,0);assert.equal(serialize(w),serialize(saved));
  assert.ok(w.sims.every(s=>s.homeId===a.id));
  for(const id of [0,1,2,4])assert.equal(w.sims[id].householdId,'household:marriage:0:1');
  assert.equal(w.sims[3].householdId,a.id,'parent/roommate is not absorbed into the couple household');
  assert.equal(events.filter(e=>e.type==='moved_home'&&e.payload.reason==='marriage').length,2);
  assert.equal(a.migrationIntentId,undefined);assert.equal(closed(w),money);
});
test('a married retry chooses a new family-sized home when both existing homes are full',()=>{
  const {w,a,b,fresh}=fixture();a.resources.length=3;b.resources.length=2;
  w.partnerStage={0:'married',1:'married'};const events=marry(w);
  assert.ok(!events.some(e=>e.type==='married'));assert.equal(w.householdIntents.length,1);
  assert.equal(w.householdIntents[0].targetHomeId,fresh.id);assert.deepEqual(w.householdIntents[0].memberIds,[0,1,2,4]);
  const saved=deserialize(serialize(w));
  for(let n=0;n<400&&w.householdIntents.length;n++)assert.deepEqual(tick(w),tick(saved));
  assert.equal(w.householdIntents.length,0);assert.equal(serialize(w),serialize(saved));
  for(const id of [0,1,2,4])assert.equal(w.sims[id].homeId,fresh.id);
  assert.equal(w.sims[3].homeId,a.id);
});
test('an available spouse bed is insufficient when their accompanying children do not fit',()=>{
  const {w,a,b,fresh}=fixture();a.resources.length=4;b.resources.length=2;fresh.resources.length=3;
  marry(w);assert.equal(w.householdIntents.length,0);assert.equal(w.sims[1].homeId,b.id);
  applyRomance(w,w.sims[0],1,()=>{});assert.equal(w.householdIntents.length,0);
  fresh.resources.push({...fresh.resources[0],id:'added-bed'});
  applyRomance(w,w.sims[0],2,()=>{});assert.equal(w.householdIntents[0].targetHomeId,fresh.id);
});
test('partner, dependent, destination occupancy and route changes cancel without a partial residence commit',()=>{
  for(const kind of ['partner','child','anchor','occupancy','route']){
    const {w,a,b,fresh}=fixture();marry(w);tick(w);
    if(kind==='partner')w.partnerStage[0]='dating';
    if(kind==='child')w.parents[2]=[3];
    if(kind==='anchor')w.sims[0].homeId=fresh.id;
    if(kind==='occupancy')w.sims[3].homeId=fresh.id;
    if(kind==='route'){const p=w.sims[1].state.path[0];w.map.tiles[p.y*w.map.w+p.x]=TILE.WATER;w.map.reachVersion++;}
    const events=[];advanceHouseholdMigrations(w,2,(type,simId,payload)=>events.push({type,simId,payload}),()=>assert.fail('must cancel'));
    assert.equal(w.householdIntents.length,0,kind);assert.equal(a.migrationIntentId,undefined);
    assert.equal(w.sims[1].homeId,b.id);assert.equal(w.sims[2].homeId,b.id);
    assert.equal(events[0].type,'household_intent_failed');
  }
});
test('a queued marriage revalidates occupancy and never steals another reservation',()=>{
  for(const kind of ['occupancy','reservation']){
    const {w,a,fresh}=fixture();marry(w);
    if(kind==='occupancy')w.sims[3].homeId=fresh.id;else a.migrationIntentId=99;
    const events=[];applyHouseholdIntents(w,1,(type,simId,payload)=>events.push({type,simId,payload}));
    assert.equal(w.householdIntents.length,0);assert.equal(events[0].payload.reason,'target_unavailable');
    assert.equal(a.migrationIntentId,kind==='reservation'?99:undefined);
  }
});
test('repeated spouse reflections do not create duplicate queued or gathering moves',()=>{
  const {w}=fixture();marry(w);
  applyRomance(w,w.sims[1],0,()=>{});assert.equal(w.householdIntents.length,1);
  applyHouseholdIntents(w,1,()=>{});applyRomance(w,w.sims[0],1,()=>{});
  assert.equal(w.householdIntents.length,1);assert.equal(w.nextHouseholdIntentId,1);
});
test('partial arrival cannot commit and only the mayor actually leaving their municipality loses office',()=>{
  const {w,a,b}=fixture();w.mayorId=0;w.villages[1].government.mayorId=1;marry(w);tick(w);
  w.sims[1].x=a.door.x;w.sims[1].y=a.door.y;
  completeHouseholdMigrations(w,2,()=>assert.fail('child is not there'));
  assert.equal(w.sims[1].homeId,b.id);assert.equal(w.villages[1].government.mayorId,1);
  w.sims[2].x=a.door.x;w.sims[2].y=a.door.y;completeHouseholdMigrations(w,2,()=>{});
  assert.equal(w.mayorId,0);assert.equal(w.villages[1].government.mayorId,null);
});
test('an unreachable spouse home cannot cause an instantaneous cross-town marriage move',()=>{
  const {w,b}=fixture();for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+30]=TILE.WATER;
  w.map.reachVersion++;marry(w);assert.equal(w.householdIntents.length,0);assert.equal(w.sims[1].homeId,b.id);
});

test('local cohabitation cannot fall back into a spouse home reserved for a different incoming family',()=>{
  const {w,a,b,fresh}=fixture();b.villageId='village:0';fresh.villageId='village:0';
  w.sims[1].villageId=w.sims[2].villageId='village:0';a.migrationIntentId=99;
  marry(w);assert.equal(w.sims[1].homeId,b.id);assert.equal(a.migrationIntentId,99);
  assert.equal(w.householdIntents.length,0,'a local alternative does not require a cross-town intent');
});

test('married retry weights feasible towns once, preserves its draw and physically reunites the whole family after reload',()=>{
  const {w,a,fresh}=fixture();w.partnerStage={0:'married',1:'married'};
  const neighbor=w.sims[3];neighbor.homeId=fresh.id;neighbor.villageId=fresh.villageId;
  neighbor.x=fresh.door.x;neighbor.y=fresh.door.y;
  const replay=deserialize(serialize(w)),reordered=deserialize(serialize(w));
  reordered.map.facilities.reverse();
  const rng={...w.rngSim},draw=rngNext(rng),money=closed(w);
  const events=marry(w);assert.deepEqual(events,marry(replay));
  assert.deepEqual(events,marry(reordered),'facility storage order cannot select the destination');
  const intent=w.householdIntents[0],choice=intent.migrationChoice;
  assert.equal(choice.candidates.length,3);assert.equal(choice.fromVillageId,'village:1');
  assert.equal(choice.draw,draw);assert.deepEqual(w.rngSim,rng);
  assert.deepEqual(choice.candidates.map(c=>c.population),[2,2,1]);
  for(const c of choice.candidates)assert.equal(c.weight,Math.floor(c.population*1000000/c.distance));
  const target=w.map.facilities.find(f=>f.id===intent.targetHomeId);
  const moving=intent.memberIds.slice();
  assert.ok(moving.length>0);assert.ok(!events.some(e=>e.type==='moved_home'));
  applyRomance(w,w.sims[1],0,()=>assert.fail('pending intent must not be recreated'));
  assert.deepEqual(w.rngSim,rng,'retry of a pending trip consumes no second choice draw');
  let saved=deserialize(serialize(w)),arrivals=[];
  for(let n=0;n<400&&w.householdIntents.length;n++){
    const ev=tick(w);assert.deepEqual(ev,tick(saved));arrivals.push(...ev);
    if(n===1)saved=deserialize(serialize(w));
    assert.equal(closed(w),money);
  }
  assert.equal(w.householdIntents.length,0);assert.equal(serialize(w),serialize(saved));
  for(const id of [0,1,2,4]){
    assert.equal(w.sims[id].homeId,target.id);assert.equal(w.sims[id].villageId,target.villageId);
  }
  assert.equal(w.sims[3].homeId,fresh.id,'unrelated parent is not moved');
  assert.equal(arrivals.filter(e=>e.type==='moved_home'&&e.payload.reason==='marriage').length,moving.length);
});

test('marriage gravity excludes queued homes before drawing, and never substitutes inaccessible or undersized homes',()=>{
  const {w,a,b,fresh}=fixture();w.partnerStage={0:'married',1:'married'};
  a.resources.length=2;b.resources.length=2;
  w.householdIntents.push({intentId:99,kind:'separate',simId:3,targetHomeId:fresh.id});
  const rng={...w.rngSim};marry(w);
  assert.equal(w.householdIntents.length,1);assert.deepEqual(w.rngSim,rng);
  w.householdIntents=[];fresh.resources.length=3;marry(w);
  assert.equal(w.householdIntents.length,0);assert.deepEqual(w.rngSim,rng);
  fresh.resources.push({...fresh.resources[0],id:'extra'});
  for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+70]=TILE.WATER;
  w.map.reachVersion++;marry(w);
  assert.equal(w.householdIntents.length,0);assert.deepEqual(w.rngSim,rng);
});
