import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {commissionAirport} from '../sim/air-network.js';
import {TILE} from '../sim/map.js';
import {emptyState} from '../sim/simfactory.js';
import {newGovernment} from '../sim/government.js';
import {updateEmployment} from '../sim/employer-assignment.js';
import {collectCandidates} from '../sim/tick.js';
import {chooseVisit} from '../sim/visit-choice.js';
import {Storage} from '../db/storage.js';
import {considerUniversity} from '../sim/education.js';

function fixture(){
  const w=createWorld(32),s=w.sims[0];w.sims=[s];
  w.map={w:64,h:8,tiles:Array(512).fill(TILE.GRASS),facilities:[],reachVersion:0};
  for(let y=0;y<8;y++)w.map.tiles[y*64+32]=TILE.WATER;
  const facility=(id,type,x,villageId)=>({id,type,villageId,door:{x,y:3},resources:[{id:`${id}:seat`,x,y:3}],revenue:100000});
  w.map.facilities=[facility('home','house',0,'village:0'),facility('cafe','cafe',54,'village:1')];
  w.villages.push({...w.villages[0],id:'village:1',name:'건너편',center:{x:54,y:3},government:newGovernment()});
  s.homeId='home';s.villageId='village:0';s.x=0;s.y=3;s.traits.age=30;s.traits.occupation='jobless';
  s.education.course=null;s.education.completed=true;s.state=emptyState();s.money=10000;s.hasCar=false;
  s.needs={hunger:10000,energy:10000,social:10000,fun:10000};
  w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;w.projects=[];w.zoneOrders=[];w.plots=[];
  for(const [i,x] of [[0,2],[1,52]]){
    const a=facility(`airport${i}`,'airport',x,`village:${i}`);w.map.facilities.push(a);
    commissionAirport(w.air,a,`project:${i}`,539,{speed:10,dwellTicks:2,capacity:1});
  }
  return {w,s};
}
const assign=action=>[{sequence:1,command:'assign',payload:{simId:0,actionType:action}}];
function until(w,predicate,events=[]){
  for(let i=0;i<200&&!predicate();i++)events.push(...tick(w));
  assert.ok(predicate(),'expected travel transition within 200 ticks');return events;
}

test('actual cross-water visit walks to gate, flies, walks to resource and only then records arrival',()=>{
  const {w,s}=fixture(),events=tick(w,assign('eat')),states=new Set([s.state.kind]);
  assert.ok(events.some(e=>e.type==='action_started'&&e.payload.action==='eat'));
  assert.equal(w.transportStats.today.airTrips,1);assert.equal(s.state.flight.phase,'access');
  let alighted=false,completed=false;
  for(let i=0;i<180&&!completed;i++){
    const next=tick(w);events.push(...next);states.add(s.state.kind);
    if(next.some(e=>e.type==='flight_alighted')){
      alighted=true;assert.equal(w.transportStats.today.arrivals,0);assert.equal(s.x,52);
      assert.equal(s.state.kind,'walking');assert.equal(s.state.flight.phase,'egress');
    }
    if(s.state.kind==='flying')assert.equal(s.x,w.air.links[0].aircraft.x);
    completed=next.some(e=>e.type==='action_completed'&&e.payload.action==='eat');
  }
  assert.ok(alighted&&completed);assert.ok(states.has('flying'));assert.ok(states.has('walking'));
  assert.equal(w.transportStats.today.airArrivals,1);
  const visits=Object.values(w.transportStats.today.municipalVisits);assert.equal(visits[0].arrivals,1);
  assert.equal(w.transportStats.today.walkedTiles,4);assert.ok(w.transportStats.today.airDistance>=50);
  assert.equal(w.wear[3*64+32],undefined,'flight never wears water into a road');
});

test('world tick resumes identically from access, gate, flying and egress states',()=>{
  for(const cut of [540,541,543,546,548]){
    const {w}=fixture();tick(w,assign('eat'));until(w,()=>w.worldTick>=cut);
    const copy=deserialize(serialize(w));migrateWorld(copy);
    for(let i=0;i<100;i++)assert.deepEqual(tick(w),tick(copy));
    assert.equal(serialize(w),serialize(copy));
  }
});

test('a flying resident cannot be reassigned out of the aircraft',()=>{
  const {w,s}=fixture();tick(w,assign('eat'));until(w,()=>s.state.kind==='flying');
  const action=s.state.action,events=tick(w,assign('sleep'));
  assert.ok(events.some(e=>e.type==='input_rejected'));
  assert.equal(s.state.kind,'flying');assert.equal(s.state.action,action);
});

