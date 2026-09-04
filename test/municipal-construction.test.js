import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serialize, deserialize, hashWorld, tick, migrateWorld } from '../sim/index.js';
import { TILE, addBuilding } from '../sim/map.js';
import { newGovernment, publicBalance } from '../sim/government.js';
import { municipalProjectLimit, projectMunicipality, municipalConstructionView, planMunicipalConstruction } from '../sim/municipal-construction.js';

function fixture(){
  const w=createWorld(32);
  w.map={w:128,h:128,tiles:Array(128*128).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.villages[0].center={x:10,y:10};
  w.villages.push({id:'village:1',name:'새솔',center:{x:80,y:80},foundedTick:0,government:{...newGovernment(),treasury:1000000}});
  w.treasury=1000000;w.logic.growth.headroomBeds=0;w.unlockedIndustries=[];
  w.sims=w.sims.slice(0,4);
  for(const [i,v] of w.villages.entries()){
    const x=i?80:5;
    const home=addBuilding(w.map,'house',{x,y:5},0);
    // Keep this housing/school fixture's labor demand satisfied. Employment
    // shortage construction is covered independently in employment-construction.
    const facs=[home,addBuilding(w.map,'cafe',{x,y:15},0),addBuilding(w.map,'park',{x,y:25},0),
      addBuilding(w.map,'office',{x,y:35},0)];
    for(const f of facs)f.villageId=v.id;
    for(const s of w.sims.slice(i*2,i*2+2)){
      s.villageId=v.id;s.homeId=home.id;s.traits.age=25;s.traits.occupation='jobless';s.education.course=null;
      s.x=home.door.x;s.y=home.door.y;
    }
  }
  w.plots=Array.from({length:10},(_,i)=>({plotId:i+1,x:(i<5?5:75)+(i%5)*9,y:45,used:false,villageId:i<5?'village:0':'village:1'}));
  w.projects=[];w.zoneOrders=[];w.centers=[];w.lastDailyDay=0;w.lastPlanDay=0;
  return w;
}
function plan(w){
  const limits=new Map(w.villages.map(v=>[v.id,municipalProjectLimit(w,v.id)])),events=[];
  planMunicipalConstruction(w,1,limits,(type,id,payload)=>events.push({type,id,payload}));return events;
}

test('#32 local housing deficit and committed capacity do not borrow beds or overbuild across municipalities',()=>{
  const w=fixture(),localHome=w.map.facilities.find(f=>f.type==='house'&&f.villageId==='village:1');
  localHome.resources.length=1;
  const rootHome=w.map.facilities.find(f=>f.type==='house'&&f.villageId==='village:0');
  rootHome.resources.push(...Array.from({length:20},()=>({})));
  const saved=deserialize(serialize(w)),events=plan(w);
  assert.deepEqual(events,plan(saved));assert.equal(hashWorld(w),hashWorld(saved));
  assert.equal(w.projects.length,1);assert.equal(w.projects[0].type,'house');
  assert.equal(projectMunicipality(w,w.projects[0]),'village:1');
  assert.equal(events[0].payload.villageId,'village:1');
  assert.equal(localHome.resources.length,1,'planned beds are not usable before construction');
  assert.equal(plan(w).length,0,'pending capacity covers the deficit');
});

test('single-town and municipal planners build a small house when the only available parcel cannot fit an apartment',()=>{
  for(const municipal of [false,true])for(const blocked of [false,true]){
    const w=fixture(),id=municipal?'village:1':'village:0';
    if(!municipal){w.villages=w.villages.slice(0,1);w.sims=w.sims.slice(0,2);w.map.facilities=w.map.facilities.filter(f=>f.villageId===id);}
    const home=w.map.facilities.find(f=>f.type==='house'&&f.villageId===id);home.resources.length=1;
    (municipal?w.villages[1].government:w).cityTier=1;
    w.plots=[{plotId:1000,x:40,y:80,used:false,villageId:id}];
    for(let y=80;y<86;y++)w.map.tiles[y*w.map.w+46]=TILE.ROAD;
    if(blocked)w.map.railTracks={[82*w.map.w+44]:true};
    w.lastPlanDay=-1;
    const before=w.map.tiles.slice(),money=publicBalance(w)+w.externalOutflow,saved=deserialize(serialize(w));
    const events=tick(w);assert.deepEqual(events,tick(saved));assert.equal(hashWorld(w),hashWorld(saved));
    const projects=w.projects.filter(p=>p.plotId===1000);
    assert.equal(projects.length,blocked?0:1,`${municipal?'municipal':'single'} blocked=${blocked}`);
    if(!blocked)assert.equal(projects[0].type,'house');
    assert.deepEqual(w.map.tiles,before,'planning must not erase bordering roads or a railway');
    assert.equal(publicBalance(w)+w.externalOutflow,money);
  }
});

test('integration migration fills romance rules but preserves saved calendar tuning, projects, funds and RNG',()=>{
  assert.equal(createWorld(32).logic.society.yearDays,40);
  for(const yearDays of [40,120,60]){
    const w=fixture();w.logic.logicSchemaVersion=84;w.logic.society.yearDays=yearDays;
    delete w.logic.romance.minRomanceAge;delete w.logic.romance.ageGapBase;
    w.projects=[{plotId:1,type:'house',progress:10,required:25000}];
    const before=serialize({map:w.map,projects:w.projects,money:publicBalance(w),rngSim:w.rngSim});
    migrateWorld(w);
    assert.equal(w.logic.society.yearDays,yearDays);assert.equal(w.logic.romance.minRomanceAge,19);
    assert.equal(w.logic.romance.ageGapBase,7);
    assert.equal(serialize({map:w.map,projects:w.projects,money:publicBalance(w),rngSim:w.rngSim}),before);
    const saved=serialize(w);migrateWorld(w);assert.equal(serialize(w),saved);
    const replay=deserialize(saved);assert.deepEqual(tick(w),tick(replay));assert.equal(hashWorld(w),hashWorld(replay));
  }
});

test('#32 reserving an occupied spouse home does not erase the beds already serving its residents',()=>{
  const w=fixture(),home=w.map.facilities.find(f=>f.type==='house'&&f.villageId==='village:1');
  home.migrationIntentId=99;
  assert.deepEqual(plan(w),[],'an incoming-family reservation does not make current residents homeless');
  home.resources.length=1;
  assert.equal(plan(w).filter(e=>e.type==='project_started').length,1,'real occupied-bed shortages still trigger construction');
});

test('#32 school demand, current students and school funding belong to the resident municipality',()=>{
  const w=fixture(),g=w.villages[1].government;
  w.sims[2].traits.age=12;w.sims[2].traits.occupation='student';
  const school=addBuilding(w.map,'primary_school',{x:5,y:60},0);school.villageId='village:0';
  g.treasury=0;assert.deepEqual(plan(w),[],'cannot borrow wealthy neighbor funds');
  g.treasury=w.logic.zone.costs.primary_school;
  const money=publicBalance(w)+w.externalOutflow,root=w.treasury;
  plan(w);
  assert.equal(w.projects.length,1);assert.equal(w.projects[0].type,'primary_school');
  assert.equal(projectMunicipality(w,w.projects[0]),'village:1');
  assert.equal(g.treasury,0);assert.equal(w.treasury,root);assert.equal(publicBalance(w)+w.externalOutflow,money);
});

test('#32 globally known industry needs local evidence, and planning views do not mutate observations',()=>{
  const w=fixture();w.unlockedIndustries=['workshop','lab','warehouse'];
  for(const k of w.unlockedIndustries)w.logic.industryDevelopment[k]=100;
  w.transit.demand=100000;
  const before=serialize(w);const view=municipalConstructionView(w,'village:1');
  assert.equal(serialize(w),before);assert.deepEqual(view.unlockedIndustries,[]);
  assert.deepEqual(plan(w),[]);
  w.sims[2].development.studyTicks=100;
  plan(w);
  assert.equal(w.projects.length,1);assert.equal(w.projects[0].type,'lab');
  assert.equal(projectMunicipality(w,w.projects[0]),'village:1');
});

test('#32 unfinished students cannot generate office-job demand even with a stale employed occupation',()=>{
  const w=fixture();
  for(const s of w.sims){s.traits.occupation='office_worker';s.education.course='doctorate';s.education.completed=false;}
  assert.deepEqual(plan(w),[]);
});

test('#32 a full neighboring queue cannot block local paid orders, preserving local FIFO and save replay',()=>{
  const w=fixture();
  w.logic.growth.maxProjectSlots=3; // Explicit full-queue boundary, independent of the production default.
  w.projects=w.plots.slice(0,3).map(p=>({plotId:p.plotId,type:'house',progress:0,required:99999}));
  w.zoneOrders=[{plotId:4,type:'house',dir:0},{plotId:6,type:'house',dir:0},{plotId:7,type:'cafe',dir:0}];
  const saved=deserialize(serialize(w)),events=tick(w);
  assert.deepEqual(events,tick(saved));assert.equal(hashWorld(w),hashWorld(saved));
  assert.deepEqual(w.zoneOrders.map(p=>p.plotId),[4]);
  assert.deepEqual(events.filter(e=>e.type==='project_started').map(e=>e.payload.plotId),[6,7]);
  assert.equal(w.projects.filter(p=>projectMunicipality(w,p)==='village:0').length,3);
  assert.equal(w.projects.filter(p=>projectMunicipality(w,p)==='village:1').length,2);
  w.founding.petitions.push({id:99,villageId:'village:1'});
  assert.equal(projectMunicipality(w,{plotId:4,foundingPetitionId:99}),'village:1','founding is its source government obligation');
});
