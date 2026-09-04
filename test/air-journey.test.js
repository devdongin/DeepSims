import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseAirJourney as choose} from '../sim/air-journey.js';
import {bfsPath} from '../sim/pathfind.js';
import {TILE} from '../sim/map.js';

function fixture(){
  const a={id:'A',type:'airport',door:{x:10,y:10}},b={id:'B',type:'airport',door:{x:60,y:10}};
  const link={id:'AB',from:'A',to:'B',fromPoint:a.door,toPoint:b.door,openedTick:0,pausedTicks:0,speed:8,dwellTicks:2,capacity:4,blocked:false};
  return {world:{map:{w:80,h:32,tiles:Array(2560).fill(TILE.GRASS),facilities:[a,b],reachVersion:0},
    air:{airports:[a,b],links:[link]},incidents:[],logic:{transport:{airTransferTicks:2,carSpeedTiles:2}}},
    sim:{x:8,y:10,hasCar:false},target:{action:'work',facilityId:'office',res:{x:62,y:10}}};
}

test('air journey includes actual access, wait, flight and egress and keeps physical gravity distance',()=>{
  const f=fixture(),before=JSON.stringify(f),q=choose(f.world,f.sim,f.target,0);
  assert.equal(q.access.length,2);assert.equal(q.egress.length,2);assert.equal(q.itinerary.legs[0].departureTick,2);
  assert.equal(q.estimatedTicks,11);assert.equal(q.physicalDistance,54);assert.equal(q.directTicks,54);
  assert.deepEqual(q.access,bfsPath(f.world.map,8,10,10,10));assert.deepEqual(q.egress,bfsPath(f.world.map,60,10,62,10));
  assert.equal(JSON.stringify(f),before);
});

test('water-disconnected regions can connect through real airport access and egress',()=>{
  const f=fixture();for(let y=0;y<32;y++)f.world.map.tiles[y*80+40]=TILE.WATER;
  assert.equal(bfsPath(f.world.map,8,10,62,10),null);
  const q=choose(f.world,f.sim,f.target,0);assert.ok(q);assert.equal(q.directTicks,null);assert.equal(q.physicalDistance,54);
  assert.ok(q.access.every(p=>p.x<40));assert.ok(q.egress.every(p=>p.x>40));
});

test('short ground journeys and slow airport service do not select flight',()=>{
  const f=fixture();assert.equal(choose(f.world,f.sim,{...f.target,res:{x:11,y:10}},0),null);
  f.world.air.links[0].openedTick=100;assert.equal(choose(f.world,f.sim,f.target,0),null);
  assert.equal(choose(f.world,f.sim,{...f.target,res:{x:8,y:10}},0),null);
});

test('closed airports and suspended links are unavailable, while return-home flights are supported',()=>{
  const f=fixture();f.world.incidents=[{facilityId:'B'}];assert.equal(choose(f.world,f.sim,f.target,0),null);
  f.world.incidents=[];f.world.air.links[0].blocked=true;assert.equal(choose(f.world,f.sim,f.target,0),null);
  f.world.air.links[0].blocked=false;
  const q=choose(f.world,{...f.sim,x:62},{action:'sleep',facilityId:'house',res:{x:8,y:10}},0);
  assert.ok(q);assert.equal(q.itinerary.from,'B');assert.equal(q.itinerary.to,'A');
});

test('special movements and no-airport worlds bypass the query without state changes',()=>{
  const f=fixture();for(const action of ['construct','respond_fire','escort_child_doctor','supply_groceries','settle_village'])
    assert.equal(choose(f.world,f.sim,{...f.target,action},0),null);
  assert.equal(choose(f.world,f.sim,{...f.target,facilityId:'patrol'},0),null);
  f.world.air.links=[];const before=JSON.stringify(f);assert.equal(choose(f.world,f.sim,f.target,0),null);assert.equal(JSON.stringify(f),before);
});

test('airport list order and save/resume preserve selected journey and gate decisions are not retroactive',()=>{
  const f=fixture(),copy=JSON.parse(JSON.stringify(f));copy.world.air.airports.reverse();
  assert.deepEqual(choose(f.world,f.sim,f.target,0),choose(copy.world,copy.sim,copy.target,0));
  const q=choose(f.world,{...f.sim,x:10},f.target,2);
  assert.ok(q.itinerary.legs[0].departureTick>2);
});

test('two water barriers require a genuine two-flight transfer through a reachable hub',()=>{
  const f=fixture(),a=f.world.air.airports[0],c={id:'C',type:'airport',door:{x:60,y:10}},b={id:'B',type:'airport',door:{x:35,y:10}};
  const template=f.world.air.links[0];f.world.air.airports=[a,b,c];f.world.map.facilities=[a,b,c];
  f.world.air.links=[{...template,toPoint:b.door},{...template,id:'BC',from:'B',to:'C',fromPoint:b.door,toPoint:c.door}];
  for(let y=0;y<32;y++)for(const x of [25,45])f.world.map.tiles[y*80+x]=TILE.WATER;
  const q=choose(f.world,f.sim,f.target,0);assert.ok(q);assert.equal(q.itinerary.legs.length,2);
  assert.deepEqual(q.itinerary.legs.map(l=>l.linkId),['AB','BC']);
  f.world.incidents=[{facilityId:'B'}];assert.equal(choose(f.world,f.sim,f.target,0),null);
});
