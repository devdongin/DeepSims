import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TILE,addBuilding,zoneFootprint,isRoadProtected} from '../sim/map.js';
import {campusSiteReserved} from '../sim/center-plots.js';
const map=()=>({w:80,h:80,tiles:Array(6400).fill(TILE.GRASS),facilities:[],reachVersion:0});

test('airport recipe has a larger footprint than university and rotated gates remain inside',()=>{
  for(let dir=0;dir<4;dir++){
    const m=map(),f=addBuilding(m,'airport',{x:20,y:20,villageId:'village:1'},dir),shape=zoneFootprint('airport',dir);
    assert.equal(f.w*f.h,240);assert.ok(f.w*f.h>zoneFootprint('university',0).w*zoneFootprint('university',0).h);
    assert.deepEqual({w:f.w,h:f.h},shape);assert.equal(f.villageId,'village:1');
    assert.equal(f.resources.length,2);assert.ok(f.resources.every(r=>r.kind==='gate'));
    for(const p of [f.door,...f.resources]){
      assert.ok(p.x>=f.x&&p.x<f.x+f.w&&p.y>=f.y&&p.y<f.y+f.h);
      assert.equal(m.tiles[p.y*m.w+p.x],TILE.FLOOR);
    }
    assert.equal(f.revenue,0,'construction does not invent receipts or paid jobs');
  }
});

test('airport construction rejects roads, bridges, terrain, facilities and tracks without mutation',()=>{
  for(const obstacle of [TILE.ROAD,TILE.BRIDGE,TILE.SIDEWALK,TILE.WATER,TILE.WALL,'track']){
    const m=map();if(obstacle==='track')m.railTracks={[25*80+25]:true};else m.tiles[25*80+25]=obstacle;
    const before=JSON.stringify(m);assert.throws(()=>addBuilding(m,'airport',{x:20,y:20}),RangeError);
    assert.equal(JSON.stringify(m),before);
  }
});

test('large airport reservations protect roads and neighboring construction in both directions',()=>{
  for(const field of ['projects','zoneOrders']){
    const m=map(),plots=[{plotId:1,x:20,y:20},{plotId:2,x:35,y:20}],world={map:m,plots,projects:[],zoneOrders:[]};
    world[field]=[{plotId:1,type:'airport',dir:0}];
    assert.equal(campusSiteReserved(world,plots[1],'house'),true);
    assert.equal(isRoadProtected(m,39,31,true,plots,world.projects,world.zoneOrders),true);
    world[field]=[{plotId:2,type:'house',dir:0}];assert.equal(campusSiteReserved(world,plots[0],'airport'),true);
  }
});

test('removed airport identities are not reused after save/reload',()=>{
  const m=map(),first=addBuilding(m,'airport',{x:2,y:2});m.facilities=[];
  const copy=JSON.parse(JSON.stringify(m)),a=addBuilding(m,'airport',{x:40,y:40}),b=addBuilding(copy,'airport',{x:40,y:40});
  assert.notEqual(first.id,a.id);assert.equal(a.id,b.id);assert.deepEqual(m,copy);
});

test('rotated footprint preserves terrain outside its actual site and invalid directions are atomic',()=>{
  const m=map();m.tiles[20*80+35]=TILE.ROAD;
  addBuilding(m,'airport',{x:20,y:20},1);assert.equal(m.tiles[20*80+35],TILE.ROAD);
  const bad=map(),before=JSON.stringify(bad);
  assert.throws(()=>addBuilding(bad,'airport',{x:20,y:20},4),RangeError);assert.equal(JSON.stringify(bad),before);
});

test('grass-backed open facilities and malformed coordinates cannot be silently overwritten',()=>{
  const m=map();addBuilding(m,'park',{x:25,y:25});const before=JSON.stringify(m);
  assert.throws(()=>addBuilding(m,'airport',{x:20,y:20}),RangeError);assert.equal(JSON.stringify(m),before);
  for(const x of [NaN,Infinity,20.5,-1]){
    const n=map(),original=JSON.stringify(n);
    assert.throws(()=>addBuilding(n,'airport',{x,y:20}),RangeError);assert.equal(JSON.stringify(n),original);
  }
});
