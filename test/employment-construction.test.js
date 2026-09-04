import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld} from '../sim/index.js';
import {officeConstructionDemand,PLANNED_OFFICE_SEATS} from '../sim/employment.js';
import {TILE,addBuilding} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';

function fixture(municipal=false){
  const w=createWorld(32),id=municipal?'village:1':'village:0';
  w.map={w:96,h:64,tiles:Array(96*64).fill(TILE.GRASS),facilities:[],reachVersion:0};
  w.sims=w.sims.slice(0,2);w.projects=[];w.zoneOrders=[];w.unlockedIndustries=[];w.centers=[];
  if(municipal)w.villages.push({id,name:'고용도시',center:{x:10,y:10},government:newGovernment()});
  const home=addBuilding(w.map,'house',{x:5,y:5,villageId:id});
  addBuilding(w.map,'cafe',{x:15,y:5,villageId:id});
  addBuilding(w.map,'park',{x:25,y:5,villageId:id});addBuilding(w.map,'park',{x:35,y:5,villageId:id});
  for(const s of w.sims){s.villageId=id;s.homeId=home.id;s.traits.age=30;s.traits.occupation='jobless';s.education.course=null;s.x=home.door.x;s.y=home.door.y;}
  w.plots=Array.from({length:3},(_,i)=>({plotId:500+i,x:8+i*12,y:30,used:false,villageId:id}));
  w.logic.growth.headroomBeds=0;w.lastDailyDay=0;w.lastPlanDay=-1;
  const g=municipal?w.villages[1].government:w;g.treasury=10000;
  return {w,id,g};
}
const closed=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+(w.externalOutflow??0)-(w.externalInflow??0);

test('eligible jobseekers create one paid office project with real default labor in both planners',()=>{
  for(const municipal of [false,true]){
    const {w,id,g}=fixture(municipal),saved=deserialize(serialize(w)),before=closed(w),treasury=g.treasury;
    const events=tick(w);assert.deepEqual(events,tick(saved));assert.equal(hashWorld(w),hashWorld(saved));
    const offices=w.projects.filter(p=>p.type==='office');assert.equal(offices.length,1);
    assert.equal(offices[0].required,w.logic.construct.requiredByType.office);
    assert.equal(offices[0].progress,0);assert.equal(w.map.facilities.some(f=>f.type==='office'),false);
    assert.equal(treasury-g.treasury,w.logic.zone.costs.office);assert.equal(closed(w),before);
    assert.ok(events.some(e=>e.type==='employment_construction_planned'&&e.payload.jobseekers===2));
    assert.equal(officeConstructionDemand(w,id).unmet,0,'pending capacity prevents duplicate projects');
    assert.equal(officeConstructionDemand(w,id).pendingCapacity,PLANNED_OFFICE_SEATS);
  }
});

test('no local funds means no office project or borrowed neighbor money',()=>{
  for(const municipal of [false,true]){
    const {w,g}=fixture(municipal);g.treasury=w.logic.zone.costs.office-1;
    if(municipal)w.treasury=1000000;
    const before=closed(w),root=w.treasury;tick(w);
    assert.equal(w.projects.some(p=>p.type==='office'),false);assert.equal(closed(w),before);
    if(municipal)assert.equal(w.treasury,root);
  }
});

test('demand deducts real and queued capacity, excludes ineligible residents and counts each service applicant once',()=>{
  const {w,id}=fixture();assert.equal(officeConstructionDemand(w,id).unmet,2);
  w.sims[0].traits.age=18;w.sims[1].education.course='doctorate';w.sims[1].education.completed=false;
  assert.equal(officeConstructionDemand(w,id).unmet,0);
  w.sims[0].traits.age=30;w.sims[1].education.course=null;
  const office=addBuilding(w.map,'office',{x:50,y:5,villageId:id});
  assert.equal(office.resources.length,PLANNED_OFFICE_SEATS);assert.equal(officeConstructionDemand(w,id).unmet,0);
  w.map.facilities=w.map.facilities.filter(f=>f!==office);
  w.projects=[{type:'office',plotId:500}];w.zoneOrders=[{type:'office',plotId:500}];
  assert.equal(officeConstructionDemand(w,id).pendingCapacity,4);
  w.projects=[];w.zoneOrders=[];
  for(const type of ['restaurant','market']){
    const f=structuredClone(createWorld(32).map.facilities.find(f=>f.type===type));
    f.villageId=id;f.revenue=5000;w.map.facilities.push(f);
  }
  w.logic.society.retireAge=70;w.sims[1].traits.age=66; // office eligible, service occupations stop at65
  const evidence=officeConstructionDemand(w,id);
  assert.equal(evidence.servicePlacements,1);assert.equal(evidence.unmet,1);
  const before=serialize(w);officeConstructionDemand(w,id);assert.equal(serialize(w),before);
});

test('paid office demand reaches default-labor completion, real hiring and wages across saved construction',()=>{
  const {w}=fixture();const before=closed(w),hiredIds=new Set();let saved=null,planned=null,complete=false,hired=false,paid=false;
  for(let i=0;i<60*1440&&!paid;i++){
    const events=tick(w);
    if(saved){assert.deepEqual(events,tick(saved));if(i%1440===0)assert.equal(hashWorld(w),hashWorld(saved));}
    assert.equal(closed(w),before);
    for(const e of events){
      if(e.type==='employment_construction_planned'&&!planned)planned=e;
      if(e.type==='job_changed'&&e.payload.reason==='existing_office_capacity'){hired=true;hiredIds.add(e.simId);}
      if(hiredIds.has(e.simId)&&e.type==='money_changed'&&e.payload.action==='work'&&e.payload.delta>0
        &&events.some(done=>done.type==='action_completed'&&done.simId===e.simId&&done.payload.action==='work'
          &&w.map.facilities.some(f=>f.id===done.payload.facilityId&&f.type==='office')))paid=true;
    }
    const project=w.projects.find(p=>p.type==='office');
    if(!saved&&project?.progress>0){
      assert.equal(project.required,8000);saved=deserialize(serialize(w));
    }
    complete ||= w.map.facilities.some(f=>f.type==='office');
    if(!complete)assert.equal(hired,false,'no office hiring before completed capacity');
  }
  assert.ok(planned);assert.ok(saved,'real construction progressed before save');
  assert.ok(complete);assert.ok(hired);assert.ok(paid);
  assert.equal(hashWorld(w),hashWorld(saved));
});

test('a globally occupied service job cannot hide local demand, and one global vacancy cannot cover two towns',()=>{
  const {w}=fixture();
  w.villages.push({id:'village:1',government:newGovernment()},{id:'village:2',government:newGovernment()});
  w.sims[1].villageId='village:1';
  const staff=structuredClone(w.sims[0]);staff.id=99;staff.villageId='village:2';staff.traits.occupation='chef';w.sims.push(staff);
  const restaurant=structuredClone(createWorld(32).map.facilities.find(f=>f.type==='restaurant'));
  restaurant.villageId='village:0';restaurant.revenue=5000;w.map.facilities.push(restaurant);
  assert.equal(officeConstructionDemand(w,'village:0').servicePlacements,0);
  assert.equal(officeConstructionDemand(w,'village:0').unmet,1);
  const second=structuredClone(restaurant);second.id='second';second.villageId='village:1';w.map.facilities.push(second);
  const rows=['village:0','village:1'].map(id=>officeConstructionDemand(w,id));
  assert.equal(rows.reduce((n,r)=>n+r.servicePlacements,0),1);
  assert.equal(rows.reduce((n,r)=>n+r.unmet,0),1);
});