test('removing the final resource while airborne cancels at airport without a false visit or stale reservation',()=>{
  const {w,s}=fixture();tick(w,assign('eat'));until(w,()=>s.state.kind==='flying');
  w.map.facilities=w.map.facilities.filter(f=>f.id!=='cafe');
  const events=[];until(w,()=>events.some(e=>e.type==='action_failed'),events);
  assert.ok(events.some(e=>e.type==='action_failed'&&e.payload.reason==='target_unavailable'));
  assert.equal(w.transportStats.today.airArrivals??0,0);assert.equal(w.transportStats.today.municipalVisits,undefined);
  assert.equal(w.reservations['cafe:cafe:seat'],undefined);assert.equal(s.x,52);
});

test('cross-water employer assignment leads to actual attended wages and a return flight home',()=>{
  const {w,s}=fixture();s.traits.occupation='barista';const before=s.money,events=tick(w,assign('work'));
  assert.equal(s.employment.facilityId,'cafe');
  assert.equal(events.find(e=>e.type==='employment_started').payload.distance,54);
  for(let i=0;i<300&&!events.some(e=>e.type==='action_completed'&&e.payload.action==='work');i++)events.push(...tick(w));
  assert.ok(events.some(e=>e.type==='action_completed'&&e.payload.action==='work'));
  assert.ok(s.money>before);assert.equal(s.x,54);
  events.push(...tick(w,assign('sleep')));
  for(let i=0;i<100&&s.state.kind!=='performing';i++)events.push(...tick(w));
  assert.equal(s.x,0);assert.equal(s.state.action,'sleep');assert.equal(s.state.kind,'performing');
  assert.ok(events.some(e=>e.type==='flight_boarded'&&e.payload.from==='airport1'));
  assert.equal(w.transportStats.today.airArrivals,2);
});

test('temporary airport closure does not fire an assigned remote employee; removal does',()=>{
  const {w,s}=fixture();s.traits.occupation='barista';updateEmployment(w,540,()=>{});
  const employer={...s.employment};w.air.links[0].blocked=true;
  w.incidents=[{type:'fire',facilityId:'airport1',sinceTick:540}];
  updateEmployment(w,541,()=>assert.fail('temporary closure must not end employment'));
  assert.deepEqual(s.employment,employer);
  w.map.facilities=w.map.facilities.filter(f=>f.id!=='airport1');
  updateEmployment(w,542,()=>{});assert.equal(s.employment,null);
});

test('enrollment during a commute releases work but keeps the resident aboard until landing without wages',()=>{
  const {w,s}=fixture();s.traits.occupation='barista';tick(w,assign('work'));
  until(w,()=>s.state.kind==='flying');
  s.traits.occupation='student';s.education.course='university';s.education.completed=false;
  const cash=s.money,events=tick(w);
  assert.equal(s.state.kind,'flying');assert.equal(s.state.flight.cancelOnAlight,true);
  assert.equal(w.reservations['cafe:cafe:seat'],undefined);
  const copy=deserialize(serialize(w));migrateWorld(copy);
  for(let i=0;i<10;i++){const a=tick(w);events.push(...a);assert.deepEqual(a,tick(copy));}
  assert.equal(serialize(w),serialize(copy));assert.equal(s.money,cash);
  assert.ok(events.some(e=>e.type==='action_failed'&&e.payload.reason==='lifecycle_changed'));
  assert.ok(!events.some(e=>e.type==='action_completed'&&e.payload.action==='work'));
});

test('finite aircraft seats make the second actual traveller wait for a later departure',()=>{
  const {w,s}=fixture(),other=structuredClone(s);other.id=1;w.sims.push(other);
  w.map.facilities.find(f=>f.id==='cafe').resources.push({id:'second',x:54,y:4});
  const events=tick(w,[...assign('eat'),{sequence:2,command:'assign',payload:{simId:1,actionType:'eat'}}]);
  for(let i=0;i<40;i++)events.push(...tick(w));
  const board=events.filter(e=>e.type==='flight_boarded');
  assert.equal(board.length,2);assert.equal(board[0].simId,0);assert.equal(board[1].simId,1);
  assert.ok(board[1].tick>events.find(e=>e.type==='flight_alighted'&&e.simId===0).tick);
  assert.equal(w.transportStats.today.airArrivals,2);assert.ok(w.transportStats.today.airWaitingTicks>0);
});

test('visit gravity admits an operational cross-water town using physical distance, not flight time',()=>{
  const {w,s}=fixture();
  w.map.facilities.push({id:'local','type':'cafe',villageId:'village:0',door:{x:1,y:3},resources:[{id:'local-seat',x:1,y:3}]});
  const cands=collectCandidates(w,s,['eat'],540,true),pick=xs=>xs.reduce((a,b)=>a.score>b.score?a:b);
  const choice=chooseVisit(w,s,cands,pick(cands),pick);
  assert.equal(choice.evidence.candidates.length,2);
  assert.equal(choice.evidence.candidates.find(c=>c.villageId==='village:1').distance,54);
});

