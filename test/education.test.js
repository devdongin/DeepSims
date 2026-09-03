import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, hashWorld, serialize, deserialize } from '../sim/index.js';
import { newEducation, schoolFor, considerUniversity, recordStudy, finishUniversity } from '../sim/education.js';

function fixture() {
  const w=createWorld(96), s=w.sims[0];
  s.education=newEducation();s.traits.age=19;
  w.logic.education={annualTuition:2000};
  w.map.facilities.push({id:'uni-test',type:'university'});
  s.money=500; w.parents[s.id]=[1];
  w.sims[1].homeId=s.homeId;w.sims[1].money=5000;
  s.abilities.intellect=99;s.traits.mbti.SN=0;s.traits.mbti.JP=100;
  return w;
}

test('#96 school stages have exact primary/middle/high boundaries and university is opt-in', () => {
  const s={traits:{age:0},education:newEducation()};
  for(const [age,school] of [[0,null],[6,null],[7,'primary_school'],[12,'primary_school'],[13,'middle_school'],
    [15,'middle_school'],[16,'high_school'],[18,'high_school'],[19,null],[22,null],[23,null]]) {
    s.traits.age=age;assert.equal(schoolFor(s),school);
  }
  s.traits.age=19;s.education.universityEnrolled=true;assert.equal(schoolFor(s),'university');
  assert.equal(recordStudy(s,'high_school'),false);
  assert.equal(recordStudy(s,'university'),true);
  s.traits.age=23;finishUniversity(s,2);assert.equal(s.education.universityGraduated,false);
  s.education.studied.university=2;finishUniversity(s,2);assert.equal(s.education.universityGraduated,true);
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
  for(const kind of ['funds','campus']) {
    const w=fixture(),s=w.sims[0],events=[];
    if(kind==='funds')w.sims[1].money=0;
    else w.map.facilities=w.map.facilities.filter(f=>f.type!=='university');
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
