import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { newEducation, schoolFor, considerUniversity, recordStudy, updateEducation, canWork, universityChance } from '../sim/education.js';
import { riskHash } from '../sim/chrono.js';
import { actionBlockReason, facilityShortfallKind } from '../sim/tick.js';
import { addBuilding, plotBuildable, TILE, ZONE_DIMS, zoneFootprint, isWalkable, sameRegion } from '../sim/map.js';

function fixture() {
  const w=createWorld(96), s=w.sims[0];
  s.education=newEducation();s.traits.age=19;
  w.logic.education={annualTuition:2000};
  addBuilding(w.map,'university',w.plots.find(p=>plotBuildable(w.map,p,8,6)));
  s.money=500; w.parents[s.id]=[1];
  w.sims[1].homeId=s.homeId;w.sims[1].money=5000;
  s.abilities.intellect=99;s.traits.mbti.SN=0;s.traits.mbti.JP=100;
  return w;
}

test('#96 every constructed facility has reachable interior resources in all four orientations', () => {
  for(const type of Object.keys(ZONE_DIMS))for(const dir of [0,1,2,3]) {
    const w=createWorld(96),size=zoneFootprint(type,dir);
    const plot=w.plots.find(p=>plotBuildable(w.map,p,size.w,size.h));
    const fac=addBuilding(w.map,type,plot,dir);
    for(const r of fac.resources) {
      assert.ok(isWalkable(w.map,r.x,r.y),`${type}/d${dir}/${r.id}: walkable`);
      assert.ok(sameRegion(w.map,fac.door.x,fac.door.y,r.x,r.y),`${type}/d${dir}/${r.id}: reachable`);
    }
    assert.equal(new Set(fac.resources.map(r=>`${r.x},${r.y}`)).size,fac.resources.length);
  }
});

test('#96 migration repairs only invalid legacy campus resources and releases stale targets', () => {
  const {w}=fixture(),s=w.sims[0];w.schemaVersion=54;
  const f=w.map.facilities.find(f=>f.type==='university'),r=f.resources[3];
  r.x=f.x+f.w-1;r.y=f.y+2;
  const valid=JSON.stringify(f.resources.slice(0,3)),rng=JSON.stringify(w.rngSim);
  s.state={...s.state,kind:'walking',action:'work',facilityId:f.id,resourceId:r.id};
  const key=`${f.id}:${r.id}`;w.reservations[key]=s.id;s.noPathCool[key]=1000;
  migrateWorld(w);
  assert.equal(r.id,'slot3');assert.ok(isWalkable(w.map,r.x,r.y));
  assert.ok(sameRegion(w.map,f.door.x,f.door.y,r.x,r.y));
  assert.equal(JSON.stringify(f.resources.slice(0,3)),valid);
  assert.equal(w.reservations[key],undefined);assert.equal(s.noPathCool[key],undefined);
  assert.equal(s.state.kind,'idle');assert.equal(JSON.stringify(w.rngSim),rng);
  assert.equal(hashWorld(w),hashWorld(migrateWorld(deserialize(serialize(w)))));
});

test('#96 school stages have exact primary/middle/high boundaries and university is opt-in', () => {
  const s={traits:{age:0},education:newEducation()};
  for(const [age,school] of [[0,null],[6,null],[7,'primary_school'],[12,'primary_school'],[13,'middle_school'],
    [15,'middle_school'],[16,'high_school'],[18,'high_school'],[19,null],[22,null],[23,null]]) {
    s.traits.age=age;assert.equal(schoolFor(s),school);
  }
  s.traits.age=19;s.education.universityEnrolled=true;assert.equal(schoolFor(s),'university');
  assert.equal(recordStudy(s,'high_school'),false);
  assert.equal(recordStudy(s,'university'),true);
  s.traits.age=23;assert.equal(schoolFor(s),'university','age does not evict an enrolled student');
});

