import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,findNonFinite,migrateWorld} from '../sim/index.js';
import {TILE,addBuilding,plotBuildable,zoneFootprint,isWalkable} from '../sim/map.js';
import {DEFAULT_LOGIC,validateLogic} from '../sim/logic.js';
import {canWork} from '../sim/education.js';
import {collectCandidates} from '../sim/tick.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function fixture(dir=0){
  const w=createWorld(32),fp=zoneFootprint('train_station',dir);
  w.lastPlanDay=0;w.lastDailyDay=0;w.treasury=100000;w.transit.stationUnlocked=true;
  const plot=w.plots.find(p=>!p.used&&plotBuildable(w.map,p,fp.w,fp.h));
  assert.ok(plot);return {w,plot,order:{sequence:0,command:'zone',payload:{plotId:plot.plotId,type:'train_station',dir}}};
}
const closedMoney=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;

test('station geometry rotates doors and platforms without stamping outside its paid footprint',()=>{
  for(let dir=0;dir<4;dir++){
    const map={w:32,h:32,tiles:Array(1024).fill(TILE.GRASS),facilities:[]};
    const plot={x:10,y:10,villageId:'village:1'},fp=zoneFootprint('train_station',dir);
    const f=addBuilding(map,'train_station',plot,dir);
    assert.equal(f.type,'train_station');assert.equal(f.villageId,'village:1');assert.equal(f.dir,dir);
    assert.equal(f.w,fp.w);assert.equal(f.h,fp.h);assert.equal(f.revenue,0);
    for(const r of [f.door,...f.resources]){
      assert.ok(r.x>=f.x&&r.x<f.x+f.w&&r.y>=f.y&&r.y<f.y+f.h);
      assert.ok(isWalkable(map,r.x,r.y));
    }
    assert.deepEqual(f.resources.map(r=>r.kind),['platform','platform']);
    for(let y=0;y<map.h;y++)for(let x=0;x<map.w;x++)
      if(x<f.x||x>=f.x+f.w||y<f.y||y>=f.y+f.h)assert.equal(map.tiles[y*map.w+x],TILE.GRASS);
  }
});

test('station command charges only the plot municipality and preserves closed accounting',()=>{
  const {w,plot,order}=fixture();
  w.villages.push({id:'village:1',name:'새솔',center:{x:plot.x,y:plot.y},government:{...newGovernment(),treasury:8000}});
  plot.villageId='village:1';const root=w.treasury,money=closedMoney(w),out=w.externalOutflow;
  const events=tick(w,[order]);assert.ok(events.some(e=>e.type==='zoned'));
  assert.equal(w.treasury,root);assert.equal(w.villages[1].government.treasury,0);
  assert.equal(w.externalOutflow,out+8000);assert.equal(closedMoney(w),money);
  assert.equal(w.projects[0].required,20000);assert.equal(w.map.facilities.some(f=>f.type==='train_station'),false);
});

test('station rejects insufficient local funds, invalid direction and blocked footprint without charging',()=>{
  for(const reason of ['treasury_short','bad_dir','not_buildable']){
    const {w,plot,order}=fixture();
    if(reason==='treasury_short')w.treasury=7999;
    if(reason==='bad_dir')order.payload.dir=4;
    if(reason==='not_buildable')w.map.tiles[plot.y*w.map.w+plot.x]=TILE.WALL;
    const money=w.treasury,out=w.externalOutflow,events=tick(w,[order]);
    assert.ok(events.some(e=>e.type==='input_rejected'&&e.payload.reason===reason),reason);
    assert.equal(w.treasury,money);assert.equal(w.externalOutflow,out);assert.equal(w.projects.length,0);
  }
});