test('actual all-airport closure holds aboard, resumes by diversion and stores real events without a false visit',()=>{
  const {w,s}=fixture(),events=tick(w,assign('eat'));
  until(w,()=>s.x>=22,events);
  w.incidents=['airport0','airport1'].map(facilityId=>({type:'fire',facilityId,sinceTick:w.worldTick}));
  events.push(...tick(w));assert.equal(w.air.links[0].aircraft.disruption.kind,'holding');
  const position={x:s.x,y:s.y},copy=deserialize(serialize(w));migrateWorld(copy);
  for(let i=0;i<3;i++){
    const next=tick(w);events.push(...next);assert.deepEqual(next,tick(copy));
    assert.deepEqual({x:s.x,y:s.y},position);assert.equal(s.state.kind,'flying');
  }
  w.incidents=w.incidents.filter(i=>i.facilityId==='airport1');copy.incidents=structuredClone(w.incidents);
  for(let i=0;i<30&&!events.some(e=>e.type==='action_failed');i++){
    const next=tick(w);events.push(...next);assert.deepEqual(next,tick(copy));
  }
  assert.equal(serialize(w),serialize(copy));
  assert.ok(events.some(e=>e.type==='flight_diversion_landed'));
  assert.ok(events.some(e=>e.type==='action_failed'&&e.payload.reason==='no_path'));
  assert.equal(w.transportStats.today.airArrivals??0,0);assert.equal(w.transportStats.today.municipalVisits,undefined);
  assert.equal(w.reservations['cafe:cafe:seat'],undefined);
  assert.ok(s.noPathCool['cafe:cafe:seat']>w.worldTick);
  const storage=new Storage(':memory:');
  try{
    storage.loadOrCreate({seed:32,nowUtcMs:1000});
    storage.commitBatch({world:w,events,appliedInputIds:[],epochUtcMs:1000});
    assert.equal(storage.db.prepare('SELECT count(*) AS n FROM events').get().n,events.length);
  }finally{storage.close();}
});

test('operational air access permits paid university enrollment and actual study without an employer',()=>{
  const {w,s}=fixture();w.map.facilities.find(f=>f.id==='cafe').type='university';
  s.traits.age=20;s.traits.occupation='student';s.education.course='university';s.education.completed=false;
  const cash=s.money,treasury=w.villages[1].government.treasury;
  considerUniversity(w,s,540,()=>{});assert.equal(s.education.universityEnrolled,true);
  assert.equal(cash-s.money,w.logic.education.annualTuition);
  assert.equal(w.villages[1].government.treasury-treasury,w.logic.education.annualTuition);
  const events=tick(w,assign('study'));for(let i=0;i<100;i++)events.push(...tick(w));
  assert.ok(s.education.studied.university>0);assert.equal(s.employment,null);
  assert.ok(events.some(e=>e.type==='flight_boarded'));
  assert.ok(!events.some(e=>e.type==='action_completed'&&e.payload.action==='work'));
});

test('a suspended air-only campus does not collect enrollment tuition',()=>{
  const {w,s}=fixture();w.map.facilities.find(f=>f.id==='cafe').type='university';
  s.traits.age=20;s.traits.occupation='student';s.education.course='university';s.education.completed=false;
  w.air.links[0].blocked=true;const cash=s.money;
  considerUniversity(w,s,540,()=>{});assert.equal(s.education.universityEnrolled,false);assert.equal(s.money,cash);
});

test('airport removal during an actual flight retires the gate and diverts before releasing the traveller',()=>{
  const {w,s}=fixture(),events=tick(w,assign('eat'));until(w,()=>s.state.kind==='flying',events);
  w.map.facilities=w.map.facilities.filter(f=>f.id!=='airport1');
  const before={x:s.x,y:s.y};events.push(...tick(w));
  assert.equal(w.air.airports[1].removed,true);assert.equal(w.air.links[0].blocked,true);
  assert.equal(s.state.kind,'flying');assert.deepEqual({x:s.x,y:s.y},before);
  const copy=deserialize(serialize(w));migrateWorld(copy);
  for(let i=0;i<15;i++){const next=tick(w);events.push(...next);assert.deepEqual(next,tick(copy));}
  assert.equal(serialize(w),serialize(copy));assert.equal(w.air.links.length,1);
  assert.equal(w.air.links[0].blocked,true);assert.equal(w.air.links[0].aircraft.passengers.length,0);
  assert.equal(events.filter(e=>e.type==='airport_removed').length,1);
  assert.ok(events.some(e=>e.type==='flight_diversion_landed'&&e.payload.airportId==='airport0'));
  assert.equal(w.reservations['cafe:cafe:seat'],undefined);
  assert.equal(w.transportStats.today.airArrivals??0,0);
});
