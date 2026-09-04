import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseVisit} from '../sim/visit-choice.js';
import {makeRng,rngNext} from '../sim/prng.js';
import {createWorld,tick,serialize,deserialize} from '../sim/index.js';
import {addBuilding,TILE} from '../sim/map.js';
import {emptyState} from '../sim/simfactory.js';
import {newGovernment} from '../sim/government.js';
import {pfStats} from '../sim/pathfind.js';
const pick=cs=>[...cs].sort((a,b)=>b.score-a.score||a.facilityId.localeCompare(b.facilityId)||a.resourceId.localeCompare(b.resourceId))[0];
function fixture(){
  const world={villages:[{id:'a'},{id:'b'}],sims:[{villageId:'a'},{villageId:'b'}],rngSim:makeRng(32),
    map:{w:32,h:32,tiles:Array(1024).fill(TILE.GRASS),facilities:[{id:'a',villageId:'a'},{id:'b',villageId:'b'}],reachVersion:0}};
  const sim={x:2,y:2,villageId:'a'};
  const cs=[{action:'play',facilityId:'a',resourceId:'r',res:{x:6,y:2},score:100},
    {action:'play',facilityId:'b',resourceId:'r',res:{x:10,y:2},score:80}];
  return {world,sim,cs};
}
test('visits weight observed town population over real path distance once per town, not per seat',()=>{
  const {world,sim,cs}=fixture(),copy=structuredClone(world),rng={...world.rngSim},draw=rngNext(rng);
  const result=chooseVisit(world,sim,cs,pick(cs),pick);
  assert.deepEqual(result.evidence.candidates.map(o=>[o.population,o.distance,o.weight]),[[1,4,250000],[1,8,125000]]);
  assert.equal(result.evidence.draw,draw);assert.deepEqual(world.rngSim,rng);
  assert.deepEqual(result,chooseVisit(copy,sim,[{...cs[1],resourceId:'z',score:20},...cs].reverse(),pick(cs),pick));
  assert.deepEqual(result.path.at(-1),result.candidate.res);
});
test('urgent, fixed-purpose, appointment and single-town choices preserve candidate and RNG',()=>{
  for(const kind of ['urgent','work','study','party','single']){
    const {world,sim,cs}=fixture(),rng={...world.rngSim};
    if(kind==='single')world.villages.length=1;
    if(kind==='party')cs[0].partyPull=true;
    if(['work','study'].includes(kind))for(const c of cs)c.action=kind;
    assert.deepEqual(chooseVisit(world,sim,cs,cs[0],pick,kind==='urgent'),{candidate:cs[0]});
    assert.deepEqual(world.rngSim,rng);
  }
});
test('disconnected towns cannot win and a sole reachable town needs no draw',()=>{
  const {world,sim,cs}=fixture(),rng={...world.rngSim};
  for(let y=0;y<32;y++)world.map.tiles[y*32+8]=TILE.WATER;
  const result=chooseVisit(world,sim,cs,cs[0],pick);
  assert.equal(result.candidate,cs[0]);assert.equal(result.evidence.candidates.length,1);
  assert.deepEqual(world.rngSim,rng);
});
test('zero-population fallback keeps utility order and searches once per reachable town, not per seat',()=>{
  const {world,sim,cs}=fixture();world.sims=[];
  const rng={...world.rngSim},before=pfStats.calls;
  const extra=Array.from({length:100},(_,n)=>({...cs[1],resourceId:`extra${n}`,score:1}));
  const result=chooseVisit(world,sim,[...cs,...extra],cs[0],pick);
  assert.equal(result.candidate,cs[0]);assert.equal(result.evidence.draw,null);
  assert.equal(pfStats.calls-before,2);assert.deepEqual(world.rngSim,rng);
  const only=pfStats.calls;chooseVisit(world,sim,[cs[0]],cs[0],pick);
  assert.equal(pfStats.calls,only,'one-town candidate set must not add BFS work');
});
test('a disconnected top resource does not hide the next reachable resource in the same town',()=>{
  const {world,sim,cs}=fixture();
  for(let y=0;y<32;y++)world.map.tiles[y*32+8]=TILE.WATER;
  const reachable={...cs[1],resourceId:'reachable',score:1,res:{x:7,y:2}};
  const result=chooseVisit(world,sim,[...cs,reachable],cs[0],pick);
  assert.equal(result.evidence.candidates.find(c=>c.villageId==='b').resourceId,'reachable');
});
function physicalFixture(){
  const w=createWorld(32);w.map={w:80,h:64,tiles:Array(5120).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.sims=w.sims.slice(0,3);w.plots=[];w.projects=[];w.lastDailyDay=0;w.lastPlanDay=0;
  for(let n=0;n<3;n++){
    const villageId=`village:${n}`,h=addBuilding(w.map,'house',{x:5+n*24,y:5,villageId},0);
    addBuilding(w.map,'park',{x:5+n*24,y:20,villageId},0);
    if(n)w.villages.push({id:villageId,center:{...h.door},government:newGovernment()});
    const s=w.sims[n];s.homeId=h.id;s.villageId=villageId;s.x=h.door.x;s.y=h.door.y;
    s.traits.occupation='jobless';s.traits.age=25;s.education.course=null;s.mood=10000;
    s.needs={hunger:10000,energy:10000,social:10000,fun:4000};s.state=emptyState();
    if(n)s.state={...emptyState(),kind:'performing',action:'sleep',facilityId:h.id,resourceId:h.resources[0].id,ticksLeft:1000};
  }
  // The home seats are occupied, so the unmet leisure need requires a public visit.
  for(const f of w.map.facilities.filter(f=>f.type==='house'||f.villageId==='village:0'))for(const r of f.resources)
    w.reservations[`${f.id}:${r.id}`]=999;
  w.rngSim=makeRng(1); // Fixed draw exercises an actual foreign destination.
  return w;
}
test('real idle decision selects a visit then walks to the actual resource with identical save replay',()=>{
  const w=physicalFixture();
  let saved=deserialize(serialize(w));const events=tick(w);assert.deepEqual(events,tick(saved));
  const started=events.find(e=>e.type==='action_started'&&e.simId===0);
  assert.ok(started?.payload.reason.visitChoice,JSON.stringify(started));
  const s=w.sims[0],home=s.homeId,village=s.villageId;
  assert.equal(started.payload.reason.visitChoice.candidates.length,2);
  saved=deserialize(serialize(w));
  for(let n=0;n<200&&s.state.kind==='walking';n++)assert.deepEqual(tick(w),tick(saved));
  const target=w.map.facilities.find(f=>f.id===started.payload.facilityId),r=target.resources.find(r=>r.id===started.payload.resourceId);
  assert.notEqual(target.villageId,village,'fixture must demonstrate a real cross-town visit');
  assert.equal(s.state.kind,'performing');assert.equal(s.x,r.x);assert.equal(s.y,r.y);
  assert.equal(s.homeId,home);assert.equal(s.villageId,village);assert.equal(serialize(w),serialize(saved));
  assert.ok(Object.values(w.transportStats.today.municipalVisits).some(v=>v.to===target.villageId&&v.arrivals===1));
});

test('actual urgent decision bypasses town lottery and survives replay',()=>{
  const w=physicalFixture();w.sims[0].needs.fun=1000;
  const saved=deserialize(serialize(w)),events=tick(w);assert.deepEqual(events,tick(saved));
  const started=events.find(e=>e.type==='action_started'&&e.simId===0);
  assert.equal(started.payload.reason.urgencyOverride,true);
  assert.equal(started.payload.reason.visitChoice,undefined);
  assert.equal(serialize(w),serialize(saved));
});

test('actual party appointment keeps the named venue instead of drawing another town',()=>{
  const w=physicalFixture(),s=w.sims[0],park=w.map.facilities.find(f=>f.type==='park'&&f.villageId==='village:1');
  s.needs.fun=10000;s.needs.social=4000;s.knownTokens=[900];
  w.tokens=[{tokenId:900,topic:'gathering',originTick:0,scheduledTick:1,expiresTick:100,placeId:park.id}];
  const saved=deserialize(serialize(w)),events=tick(w);assert.deepEqual(events,tick(saved));
  const started=events.find(e=>e.type==='action_started'&&e.simId===0);
  assert.equal(started.payload.action,'socialize');assert.equal(started.payload.facilityId,park.id);
  assert.equal(started.payload.reason.partyPull,true);assert.equal(started.payload.reason.visitChoice,undefined);
  assert.equal(serialize(w),serialize(saved));
});
