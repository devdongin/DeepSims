import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {restoreAirNetwork} from '../sim/air-save.js';
import {commissionAirport} from '../sim/air-network.js';
import {advanceAirService} from '../sim/air-service.js';
import {chooseFlightItinerary} from '../sim/flight-itinerary.js';

function fixture(){
  const world=createWorld(32);world.sims=world.sims.slice(0,1);
  const facilities=[{id:'airport0',villageId:'village:0',type:'airport',door:{x:0,y:0}},
    {id:'airport1',villageId:'village:1',type:'airport',door:{x:10,y:0}}];
  for(const f of facilities)commissionAirport(world.air,f,`project:${f.id}`,0,{speed:1,dwellTicks:2,capacity:2});
  world.map.facilities.push(...facilities);
  const itinerary=chooseFlightItinerary(world.air.links,'airport0','airport1',0,2);
  const sim=world.sims[0];sim.x=0;sim.y=0;
  sim.state={kind:'waiting_flight',flight:{legs:itinerary.legs,legIndex:0,airportId:'airport0',waitingSince:0,readyTick:0,boardedTick:null}};
  return world;
}
const step=(w,t,closed=[])=>{
  const events=[];
  advanceAirService(w.air,w.sims,w.map.facilities,closed.map(facilityId=>({facilityId})),t,2,
    (...event)=>events.push(event));w.worldTick=t;return events;
};

test('missing or empty old airport state restores without inventing aircraft or consuming RNG',()=>{
  for(const air of [undefined,null,{airports:[],links:[]}]){
    const w=createWorld(32),rng=serialize(w.rngSim);w.air=air;w.schemaVersion=76;
    migrateWorld(w);assert.deepEqual(w.air,{airports:[],links:[],nextId:0});assert.equal(serialize(w.rngSim),rng);
    const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
  }
});

test('missing nextId derives from committed identities and next commissioning cannot reuse a link',()=>{
  const w=fixture();delete w.air.nextId;const before=serialize(w.air);
  const restored=restoreAirNetwork(w.air,w.sims,0);assert.equal(restored.nextId,1);assert.equal(serialize(w.air),before);
  commissionAirport(restored,{id:'airport2',type:'airport',villageId:'village:2',door:{x:20,y:0}},
    'project:airport2',0,{speed:1,dwellTicks:2,capacity:2});
  assert.deepEqual(restored.links.map(l=>l.id),['air:0','air:1']);
});

test('partial paid network records fail at load before any migration mutation',()=>{
  const mutations=[
    w=>delete w.air.airports[0].projectId,
    w=>delete w.air.airports[0].openedTick,
    w=>delete w.air.links[0].aircraft,
    w=>delete w.air.links[0].aircraft.passengers,
    w=>{w.air.links[0].blocked=true;},
    w=>{w.air.links[0].aircraft.disruption={kind:'teleport'};},
    w=>{w.air.nextId=0;},
    w=>{w.air.links[0].fromPoint.x=1;},
    w=>{w.air.links[0].capacity=0;},
    w=>{w.air.airports[1].projectId=w.air.airports[0].projectId;},
    w=>{w.air.links=[];},
    w=>{w.worldTick=10;},
    w=>{w.air.lastServiceTick=1;},
    w=>{w.air.links[0].aircraft.passengers=[w.sims[0].id];},
    w=>{w.air.links[0].aircraft.x=3;},
    w=>{step(w,2);w.air.links[0].aircraft.passengers.push(w.sims[0].id);},
    w=>{step(w,2);w.sims[0].x=3;},
  ];
  for(const mutate of mutations){
    const w=fixture();mutate(w);const before=serialize(w);
    assert.throws(()=>migrateWorld(w),RangeError,mutate.toString());assert.equal(serialize(w),before);
  }
});

test('resident removed after service remains removed and stale occupancy cleans identically after resume',()=>{
  const w=fixture();for(let t=0;t<=2;t++)step(w,t);
  assert.equal(w.sims[0].state.kind,'flying');w.sims=[];
  const copy=deserialize(serialize(w));migrateWorld(copy);
  assert.equal(serialize(copy),serialize(w));
  assert.deepEqual(step(w,3),step(copy,3));assert.equal(serialize(copy),serialize(w));
  assert.deepEqual(copy.air.links[0].aircraft.passengers,[]);
});

test('partial access and egress saves fail at load before a walking tick can consume them',()=>{
  const valid=()=>{
    const w=fixture(),s=w.sims[0];
    s.state.kind='walking';s.state.path=[{x:0,y:0}];s.state.journey={mode:'air'};
    Object.assign(s.state.flight,{phase:'access',waitingSince:null});return w;
  };
  const original=valid();migrateWorld(original);
  for(const mutate of [
    w=>delete w.sims[0].state.flight,
    w=>delete w.sims[0].state.flight.legs,
    w=>{w.sims[0].state.flight.readyTick=NaN;},
    w=>{w.sims[0].state.path[0].x=4;},
    w=>{w.sims[0].state.flight.legs[0].to='missing';},
    w=>{w.sims[0].state.flight.phase='egress';w.sims[0].state.path=null;},
  ]){
    const w=valid();mutate(w);const before=serialize(w);assert.throws(()=>migrateWorld(w),RangeError);
    assert.equal(serialize(w),before);
  }
});

test('actual service and all recovery phases survive load with identical subsequent events and world',()=>{
  const phases=new Set();
  const closed=t=>t>=8&&t<11?['airport0','airport1','airport2']:t>=11&&t<17?['airport0','airport1']:[];
  for(let cut=0;cut<=30;cut++){
    const w=fixture(),alternate={id:'airport2',type:'airport',villageId:'village:2',door:{x:5,y:3}};
    commissionAirport(w.air,alternate,'project:airport2',0,{speed:1,dwellTicks:2,capacity:2});
    w.map.facilities.push(alternate);
    for(let t=0;t<=cut;t++)step(w,t,closed(t));
    phases.add(w.air.links[0].aircraft.disruption?.kind??'normal');
    const copy=deserialize(serialize(w));migrateWorld(copy);
    assert.equal(serialize(copy),serialize(w),`load at ${cut}`);
    for(let t=cut+1;t<=35;t++)assert.deepEqual(step(w,t,closed(t)),step(copy,t,closed(t)));
    assert.equal(serialize(copy),serialize(w));
  }
  for(const phase of ['normal','holding','diverting','landed','repositioning'])assert.ok(phases.has(phase),phase);
});
