// Fixed input, durable policy command, no connection to a running world.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { migrateWorld, tick, hashWorld, findNonFinite } from '../sim/index.js';
import { canWork } from '../sim/education.js';
import { escortableChildren } from '../sim/child-escort.js';
const [snapshot, daysArg='30', copayArg='100', allowanceArg='0'] = process.argv.slice(2);
if (!snapshot) throw new Error('usage: node bench/family-policy-soak.js SNAPSHOT DAYS COPAY ALLOWANCE');
const raw=fs.readFileSync(snapshot,'utf8'), w=migrateWorld(JSON.parse(raw));
const policy={healthCopayPct:Number(copayArg),childAllowance:Number(allowanceArg)};
const initial={pop:w.sims.length,treasury:w.treasury,tick:w.worldTick};
let personTicks=0,sickTicks=0,childTicks=0,sickChildTicks=0,parentWorkTicks=0,careTicks=0;
let patientCost=0,subsidy=0,allowance=0,visits=0,allowancePayments=0,nonworkerWages=0,minTreasury=w.treasury;
let doctorRecoveries=0,naturalRecoveries=0,illnesses=0,births=0,publicWageShortfalls=0;
let escortOpportunityTicks=0;
for(let i=0;i<Number(daysArg)*1440;i++) {
  const byId=new Map(w.sims.map(s=>[s.id,s])), parents=new Set();
  for(const child of w.sims) if(child.traits.age<19) for(const id of w.parents[child.id]??[])
    if(byId.get(id)?.homeId===child.homeId) parents.add(id);
  const nonworkers=new Set(w.sims.filter(s=>!canWork(s)).map(s=>s.id));
  escortOpportunityTicks+=w.sims.filter(s=>s.traits.age>=19&&escortableChildren(w,s).length>0).length;
  for(const s of w.sims) {
    personTicks++; sickTicks+=Number(!!s.sick);
    if(s.traits.age<19){childTicks++;sickChildTicks+=Number(!!s.sick);}
    if(s.state.kind==='performing') {
      if(s.state.action==='work'&&parents.has(s.id)) parentWorkTicks++;
      if(s.state.action==='escort_child_doctor') careTicks++;
    }
  }
  const inputs=i===0?[{sequence:0,command:'policy',payload:policy}]:[];
  for(const e of tick(w,inputs)) {
    if(e.type==='input_rejected') throw new Error(JSON.stringify(e));
    if(e.type==='medical_visit_paid'){visits++;patientCost+=e.payload.patientCost;subsidy+=e.payload.subsidy;}
    if(e.type==='child_allowance_paid'){allowancePayments++;allowance+=e.payload.amount;}
    if(e.type==='recovered'){if(e.payload.how==='doctor')doctorRecoveries++;else naturalRecoveries++;}
    if(e.type==='fell_sick')illnesses++;
    if(e.type==='child_settled')births++;
    if(e.type==='wage_shortfall'&&e.payload.source==='treasury')publicWageShortfalls++;
    if(e.type==='money_changed'&&e.payload.action==='work'&&e.payload.delta>0&&nonworkers.has(e.simId))nonworkerWages++;
  }
  minTreasury=Math.min(minTreasury,w.treasury);
}
console.log(JSON.stringify({inputSha256:createHash('sha256').update(raw).digest('hex'),policy,initial,
  final:{pop:w.sims.length,treasury:w.treasury,tick:w.worldTick},personTicks,sickTicks,childTicks,sickChildTicks,
  parentWorkTicks,careTicks,visits,patientCost,subsidy,allowance,allowancePayments,doctorRecoveries,
  naturalRecoveries,illnesses,births,nonworkerWages,publicWageShortfalls,minTreasury,
  escortOpportunityTicks,
  nonFinite:findNonFinite(w),hash:hashWorld(w)},null,2));
