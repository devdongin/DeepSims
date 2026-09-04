import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,migrateWorld,findNonFinite} from '../sim/index.js';
import {TILE,addBuilding,isWalkable,plotBuildable} from '../sim/map.js';
import {bfsPath} from '../sim/pathfind.js';
import {syncRailNetwork,chooseRailJourney,initializeRail,makeRailState} from '../sim/rail.js';
import {newGovernment} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {railView} from '../server/view.js';

function fixture(capacity=8){
  const w=createWorld(32);w.map={w:128,h:40,tiles:Array(128*40).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.plots=[];w.projects=[];w.zoneOrders=[];w.lastDailyDay=0;w.lastPlanDay=0;
  w.villages.push({id:'village:1',name:'동쪽',center:{x:104,y:15},government:newGovernment()});
  w.logic.transport.railCapacity=capacity;
  const a=addBuilding(w.map,'train_station',{x:8,y:12}),b=addBuilding(w.map,'train_station',{x:96,y:12,villageId:'village:1'});
  const cafe=addBuilding(w.map,'cafe',{x:105,y:12,villageId:'village:1'});
  const home=addBuilding(w.map,'house',{x:2,y:2});
  w.sims=w.sims.slice(0,2);
  for(const s of w.sims){s.x=a.door.x-2;s.y=a.door.y;s.homeId=home.id;s.money=10000;s.hasCar=false;
    s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;
    s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:1000};}
  initializeRail(w);syncRailNetwork(w,0,()=>{});assert.equal(w.rail.links.length,1);
  return {w,a,b,cafe,link:w.rail.links[0]};
}
const assign=id=>({sequence:id,command:'assign',payload:{simId:id,actionType:'eat'}});

for(const transition of ['school','public-post'])test(`${transition} transition preserves a moving passenger until station arrival, including resume`,()=>{
  const {w}=fixture(),s=w.sims[0];w.sims=[s];
  s.traits.age=12;s.traits.occupation='student';s.education.lastStage='primary_school';
  if(transition==='public-post'){s.traits.age=30;s.traits.occupation='police';s.education.lastStage=null;}
  s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  const boundary=w.logic.society.yearDays*1440;
  w.worldTick=boundary-16;w.lastDailyDay=w.logic.society.yearDays-1;w.lastPlanDay=w.lastDailyDay;
  w.rail=makeRailState();syncRailNetwork(w,w.worldTick,()=>{});
  tick(w,[assign(s.id)]);
  while(w.worldTick<boundary-1)tick(w);
  assert.equal(s.state.kind,'riding_train');
  const reservationKey=`${s.state.facilityId}:${s.state.resourceId}`;
  let replay=deserialize(serialize(w));
  const ev=tick(w);assert.deepEqual(ev,tick(replay));
  if(transition==='school'){
    assert.ok(ev.some(e=>e.type==='school_enrolled'&&e.simId===s.id));
    assert.equal(s.traits.age,13);assert.equal(s.traits.occupation,'student');
  }else assert.notEqual(s.traits.occupation,'police');
  assert.equal(s.state.kind,'riding_train','birthday must not eject passenger');
  assert.equal(s.state.rail.cancelOnAlight,true);
  assert.notEqual(w.reservations[reservationKey],s.id,'release stale activity reservation immediately');
  replay=deserialize(serialize(w));
  let alighted=false;
  for(let i=0;i<100&&!alighted;i++){
    const events=tick(w);assert.deepEqual(events,tick(replay));assert.equal(hashWorld(w),hashWorld(replay));
    alighted=events.some(e=>e.type==='rail_alighted'&&e.simId===s.id);
    if(!alighted)assert.equal(s.state.kind,'riding_train');
    else assert.ok(events.some(e=>e.type==='action_failed'&&e.simId===s.id&&e.payload.reason==='lifecycle_changed'));
  }
  assert.ok(alighted);assert.equal(w.rail.stats.boardings,w.rail.stats.alightings);
});

