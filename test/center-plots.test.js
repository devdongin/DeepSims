import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize,tick} from '../sim/index.js';
import {TILE,plotBuildable,addBuilding,zoneFootprint} from '../sim/map.js';
import {repairCenterPlots,campusSiteReserved} from '../sim/center-plots.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(){
  const w=createWorld(119);
  w.map={w:256,h:256,tiles:Array(256*256).fill(TILE.GRASS),facilities:[],reachVersion:0};
  for(let y=0;y<256;y++) w.map.tiles[y*256+192]=TILE.ROAD;
  w.plots=[{plotId:73,x:186,y:120,used:false}];
  w.centers=[{centerId:'center0',x:186,y:120}];
  w.projects=[];w.zoneOrders=[];w.sims=[];w.lastDailyDay=0;
  return w;
}
test('large campus reservation cannot overlap another queued building in either direction',()=>{
  const w=fixture();w.plots=[{plotId:1,x:20,y:20},{plotId:2,x:30,y:20}];
  w.zoneOrders=[{plotId:2,type:'house',dir:0}];
  assert.equal(campusSiteReserved(w,w.plots[0],'university'),true);
  w.zoneOrders=[];w.projects=[{plotId:1,type:'university'}];
  assert.equal(campusSiteReserved(w,w.plots[1],'house'),true);
});
test('live center regression: repair road-overlapped parcel without touching road, then auto construction starts',()=>{
  const w=fixture(),b=deserialize(serialize(w)),tiles=[...w.map.tiles];
  assert.equal(plotBuildable(w.map,w.plots[0]),false);
  const a=tick(w),events=tick(b);
  assert.deepEqual(a,events);
  assert.ok(a.some(e=>e.type==='plot_relocated'));
  assert.ok(a.some(e=>e.type==='project_started'&&e.payload.plotId===73));
  assert.deepEqual(w.map.tiles,tiles);
  assert.equal(w.plots[0].x,180);
  assert.equal(w.plots[0].y,120);
  assert.equal(plotBuildable(w.map,w.plots[0],12,10),true);
  const repeated=[];repairCenterPlots(w,(...e)=>repeated.push(e));assert.deepEqual(repeated,[]);
});
test('repair preserves paid/active/used parcels, foreign jurisdiction and non-road obstacles',()=>{
  for(const kind of ['paid','active','approved','used','foreign','water','neighbor']){
    const w=fixture();
    if(kind==='paid')w.zoneOrders.push({plotId:73,type:'house'});
    if(kind==='active')w.projects.push({plotId:73,type:'house'});
    if(kind==='approved')w.founding.petitions=[{status:'approved',plan:{homePlotIds:[73]}}];
    if(kind==='used')w.plots[0].used=true;
    if(kind==='foreign')w.centers[0].villageId='village:1';
    if(kind==='water')w.map.tiles[120*256+186]=TILE.WATER;
    if(kind==='neighbor')w.plots.push({plotId:74,x:179,y:120,used:false});
    const before=serialize(w);repairCenterPlots(w,()=>{});
    if(kind==='neighbor'){
      const [a,b]=w.plots;
      assert.ok(a.x>=b.x+12||a.x+12<=b.x||a.y>=b.y+10||a.y+10<=b.y);
    }else assert.equal(serialize(w),before,kind);
  }
});
test('rotated campus preserves roads outside final footprint; legacy small site still completes safely',()=>{
  const map={w:64,h:64,tiles:Array(4096).fill(0),facilities:[],reachVersion:0};
  map.tiles[20*64+31]=TILE.ROAD;
  const f=addBuilding(map,'university',{x:20,y:20},1);
  assert.equal(f.w,10);assert.equal(f.h,12);assert.equal(map.tiles[20*64+31],TILE.ROAD);
  const old={w:64,h:64,tiles:Array(4096).fill(0),facilities:[],reachVersion:0};
  old.tiles[20*64+28]=TILE.ROAD;
  const legacy=addBuilding(old,'university',{x:20,y:20},0);
  assert.equal(legacy.w,8);assert.equal(legacy.h,6);assert.equal(old.tiles[20*64+28],TILE.ROAD);
});
test('actual client relocation handler preserves plot identity and ownership',()=>{
  const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const start=source.indexOf("if (e.type === 'plot_relocated')"),end=source.indexOf("if (e.type === 'village_land_assigned')",start);
  const world={plots:[{plotId:73,x:186,y:120,villageId:'village:0'}]};
  vm.runInNewContext(source.slice(start,end),{world,e:{type:'plot_relocated',payload:{plotId:73,x:180,y:120}}});
  assert.deepEqual(world.plots,[{plotId:73,x:180,y:120,villageId:'village:0'}]);
});
test('university footprint and all rotated doors/resources fit a campus larger than high school',()=>{
  for(let dir=0;dir<4;dir++){
    const map={w:64,h:64,tiles:Array(4096).fill(0),facilities:[],reachVersion:0};
    const f=addBuilding(map,'university',{x:20,y:20},dir),fp=zoneFootprint('university',dir);
    assert.deepEqual({w:f.w,h:f.h},fp);assert.equal(f.w*f.h,120);
    assert.ok(f.w*f.h>zoneFootprint('high_school',dir).w*zoneFootprint('high_school',dir).h);
    assert.equal(f.resources.length,4,'larger building does not invent education capacity');
    for(const p of [f.door,...f.resources]){
      assert.ok(p.x>=f.x&&p.x<f.x+f.w&&p.y>=f.y&&p.y<f.y+f.h);
      assert.equal(map.tiles[p.y*map.w+p.x],TILE.FLOOR);
    }
  }
});