test('station work sites remain floor after every rotation and do not employ students',()=>{
  for(let dir=0;dir<4;dir++){
    const {w,plot,order}=fixture(dir);tick(w,[order]);
    const student=w.sims.at(-1);student.traits.occupation='student';student.traits.age=19;
    const worker=w.sims.find(canWork);assert.ok(worker);
    const spots=collectCandidates(w,worker,['construct'],w.worldTick,true);
    assert.ok(spots.length>0);assert.equal(collectCandidates(w,student,['construct'],w.worldTick,true).length,0);
    addBuilding(w.map,'train_station',plot,dir);
    for(const c of spots)assert.ok(isWalkable(w.map,c.x,c.y),JSON.stringify(c));
    assert.equal(collectCandidates(w,worker,['work'],w.worldTick,true).some(c=>c.facilityId.startsWith('train_station')),false);
  }
});

test('paid station completes via actual walking and labor, with mid-project save replay',()=>{
  const {w,plot,order}=fixture(1);
  // Short labor is a unit fixture only. Default 20000 is asserted above and in the autonomous benchmark.
  w.logic.construct.requiredByType.train_station=3;tick(w,[order]);
  const worker=w.sims.find(canWork),saved=deserialize(serialize(w));
  const assignment={sequence:1,command:'assign',payload:{simId:worker.id,actionType:'construct'}};
  const money=closedMoney(w);let walked=0,built=false;
  for(let i=0;i<600&&!built;i++){
    const before={x:worker.x,y:worker.y},inputs=i===0?[assignment]:[],events=tick(w,inputs);
    assert.deepEqual(events,tick(saved,inputs));
    walked+=Math.abs(worker.x-before.x)+Math.abs(worker.y-before.y);
    built=events.some(e=>e.type==='facility_built'&&e.payload.type==='train_station');
  }
  assert.ok(built);assert.ok(walked>0);assert.ok(plot.used);assert.equal(w.projects.length,0);
  assert.ok(isWalkable(w.map,worker.x,worker.y));assert.equal(closedMoney(w),money);
  assert.equal(hashWorld(w),hashWorld(saved));assert.deepEqual(findNonFinite(w),[]);
});

test('logic80 upgrade adds the station recipe without replacing tuning, money, projects or RNG',()=>{
  const {w,order}=fixture();tick(w,[order]);w.logic.logicSchemaVersion=80;
  delete w.logic.zone.costs.train_station;delete w.logic.construct.requiredByType.train_station;
  w.logic.zone.costs.house=2222;w.projects[0].required=12345;
  const rng=serialize({rngSim:w.rngSim,rngWorldgen:w.rngWorldgen}),money=closedMoney(w),before=serialize(w.map);
  migrateWorld(w);assert.equal(w.logic.logicSchemaVersion,DEFAULT_LOGIC.logicSchemaVersion);
  assert.equal(w.logic.zone.costs.train_station,8000);assert.equal(w.logic.construct.requiredByType.train_station,20000);
  assert.equal(w.logic.zone.costs.house,2222);assert.equal(w.projects[0].required,12345);
  assert.equal(serialize(w.map),before);assert.equal(closedMoney(w),money);
  assert.equal(serialize({rngSim:w.rngSim,rngWorldgen:w.rngWorldgen}),rng);assert.ok(validateLogic(w.logic).ok);
  const again=serialize(w);migrateWorld(w);assert.equal(serialize(w),again);
  delete w.logic.zone.costs.train_station;assert.equal(validateLogic(w.logic).ok,false);
});

test('unchanged seed world unlocks and completes a paid station using autonomous normal-duration labor',()=>{
  const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../bench/station-construction.js',import.meta.url)),'32'],
    {encoding:'utf8',timeout:180000}));
  assert.ok(result.unlockedDay>=0);assert.ok(result.ordered.tick>=result.unlockedDay*1440);
  assert.equal(result.ordered.cost,8000);assert.equal(result.started.required,18000);
  assert.ok(result.built.tick>result.started.tick);assert.equal(result.built.type,'train_station');
  assert.equal(result.ineligibleWork,0);assert.equal(result.noPath,0);
});
