import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceAirService} from '../sim/air-service.js';
import {chooseFlightItinerary} from '../sim/flight-itinerary.js';
import {Storage} from '../db/storage.js';

function fixture(){
  const facilities=[{id:'A',type:'airport',door:{x:0,y:0}},{id:'B',type:'airport',door:{x:10,y:0}},{id:'C',type:'airport',door:{x:5,y:3}}];
  const link={id:'AB',from:'A',to:'B',fromPoint:{x:0,y:0},toPoint:{x:10,y:0},openedTick:0,pausedTicks:0,
    speed:1,dwellTicks:2,capacity:1,blocked:false,aircraft:{x:0,y:0,passengers:[]}};
  const itinerary=chooseFlightItinerary([link],'A','B',0,2);
  const sim={id:1,x:0,y:0,state:{kind:'waiting_flight',action:'work',facilityId:'office',resourceId:'desk',
    flight:{legs:itinerary.legs,legIndex:0,airportId:'A',waitingSince:0,readyTick:0,boardedTick:null}}};
  return {network:{airports:JSON.parse(JSON.stringify(facilities)),links:[link],nextId:1},sims:[sim],facilities};
}
const step=(f,t,closed=[],events=[])=>advanceAirService(f.network,f.sims,f.facilities,closed.map(facilityId=>({facilityId})),t,2,
  (type,id,payload)=>events.push({t,type,id,payload}));

test('combined service boards and lands on schedule without invoking recovery',()=>{
  const f=fixture(),events=[];for(let t=0;t<=12;t++)step(f,t,[],events);
  assert.equal(f.sims[0].state.kind,'flight_arrived');assert.equal(f.sims[0].x,10);
  assert.deepEqual(events.map(e=>e.type),['flight_boarded','flight_alighted']);
  assert.equal(f.network.links[0].aircraft.disruption,undefined);
});

test('closed gate blocks new boarding and leaves the traveller at the actual gate',()=>{
  const f=fixture(),events=[];for(let t=0;t<=4;t++)step(f,t,['B'],events);
  assert.equal(f.sims[0].state.kind,'flight_route_unavailable');assert.equal(f.sims[0].x,0);
  assert.ok(!events.some(e=>e.type==='flight_boarded'));
  assert.ok(!events.some(e=>e.type==='flight_holding'||e.type==='flight_diverted'),'a grounded empty aircraft does not take off into a closure');
  assert.equal(events.filter(e=>e.type==='flight_service_suspended').length,1);
});

test('airborne closure diverts, unloads, returns the empty aircraft and resumes without moving landed residents',()=>{
  const f=fixture(),events=[];for(let t=0;t<=7;t++)step(f,t,[],events);
  for(let t=8;t<=15;t++)step(f,t,['B'],events);
  assert.equal(f.sims[0].state.kind,'flight_diverted_arrival');
  assert.deepEqual({x:f.sims[0].x,y:f.sims[0].y},{x:5,y:3});
  for(let t=16;t<=25;t++)step(f,t,[],events);
  assert.equal(f.network.links.length,1);assert.equal(f.network.links[0].blocked,false);
  assert.ok(events.some(e=>e.type==='flight_service_resumed'));
  assert.deepEqual({x:f.sims[0].x,y:f.sims[0].y},{x:5,y:3});
});

test('entire service/recovery execution resumes identically through all-airport closure',()=>{
  for(const cut of [2,7,12,17,23]){
    const f=fixture(),closed=t=>t>=7&&t<12?['A','B','C']:t>=12&&t<17?['A','B']:[];
    for(let t=0;t<=cut;t++)step(f,t,closed(t));
    const copy=JSON.parse(JSON.stringify(f)),a=[],b=[];
    for(let t=cut+1;t<=35;t++){step(f,t,closed(t),a);step(copy,t,closed(t),b);}
    assert.deepEqual(a,b);assert.deepEqual(f,copy);assert.equal(f.network.links[0].blocked,false);
  }
});

test('duplicate/skipped updates reject before mutation and no-aircraft worlds stay unchanged',()=>{
  const f=fixture();step(f,0);const before=JSON.stringify(f);
  assert.throws(()=>step(f,0),RangeError);assert.throws(()=>step(f,2),RangeError);
  assert.equal(JSON.stringify(f),before);
  const empty={links:[],airports:[]};advanceAirService(empty,[],[],[],100,2,()=>{});
  assert.deepEqual(empty,{links:[],airports:[]});
});

test('combined actual service suspension and recovery events cross the real storage boundary',()=>{
  const f=fixture(),actual=[];for(let t=0;t<=30;t++)step(f,t,t>=7&&t<=15?['B']:[],actual);
  const events=actual.map((e,ordinal)=>({tick:e.t,ordinal,type:e.type,simId:e.id,payload:e.payload}));
  assert.ok(events.some(e=>e.type==='flight_service_suspended'));assert.ok(events.some(e=>e.type==='flight_service_resumed'));
  const storage=new Storage(':memory:');
  try{
    const {world}=storage.loadOrCreate({seed:32,nowUtcMs:1000});world.worldTick=30;
    storage.commitBatch({world,events,appliedInputIds:[],epochUtcMs:1000});
    assert.equal(storage.db.prepare('SELECT count(*) AS n FROM events').get().n,events.length);
  }finally{storage.close();}
});
