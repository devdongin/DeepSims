import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeSynthWorld} from '../bench/synthpop.js';
import {tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {TILE,addBuilding} from '../sim/map.js';
import {newGovernment} from '../sim/government.js';
import {emptyState} from '../sim/simfactory.js';
import {airportConstructionEvidence as evidence} from '../sim/airport-construction.js';
import {rollTransportDay,transportSummary} from '../sim/transport-stats.js';
import {Storage} from '../db/storage.js';

// Controlled existing people/needs/towns, but NO seeded travel or intent data.
function fixture(){
  const w=makeSynthWorld(32,13);
  w.map={w:128,h:128,tiles:Array(16384).fill(TILE.GRASS),facilities:[],reachVersion:0};
  for(let y=0;y<128;y++)w.map.tiles[y*128+64]=TILE.WATER;
  w.villages[0].center={x:8,y:65};
  const g=newGovernment();g.cityTier=3;g.treasury=100000;
  w.villages.push({id:'village:1',name:'Other',center:{x:108,y:65},government:g});
  const homes=[addBuilding(w.map,'house',{x:4,y:60,villageId:'village:0'}),
    addBuilding(w.map,'house',{x:100,y:80,villageId:'village:1'})];
  addBuilding(w.map,'cafe',{x:100,y:60,villageId:'village:1'});
  for(const [i,s] of w.sims.entries()){
    const side=i===12?1:0;s.villageId=`village:${side}`;s.homeId=homes[side].id;Object.assign(s,homes[side].door);
    s.state=emptyState();s.money=10000;s.groceries=0;s.mood=0;s.traits.age=30;
    s.traits.occupation='jobless';s.education.course=null;s.education.completed=true;
    s.needs={hunger:side?10000:0,energy:10000,social:10000,fun:10000};
  }
  w.projects=[];w.zoneOrders=[];w.centers=[];w.lastDailyDay=0;w.lastPlanDay=0;w.cityTier=3;w.treasury=100000;
  w.plots=[{plotId:500,x:10,y:20,villageId:'village:0',used:false},{plotId:501,x:90,y:20,villageId:'village:1',used:false}];
  return w;
}

test('actual autonomous unreachable choices unlock paid first airports without inventing arrivals',()=>{
  const w=fixture(),copy=deserialize(serialize(w));assert.equal(evidence(w,'village:0').eligible,false);
  const events=tick(w);assert.deepEqual(events,tick(copy));
  assert.equal(events.filter(e=>e.type==='air_trip_unserved').length,12);
  for(const id of ['village:0','village:1']){
    const e=evidence(w,id);assert.equal(e.eligible,true);assert.equal(e.completedTrips,0);assert.equal(e.unservedIntents,12);
  }
  assert.equal(w.transportStats.today.arrivals,0);
  assert.ok(Object.keys(w.transportStats.pending).every(id=>Number(id)===w.sims[12].id),
    'only the destination resident may have a genuine local departure');
  assert.equal(w.transportStats.today.departures,Object.keys(w.transportStats.pending).length);
  assert.deepEqual(w.air,{airports:[],links:[],nextId:0});
  const repeat=[{sequence:0,command:'assign',payload:{simId:w.sims[0].id,actionType:'eat'}}];
  const again=tick(w,repeat);assert.deepEqual(again,tick(copy,repeat));
  assert.equal(again.filter(e=>e.type==='air_trip_unserved').length,0);assert.equal(evidence(w,'village:0').unservedIntents,12);
  const orders=w.plots.map((p,sequence)=>({sequence,command:'zone',payload:{plotId:p.plotId,type:'airport',dir:0}}));
  assert.deepEqual(tick(w,orders),tick(copy,orders));assert.equal(w.projects.length,2);
  assert.ok(w.projects.every(p=>p.required===60000&&p.fundedCost===30000));
  assert.equal(w.treasury,70000);assert.equal(w.villages[1].government.treasury,70000);
  assert.equal(w.air.airports.length,0,'eligibility and payment are not free completion');
  assert.equal(serialize(w),serialize(copy));
});

test('no-money food action cannot create a paid meal intent; other free choices remain legitimate',()=>{
  const w=fixture();for(const s of w.sims)s.money=0;
  const events=tick(w,[{sequence:0,command:'assign',payload:{simId:w.sims[0].id,actionType:'eat'}}]);
  assert.ok(events.some(e=>e.type==='input_rejected'&&e.payload.action==='eat'&&e.payload.reason==='no_valid_target'));
  assert.equal(events.filter(e=>e.type==='air_trip_unserved'&&['eat','binge_eat'].includes(e.payload.action)).length,0);
});

test('completed visits and failed intents are never added to cross the investment threshold',()=>{
  const w=fixture();tick(w);
  Object.values(w.transportStats.today.unservedAirTrips)[0].residentIds.length=6;
  w.transportStats.today.municipalVisits={sample:{from:'village:0',to:'village:1',arrivals:6}};
  const e=evidence(w,'village:0');assert.equal(e.completedTrips,6);assert.equal(e.unservedIntents,6);assert.equal(e.eligible,false);
});

test('SQL save and day rollover preserve bounded dedup and expire old investment evidence',()=>{
  const w=fixture(),events=tick(w),storage=new Storage(':memory:');
  try{
    storage.loadOrCreate({seed:32,nowUtcMs:1000});storage.commitBatch({world:w,events,appliedInputIds:[],epochUtcMs:1000});
    const restored=storage.loadOrCreate({seed:32,nowUtcMs:1000}).world;
    assert.equal(serialize(restored),serialize(w));assert.deepEqual(tick(w),tick(restored));
    assert.equal(storage.db.prepare("SELECT count(*) n FROM events WHERE type='air_trip_unserved'").get().n,12);
    assert.ok(!JSON.stringify(transportSummary(w.transportStats.today)).includes('residentIds'));
    rollTransportDay(w,1440);assert.ok(!JSON.stringify(w.transportStats.history).includes('residentIds'));
    assert.equal(evidence(w,'village:0').unservedIntents,12);
    rollTransportDay(w,14*1440);assert.equal(evidence(w,'village:0').unservedIntents,0);
    assert.equal(evidence(w,'village:0').eligible,false);
    const old=fixture();delete old.transportStats.today.unservedAirTrips;
    migrateWorld(old);assert.equal(evidence(old,'village:0').unservedIntents,0);
  }finally{storage.close();}
});
