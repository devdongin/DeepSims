import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serialize, deserialize, hashWorld, tick } from '../sim/index.js';
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
    const facs=[home,addBuilding(w.map,'cafe',{x,y:15},0),addBuilding(w.map,'park',{x,y:25},0)];
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
