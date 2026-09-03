import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, hashWorld, migrateWorld } from '../sim/index.js';
import { newGovernment, governmentFor, governmentViews, governmentEmitter, publicBalance,
  recordMunicipalStats, reputationVillage } from '../sim/government.js';
import { maybeElection, applyWelfare, remitPublicRevenue, maybeFiscalReview, mayorStipend,
  fireSelfOut, maybePetition } from '../sim/society.js';
import { medicalQuote } from '../sim/health-policy.js';
import { foodAidBlockReason } from '../sim/food-aid.js';
import { openSupplyMarket } from '../sim/food-supply.js';
import { emptyState } from '../sim/simfactory.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from '../sim/constants.js';

function twoVillages(){
  const w=createWorld(32),home=w.map.facilities.find(f=>f.id===w.sims[0].homeId);
  const village={id:'village:1',name:'새솔',center:{...home.door},foundedTick:600,government:newGovernment()};
  w.villages.push(village);w.nextVillageId=2;home.villageId=village.id;
  for(const s of w.sims){
    if(s.homeId===home.id)s.villageId=village.id;
    s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null;
    s.state={...emptyState(),kind:'performing',action:'idle',ticksLeft:10000};
    s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  }
  w.worldTick=600;w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,village,g:village.government,home,s:w.sims[0]};
}
const closedMoney=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+(w.externalOutflow??0)-(w.externalInflow??0);

test('#32 migration adds empty independent accounts without copying the original treasury',()=>{
  const {w,village}=twoVillages();w.schemaVersion=68;delete village.government;
  const before={money:w.treasury,rng:serialize(w.rngSim),sims:serialize(w.sims)};
  migrateWorld(w);
  assert.equal(w.schemaVersion,SCHEMA_VERSION);assert.equal(village.government.treasury,0);
  assert.equal(publicBalance(w),before.money);assert.equal(serialize(w.rngSim),before.rng);
  assert.equal(serialize(w.sims),before.sims);
  const snapshot=serialize(w);migrateWorld(w);assert.equal(serialize(w),snapshot);
});

test('#32 local election uses local candidates and never hires a student as mayor',()=>{
  const {w,g,s}=twoVillages(),student=w.sims.find(x=>x.id!==s.id&&x.villageId===s.villageId);
  student.traits.occupation='student';student.education.course='doctorate';student.education.completed=false;
  const local=governmentViews(w).find(v=>v.municipalityId===s.villageId),events=[];
  const before=w.mayorId;
  maybeElection(local,1440,1,governmentEmitter(local,(...e)=>events.push(e)));
  assert.equal(g.mayorId,s.id);assert.equal(w.mayorId,before);assert.equal(g.lastElectionDay,1);
  assert.deepEqual(events[0][2].candidates,[s.id]);assert.equal(events[0][2].villageId,s.villageId);
  assert.equal(local.sims.length,2);assert.ok(!events[0][2].candidates.includes(student.id));
});

test('#32 welfare and health/food support use resident government funds, not a wealthy neighboring treasury',()=>{
  const {w,g,s}=twoVillages();w.treasury=100000;g.treasury=0;
  for(const x of w.sims)x.money=0;
  g.policy={welfareAmount:50,welfareThreshold:100,healthCopayPct:0};
  s.needs.hunger=0;s.groceries=0;
  assert.equal(medicalQuote(w,s).subsidy,0);assert.equal(foodAidBlockReason(w,s),'no_funds');
  const local=governmentViews(w).find(v=>v.municipalityId===s.villageId);
  applyWelfare(local,600,()=>assert.fail('empty local government cannot pay'));
  assert.equal(w.treasury,100000);
  g.treasury=50;const before=closedMoney(w),events=[];
  applyWelfare(local,601,(...e)=>events.push(e));
  assert.equal(g.treasury,0);assert.equal(s.money,50);assert.equal(w.treasury,100000);
  assert.equal(events.length,1);assert.equal(closedMoney(w),before);
});

