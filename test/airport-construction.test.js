import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld} from '../sim/index.js';
import {TILE,addBuilding} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {airportConstructionEvidence as evidence} from '../sim/airport-construction.js';
import {migrateWorld} from '../sim/migrate.js';
import {Storage} from '../db/storage.js';

function fixture(){
  const w=createWorld(32);w.map={w:128,h:128,tiles:Array(16384).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.villages[0].center={x:10,y:10};w.villages.push({id:'village:1',name:'공항도시',center:{x:90,y:90},government:newGovernment()});
  w.sims=w.sims.slice(0,2);w.projects=[];w.zoneOrders=[];w.centers=[];
  for(let i=0;i<2;i++){
    const id=`village:${i}`,home=addBuilding(w.map,'house',{x:5+i*80,y:5+i*80,villageId:id}),s=w.sims[i];
    s.villageId=id;s.homeId=home.id;s.x=home.door.x;s.y=home.door.y;s.traits.age=30;s.traits.occupation='jobless';s.education.course=null;
  }
  w.plots=[{plotId:500,x:45,y:45,villageId:'village:1',used:false}];
  w.villages[1].government.cityTier=3;w.villages[1].government.treasury=w.logic.zone.costs.airport;
  w.transportStats.today.municipalVisits={fixture:{from:'village:0',to:'village:1',arrivals:12,walkingTicks:120}};
  w.lastDailyDay=0;w.lastPlanDay=0;
  return w;
}
const order=[{sequence:0,command:'zone',payload:{plotId:500,type:'airport',dir:0}}];
const money=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)+w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)
  +(w.externalOutflow??0)-(w.externalInflow??0);

test('airport requires local tier and real recent long-distance municipal arrivals',()=>{
  const w=fixture();assert.equal(evidence(w,'village:1').eligible,true);
  w.villages[1].government.cityTier=2;assert.equal(evidence(w,'village:1').reason,'tier_locked');
  w.villages[1].government.cityTier=3;w.transportStats.today.municipalVisits.fixture.arrivals=11;
  assert.equal(evidence(w,'village:1').reason,'airport_demand_short');
  w.transportStats.today.municipalVisits.fixture.arrivals=12;w.villages[0].center={x:89,y:89};
  assert.equal(evidence(w,'village:1').completedTrips,0);
});

test('new-day inputs expire old demand using the already-rolled transport day',()=>{
  const w=fixture();w.worldTick=14*1440-1;w.transportStats.history=[{...w.transportStats.today}];
  w.transportStats.today={day:14,municipalVisits:{}};
  assert.equal(evidence(w,'village:1').completedTrips,0);
  const root=fixture(),view={...root,rootWorld:root,sims:root.sims.filter(s=>s.villageId==='village:1')};
  assert.deepEqual(evidence(view,'village:1'),evidence(root,'village:1'));
});

test('ordinary paid airport order charges only its municipality and preserves default labor and replay',()=>{
  const w=fixture(),copy=deserialize(serialize(w)),root=w.treasury,before=money(w),events=tick(w,order);
  assert.deepEqual(events,tick(copy,order));assert.equal(hashWorld(w),hashWorld(copy));
  assert.equal(w.treasury,root);assert.equal(w.villages[1].government.treasury,0);assert.equal(money(w),before);
  const project=w.projects.find(p=>p.type==='airport');assert.ok(project);assert.equal(project.required,60000);
  assert.equal(project.progress,0);assert.equal(project.fundedCost,30000);assert.equal(project.orderedTick,1);
  assert.equal(w.air.airports.length,0);assert.equal(w.air.links.length,0);
  const cash=money(w);const again=tick(w,order);assert.ok(again.some(e=>e.type==='input_rejected'));assert.equal(money(w),cash);
});

test('fund shortage and protected roads/open facilities reject before deducting construction costs',()=>{
  for(const kind of ['funds','road','park']){
    const w=fixture();if(kind==='funds')w.villages[1].government.treasury=29999;
    if(kind==='road')w.map.tiles[50*128+50]=TILE.ROAD;
    if(kind==='park')addBuilding(w.map,'park',{x:50,y:50});
    const before=w.villages[1].government.treasury,terrain=[...w.map.tiles];
    const events=tick(w,order);assert.ok(events.some(e=>e.type==='input_rejected'),kind);
    assert.equal(w.villages[1].government.treasury,before);assert.deepEqual(w.map.tiles,terrain);assert.equal(w.projects.length,0);
  }
});

test('paid airport order retains its committed eligibility after queued demand expires',()=>{
  const w=fixture();
  w.plots.push({plotId:501,x:90,y:45,villageId:'village:1',used:false});
  w.projects.push({plotId:501,type:'house',dir:0,progress:0,required:100000000,zoned:true});
  tick(w,order);
  const paid=w.zoneOrders.find(o=>o.type==='airport');assert.ok(paid);
  assert.equal(paid.fundedCost,30000);assert.equal(w.villages[1].government.treasury,0);
  w.projects=[];
  w.transportStats.today={day:14,municipalVisits:{}};w.transportStats.history=[];
  assert.equal(evidence(w,'village:1').eligible,false);
  // No fictional elapsed simulation is needed: the rolling demand observation
  // changed while this already-paid order waited for a project slot.
  const copy=deserialize(serialize(w)),events=tick(w);
  assert.deepEqual(events,tick(copy));assert.equal(hashWorld(w),hashWorld(copy));
  const project=w.projects.find(p=>p.type==='airport');assert.ok(project);
  assert.equal(project.orderedTick,paid.orderedTick);assert.equal(project.fundedCost,30000);
  assert.ok(!events.some(e=>e.type==='input_rejected'&&e.payload.plotId===500));
});

