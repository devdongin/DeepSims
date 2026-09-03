import {test}from'node:test';import assert from'node:assert/strict';
import{createWorld,tick,serialize,deserialize,hashWorld}from'../sim/index.js';
import{collectCandidates,actionBlockReason}from'../sim/tick.js';
import{ESCORT_ACTION,escortableChildren,claimEscortPickup,beginHospitalEscort,cancelEscort}from'../sim/child-escort.js';

function fixture(){const w=createWorld(711),g=w.sims[0],c=w.sims[1];w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
 for(const s of w.sims){s.traits.age=50;s.traits.occupation='retired';s.state={...s.state,kind:'performing',action:'idle',ticksLeft:10000};}
 g.traits.age=30;g.traits.occupation='office_worker';g.money=10000;g.state={...g.state,kind:'idle'};c.traits.age=5;c.traits.occupation='child';c.money=0;c.homeId=g.homeId;c.sick={kind:'cold',untilTick:10000};c.state={...c.state,kind:'idle'};c.x=g.x;c.y=g.y;
 w.parents[c.id]=[g.id];w.policy.healthCopayPct=25;w.treasury=2000;g.needs={hunger:9999,energy:9999,social:9999,fun:9999};return{w,g,c};}

test('#71 only a live cohabiting adult parent can claim a sick idle child',()=>{const{w,g,c}=fixture();assert.deepEqual(escortableChildren(w,g),[c]);
 assert.equal(actionBlockReason(w,g,ESCORT_ACTION,601),null);const room=w.sims[2];room.homeId=c.homeId;room.traits.age=30;assert.deepEqual(escortableChildren(w,room),[]);
 c.homeId='elsewhere';assert.deepEqual(escortableChildren(w,g),[]);c.homeId=g.homeId;c.sick=null;assert.deepEqual(escortableChildren(w,g),[]);
 c.sick={kind:'cold',untilTick:10000};g.traits.age=18;assert.equal(actionBlockReason(w,g,ESCORT_ACTION,601),'too_young');});

test('#71 urgent escort wakes a sick child from an actual home bed and releases it',()=>{const{w,g,c}=fixture();const home=w.map.facilities.find(f=>f.id===c.homeId),bed=home.resources[0];c.x=bed.x;c.y=bed.y;c.state={...c.state,kind:'performing',action:'sleep',facilityId:home.id,resourceId:bed.id,ticksLeft:100};w.reservations[`${home.id}:${bed.id}`]=c.id;
 assert.deepEqual(escortableChildren(w,g),[c]);assert.equal(claimEscortPickup(w,g,c.id),true);assert.equal(w.reservations[`${home.id}:${bed.id}`],undefined);assert.equal(c.state.kind,'awaiting_escort');});

test('#71 escort walks to the child, reserves a real hospital seat, moves together and pays once',()=>{const{w,g,c}=fixture(),events=[];
 const first=tick(w,[]);events.push(...first);assert.equal(g.state.action,ESCORT_ACTION);assert.equal(c.state.kind,'awaiting_escort');
 let sawTravel=false,recovered=0;for(let i=0;i<1000&&!events.some(e=>e.type==='medical_visit_paid');i++){const ev=tick(w,[]);events.push(...ev);
  if(c.state.kind==='being_escorted'){sawTravel=true;assert.deepEqual([c.x,c.y],[g.x,g.y]);}}
 recovered=events.filter(e=>e.type==='recovered'&&e.simId===c.id&&e.payload.how==='doctor').length;
 assert.equal(sawTravel,true);assert.equal(recovered,1);assert.equal(events.filter(e=>e.type==='medical_visit_paid'&&e.simId===c.id).length,1);
 assert.equal(c.sick,null);assert.equal(events.some(e=>e.type==='money_changed'&&e.simId===c.id&&e.payload.action==='work'),false);
 assert.equal(events.filter(e=>e.type==='child_escorted'&&e.simId===g.id).length,1);});

test('#71 hospital loss after pickup cancels both sides without healing or money',()=>{const{w,g,c}=fixture();
 const cand=collectCandidates(w,g,[ESCORT_ACTION],601,true)[0];w.reservations[`childcare:${cand.resourceId}`]=g.id;
 assert.equal(claimEscortPickup(w,g,c.id),true);g.state={...g.state,kind:'performing',action:ESCORT_ACTION,facilityId:'childcare',resourceId:cand.resourceId,ticksLeft:0};
 for(const f of w.map.facilities.filter(f=>f.type==='hospital'))for(const r of f.resources)w.reservations[`${f.id}:${r.id}`]=999;
 const before=[g.money,c.money,w.treasury];assert.equal(beginHospitalEscort(w,g),false);assert.equal(c.state.kind,'idle');assert.deepEqual([g.money,c.money,w.treasury],before);});

test('#71 active escort survives save/resume with identical path, payment and RNG',()=>{const{w}=fixture();tick(w,[]);tick(w,[]);const b=deserialize(serialize(w));
 const ae=[],be=[];for(let i=0;i<300;i++){ae.push(...tick(w,[]));be.push(...tick(b,[]));if(ae.some(e=>e.type==='medical_visit_paid'))break;}
 assert.deepEqual(ae,be);assert.equal(hashWorld(w),hashWorld(b));assert.equal(ae.filter(e=>e.type==='medical_visit_paid').length,1);});

test('#71 explicit cancellation releases the child and hospital reservation',()=>{const{w,g,c}=fixture();c.state={...c.state,kind:'being_escorted',action:ESCORT_ACTION,facilityId:'hospital',resourceId:'bed',escortId:g.id};g.state={...g.state,action:ESCORT_ACTION,escortId:c.id};w.reservations['hospital:bed']=c.id;
 cancelEscort(w,g);assert.equal(c.state.kind,'idle');assert.equal(g.state.kind,'idle');assert.equal(w.reservations['hospital:bed'],undefined);});

test('#71 a missing guardian cannot leave a child frozen or a seat reserved',()=>{const{w,g,c}=fixture();c.state={...c.state,kind:'being_escorted',action:ESCORT_ACTION,facilityId:'hospital',resourceId:'bed',escortId:g.id};w.reservations['hospital:bed']=c.id;w.sims=w.sims.filter(s=>s!==g);
 tick(w,[]);assert.equal(['awaiting_escort','being_escorted'].includes(c.state.kind),false);assert.equal(w.reservations['hospital:bed'],undefined);});