test('#32 public facility remittances and grocery capital belong to the facility municipality',()=>{
  const {w,g,village}=twoVillages();
  const hospital=w.map.facilities.find(f=>f.type==='hospital');hospital.villageId=village.id;hospital.revenue=100;
  for(const f of w.map.facilities)if(f!==hospital)f.revenue=0;
  const before=closedMoney(w),primary=w.treasury;
  remitPublicRevenue(w,600,()=>{});
  assert.equal(w.treasury,primary);assert.equal(g.treasury,100);assert.equal(hospital.revenue,0);
  const market={id:'fixture-local-market',type:'market',villageId:village.id,revenue:0};
  w.map.facilities.push(market);openSupplyMarket(w,market,()=>{});
  assert.equal(g.treasury,0);assert.equal(market.revenue,100);assert.equal(w.treasury,primary);
  assert.equal(closedMoney(w),before);
});

test('#32 actual work pays public salary at the workplace and income tax at the residence',()=>{
  for(const occupation of ['office_worker','doctor']){
    const {w,g,s}=twoVillages();s.traits.occupation=occupation;
    const facility=w.map.facilities.find(f=>f.type===(occupation==='doctor'?'hospital':'office'));
    const r=facility.resources[0];s.x=r.x;s.y=r.y;
    s.state={...emptyState(),kind:'performing',action:'work',facilityId:facility.id,resourceId:r.id,ticksLeft:1};
    w.reservations[`${facility.id}:${r.id}`]=s.id;
    g.policy.taxPct=25;w.policy.taxPct=5;
    const before={primary:w.treasury,local:g.treasury,money:s.money,total:closedMoney(w)};
    const events=tick(w),paid=events.find(e=>e.type==='money_changed'&&e.simId===s.id&&e.payload.action==='work');
    assert.ok(paid);assert.ok(paid.payload.tax>0);
    assert.equal(g.treasury-before.local,paid.payload.tax);
    assert.equal(s.money-before.money,paid.payload.delta);
    const gross=paid.payload.delta+paid.payload.tax;
    assert.equal(paid.payload.delta,Math.floor(gross*75/100));
    assert.equal(w.treasury-before.primary,occupation==='doctor'?-gross:0);
    assert.equal(closedMoney(w),before.total);
  }
});

test('#32 a daily two-village government cycle is deterministic after save and conserves total money',()=>{
  const {w,g}=twoVillages();w.worldTick=1439;g.treasury=500;
  const b=deserialize(serialize(w)),before=closedMoney(w);
  for(let i=0;i<50;i++)assert.deepEqual(tick(w),tick(b));
  assert.equal(hashWorld(w),hashWorld(b));assert.equal(closedMoney(w),before);
  assert.notEqual(g.mayorId,null);assert.equal(governmentFor(w,'village:1'),g);
});

test('#32 municipal fiscal review changes only its own policy and reads local complaint evidence',()=>{
  const {w,g,s}=twoVillages();
  const day=w.logic.fiscal.reviewIntervalDays;w.worldTick=day*1440;
  g.treasury=100000;g.policy.welfareAmount=100;
  w.complaints=[{kind:'hungry',count:10,sinceDay:day}];
  const foreign=w.sims.find(x=>x.villageId!==s.villageId);foreign.complaintDays.hungry=day;
  let local=governmentViews(w).find(v=>v.municipalityId===s.villageId);
  assert.equal(local.complaints.length,0);
  s.complaintDays.hungry=day;
  local=governmentViews(w).find(v=>v.municipalityId===s.villageId);
  assert.equal(local.complaints.length,1);
  const before=serialize(w.policy),events=[];
  maybeFiscalReview(local,w.worldTick,day,governmentEmitter(local,(...e)=>events.push(e)));
  assert.ok(g.policy.welfareAmount>100);assert.equal(serialize(w.policy),before);
  assert.equal(events[0][2].villageId,s.villageId);assert.equal(w.lastFiscalDay,-1);
  assert.equal(g.lastFiscalDay,day);
});