test('completed paid construction registers its actual airport without instant extra aircraft',()=>{
  // Tuned unit fixture only. Default60000 labor remains asserted separately;
  // the full default-labor completion/30-day operating audit is still required.
  const w=fixture();w.logic.construct.requiredByType.airport=1;
  tick(w,order);const copy=deserialize(serialize(w)),events=[];
  for(let i=0;i<1000&&!events.some(e=>e.type==='airport_opened');i++){
    const a=tick(w);events.push(...a);assert.deepEqual(a,tick(copy));
  }
  assert.ok(events.some(e=>e.type==='airport_opened'));assert.equal(hashWorld(w),hashWorld(copy));
  assert.equal(w.air.airports.length,1);assert.equal(w.air.links.length,0);
  assert.equal(w.map.facilities.find(f=>f.type==='airport').w,20);
  assert.ok(w.air.airports[0].projectId.startsWith('airport:500:1'));
});

test('previous save migration initializes empty air state without aircraft or RNG draws',()=>{
  const w=createWorld(32),rng=serialize(w.rngSim);delete w.air;w.schemaVersion=76;
  const restored=migrateWorld(deserialize(serialize(w)));assert.deepEqual(restored.air,{airports:[],links:[],nextId:0});
  assert.equal(serialize(restored.rngSim),rng);
});

test('two paid airports complete with default labor and create one actual scheduled aircraft',{timeout:120000},()=>{
  // Controlled existing municipalities/demand/funding, not a natural growth claim.
  const w=fixture();w.cityTier=3;w.treasury=w.logic.zone.costs.airport;
  w.plots.push({plotId:501,x:5,y:45,villageId:'village:0',used:false});
  const before=money(w),events=tick(w,[...order,{sequence:1,command:'zone',payload:{plotId:501,type:'airport',dir:0}}]);
  assert.equal(w.projects.filter(p=>p.type==='airport'&&p.required===60000).length,2);
  let copy=null;
  for(let i=0;i<60*1440&&w.air.airports.length<2;i++){
    const a=tick(w);events.push(...a);assert.equal(money(w),before);
    if(copy)assert.deepEqual(a,tick(copy));
    else if(w.projects.some(p=>p.type==='airport'&&p.progress>0))copy=deserialize(serialize(w));
  }
  assert.equal(w.air.airports.length,2,'default paid labor must really complete both projects');
  assert.equal(w.air.links.length,1);assert.equal(events.filter(e=>e.type==='airport_opened').length,2);
  assert.ok(copy);assert.equal(hashWorld(w),hashWorld(copy));
  const first={...w.air.links[0].aircraft};for(let i=0;i<20;i++)assert.deepEqual(tick(w),tick(copy));
  assert.notDeepEqual({x:w.air.links[0].aircraft.x,y:w.air.links[0].aircraft.y},{x:first.x,y:first.y});
  assert.equal(hashWorld(w),hashWorld(copy));
});

test('removing the only airport retires its identity and allows a separately paid replacement',()=>{
  const w=fixture();w.villages[1].government.treasury=60000;w.logic.construct.requiredByType.airport=1;
  const before=money(w),events=tick(w,order);
  for(let i=0;i<1000&&!w.air.airports.length;i++)events.push(...tick(w));
  assert.equal(w.air.airports.length,1);const old=w.air.airports[0].id;
  w.map.facilities=w.map.facilities.filter(f=>f.id!==old);
  w.plots.push({plotId:501,x:15,y:45,villageId:'village:1',used:false});
  events.push(...tick(w,[{sequence:1,command:'zone',payload:{plotId:501,type:'airport',dir:0}}]));
  assert.equal(w.air.airports[0].removed,true,'even an airport with no aircraft must be retired');
  const copy=deserialize(serialize(w));migrateWorld(copy);
  for(let i=0;i<1000&&w.air.airports.length<2;i++){
    const next=tick(w);events.push(...next);assert.deepEqual(next,tick(copy));
  }
  assert.equal(w.air.airports.length,2);assert.notEqual(w.air.airports[1].id,old);
  assert.equal(w.air.airports[1].removed,false);assert.equal(w.air.links.length,0);
  assert.equal(events.filter(e=>e.type==='airport_removed').length,1);
  assert.equal(events.filter(e=>e.type==='airport_opened').length,2);
  assert.equal(money(w),before);assert.equal(hashWorld(w),hashWorld(copy));
  const storage=new Storage(':memory:');try{
    storage.loadOrCreate({seed:32,nowUtcMs:1000});
    storage.commitBatch({world:w,events,appliedInputIds:[],epochUtcMs:1000});
    assert.equal(storage.db.prepare("SELECT count(*) AS n FROM events WHERE type='airport_removed'").get().n,1);
  }finally{storage.close();}
});
