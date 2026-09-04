import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeAirNetwork,commissionAirport,recentAirportDemand,unavailableAirports} from '../sim/air-network.js';

const cfg={speed:4,dwellTicks:10,capacity:8};
const airport=(id,x,villageId=id)=>({id,type:'airport',villageId,door:{x,y:10}});
const add=(n,f,t=0,stats)=>commissionAirport(n,f,`project:${f.id}`,t,cfg,stats);
const day=(d,from,to,arrivals)=>({day:d,municipalVisits:{visit:{from,to,arrivals}}});

test('completed airport registrations create a bounded tree, never a complete fleet graph',()=>{
  const n=makeAirNetwork();
  for(let i=0;i<10;i++){
    const result=add(n,airport(`a${i}`,10+i*20));
    assert.equal(n.airports.length,i+1);assert.equal(n.links.length,i);
    assert.equal(result.linkId,i?`air:${i-1}`:null);
    assert.ok(n.links.every(l=>l.capacity===8&&l.aircraft.passengers.length===0));
  }
  assert.equal(new Set(n.links.map(l=>l.id)).size,9);
});

test('commissioning is replay-idempotent and detached from mutable facility objects',()=>{
  const n=makeAirNetwork(),f=airport('a',10);add(n,f);
  const before=JSON.stringify(n);assert.equal(add(n,f),null);assert.equal(JSON.stringify(n),before);
  f.door.x=99;assert.equal(n.airports[0].door.x,10);
  const resumed=JSON.parse(JSON.stringify(n));
  assert.deepEqual(add(n,airport('b',40),1),add(resumed,airport('b',40),1));
  assert.deepEqual(n,resumed);
});

test('actual recent completed demand outranks distance, with distance then ID ties',()=>{
  const n=makeAirNetwork();add(n,airport('a',10));add(n,airport('b',100));
  const stats={today:day(0,'c','b',3),history:[]};add(n,airport('c',20),0,stats);
  assert.equal(n.links.at(-1).from,'b');
  const m=makeAirNetwork();add(m,airport('b',10));add(m,airport('a',30));
  const copy=JSON.parse(JSON.stringify(m));copy.airports.reverse();
  add(m,airport('c',20));add(copy,airport('c',20));
  assert.equal(m.links.at(-1).from,'a');assert.deepEqual(m.links,copy.links);
});

test('14-day demand excludes older/future days and counts both directions, not attempted trips',()=>{
  const stats={today:{...day(20,'a','b',2),departures:500,cancelledTrips:100},
    history:[day(6,'a','b',100),day(7,'b','a',3),day(19,'a','c',100),day(21,'a','b',100)]};
  assert.equal(recentAirportDemand(stats,'a','b',20),5);
  assert.equal(recentAirportDemand(stats,'b','a',20),5);
  assert.equal(recentAirportDemand(undefined,'a','b',20),0);
});

test('temporary closure/reopening does not create aircraft, change topology or mutate network',()=>{
  const n=makeAirNetwork(),a=airport('a',10),b=airport('b',40);add(n,a);add(n,b);
  const before=JSON.stringify(n);
  assert.deepEqual(unavailableAirports(n,[a,b],[{facilityId:'a'}]),['a']);
  assert.deepEqual(unavailableAirports(n,[a],[]),['b']);
  assert.deepEqual(unavailableAirports(n,[a,b],[]),[]);
  assert.equal(JSON.stringify(n),before);
});

test('invalid commissioning cannot partially append airports or issue replacement aircraft',()=>{
  for(const bad of [f=>({...f,type:'office'}),f=>({...f,door:{x:-1,y:0}}),
    f=>({...f,villageId:'a'}),f=>({...f,door:{x:10,y:10}})]){
    const n=makeAirNetwork();add(n,airport('a',10));const before=JSON.stringify(n);
    assert.throws(()=>add(n,bad(airport('b',40))),RangeError);assert.equal(JSON.stringify(n),before);
  }
  const n=makeAirNetwork();add(n,airport('a',10));const before=JSON.stringify(n);
  assert.throws(()=>commissionAirport(n,airport('b',40),'project:a',0,cfg),RangeError);
  assert.throws(()=>commissionAirport(n,airport('b',40),'project:b',0,{...cfg,capacity:0}),RangeError);
  assert.equal(JSON.stringify(n),before);
});
