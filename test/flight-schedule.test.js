import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airDistance, flightPosition, flightServiceAt, nextFlight } from '../sim/flight-schedule.js';

const route = () => ({ id: 'air:0', from: 'airport0', to: 'airport1',
  fromPoint: { x: 0, y: 0 }, toPoint: { x: 30, y: 40 },
  speed: 5, dwellTicks: 3, openedTick: 100, pausedTicks: 0, blocked: false });

test('flight physical distance is symmetric, rounded Euclidean, not BFS/Manhattan', () => {
  assert.equal(airDistance({x:0,y:0},{x:3,y:4}),5);
  assert.equal(airDistance({x:0,y:0},{x:1,y:1}),2);
  for(let x=0;x<20;x++)for(let y=0;y<20;y++) {
    const a={x,y},b={x:19,y:19},d=airDistance(a,b),n=(19-x)**2+(19-y)**2;
    assert.equal(d,airDistance(b,a));assert.ok(d*d>=n);
    assert.ok(d===0||(d-1)**2<n);
  }
});

test('straight flight positions stay bounded and reverse identically without mutation', () => {
  for(const end of [{x:10,y:17},{x:0,y:2},{x:10,y:2},{x:0,y:17}]){
    const start=Object.freeze({x:5,y:7}),duration=airDistance(start,end);
    Object.freeze(end);
    assert.deepEqual(flightPosition(start,end,0,duration),start);
    assert.deepEqual(flightPosition(start,end,duration,duration),end);
    let previous=start;
    for(let t=0;t<=duration;t++){
      const p=flightPosition(start,end,t,duration);
      assert.deepEqual(p,flightPosition(end,start,duration-t,duration));
      for(const axis of ['x','y']){
        assert.ok(p[axis]>=Math.min(start[axis],end[axis])&&p[axis]<=Math.max(start[axis],end[axis]));
        assert.ok(Math.abs(p[axis]-previous[axis])<=1);
      }
      previous=p;
    }
  }
});

test('schedule gate/flight/arrival boundaries match next departures in both directions', () => {
  const l=route();assert.equal(flightServiceAt(l,99),null);
  assert.equal(flightServiceAt(l,100).airportId,l.from);
  assert.deepEqual(nextFlight(l,l.from,100),{linkId:l.id,from:l.from,to:l.to,
    departureTick:103,arrivalTick:113,rideTicks:10,waitTicks:3});
  assert.equal(flightServiceAt(l,103).departure,true);
  assert.equal(flightServiceAt(l,104).kind,'flying');
  assert.equal(flightServiceAt(l,112).kind,'flying');
  assert.equal(flightServiceAt(l,113).airportId,l.to);
  assert.equal(nextFlight(l,l.to,113).departureTick,116);
  assert.equal(flightServiceAt(l,116).departure,true);
  assert.equal(flightServiceAt(l,117).kind,'flying');
  assert.equal(flightServiceAt(l,126).airportId,l.from);
  assert.equal(nextFlight(l,l.from,104).departureTick,129);
});

test('every advertised departure and arrival agrees with the physical schedule', () => {
  for(const speed of [1,5,50,100])for(const pause of [0,7]){
    const l={...route(),speed,pausedTicks:pause};
    for(let ready=0;ready<400;ready++)for(const from of [l.from,l.to]){
      const f=nextFlight(l,from,ready),departure=flightServiceAt(l,f.departureTick);
      assert.ok(f.departureTick>=ready);assert.equal(departure.airportId,from);
      assert.equal(departure.departure,true);
      assert.equal(flightServiceAt(l,f.arrivalTick).airportId,f.to);
      assert.equal(nextFlight(l,from,f.departureTick).departureTick,f.departureTick);
      assert.ok(nextFlight(l,from,f.departureTick+1).departureTick>f.departureTick);
    }
  }
});

test('persisted pause shifts service without extra aircraft, RNG or catch-up bursts', () => {
  const original=route(),resumed=JSON.parse(JSON.stringify({...original,pausedTicks:20}));
  for(let t=100;t<300;t++)assert.deepEqual(flightServiceAt(original,t),flightServiceAt(resumed,t+20));
  assert.equal(nextFlight({...resumed,blocked:true},resumed.from,130),null);
  assert.equal(nextFlight(resumed,'unknown',130),null);
  const before=JSON.stringify(resumed);
  nextFlight(resumed,resumed.from,10_000_000);
  assert.equal(JSON.stringify(resumed),before);
});

test('malformed geometry and timing fail explicitly instead of producing invalid coordinates', () => {
  assert.throws(()=>airDistance({x:-1,y:0},{x:1,y:0}),RangeError);
  assert.throws(()=>airDistance({x:0,y:0},{x:Number.MAX_SAFE_INTEGER,y:0}),RangeError);
  assert.throws(()=>flightPosition({x:0,y:0},{x:1,y:1},2,1),RangeError);
  for(const patch of [{speed:0},{dwellTicks:0},{openedTick:-1},{pausedTicks:-1},
    {to:'airport0'},{toPoint:{x:0,y:0}}])assert.throws(()=>nextFlight({...route(),...patch},'airport0',100),RangeError);
});