test('rail corridors are adjacent, preserve underlying terrain and avoid facilities and reserved land',()=>{
  const {w,link}=fixture();
  for(let i=1;i<link.path.length;i++){
    const p=link.path[i],prev=link.path[i-1];assert.equal(Math.abs(p.x-prev.x)+Math.abs(p.y-prev.y),1);assert.ok(isWalkable(w.map,p.x,p.y));
    assert.equal(w.map.railTracks[p.y*w.map.w+p.x],true);
    assert.equal(plotBuildable(w.map,{x:p.x,y:p.y},1,1),false);
  }
  const before=serialize(w);syncRailNetwork(w,1,()=>{});assert.equal(serialize(w),before);
  const terrain=w.map.tiles.slice();w.map.reachVersion++;syncRailNetwork(w,2,()=>{});assert.deepEqual(w.map.tiles,terrain);
});

test('real passenger walks, boards, rides and alights before reaching the destination',()=>{
  const {w,cafe,link}=fixture(),s=w.sims[0],saved=deserialize(serialize(w));
  const stages=new Set(),events=[];let arrived=false;
  for(let i=0;i<250&&!arrived;i++){
    const old={x:s.x,y:s.y,kind:s.state.kind},inputs=i===0?[assign(s.id)]:[];
    const ev=tick(w,inputs);assert.deepEqual(ev,tick(saved,inputs));events.push(...ev);stages.add(s.state.kind);
    assert.ok(Math.abs(s.x-old.x)+Math.abs(s.y-old.y)<=(old.kind==='riding_train'?link.speed:1));
    if(s.state.kind==='riding_train'){
      assert.equal(s.x,link.train.x);assert.equal(s.y,link.train.y);assert.equal(s.state.ticksLeft,w.logic.actions.eat.duration);
    }
    arrived=s.state.kind==='performing'&&s.state.action==='eat';
  }
  assert.ok(arrived);for(const kind of ['walking','riding_train','performing'])assert.ok(stages.has(kind),kind);
  assert.equal(events.filter(e=>e.type==='rail_boarded'&&e.simId===s.id).length,1);
  assert.equal(events.filter(e=>e.type==='rail_alighted'&&e.simId===s.id).length,1);
  const r=cafe.resources.find(r=>r.id===s.state.resourceId);assert.deepEqual({x:s.x,y:s.y},{x:r.x,y:r.y});
  assert.equal(link.train.passengers.includes(s.id),false);assert.ok(w.transportStats.today.railArrivals>0);
  assert.ok(w.transportStats.today.municipalVisits);assert.equal(hashWorld(w),hashWorld(saved));assert.deepEqual(findNonFinite(w),[]);
});

test('capacity queues passengers instead of overbooking or teleporting them',()=>{
  const {w,link}=fixture(1),boarded=[];let waited=false;
  for(let i=0;i<300&&boarded.length<2;i++){
    const events=tick(w,i===0?w.sims.map(s=>assign(s.id)):[]);
    boarded.push(...events.filter(e=>e.type==='rail_boarded').map(e=>({id:e.simId,tick:e.tick})));
    assert.ok(link.train.passengers.length<=1);
    waited ||= w.sims.some(s=>s.state.kind==='waiting_train');
  }
  assert.ok(waited);assert.equal(boarded.length,2);assert.deepEqual(boarded.map(e=>e.id),[0,1]);assert.ok(boarded[1].tick>boarded[0].tick);
});

test('rail must beat walk/car schedule estimates and cannot hijack escorted or settlement travel',()=>{
  const {w,cafe}=fixture(),s=w.sims[0],target={action:'eat',res:cafe.resources[0]};
  const direct=bfsPath(w.map,s.x,s.y,target.res.x,target.res.y);assert.ok(chooseRailJourney(w,s,target,direct,0));
  const near={action:'eat',res:{x:s.x+1,y:s.y}};assert.equal(chooseRailJourney(w,s,near,[near.res],0),null);
  for(const action of ['settle_village','escort_child_doctor','construct','respond_fire','supply_groceries'])
    assert.equal(chooseRailJourney(w,s,{...target,action},direct,0),null);
  s.hasCar=true;assert.equal(chooseRailJourney(w,s,target,direct,12),null,'missed departure makes the car preferable');
});

