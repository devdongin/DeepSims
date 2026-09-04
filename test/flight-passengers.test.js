import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceScheduledFlights as advance} from '../sim/flight-passengers.js';
import {chooseFlightItinerary} from '../sim/flight-itinerary.js';
import {Storage} from '../db/storage.js';

const link=(id,from,to,x,openedTick=0)=>({id,from,to,fromPoint:{x,y:0},toPoint:{x:x+10,y:0},
  speed:1,dwellTicks:2,capacity:1,openedTick,pausedTicks:0,blocked:false,
  aircraft:{x,y:0,passengers:[]}});
function passenger(id,links,from,to,waitingSince=0){
  const itinerary=chooseFlightItinerary(links,from,to,waitingSince,3);
  const first=links.find(l=>l.id===itinerary.legs[0].linkId),p=from===first.from?first.fromPoint:first.toPoint;
  return {id,...p,state:{kind:'waiting_flight',action:'work',facilityId:'office',resourceId:'desk',
    flight:{legs:itinerary.legs,legIndex:0,airportId:from,waitingSince,readyTick:waitingSince,boardedTick:null}}};
}
const run=(links,sims,start,end,transfer=3)=>{
  const events=[];for(let t=start;t<=end;t++)advance(links,sims,t,transfer,(type,id,payload)=>events.push({t,type,id,payload}));
  return events;
};

test('actual gate FIFO and finite seats defer overflow passengers to a later flight',()=>{
  const links=[link('AB','A','B',0)],sims=[passenger(2,links,'A','B'),passenger(1,links,'A','B')];
  const events=run(links,sims,0,36),boarded=events.filter(e=>e.type==='flight_boarded');
  assert.deepEqual(boarded.map(e=>[e.id,e.t]),[[1,2],[2,26]]);
  assert.deepEqual(events.filter(e=>e.type==='flight_alighted').map(e=>[e.id,e.t]),[[1,12],[2,36]]);
  assert.ok(sims.every(s=>s.state.kind==='flight_arrived'&&s.x===10));
  assert.equal(sims[0].state.action,'work','landing does not fabricate activity completion');
});

test('airborne coordinates follow the actual aircraft rather than jumping to the facility',()=>{
  const links=[link('AB','A','B',0)],sims=[passenger(1,links,'A','B')];
  run(links,sims,0,2);assert.equal(sims[0].x,0);assert.equal(sims[0].state.kind,'flying');
  for(let t=3;t<12;t++){
    run(links,sims,t,t);assert.equal(sims[0].x,t-2);assert.equal(sims[0].x,links[0].aircraft.x);
    assert.equal(sims[0].state.kind,'flying');
  }
});

test('missed first-flight capacity shifts real transfer timing and still reaches the final airport',()=>{
  const links=[link('AB','A','B',0),link('BC','B','C',10,13)];
  const sims=[passenger(2,links,'A','C'),passenger(1,links,'A','C')];
  const events=run(links,sims,0,60);
  assert.deepEqual(events.filter(e=>e.type==='flight_transfer').map(e=>[e.id,e.t,e.payload.readyTick]),[[1,12,15],[2,36,39]]);
  assert.deepEqual(events.filter(e=>e.type==='flight_boarded'&&e.payload.linkId==='BC').map(e=>[e.id,e.t]),[[1,15],[2,39]]);
  assert.ok(sims.every(s=>s.state.kind==='flight_arrived'&&s.x===20));
});

test('all links alight before boarding, including zero-dwell transfer with reversed storage order',()=>{
  const a=[link('zAB','A','B',0),link('aBC','B','C',10,10)];
  const s=[passenger(1,a,'A','C')],b=JSON.parse(JSON.stringify(a)).reverse(),r=JSON.parse(JSON.stringify(s));
  const first=run(a,s,0,22,0),second=run(b,r,0,22,0);
  assert.deepEqual(first,second);assert.deepEqual(s,r);
  assert.equal(first.find(e=>e.type==='flight_boarded'&&e.payload.linkId==='aBC').t,12);
  assert.equal(s[0].state.kind,'flight_arrived');
});

test('save/resume at gate, airborne, transfer and arrival preserves all events and state',()=>{
  for(const cut of [0,2,7,12,15,20,25]){
    const links=[link('AB','A','B',0),link('BC','B','C',10,13)],sims=[passenger(1,links,'A','C')];
    run(links,sims,0,cut);
    const copy=JSON.parse(JSON.stringify({links,sims}));
    assert.deepEqual(run(links,sims,cut+1,60),run(copy.links,copy.sims,cut+1,60));
    assert.deepEqual({links,sims},copy);
  }
});

test('in-flight cancellation waits for landing; missing residents release seats without moving others',()=>{
  const links=[link('AB','A','B',0)],sims=[passenger(1,links,'A','B')];
  run(links,sims,0,4);sims[0].state.flight.cancelOnAlight=true;
  run(links,sims,5,11);assert.equal(sims[0].state.kind,'flying');
  run(links,sims,12,12);assert.equal(sims[0].state.kind,'flight_cancelled');assert.equal(sims[0].x,10);
  links[0].aircraft.passengers.push(999);run(links,sims,13,13);assert.deepEqual(links[0].aircraft.passengers,[]);
});

test('wrong gate and access coordinates cannot board; disrupted links reject before mutation',()=>{
  const links=[link('AB','A','B',0)],sims=[passenger(1,links,'A','B')];sims[0].x=1;
  run(links,sims,0,2);assert.equal(sims[0].state.kind,'waiting_flight');
  links[0].blocked=true;const before=JSON.stringify({links,sims});
  assert.throws(()=>advance(links,sims,3,3,()=>{}),RangeError);
  assert.equal(JSON.stringify({links,sims}),before);
});

test('cancellation at the gate does not put the resident on a new flight',()=>{
  const links=[link('AB','A','B',0)],sims=[passenger(1,links,'A','B')];
  sims[0].state.flight.cancelOnAlight=true;
  const events=run(links,sims,0,12);
  assert.equal(sims[0].state.kind,'flight_cancelled');assert.equal(sims[0].x,0);
  assert.deepEqual(events,[]);assert.deepEqual(links[0].aircraft.passengers,[]);
});

test('actual boarding, transfer and alighting events pass the registered 1KB storage boundary',()=>{
  const links=[link('AB','A','B',0),link('BC','B','C',10,13)],sims=[passenger(1,links,'A','C')];
  const actual=run(links,sims,0,60),events=actual.map((e,ordinal)=>({tick:e.t,ordinal,type:e.type,simId:e.id,payload:e.payload}));
  assert.deepEqual([...new Set(events.map(e=>e.type))].sort(),['flight_alighted','flight_boarded','flight_transfer']);
  for(const e of events)assert.ok(Buffer.byteLength(JSON.stringify(e.payload))<=1024);
  const storage=new Storage(':memory:');
  try{
    const {world}=storage.loadOrCreate({seed:32,nowUtcMs:1000});world.worldTick=60;
    storage.commitBatch({world,events,appliedInputIds:[],epochUtcMs:1000});
    assert.deepEqual(storage.db.prepare('SELECT type FROM events ORDER BY tick,ordinal').all().map(e=>e.type),events.map(e=>e.type));
  }finally{storage.close();}
});
