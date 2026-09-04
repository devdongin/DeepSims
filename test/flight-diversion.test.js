import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceFlightDiversion as advance} from '../sim/flight-diversion.js';
import {Storage} from '../db/storage.js';

function fixture(){return {
  link:{id:'AB',from:'A',to:'B',speed:1,capacity:1,blocked:false,aircraft:{x:5,y:0,passengers:[1]}},
  sims:[{id:1,x:5,y:0,state:{kind:'flying',action:'work',flight:{legs:[{linkId:'AB',from:'A',to:'B'}],legIndex:0,boardedTick:2,waitingSince:0,readyTick:0}}}],
  airports:[{id:'A',door:{x:0,y:0}},{id:'B',door:{x:10,y:0}},{id:'C',door:{x:5,y:3}}]};}
const step=(f,t,closed,events=[])=>advance(f.link,f.sims,f.airports,closed,t,(type,id,payload)=>events.push({t,type,id,payload}));

test('open intended destination is retained instead of diverting to a closer alternate',()=>{
  const f=fixture();step(f,5,['A']);assert.equal(f.link.aircraft.disruption.targetId,'B');
  assert.equal(f.sims[0].x,5);
  for(let t=6;t<=10;t++){step(f,t,['A']);assert.equal(f.sims[0].x,t);}
  assert.equal(f.sims[0].state.kind,'flight_diverted_arrival');assert.equal(f.link.blocked,true);
});

test('closed destination diverts physically to nearest open airport, never to arbitrary ground',()=>{
  const f=fixture(),events=[];step(f,5,['B'],events);
  assert.equal(f.link.aircraft.disruption.targetId,'C');
  step(f,6,['B'],events);assert.deepEqual({x:f.sims[0].x,y:f.sims[0].y},{x:5,y:1});
  step(f,7,['B'],events);assert.equal(f.sims[0].state.kind,'flying');
  step(f,8,['B'],events);assert.equal(f.sims[0].y,3);
  assert.equal(f.sims[0].state.kind,'flight_diverted_arrival');assert.equal(f.sims[0].state.action,'work');
  assert.deepEqual(f.link.aircraft.passengers,[]);
  const before=JSON.stringify(f);step(f,9,['B'],events);assert.equal(JSON.stringify(f),before);
  assert.equal(events.filter(e=>e.type==='flight_diversion_landed').length,1);
});

test('all-closed holding persists without alighting and resumes when an airport opens',()=>{
  const f=fixture(),events=[];
  for(let t=5;t<20;t++)assert.equal(step(f,t,['A','B','C'],events),'holding');
  assert.equal(f.sims[0].state.kind,'flying');assert.equal(f.sims[0].x,5);assert.equal(f.sims[0].y,0);
  assert.equal(events.filter(e=>e.type==='flight_holding').length,1);
  const resumed=JSON.parse(JSON.stringify(f)),a=[],b=[];
  for(let t=20;t<=23;t++){step(f,t,['A','B'],a);step(resumed,t,['A','B'],b);}
  assert.deepEqual(f,resumed);assert.deepEqual(a,b);assert.equal(f.sims[0].y,3);
});

test('alternate closure mid-flight replans from actual position and saved diversion replays',()=>{
  const f=fixture();step(f,5,['B']);step(f,6,['B']);
  const before={x:f.sims[0].x,y:f.sims[0].y};step(f,7,['B','C']);
  assert.deepEqual({x:f.sims[0].x,y:f.sims[0].y},before);
  assert.equal(f.link.aircraft.disruption.targetId,'A');
  const copy=JSON.parse(JSON.stringify(f)),a=[],b=[];
  for(let t=8;t<20;t++){step(f,t,['B','C'],a);step(copy,t,['B','C'],b);}
  assert.deepEqual(f,copy);assert.deepEqual(a,b);assert.equal(f.sims[0].x,0);
});

test('equal-distance alternatives use ID order; death and cancellation release seats only safely',()=>{
  const f=fixture();f.airports=[{id:'Z',door:{x:6,y:0}},{id:'C',door:{x:4,y:0}}];
  f.sims[0].state.flight.cancelOnAlight=true;f.link.aircraft.passengers.push(999);
  step(f,5,[]);assert.equal(f.link.aircraft.disruption.targetId,'C');
  assert.deepEqual(f.link.aircraft.passengers,[1]);assert.equal(f.sims[0].state.kind,'flying');
  step(f,6,[]);assert.equal(f.sims[0].state.kind,'flight_cancelled');assert.equal(f.sims[0].x,4);
});

test('real holding/diversion/landing events are registered and stored under the payload limit',()=>{
  const f=fixture(),actual=[];step(f,5,['A','B','C'],actual);
  for(let t=6;t<=9;t++)step(f,t,['A','B'],actual);
  assert.deepEqual([...new Set(actual.map(e=>e.type))].sort(),['flight_diversion_landed','flight_diverted','flight_holding']);
  const events=actual.map((e,ordinal)=>({tick:e.t,ordinal,type:e.type,simId:e.id,payload:e.payload}));
  for(const e of events)assert.ok(Buffer.byteLength(JSON.stringify(e.payload))<=1024);
  const storage=new Storage(':memory:');
  try{
    const {world}=storage.loadOrCreate({seed:32,nowUtcMs:1000});world.worldTick=10;
    storage.commitBatch({world,events,appliedInputIds:[],epochUtcMs:1000});
    assert.deepEqual(storage.db.prepare('SELECT type FROM events ORDER BY tick,ordinal').all().map(e=>e.type),events.map(e=>e.type));
  }finally{storage.close();}
});