test('riding cannot be interrupted off-station; route suspension and recovery preserve physical train position',()=>{
  const {w,link}=fixture(),s=w.sims[0];tick(w,[assign(s.id)]);
  while(s.state.kind!=='riding_train')tick(w);
  const ev=tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'idle'}}]);
  assert.ok(ev.some(e=>e.type==='input_rejected'));assert.equal(s.state.kind,'riding_train');
  const p=link.path[Math.floor(link.path.length/2)],tile=w.map.tiles[p.y*w.map.w+p.x];
  w.map.tiles[p.y*w.map.w+p.x]=TILE.WALL;w.map.reachVersion++;
  const old={x:link.train.x,y:link.train.y};tick(w);assert.ok(link.blocked);
  for(let i=0;i<3;i++)tick(w);assert.deepEqual({x:link.train.x,y:link.train.y},old);
  w.map.tiles[p.y*w.map.w+p.x]=tile;w.map.reachVersion++;tick(w);
  assert.equal(link.blocked,false);assert.ok(Math.abs(link.train.x-old.x)+Math.abs(link.train.y-old.y)<=link.speed);
});

test('legacy stations migrate without injecting trains or terrain until deterministic network initialization',()=>{
  const {w}=fixture();w.schemaVersion=73;delete w.rail;delete w.map.railTracks;delete w.map.stationVersion;
  w.logic.logicSchemaVersion=82;for(const k of ['railSpeedTiles','railDwellTicks','railCapacity'])delete w.logic.transport[k];
  const terrain=w.map.tiles.slice(),rng=serialize(w.rngSim),money=w.treasury;
  migrateWorld(w);assert.equal(w.rail.links.length,0);assert.deepEqual(w.map.tiles,terrain);
  assert.equal(serialize(w.rngSim),rng);assert.equal(w.treasury,money);const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
  tick(w);assert.equal(w.rail.links.length,1);assert.deepEqual(findNonFinite(w),[]);
});

test('corridors avoid rotated campus reservations without changing terrain',()=>{
  const {w}=fixture();w.rail=makeRailState();w.map.railTracks={};
  w.plots=[{plotId:900,x:45,y:15,used:false}];
  w.zoneOrders=[{plotId:900,type:'university',dir:1}];
  const before=w.map.tiles.slice();syncRailNetwork(w,0,()=>{});
  assert.equal(w.rail.links.length,1);
  for(const p of w.rail.links[0].path)assert.ok(!(p.x>=45&&p.x<55&&p.y>=15&&p.y<27));
  assert.deepEqual(w.map.tiles,before);
});

test('a new bridge connects previously separate station groups without erasing water or duplicating links',()=>{
  const {w}=fixture();w.rail=makeRailState();w.map.railTracks={};
  addBuilding(w.map,'train_station',{x:25,y:25});
  addBuilding(w.map,'train_station',{x:110,y:25});
  for(let y=0;y<w.map.h;y++)w.map.tiles[y*w.map.w+64]=TILE.RIVER;
  w.map.reachVersion++;syncRailNetwork(w,0,()=>{});
  assert.equal(w.rail.links.length,2,'one service on each side, no crossing water');
  w.map.tiles[20*w.map.w+64]=TILE.BRIDGE;w.map.reachVersion++;
  const before=w.map.tiles.slice();syncRailNetwork(w,1,()=>{});
  assert.equal(w.rail.links.length,3);assert.deepEqual(w.map.tiles,before);
  assert.ok(w.rail.links.some(l=>l.path.some(p=>p.x===64&&p.y===20)));
  w.map.reachVersion++;syncRailNetwork(w,2,()=>{});assert.equal(w.rail.links.length,3);
});

test('live train projection copies mutable data and omits static paths',()=>{
  const {w,link}=fixture();link.train.passengers.push(0);
  const view=railView(w.rail);assert.equal(view.links[0].path,undefined);
  assert.deepEqual(view.links[0].train.passengers,[0]);
  view.links[0].train.passengers.push(1);view.stats.boardings=100;
  assert.deepEqual(link.train.passengers,[0]);assert.equal(w.rail.stats.boardings,0);
});

test('save/resume in access, waiting, riding and egress preserves full state and events',()=>{
  const {w}=fixture(1),phases=new Set();let replay=null;
  for(let i=0;i<240;i++){
    const inputs=i===0?w.sims.map(s=>assign(s.id)):[];
    const events=tick(w,inputs);
    if(replay){assert.deepEqual(events,tick(replay,inputs));assert.equal(hashWorld(w),hashWorld(replay));}
    for(const s of w.sims)if(s.state.rail&&!phases.has(s.state.rail.phase)){
      phases.add(s.state.rail.phase);replay=deserialize(serialize(w));
    }
  }
  assert.deepEqual([...phases].sort(),['access','egress','riding','waiting']);
});