test('#32 the original town also excludes a student incumbent and never pays a student mayor wage',()=>{
  const w=createWorld(32),[adult,student]=w.sims;
  adult.traits.age=25;adult.traits.occupation='office_worker';adult.education.course=null;
  student.traits.age=25;student.traits.occupation='student';
  student.education.course='doctorate';student.education.completed=false;
  for(const s of w.sims){w.affinity[s.id][student.id]=10000;w.affinity[s.id][adult.id]=9000;}
  w.mayorId=student.id;const money=student.money,balance=w.treasury;
  mayorStipend(w,0,()=>assert.fail('students cannot perform paid mayor work'));
  assert.equal(student.money,money);assert.equal(w.treasury,balance);
  const events=[];
  maybeElection(w,w.logic.election.intervalDays*1440,w.logic.election.intervalDays,(...e)=>events.push(e));
  assert.equal(w.mayorId,adult.id);assert.ok(!events[0][2].candidates.includes(student.id));
});

test('#32 diagnostic village government summaries are detached, not a second wallet',async()=>{
  const {villageSummary}=await import('../sim/villages.js');
  const {w,g}=twoVillages();g.treasury=75;g.policy.taxPct=20;
  recordMunicipalStats(w,1);
  const before=serialize(w),rows=villageSummary(w);
  assert.equal(rows[0].government.treasury,w.treasury);assert.equal(rows[1].government.treasury,75);
  rows[1].government.treasury=999;rows[1].government.policy.taxPct=0;
  rows[0].statsHistory[0].treasury=999;rows[1].statsHistory[0].pop=999;
  assert.equal(serialize(w),before);assert.equal(publicBalance(w),w.treasury+75);
});

test('#32 actual family settlement sustains its own government and conserved finances for two more days',()=>{
  const output=execFileSync(process.execPath,[fileURLToPath(new URL('../bench/founding-construction.js',import.meta.url)),
    '32','--settle','--family','--government'],{encoding:'utf8',timeout:60000});
  const result=JSON.parse(output);
  assert.equal(result.governmentCheck.days,2);
  // Main financial mood changes settlement timing; this two-day window need not
  // contain an immigration wave. Count observed arrivals, not an invented fourth resident.
  assert.equal(result.governmentCheck.residents,3+result.governmentCheck.immigrants.length);
  assert.ok(result.governmentCheck.immigrants.every(Number.isSafeInteger));
  assert.ok(result.governmentCheck.treasury>0);assert.equal(result.governmentCheck.mayorId,0);
});

test('#32 actual volunteer completion and neglected fire change only the served facility municipality',()=>{
  const {w,g,s}=twoVillages(),hall=w.map.facilities.find(f=>f.type==='city_hall'),r=hall.resources[0];
  hall.villageId=s.villageId;w.reputation=100;g.reputation=100;
  s.x=r.x;s.y=r.y;s.state={...emptyState(),kind:'performing',action:'volunteer',facilityId:hall.id,resourceId:r.id,ticksLeft:1};
  w.reservations[`${hall.id}:${r.id}`]=s.id;
  tick(w);
  assert.equal(w.reputation,100);assert.equal(g.reputation,100+w.logic.actions.volunteer.repGain);
  w.incidents=[{facilityId:hall.id,sinceTick:0}];
  fireSelfOut(w,w.logic.incidents.selfOutTicks,()=>{});
  assert.equal(w.reputation,100);assert.equal(g.reputation,100+w.logic.actions.volunteer.repGain-w.logic.incidents.selfOutRepPenalty);
  assert.equal(w.incidents.length,0);
});

test('#32 reputation event attribution prefers explicit municipality, then facility, then resident',()=>{
  const {w,s,home}=twoVillages();
  for(const field of ['facilityId','homeId','placeId'])assert.equal(reputationVillage(w,{payload:{[field]:home.id}}),s.villageId);
  assert.equal(reputationVillage(w,{simId:s.id,payload:{}}),s.villageId);
  assert.equal(reputationVillage(w,{simId:s.id,payload:{villageId:'village:0'}}),'village:0');
  assert.equal(reputationVillage(w,{payload:{}}),'village:0');
});

