import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize} from '../sim/index.js';
import {employerRoster} from '../sim/employer-roster.js';
import {employmentStatus,officeConstructionDemand} from '../sim/employment.js';

test('physical employers count cross-town commuters at their workplace, not their home',()=>{
  const w=createWorld(32),s=w.sims[0];w.sims=[s];
  s.traits.occupation='chef';s.traits.age=30;s.education.course=null;s.villageId='village:0';
  w.map.facilities=[{id:'local',type:'restaurant',villageId:'village:0',resources:[]},
    {id:'remote',type:'restaurant',villageId:'village:1',resources:[]}];
  s.employment={facilityId:'remote',occupation:'chef',homeId:s.homeId,assignedTick:1};
  const before=serialize(w),roster=employerRoster(w),[local,remote]=roster.facilities;
  assert.equal(local.workers,0);assert.equal(local.vacancies,w.logic.industry.workersPerFacility);
  assert.equal(remote.workers,1);assert.equal(remote.commuterWorkers,1);assert.equal(remote.localWorkers,0);
  assert.deepEqual(remote.workerIds,[s.id]);assert.equal(roster.unassigned.length,0);
  assert.equal(serialize(w),before);assert.deepEqual(employerRoster(deserialize(before)),roster);
});

test('student and stale occupation records never occupy jobs; overfull firms cannot hide sibling vacancies',()=>{
  const w=createWorld(32),base=w.sims[0];
  w.map.facilities=[{id:'a',type:'restaurant',resources:[]},{id:'b',type:'restaurant',resources:[]}];
  w.sims=Array.from({length:4},(_,id)=>({...structuredClone(base),id,
    traits:{...base.traits,age:30,occupation:'chef'},education:{...base.education,course:null},
    employment:{facilityId:'a',occupation:'chef'}}));
  w.sims[2].traits.occupation='student';w.sims[3].employment.occupation='barista';
  const result=employerRoster(w),[a,b]=result.facilities;
  assert.equal(a.workers,2);assert.equal(a.vacancies,0);
  assert.equal(a.overCapacity,Math.max(0,2-w.logic.industry.workersPerFacility));
  assert.equal(b.workers,0);assert.equal(b.vacancies,w.logic.industry.workersPerFacility);
  assert.deepEqual(result.unassigned,[{simId:3,villageId:'village:0',occupation:'chef'}]);
});

test('planning evidence does not occupy a local office seat with an outbound commuter',()=>{
  const w=createWorld(32),base=w.sims[0];
  w.villages=[{id:'village:0'},{id:'village:1'}];
  w.sims=Array.from({length:2},(_,id)=>({...structuredClone(base),id,villageId:'village:0',
    traits:{...base.traits,age:30,occupation:id===0?'office_worker':'jobless'},
    education:{...base.education,course:null},employment:id===0?{facilityId:'remote',occupation:'office_worker'}:null}));
  w.map.facilities=[{id:'local',type:'office',resources:[{kind:'desk'}]},
    {id:'remote',type:'office',villageId:'village:1',resources:[{kind:'desk'}]}];
  w.plots=[];w.projects=[];w.zoneOrders=[];
  const [a,b]=employmentStatus(w);
  assert.equal(a.sectors.find(s=>s.type==='office').workers,0,'commuter works for the remote employer');
  assert.equal(b.sectors.find(s=>s.type==='office').workers,1);
  assert.equal(officeConstructionDemand(w,'village:0').unmet,0,'the local seeker has real local capacity');
});
