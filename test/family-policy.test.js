import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, hashWorld } from '../sim/index.js';
import { applyChildAllowance } from '../sim/family-policy.js';
import { validatePolicy } from '../sim/logic.js';

function fixture() {
  const w=createWorld(171), [child,a,b]=w.sims;
  for(const s of w.sims) { s.traits.age=40; s.traits.occupation='office_worker'; s.money=1000;
    s.state={...s.state,kind:'performing',action:'idle',ticksLeft:10000}; }
  child.traits.age=18; child.traits.occupation='student'; child.money=0;
  a.homeId=child.homeId; b.homeId=child.homeId; a.money=200; b.money=400;
  w.parents[child.id]=[b.id,a.id,a.id]; w.treasury=1000; w.policy.childAllowance=100;
  return {w,child,a,b};
}
const cash = w => w.treasury+w.sims.reduce((n,s)=>n+s.money,0);

test('#71 child allowance is a single family transfer per child/day, not wages or need recovery',()=>{
  const {w,child,a,b}=fixture(), before=cash(w), needs=serialize(child.needs), events=[];
  applyChildAllowance(w,1440,(type,id,payload)=>events.push({type,id,payload}));
  assert.equal(a.money,300);assert.equal(b.money,400);assert.equal(w.treasury,900);
  assert.equal(child.money,0);assert.equal(serialize(child.needs),needs);assert.equal(cash(w),before);
  assert.equal(events.length,1);assert.equal(events[0].type,'child_allowance_paid');
  applyChildAllowance(w,1441,()=>assert.fail('duplicate')); assert.equal(a.money,300);
  const restored=deserialize(serialize(w));
  applyChildAllowance(restored,1442,()=>assert.fail('save bypassed guard'));
  assert.equal(hashWorld(restored),hashWorld(w));
  applyChildAllowance(w,2880,()=>{});assert.equal(a.money,400);
});

test('#71 unrelated roommates, moved/absent parents and adult children do not qualify',()=>{
  for(const mutate of [
    ({w,child})=>{w.parents[child.id]=[];},
    ({a,b})=>{a.homeId='elsewhere';b.homeId='elsewhere';},
    ({w,a,b})=>{w.sims=w.sims.filter(s=>s!==a&&s!==b);},
    ({child})=>{child.traits.age=19;},
  ]) { const x=fixture();mutate(x);const before=cash(x.w);
    applyChildAllowance(x.w,1440,()=>assert.fail('ineligible family paid'));
    assert.equal(cash(x.w),before);assert.equal(x.w.treasury,1000); }
});

test('#71 treasury bounds and disabled policies do not invent transfers',()=>{
  const {w,a}=fixture();w.treasury=99;
  applyChildAllowance(w,1440,()=>assert.fail('overspent'));assert.equal(a.money,200);assert.equal(w.treasury,99);
  w.policy.childAllowance=0;w.childAllowanceDay=-1;
  applyChildAllowance(w,2880,()=>assert.fail('disabled'));assert.equal(w.childAllowanceDay,-1);
  for(const n of [0,100,1000]) assert.equal(validatePolicy({childAllowance:n}).ok,true);
  for(const n of [-1,1001,0.1,'100']) assert.equal(validatePolicy({childAllowance:n}).ok,false);
});

test('#71 durable allowance input reaches the daily pipeline and replays identically',()=>{
  const {w,child}=fixture();w.policy={};w.worldTick=1439;w.lastDailyDay=0;w.lastPlanDay=0;
  const restored=deserialize(serialize(w));
  const input={sequence:0,command:'policy',payload:{childAllowance:100}};
  const ev=tick(w,[input]),ref=tick(restored,[input]);
  assert.deepEqual(ev,ref);assert.equal(hashWorld(w),hashWorld(restored));
  const paid=ev.filter(e=>e.type==='child_allowance_paid'&&e.payload.childId===child.id);
  assert.equal(paid.length,1);assert.equal(paid[0].payload.amount,100);
  assert.equal(ev.some(e=>e.type==='money_changed'&&e.simId===child.id&&e.payload.action==='work'),false);
});
