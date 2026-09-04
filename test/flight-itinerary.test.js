import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseFlightItinerary as choose} from '../sim/flight-itinerary.js';
import {flightServiceAt} from '../sim/flight-schedule.js';

const link=(id,from,to,openedTick=0)=>({id,from,to,openedTick,pausedTicks:0,
  fromPoint:{x:0,y:0},toPoint:{x:10,y:0},speed:1,dwellTicks:2,blocked:false});

test('three airports use two real flights with connection dwell and no invented direct route',()=>{
  const links=[link('AB','A','B'),link('BC','B','C')],journey=choose(links,'A','C',0,3);
  assert.equal(journey.legs.length,2);
  assert.equal(journey.legs[0].departureTick,2);assert.equal(journey.legs[0].arrivalTick,12);
  assert.equal(journey.legs[1].departureTick,26);assert.equal(journey.arrivalTick,36);
  for(const leg of journey.legs){
    const route=links.find(l=>l.id===leg.linkId);
    assert.equal(flightServiceAt(route,leg.departureTick).airportId,leg.from);
    assert.equal(flightServiceAt(route,leg.arrivalTick).airportId,leg.to);
  }
  const reverse=choose(links,'C','A',0,3);
  assert.deepEqual(reverse.legs.map(l=>l.linkId),['BC','AB']);
  assert.ok(reverse.legs[1].departureTick>=reverse.legs[0].arrivalTick+3);
});

test('connection time changes a missed departure without changing geometry',()=>{
  const links=[link('AB','A','B'),link('BC','B','C',10)];
  assert.equal(choose(links,'A','C',0,0).arrivalTick,22);
  assert.equal(choose(links,'A','C',0,1).arrivalTick,46);
});

test('arrival time, not leg count or distance alone, chooses the itinerary',()=>{
  const links=[link('AB','A','B'),link('BC','B','C',13),link('AC','A','C',100)];
  assert.deepEqual(choose(links,'A','C',0,3).legs.map(l=>l.linkId),['AB','BC']);
  links[2].openedTick=0;
  assert.deepEqual(choose(links,'A','C',0,3).legs.map(l=>l.linkId),['AC']);
});

test('equal-time paths use stable link IDs regardless of storage order',()=>{
  const links=[link('z','A','B'),link('y','B','C'),link('a','A','D'),link('b','D','C')];
  const result=choose(links,'A','C',0,3);
  assert.deepEqual(result.legs.map(l=>l.linkId),['a','b']);
  assert.deepEqual(choose([...links].reverse(),'A','C',0,3),result);
  assert.deepEqual(choose(JSON.parse(JSON.stringify(links)),'A','C',0,3),result);
});

test('closures and disconnected networks do not fabricate a journey or mutate saved state',()=>{
  const links=[link('AB','A','B'),link('BC','B','C')],before=JSON.stringify(links);
  assert.equal(choose(links,'A','C',0,3,['B']),null);
  assert.equal(choose(links,'A','D',0,3),null);
  assert.equal(choose(links.map(l=>({...l,blocked:l.id==='BC'})),'A','C',0,3),null);
  assert.equal(JSON.stringify(links),before);
  assert.deepEqual(choose(links,'A','A',7,3),{from:'A',to:'A',readyTick:7,arrivalTick:7,legs:[]});
  assert.equal(choose(links,'A','A',7,3,['A']),null);
});

test('cyclic input remains finite and invalid timing/duplicate IDs fail explicitly',()=>{
  const links=[link('AB','A','B'),link('BC','B','C'),link('CA','C','A')];
  assert.ok(choose(links,'A','C',0,3).legs.length<=2);
  assert.throws(()=>choose(links,'A','C',-1,3),RangeError);
  assert.throws(()=>choose(links,'A','C',0,1.5),RangeError);
  assert.throws(()=>choose([...links,links[0]],'A','C',0,3),RangeError);
});
