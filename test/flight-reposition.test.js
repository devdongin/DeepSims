import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repositionEmptyAircraft as reposition} from '../sim/flight-reposition.js';
import {flightServiceAt,nextFlight} from '../sim/flight-schedule.js';
import {Storage} from '../db/storage.js';

function fixture(){return {link:{id:'AB',from:'A',to:'B',fromPoint:{x:0,y:0},toPoint:{x:10,y:0},
  openedTick:0,pausedTicks:3,speed:1,dwellTicks:2,capacity:1,blocked:true,
  aircraft:{x:5,y:3,passengers:[],disruption:{kind:'landed',targetId:'C'}}},
  airports:[{id:'A',door:{x:0,y:0}},{id:'B',door:{x:10,y:0}},{id:'C',door:{x:5,y:3}}]};}
const step=(f,t,closed=[],events=[])=>reposition(f.link,f.airports,closed,t,(type,id,payload)=>events.push({t,type,id,payload}));

test('empty aircraft returns physically before new schedule starts; historical opening is retained',()=>{
  const f=fixture(),events=[];assert.equal(step(f,20,[],events),'repositioning');
  assert.equal(f.link.aircraft.x,5);assert.equal(nextFlight(f.link,'A',20),null);
  for(let t=21;t<26;t++){assert.equal(step(f,t,[],events),'repositioning');assert.equal(f.link.blocked,true);}
  assert.equal(step(f,26,[],events),'ready');assert.equal(f.link.aircraft.x,0);assert.equal(f.link.aircraft.y,0);
  assert.equal(f.link.openedTick,0);assert.equal(f.link.serviceEpochTick,26);
  assert.equal(flightServiceAt(f.link,26).airportId,'A');assert.equal(flightServiceAt(f.link,26).departure,false);
  assert.equal(nextFlight(f.link,'A',26).departureTick,28);
  const before=JSON.stringify(f);step(f,27,[],events);assert.equal(JSON.stringify(f),before);assert.equal(events.length,1);
});

test('reposition save/resume has identical positions, events and new timetable',()=>{
  const f=fixture();step(f,20);step(f,21);const copy=JSON.parse(JSON.stringify(f)),a=[],b=[];
  for(let t=22;t<=30;t++){step(f,t,[],a);step(copy,t,[],b);}
  assert.deepEqual(f,copy);assert.deepEqual(a,b);
});

test('grounded recovery waits for both endpoints and does not create a replacement aircraft',()=>{
  const f=fixture(),before=JSON.stringify(f);assert.equal(step(f,20,['B']),'waiting');
  assert.equal(JSON.stringify(f),before);
  f.link.aircraft.x=0;f.link.aircraft.y=0;assert.equal(step(f,21),'ready');
  assert.equal(nextFlight(f.link,'A',21).departureTick,23);
});

test('endpoint closure mid-reposition reuses physical diversion, including all-closed holding',()=>{
  const f=fixture();step(f,20);step(f,21);const position={x:f.link.aircraft.x,y:f.link.aircraft.y};
  assert.equal(step(f,22,['A','B','C']),'holding');
  assert.deepEqual({x:f.link.aircraft.x,y:f.link.aircraft.y},position);
  for(let t=23;t<=28;t++)step(f,t,['A','B']);
  assert.equal(f.link.aircraft.disruption.kind,'landed');assert.equal(f.link.aircraft.x,5);assert.equal(f.link.aircraft.y,3);
  assert.equal(f.link.blocked,true);
  for(let t=29;t<=35;t++)step(f,t);
  assert.equal(f.link.blocked,false);assert.equal(f.link.aircraft.x,0);
});

test('passengers cannot be taken on empty repositioning and moved endpoint identities are rejected',()=>{
  const f=fixture();f.link.aircraft.passengers=[1];const before=JSON.stringify(f);
  assert.throws(()=>step(f,20),RangeError);assert.equal(JSON.stringify(f),before);
  f.link.aircraft.passengers=[];f.airports[0].door.x=1;
  assert.throws(()=>step(f,20),RangeError);
});

test('actual service resumption is registered and accepted by storage',()=>{
  const f=fixture(),actual=[];for(let t=20;t<=26;t++)step(f,t,[],actual);
  const events=actual.map((e,ordinal)=>({tick:e.t,ordinal,type:e.type,simId:e.id,payload:e.payload}));
  assert.equal(events[0].type,'flight_service_resumed');assert.ok(Buffer.byteLength(JSON.stringify(events[0].payload))<=1024);
  const storage=new Storage(':memory:');
  try{
    const {world}=storage.loadOrCreate({seed:32,nowUtcMs:1000});world.worldTick=26;
    storage.commitBatch({world,events,appliedInputIds:[],epochUtcMs:1000});
    assert.equal(storage.db.prepare('SELECT type FROM events').get().type,'flight_service_resumed');
  }finally{storage.close();}
});
