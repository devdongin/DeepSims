import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serialize, deserialize, hashWorld, tick } from '../sim/index.js';
import { TILE, zoneFootprint } from '../sim/map.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { newGovernment } from '../sim/government.js';
import { allocateMunicipalLand } from '../sim/municipal-land.js';
import { foundingEvidence } from '../sim/founding.js';

function fixture() {
  const w=createWorld(32);
  w.map={w:128,h:128,tiles:Array(128*128).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.villages[0].center={x:10,y:10};
  w.villages.push({id:'village:1',name:'새솔',center:{x:80,y:80},foundedTick:0,government:newGovernment()});
  w.sims[0].villageId='village:1';
  w.plots=[{plotId:9,x:85,y:85,used:false},{plotId:2,x:90,y:85,used:false}];
  w.projects=[];w.zoneOrders=[];w.centers=[];
  return w;
}
const assign=w=>{const events=[];allocateMunicipalLand(w,1440,(type,id,payload)=>events.push({type,id,payload}));return events;};

test('#32 vacant land attribution is ordered, idempotent and does not create land, money or people',()=>{
  const w=fixture(), replay=deserialize(serialize(w));
  const untouched=serialize({map:w.map,sims:w.sims,money:w.treasury,rng:w.rngSim});
  const count=w.plots.length,events=assign(w);
  assert.deepEqual(events,assign(replay));assert.equal(hashWorld(w),hashWorld(replay));
  assert.deepEqual(events,[{type:'village_land_assigned',id:null,payload:{villageId:'village:1',plotIds:[2,9]}}]);
  assert.equal(w.plots.length,count);assert.ok(w.plots.every(p=>p.villageId==='village:1'));
  assert.equal(serialize({map:w.map,sims:w.sims,money:w.treasury,rng:w.rngSim}),untouched);
  assert.equal(foundingEvidence(w,'village:1').localBuildablePlots,2);
  const before=hashWorld(w);assert.deepEqual(assign(w),[]);assert.equal(hashWorld(w),before);
});

test('#32 explicit ownership, used/ordered/approved/funded land and previous centers cannot be taken',()=>{
  for(const condition of ['owned','used','project','order','approved','funded','center']){
    const w=fixture();w.plots=[w.plots[0]];const p=w.plots[0];
    if(condition==='owned')p.villageId='village:0';
    if(condition==='used')p.used=true;
    if(condition==='project')w.projects=[{plotId:p.plotId}];
    if(condition==='order')w.zoneOrders=[{plotId:p.plotId}];
    if(condition==='approved')w.founding.petitions=[{status:'approved',plan:{homePlotIds:[p.plotId],homes:[{plotId:p.plotId,type:'house'}]}}];
    if(condition==='funded'){p.foundingPetitionId=1;p.foundingType='house';}
    if(condition==='center')w.centers=[{centerId:'center0',x:p.x,y:p.y,createdTick:0}];
    const before=hashWorld(w);assert.deepEqual(assign(w),[],condition);assert.equal(hashWorld(w),before,condition);
  }
});

test('#32 no claims outside radius, near the original center, without residents or across disconnected terrain',()=>{
  for(const condition of ['far','primary','empty','blocked']){
    const w=fixture();w.plots=[w.plots[0]];
    if(condition==='far')w.plots[0].x=120;
    if(condition==='primary')w.villages[0].center={x:70,y:80};
    if(condition==='empty')w.sims[0].villageId='village:0';
    if(condition==='blocked'){
      for(let y=0;y<128;y++)w.map.tiles[y*128+83]=TILE.MOUNTAIN;
      w.map.reachVersion++;
    }
    const before=hashWorld(w);assert.deepEqual(assign(w),[],condition);assert.equal(hashWorld(w),before,condition);
  }
});

test('#32 closest founded municipality wins stable ties, regardless of list order',()=>{
  const w=fixture();w.plots=[{plotId:1,x:90,y:80,used:false}];
  w.villages.push({id:'village:2',name:'다른마을',center:{x:100,y:80},foundedTick:0,government:newGovernment()});
  w.sims[1].villageId='village:2';
  const b=deserialize(serialize(w));b.villages.reverse();
  assert.deepEqual(assign(w),assign(b));assert.equal(w.plots[0].villageId,'village:1');
  const c=fixture();c.centers=[{centerId:'own',x:85,y:85,villageId:'village:1'}];
  assert.equal(assign(c).length,1,'own center does not block its own territory');
});

test('#32 daily integration attributes land before planning and resumes identically',()=>{
  const w=fixture();w.worldTick=1439;w.lastDailyDay=0;w.lastPlanDay=1;
  const b=deserialize(serialize(w)),events=tick(w);
  assert.deepEqual(events,tick(b));assert.equal(hashWorld(w),hashWorld(b));
  assert.ok(events.some(e=>e.type==='village_land_assigned'));
  assert.ok(w.plots.every(p=>p.villageId==='village:1'));
});

test('#32 adjacent proposed plots cannot take approved or funded founding entrances',()=>{
  for(const funded of [false,true]){
    const w=fixture(),reserved={plotId:1,x:85,y:85,used:false};
    const p={plotId:2,x:85,y:85+zoneFootprint('house',0).h,used:false};
    w.plots=[reserved,p];
    if(funded){reserved.foundingPetitionId=0;reserved.foundingType='house';}
    else w.founding.petitions=[{status:'approved',plan:{homePlotIds:[1],homes:[{plotId:1,type:'house'}]}}];
    assert.deepEqual(assign(w),[]);assert.equal(p.villageId,undefined);
  }
});

test('#32 actual client land-event handler updates existing plot ownership without creating plots',()=>{
  const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const start=source.indexOf("if (e.type === 'village_land_assigned')");
  const end=source.indexOf("if(e.type==='village_founded')",start);
  assert.ok(start>=0&&end>start);
  const world={plots:[{plotId:1},{plotId:2,villageId:'village:0'}]},e={type:'village_land_assigned',payload:{villageId:'village:1',plotIds:[1,999]}};
  vm.runInNewContext(source.slice(start,end),{world,e});
  assert.deepEqual(world.plots,[{plotId:1,villageId:'village:1'},{plotId:2,villageId:'village:0'}]);
});