test('#96 university tuition is an atomic family-to-treasury transfer and is not charged twice', () => {
  const w=fixture(),s=w.sims[0], events=[];
  const sum=()=>w.treasury+w.sims.reduce((n,x)=>n+x.money,0);
  const before=sum();
  // A returning student chooses continuation; fresh preference choice tested separately.
  s.education.universityEnrolled=true;
  considerUniversity(w,s,0,(type,id,payload)=>events.push(payload));
  assert.equal(s.education.tuitionPaid,2000);
  assert.equal(s.money,0);assert.equal(w.sims[1].money,3500);
  assert.equal(sum(),before);assert.equal(events.length,1);
  const hash=hashWorld(w);considerUniversity(w,s,1,()=>{});assert.equal(hashWorld(w),hash);
  assert.equal(hashWorld(deserialize(serialize(w))),hash);
});

test('#96 admission responds to funds and campus availability without inventing funds or attendance', () => {
  for(const kind of ['funds','campus','unreachable']) {
    const w=fixture(),s=w.sims[0],events=[];
    if(kind==='funds')w.sims[1].money=0;
    else if(kind==='campus') w.map.facilities=w.map.facilities.filter(f=>f.type!=='university');
    else {
      const campus=w.map.facilities.find(f=>f.type==='university');
      w.map.tiles[campus.door.y*w.map.w+campus.door.x]=TILE.WALL;
      w.map.reachVersion++;
    }
    const money=w.sims.map(s=>s.money),treasury=w.treasury;
    considerUniversity(w,s,0,(type,id,payload)=>events.push(payload));
    assert.equal(events[0].choice,'deferred');assert.equal(s.education.universityEnrolled,false);
    assert.deepEqual(w.sims.map(s=>s.money),money);assert.equal(w.treasury,treasury);
    assert.equal(s.education.studied.university,0);
  }
});

test('#96 fresh university choice includes both paths, is stable, and consumes no world RNG', () => {
  const seen=new Set();
  for(let seed=1;seed<100;seed++) {
    const w=fixture();w.seed=seed;
    const before=JSON.stringify(w.rngSim),events=[];
    considerUniversity(w,w.sims[0],0,(type,id,payload)=>events.push(payload));
    seen.add(events[0].choice);
    assert.equal(JSON.stringify(w.rngSim),before);
    const b=fixture();b.seed=seed;considerUniversity(b,b.sims[0],0,()=>{});
    assert.equal(hashWorld(w),hashWorld(b));
  }
  assert.ok(seen.has('university'));assert.ok(seen.has('employment'));
});

test('#96 actual school attendance advances study, not wages; weekends and wrong campuses are excluded', () => {
  const w=createWorld(96),s=w.sims[0];
  w.worldTick=540;w.lastDailyDay=0;w.lastPlanDay=0;
  for(const sim of w.sims) sim.state={...sim.state,kind:'performing',action:'idle',ticksLeft:10000};
  s.traits.age=7;s.traits.occupation='student';s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  const school=w.map.facilities.find(f=>f.type==='primary_school');
  s.x=school.resources[0].x;s.y=school.resources[0].y;
  const money=s.money, events=[];
  assert.equal(actionBlockReason(w,s,'work',541),'not_needed');
  assert.equal(actionBlockReason(w,s,'study',5*1440+541),'off_hours');
  s.traits.age=13;assert.equal(facilityShortfallKind(w,s,'study',541),'no_facility');
  s.traits.age=7;
  events.push(...tick(w,[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'study'}}]));
  for(let t=0;t<70;t++) events.push(...tick(w));
  assert.ok(s.education.studied.primary_school>=60);
  assert.ok(events.some(e=>e.type==='action_completed' && e.simId===s.id && e.payload.action==='study'));
  assert.equal(s.money,money);
  assert.equal(events.some(e=>e.type==='money_changed' && e.simId===s.id),false);
  assert.equal(hashWorld(w),hashWorld(migrateWorld(deserialize(serialize(w)))));
});

test('#96 actual school shortage funds a distinct construction project, then produces school resources', () => {
  const w=createWorld(96);
  for(const s of w.sims){s.traits.age=30;s.traits.occupation='office_worker';}
  w.sims[0].traits.age=13;w.sims[0].traits.occupation='student';
  w.treasury=100000;
  const events=tick(w);
  const plan=events.find(e=>e.type==='school_planned');assert.ok(plan);
  assert.equal(plan.payload.type,'middle_school');
  assert.equal(plan.payload.cost,w.logic.zone.costs.middle_school);
  const project=w.projects.find(p=>p.type==='middle_school');assert.ok(project);
  assert.equal(project.progress,0);assert.ok(project.required>0);
  project.progress=project.required;
  const done=tick(w);assert.ok(done.some(e=>e.type==='facility_built' && e.payload.type==='middle_school'));
  const school=w.map.facilities.find(f=>f.type==='middle_school');assert.equal(school.resources.length,4);
});

