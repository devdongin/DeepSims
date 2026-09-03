import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, hashWorld } from '../sim/index.js';
import { newGovernment, governmentViews } from '../sim/government.js';
import { validatePolicyCommand, applyPolicyCommand } from '../sim/policy-command.js';
import { validatePolicy } from '../sim/logic.js';
import { maybeFiscalReview } from '../sim/society.js';
import { Storage } from '../db/storage.js';
import { Engine } from '../server/engine.js';

function fixture(){
  const w=createWorld(32),g=newGovernment();
  w.villages.push({id:'village:1',name:'새솔',center:{x:80,y:80},foundedTick:0,government:g});
  w.nextVillageId=2;w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,g};
}

test('#32 policy command validation is read-only, strict and backwards compatible',()=>{
  const {w}=fixture(),before=serialize(w);
  assert.deepEqual(validatePolicyCommand(w,{taxPct:20}),{ok:true,villageId:'village:0',explicit:false,changes:{taxPct:20}});
  assert.equal(validatePolicyCommand(w,{villageId:'village:1',taxPct:20}).ok,true);
  for(const payload of [null,[],{}, {villageId:'village:1'}, {villageId:null,taxPct:20},
    {villageId:1,taxPct:20}, {villageId:'missing',taxPct:20}, {villageId:'village:1',taxPct:31},
    {villageId:'village:1',treasury:100}, {villageId:'village:1',changes:{taxPct:20}}]){
    assert.equal(validatePolicyCommand(w,payload).ok,false,JSON.stringify(payload));
  }
  for(const key of ['constructor','__proto__','toString','hasOwnProperty']){
    const payload=JSON.parse(`{"${key}":10}`);
    assert.equal(validatePolicy(payload).ok,false,key);
    assert.equal(validatePolicyCommand(w,{villageId:'village:1',...payload}).ok,false,key);
  }
  assert.equal(serialize(w),before);
});

test('#32 selected policy changes and player protection never modify the neighboring government',()=>{
  const {w,g}=fixture(),events=[],primary=serialize(w.policy),money=w.treasury;
  applyPolicyCommand(w,{villageId:'village:1',taxPct:20,healthCopayPct:40},1440,(...e)=>events.push(e));
  assert.deepEqual(g.policy,{taxPct:20,healthCopayPct:40});assert.equal(g.playerPolicyDay,1);
  assert.equal(serialize(w.policy),primary);assert.equal(w.playerPolicyDay,-1);assert.equal(w.treasury,money);assert.equal(g.treasury,0);
  assert.deepEqual(events[0],[ 'policy_changed',null,{changes:{taxPct:20,healthCopayPct:40},
    before:{taxPct:w.logic.economy.taxPct,healthCopayPct:w.logic.economy.healthCopayPct},source:'player',villageId:'village:1'}]);
  applyPolicyCommand(w,{taxPct:10},2880,(...e)=>events.push(e));
  assert.equal(w.policy.taxPct,10);assert.equal(g.policy.taxPct,20);assert.equal(w.playerPolicyDay,2);
  assert.equal(Object.hasOwn(events[1][2],'villageId'),false,'legacy event shape is unchanged');
});

test('#32 an invalid or vanished policy target rejects atomically without creating authority',()=>{
  const {w,g}=fixture(),payload={villageId:'village:1',taxPct:20};
  assert.equal(validatePolicyCommand(w,payload).ok,true);
  w.villages.pop();const before=serialize(w),events=[];
  assert.equal(applyPolicyCommand(w,payload,600,(...e)=>events.push(e)),false);
  assert.equal(serialize(w),before);assert.deepEqual(g.policy,{});assert.equal(events[0][0],'input_rejected');
});

test('#32 durable municipality policy survives reconstruction before and after application exactly once',async()=>{
  const st=new Storage(':memory:');
  try{
    const engine=new Engine(st,{seed:32,now:()=>1000});engine.world=fixture().w;
    st.commitBatch({world:engine.world,events:[],appliedInputIds:[],epochUtcMs:engine.epochUtcMs});
    const expected=deserialize(serialize(engine.world));
    const input={clientInputId:'municipal-policy-once',command:'policy',payload:{villageId:'village:1',taxPct:22}};
    const accepted=await engine.submitInput(input);
    assert.equal(accepted.duplicate,false);assert.deepEqual(await engine.submitInput(input),{...accepted,duplicate:true});
    const resumed=new Engine(st,{seed:32,now:()=>1000}),events=resumed.runLive(1).events;
    assert.deepEqual(events,tick(expected,[{sequence:0,command:'policy',payload:input.payload}]));
    assert.equal(hashWorld(resumed.world),hashWorld(expected));
    assert.equal(resumed.world.villages[1].government.policy.taxPct,22);assert.equal(resumed.world.policy.taxPct,undefined);
    const again=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(hashWorld(again.world),hashWorld(expected));
    assert.ok(!again.runLive(1).events.some(e=>e.type==='policy_changed'));
  }finally{st.close();}
});

test('#32 policy commands preserve ordering across two municipalities and save/resume',()=>{
  const {w}=fixture(),copy=deserialize(serialize(w));
  const inputs=[{sequence:0,command:'policy',payload:{villageId:'village:1',taxPct:10}},
    {sequence:1,command:'policy',payload:{taxPct:25}},
    {sequence:2,command:'policy',payload:{villageId:'village:1',taxPct:15}}];
  const events=tick(w,inputs);assert.deepEqual(events,tick(copy,inputs));assert.equal(hashWorld(w),hashWorld(copy));
  assert.equal(w.policy.taxPct,25);assert.equal(w.villages[1].government.policy.taxPct,15);
  assert.deepEqual(events.filter(e=>e.type==='policy_changed').map(e=>e.payload.changes.taxPct),[10,25,15]);
});

test('#32 a selected policy protects only that municipality from immediate automated fiscal changes',()=>{
  const {w,g}=fixture(),day=w.logic.fiscal.reviewIntervalDays;
  for(const s of w.sims){s.money=1000;s.hungerZeroTicks=0;}
  w.treasury=0;w.policy.welfareAmount=2*w.logic.fiscal.stepWelfare;
  g.treasury=0;g.policy.welfareAmount=2*w.logic.fiscal.stepWelfare;
  applyPolicyCommand(w,{villageId:'village:1',taxPct:20},day*1440,()=>{});
  for(const local of governmentViews(w))maybeFiscalReview(local,day*1440,day,()=>{});
  assert.equal(g.policy.welfareAmount,2*w.logic.fiscal.stepWelfare);assert.equal(g.lastFiscalDay,-1);
  assert.equal(w.policy.welfareAmount,w.logic.fiscal.stepWelfare);assert.equal(w.lastFiscalDay,day);
});
