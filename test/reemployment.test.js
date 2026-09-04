import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,serialize,deserialize} from '../sim/index.js';
import {maybeJobSwitch} from '../sim/society.js';

function fixture(){
  const w=createWorld(32);w.sims=w.sims.slice(0,1);
  const s=w.sims[0];s.traits.age=30;s.traits.occupation='jobless';
  s.education.course=null;s.abilities={stamina:50,dexterity:50,intellect:50,charisma:50};
  for(const f of w.map.facilities)f.revenue=f.type==='restaurant'?w.logic.industry.minRevenueToHire:0;
  return w;
}
function recruit(w){
  const events=[];
  for(let day=0;day<100;day++)maybeJobSwitch(w,day*1440,day,(...e)=>events.push(e));
  return events;
}
test('an average-aptitude unemployed adult can enter a real funded vacancy without an imaginary current-job gain',()=>{
  const w=fixture(),copy=deserialize(serialize(w)),rng={...w.rngSim},money=w.sims[0].money;
  const events=recruit(w);assert.deepEqual(events,recruit(copy));assert.equal(serialize(w),serialize(copy));
  assert.equal(w.sims[0].traits.occupation,'chef');
  assert.equal(events.filter(e=>e[0]==='job_changed').length,1);
  assert.deepEqual(w.rngSim,rng);assert.equal(w.sims[0].money,money);
});
test('rehiring still requires customer demand and an unfilled job',()=>{
  for(const condition of ['no_demand','filled']){
    const w=fixture();
    if(condition==='no_demand')for(const f of w.map.facilities)f.revenue=0;
    else {const staff=structuredClone(w.sims[0]);staff.id=99;staff.traits.occupation='chef';w.sims.push(staff);}
    recruit(w);assert.equal(w.sims[0].traits.occupation,'jobless',condition);
  }
});
test('the anti-churn gain requirement remains for employed residents and does not authorize student labor',()=>{
  for(const condition of ['employed','student','degree','minor']){
    const w=fixture(),s=w.sims[0];
    if(condition==='employed')s.traits.occupation='office_worker';
    if(condition==='student')s.traits.occupation='student';
    if(condition==='degree'){s.education.course='doctorate';s.education.completed=false;}
    if(condition==='minor')s.traits.age=18;
    const occupation=s.traits.occupation;recruit(w);assert.equal(s.traits.occupation,occupation,condition);
  }
});
