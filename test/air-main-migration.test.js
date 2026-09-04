import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,migrateWorld,serialize,deserialize,tick} from '../sim/index.js';
import {SCHEMA_VERSION} from '../sim/constants.js';
import {pushRecentConflict} from '../sim/cognition.js';
import {commissionAirport} from '../sim/air-network.js';
import {addBuilding,airportSiteBuildable} from '../sim/map.js';
import {newGovernment} from '../sim/government.js';

test('logic106 fills missing main argument affinity without resetting customized main/airport parameters',()=>{
  for(const version of [102,105]){
    const w=createWorld(32);w.logic.logicSchemaVersion=version;
    if(version===105)delete w.logic.social.argumentAffinity;
    else w.logic.social.argumentAffinity=123;
    w.logic.transport.airSpeedTiles=7;
    const air=serialize(w.air),rng=serialize(w.rngSim);
    migrateWorld(w);
    assert.equal(w.logic.social.argumentAffinity,version===105?300:123);
    assert.equal(w.logic.transport.airSpeedTiles,7);
    assert.equal(serialize(w.air),air);assert.equal(serialize(w.rngSim),rng);
    const after=serialize(w);migrateWorld(w);assert.equal(serialize(w),after);
  }
});

test('main schema77 contacts/conflicts survive adding an empty air network',()=>{
  const w=createWorld(32);w.schemaVersion=77;w.logic.logicSchemaVersion=101;
  delete w.air;w.contacts[0][1]=40;w.contacts[1][0]=40;
  pushRecentConflict(w,0,1,0,'argument');
  const contacts=serialize(w.contacts),conflicts=serialize(w.recentConflicts),rng=serialize(w.rngSim);
  migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);
  assert.deepEqual(w.air,{airports:[],links:[],nextId:0});
  assert.equal(serialize(w.contacts),contacts);assert.equal(serialize(w.recentConflicts),conflicts);
  assert.equal(serialize(w.rngSim),rng);const copy=deserialize(serialize(w));
  for(let i=0;i<100;i++)assert.deepEqual(tick(w),tick(copy));
});

test('airport schema77 imports legacy contact counts without losing its air state or tuning',()=>{
  const w=createWorld(32);w.schemaVersion=77;w.logic.logicSchemaVersion=103;
  delete w.contacts;delete w.recentConflicts;w.interactions[0][1]=40;
  w.villages.push({id:'village:1',name:'Migration town',center:{x:200,y:200},government:newGovernment()});
  for(let i=0;i<2;i++){
    let site;
    for(let y=2;y<w.map.h-14&&!site;y+=16)for(let x=2;x<w.map.w-22;x+=24)
      if(airportSiteBuildable(w.map,{x,y},0)){site={x,y};break;}
    assert.ok(site);
    const f=addBuilding(w.map,'airport',{...site,villageId:`village:${i}`});
    commissionAirport(w.air,f,`migration-fixture:${i}`,0,{speed:7,dwellTicks:10,capacity:8});
  }
  assert.equal(w.air.links.length,1);
  w.logic.transport.airSpeedTiles=7;const air=serialize(w.air),rng=serialize(w.rngSim);
  migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);
  assert.equal(serialize(w.air),air);assert.deepEqual(w.contacts,w.interactions);
  assert.notEqual(w.contacts[0],w.interactions[0]);assert.deepEqual(w.recentConflicts,[]);
  assert.equal(w.logic.transport.airSpeedTiles,7);assert.equal(serialize(w.rngSim),rng);
  const before=serialize(w);migrateWorld(w);assert.equal(serialize(w),before);
});
