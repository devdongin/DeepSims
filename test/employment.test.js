import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize} from '../sim/index.js';
import {employmentStatus} from '../sim/employment.js';

function fixture(){
  const w=createWorld(32),template=w.sims[0];
  w.sims=Array.from({length:6},(_,id)=>({...structuredClone(template),id,villageId:'village:0',
    traits:{...template.traits,age:30,occupation:'jobless'},education:{...template.education,course:null}}));
  w.sims[1].traits.age=18;
  w.sims[2].education.course='doctorate';w.sims[2].education.completed=false;
  w.sims[3].traits.age=65;
  w.sims[4].traits.occupation='student';
  w.sims[5].villageId='village:1';
  w.villages=[{id:'village:0'},{id:'village:1'}];
  w.map.facilities=[{id:'office',type:'office',resources:[{kind:'desk'},{kind:'desk'}]},
    {id:'restaurant',type:'restaurant',resources:[],revenue:5000},
    {id:'other',type:'office',villageId:'village:1',resources:[{kind:'desk'}]}];
  w.plots=[{plotId:1},{plotId:2,villageId:'village:1'}];
  w.projects=[{plotId:1,type:'office'}];w.zoneOrders=[{plotId:1,type:'office'},{plotId:2,type:'office'}];
  return w;
}
test('labor evidence separates eligible unemployment, vacant capacity and actual recruitment paths by municipality',()=>{
  const w=fixture(),before=serialize(w),[a,b]=employmentStatus(w);
  assert.equal(a.jobless,4);assert.equal(a.eligibleJobless,1);assert.equal(a.ineligibleJobless,3);
  assert.equal(b.eligibleJobless,1);
  const office=a.sectors.find(s=>s.type==='office'),restaurant=a.sectors.find(s=>s.type==='restaurant');
  assert.equal(office.vacantCapacity,2);assert.equal(office.recruitmentVacancies,2);
  assert.equal(office.hiringPath,true);assert.equal(office.pendingFacilities,1);
  assert.equal(b.sectors.find(s=>s.type==='office').vacantCapacity,1);
  assert.equal(restaurant.recruitmentVacancies,1);
  assert.equal(serialize(w),before);assert.deepEqual(employmentStatus(deserialize(before)),[a,b]);
});
test('unfunded service capacity, occupied jobs and founding projects are not new recruitment capacity',()=>{
  const w=fixture();w.map.facilities.find(f=>f.type==='restaurant').revenue=0;
  let sector=employmentStatus(w)[0].sectors.find(s=>s.type==='restaurant');
  assert.equal(sector.vacantCapacity,1);assert.equal(sector.recruitmentVacancies,0);
  w.sims[0].traits.occupation='chef';w.map.facilities.find(f=>f.type==='restaurant').revenue=5000;
  w.sims[0].employment={facilityId:'restaurant',occupation:'chef'};
  sector=employmentStatus(w)[0].sectors.find(s=>s.type==='restaurant');
  assert.equal(sector.workers,1);assert.equal(sector.recruitmentVacancies,0);
  w.projects[0].foundingPetitionId=1;w.zoneOrders=[];
  assert.equal(employmentStatus(w)[0].sectors.find(s=>s.type==='office').pendingFacilities,0);
});

test('legacy office slots count as work capacity just like constructed desks',()=>{
  const w=createWorld(32),offices=w.map.facilities.filter(f=>f.type==='office');
  assert.ok(offices.some(f=>f.resources.some(r=>r.kind==='slot')));
  const row=employmentStatus(w)[0].sectors.find(s=>s.type==='office');
  assert.equal(row.capacity,offices.reduce((n,f)=>n+f.resources.length,0));
});

test('incident-blocked offices remain physical capacity but are not recruitment capacity',()=>{
  const w=fixture();w.incidents=[{facilityId:'office'}];
  const office=employmentStatus(w)[0].sectors.find(s=>s.type==='office');
  assert.equal(office.capacity,2);assert.equal(office.vacantCapacity,2);
  assert.equal(office.recruitmentCapacity,0);assert.equal(office.recruitmentVacancies,0);
});