test('#96 a legacy student shift is canceled before salary or career credit, even mid-day', () => {
  const w=createWorld(96),s=w.sims[0];
  w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
  s.traits.age=12;s.traits.occupation='student';
  s.education.studyDay=0;s.education.dailyTicks=w.logic.education.dailyStudyTicks;
  const school=w.map.facilities.find(f=>f.type==='primary_school'),res=school.resources[0];
  s.x=res.x;s.y=res.y;
  s.state={...s.state,kind:'performing',action:'work',facilityId:school.id,resourceId:res.id,ticksLeft:1};
  w.reservations[`${school.id}:${res.id}`]=s.id;
  const money=s.money,career=JSON.stringify(s.development.careerTicks);
  const events=tick(w);
  assert.equal(s.money,money);
  assert.equal(JSON.stringify(s.development.careerTicks),career);
  assert.equal(events.some(e=>e.simId===s.id&&e.type==='money_changed'&&e.payload.action==='work'),false);
  assert.equal(w.reservations[`${school.id}:${res.id}`],undefined);
});

test('#96 daily lifecycle enrolls children, promotes stages, and awards degrees only for attendance', () => {
  const w=createWorld(96),s=w.sims[0],events=[];
  s.traits.age=7;s.traits.occupation='child';
  const emit=(type,id,payload)=>events.push({type,id,payload});
  updateEducation(w,0,emit);assert.equal(s.traits.occupation,'student');assert.equal(s.education.lastStage,'primary_school');
  s.traits.age=13;updateEducation(w,1440,emit);assert.equal(s.education.lastStage,'middle_school');
  s.traits.age=16;updateEducation(w,2880,emit);assert.equal(s.education.lastStage,'high_school');
  s.traits.age=23;updateEducation(w,4320,emit);
  assert.notEqual(s.traits.occupation,'student');assert.equal(s.education.universityGraduated,false);
  assert.ok(events.some(e=>e.type==='graduated'&&e.id===s.id&&e.payload.uni===false));
});

test('#96 migration preserves the old school site/resources and does not invent past education', () => {
  const w=createWorld(96);w.schemaVersion=54;
  w.logic.logicSchemaVersion=49;
  w.logic.workplace.teacher='school';w.logic.workplace.student=['school','university'];
  w.logic.economy.publicFacilityTypes=['hospital','city_hall','school','police_station','fire_station'];
  w.logic.occupations.student.wagePct=25;
  w.sims[0].traits.age=25;w.sims[0].traits.occupation='student';
  const school=w.map.facilities.find(f=>f.id==='school');school.type='school';
  const resources=JSON.stringify(school.resources),x=school.x;
  for(const s of w.sims)delete s.education;
  migrateWorld(w);
  const migrated=w.map.facilities.find(f=>f.id==='school');
  assert.equal(migrated.type,'primary_school');assert.equal(migrated.x,x);
  assert.equal(JSON.stringify(migrated.resources),resources);
  assert.ok(w.sims.every(s=>s.education.studied.university===0 && !s.education.universityGraduated));
  assert.deepEqual(w.logic.workplace.teacher,['primary_school','middle_school','high_school']);
  assert.equal(w.logic.occupations.student.wagePct,0);
  assert.ok(w.logic.economy.publicFacilityTypes.includes('university'));
  assert.equal(w.sims[0].education.course,'university');assert.equal(canWork(w.sims[0]),false);
  assert.equal(hashWorld(w),hashWorld(migrateWorld(deserialize(serialize(w)))));
});

test('#96 non-college employment starts at 19, never during high school', () => {
  const w=createWorld(96),s=w.sims[0];
  s.traits.age=18;s.traits.occupation='student';s.education=newEducation();
  assert.equal(canWork(s),false);
  s.traits.age=19;s.education.completed=true; // explicit decision not to enter college
  updateEducation(w,0,()=>{});
  assert.notEqual(s.traits.occupation,'student');assert.equal(canWork(s),true);
});