test('#32 a municipal petition neither lowers neighboring reputation nor disarms its petition',()=>{
  const {w,g,s}=twoVillages();w.reputation=100;g.reputation=100;
  w.complaints=[{kind:'hungry',count:10,sinceDay:0}];
  for(const resident of w.sims.filter(x=>x.villageId===s.villageId))resident.complaintDays.hungry=0;
  const events=[];
  for(const local of governmentViews(w))maybePetition(local,600,0,governmentEmitter(local,(...e)=>events.push(e)));
  assert.equal(events.length,1);assert.equal(events[0][2].villageId,s.villageId);
  assert.equal(w.reputation,100);assert.equal(g.reputation,100-w.logic.complaints.petitionRepPenalty);
  assert.equal(g.petitions.hungry.armed,false);assert.equal(w.petitions.hungry,undefined);
});

test('#32 fiscal trends use local observed balances, not the global series or another municipality',()=>{
  const {w,g}=twoVillages();for(const s of w.sims)s.money=1000;
  const allowance=2*w.logic.fiscal.stepWelfare;
  w.policy.welfareAmount=allowance;g.policy.welfareAmount=allowance;
  const globalBefore=serialize(w.statsHistory);
  w.treasury=10;g.treasury=20;recordMunicipalStats(w,1);
  w.treasury=20;g.treasury=10;recordMunicipalStats(w,2);
  assert.equal(serialize(w.statsHistory),globalBefore);
  const locals=governmentViews(w);
  assert.deepEqual(locals.map(v=>v.statsHistory.map(row=>row.treasury)),[[10,20],[20,10]]);
  const day=w.logic.fiscal.reviewIntervalDays;
  for(const local of locals)maybeFiscalReview(local,day*1440,day,()=>{});
  assert.equal(w.policy.welfareAmount,allowance,'rising primary balance does not trigger a cut');
  assert.ok(g.policy.welfareAmount<allowance,'declining secondary balance triggers its own fiscal response');
  const before=serialize(w),saved=deserialize(before);
  recordMunicipalStats(w,2);recordMunicipalStats(saved,2);
  assert.equal(serialize(w),serialize(saved));assert.equal(g.statsHistory.length,2,'same-day observations replace, not append');
  for(let d=3;d<=200;d++)recordMunicipalStats(w,d);
  for(const local of governmentViews(w)){assert.equal(local.statsHistory.length,180);assert.equal(local.statsHistory[0].day,21);}
});

test('#32 migration starts missing municipal observations empty, without relabeling historical global data',()=>{
  const {w,g}=twoVillages();w.schemaVersion=69;delete g.petitions;
  w.statsHistory=[{day:1,pop:10,treasury:500}];g.statsHistory=[{day:2,pop:2,treasury:7}];
  const before=serialize(w.statsHistory),money=publicBalance(w);
  migrateWorld(w);
  assert.equal(serialize(w.statsHistory),before);assert.equal(publicBalance(w),money);
  assert.deepEqual(w.villages[0].statsHistory,[]);assert.deepEqual(g.statsHistory,[{day:2,pop:2,treasury:7}]);
  assert.deepEqual(g.petitions,{});const once=serialize(w);migrateWorld(w);assert.equal(serialize(w),once);
});

test('#32 the real daily tick applies factory pollution and decay to only the factory municipality',()=>{
  const {w,g,s}=twoVillages();w.worldTick=1439;w.reputation=100;g.reputation=200;
  w.logic.incidents.fireBasePermille=0;w.logic.incidents.kitchenBonusPermille=0;
  w.map.facilities.push({id:'fixture-polluter',type:'factory',villageId:s.villageId,
    x:400,y:400,w:1,h:1,door:{x:400,y:400},resources:[]});
  const control=deserialize(serialize(w));
  control.map.facilities.find(f=>f.id==='fixture-polluter').type='office';
  tick(w);tick(control);
  assert.equal(w.reputation,control.reputation,'another town cannot receive the pollution penalty');
  const expected=Math.floor(200*w.logic.growth.repDecayPct/100)
    -Math.floor((200-w.logic.pollution.repPerFactoryPerDay)*w.logic.growth.repDecayPct/100);
  assert.equal(control.villages[1].government.reputation-g.reputation,expected);
  assert.equal(g.statsHistory.length,1);assert.equal(g.statsHistory[0].pop,2);
  assert.equal(w.villages[0].statsHistory[0].pop,w.sims.filter(x=>x.villageId==='village:0').length);
  assert.equal(w.statsHistory.at(-1).treasury,publicBalance(w));
});