test('#96 students cannot bypass the labor gate through construction or public duties', () => {
  for (const age of [7, 18, 30]) for (const action of ['work', 'construct', 'build', 'respond_fire', 'patrol']) {
    const w=createWorld(96),s=w.sims[0];
    w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
    s.traits.age=age;s.traits.occupation='student';
    if(age>=19){s.education.course='masters';s.education.courseStartAge=age;}
    assert.equal(actionBlockReason(w,s,action,601),'not_needed');
    s.state={...s.state,kind:'performing',action,ticksLeft:1,facilityId:'legacy',resourceId:'slot0'};
    w.reservations['legacy:slot0']=s.id;
    const money=s.money;
    const events=tick(w);
    assert.equal(s.money,money,`${age}/${action}: no settlement`);
    assert.equal(w.reservations['legacy:slot0'],undefined);
    assert.equal(events.some(e=>e.simId===s.id && e.type==='action_completed' && e.payload.action===action),false);
  }
});

test('#96 age alone never graduates a university student or authorizes work during deferred tuition', () => {
  const w=createWorld(96),s=w.sims[0];
  s.traits.age=30;s.traits.occupation='student';s.education=newEducation();
  s.education.course='university';s.education.courseStartAge=19;
  s.education.universityEnrolled=true;s.education.decisionYear=0;
  updateEducation(w,0,()=>{});
  assert.equal(s.traits.occupation,'student');assert.equal(schoolFor(s),'university');
  assert.equal(s.education.universityGraduated,false);assert.equal(canWork(s),false);
  updateEducation(w,w.logic.society.yearDays*1440,()=>{}); // no university: enrollment deferred
  assert.equal(s.education.universityEnrolled,false);assert.equal(s.traits.occupation,'student');
  assert.equal(canWork(s),false);
  s.traits.occupation='office_worker'; // a stale/externally assigned occupation cannot bypass the gate
  assert.equal(canWork(s),false);assert.equal(actionBlockReason(w,s,'work',600),'not_needed');
});

test('#96 bachelor → masters → doctorate keeps students out of employment until final graduation', () => {
  const w=createWorld(96),s=w.sims[0],events=[];
  s.education=newEducation();s.traits.occupation='student';s.traits.age=23;
  s.education.course='university';s.education.courseStartAge=19;
  s.education.universityEnrolled=true;s.education.decisionYear=0;
  s.education.studied.university=w.logic.education.degreeStudyTicks;
  const pct=Math.floor(universityChance(s)*w.logic.education.postgraduatePctFactor/100)*1000;
  for(let seed=1;seed<10000;seed++) {
    if(riskHash(s.id,0,seed^0x4d415354)<pct && riskHash(s.id,0,seed^0x504844)<pct){w.seed=seed;break;}
  }
  const emit=(type,id,payload)=>events.push({type,id,payload});
  updateEducation(w,0,emit);
  assert.equal(s.education.course,'masters');assert.equal(s.education.highestDegree,'bachelor');
  assert.equal(canWork(s),false);assert.equal(s.traits.occupation,'student');
  const undergraduate=s.education.studied.university;
  recordStudy(s,'university');
  assert.equal(s.education.studied.masters,1);assert.equal(s.education.studied.university,undergraduate);
  s.traits.age=25;updateEducation(w,1,emit);
  assert.equal(s.education.course,'masters','age without attendance does not complete masters');
  s.education.studied.masters=w.logic.education.mastersStudyTicks;
  updateEducation(w,2,emit);
  assert.equal(s.education.course,'doctorate');assert.equal(canWork(s),false);
  s.education.studied.doctorate=w.logic.education.doctorateStudyTicks;
  s.traits.age=28;updateEducation(w,3,emit);assert.equal(canWork(s),false,'minimum doctoral duration');
  s.traits.age=29;updateEducation(w,4,emit);
  assert.equal(s.education.highestDegree,'doctorate');assert.equal(s.education.completed,true);
  assert.equal(canWork(s),true);assert.notEqual(s.traits.occupation,'student');
  assert.equal(events.filter(e=>e.id===s.id&&e.type==='graduated').length,1,'only final degree transitions to employment');
});
