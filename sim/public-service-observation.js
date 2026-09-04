// Observation only. Nothing in employment, planning or choice reads this ledger.
// Counts are actual calls/events; shortfalls are resident/service/reason-days.
import {canWork} from './education.js';
const SERVICES=['patrol','fire'];
const COUNTERS=['attempted','started','completed','no_path','fire_resolved','fire_natural_out'];
const REASONS=['no_target','reserved','unreachable'];
const empty=()=>({counts:Object.fromEntries(COUNTERS.map(k=>[k,0])),
  shortfalls:Object.fromEntries(REASONS.map(k=>[k,0]))});
const dayAt=t=>Math.floor(t/1440);
export function rollPublicServiceObservation(world,t){
  const state=world.publicServiceObservation,day=dayAt(t);
  if(!state||state.day===day)return;
  state.daily=state.daily.filter(b=>b.day>=day-13&&b.day<=day);state.day=day;
}
function bucket(world,t){
  world=world.rootWorld??world;
  const day=dayAt(t);
  world.publicServiceObservation??={day,daily:[]};
  rollPublicServiceObservation(world,t);
  const state=world.publicServiceObservation;
  let b=state.daily.find(b=>b.day===day);
  if(!b){b={day,villages:{},seen:[]};state.daily.push(b);}
  return b;
}
function row(b,villageId,service){
  b.villages[villageId]??=Object.fromEntries(SERVICES.map(s=>[s,empty()]));
  return b.villages[villageId][service];
}
export function recordServiceCount(world,t,service,kind,villageId){
  if(!SERVICES.includes(service)||!COUNTERS.includes(kind))throw new RangeError('service counter');
  row(bucket(world,t),villageId??'village:0',service).counts[kind]++;
}
export function recordServiceShortfall(world,t,sim,service,reason,villageId){
  if(!SERVICES.includes(service)||!REASONS.includes(reason))throw new RangeError('service shortfall');
  const b=bucket(world,t),village=villageId??sim.villageId??'village:0';
  const key=JSON.stringify([village,sim.id,service,reason]);
  if(b.seen.includes(key))return false;
  b.seen.push(key);row(b,village,service).shortfalls[reason]++;return true;
}
export function publicServiceKind(action,facilityId){
  return action==='work'&&facilityId==='patrol'?'patrol'
    :action==='respond_fire'&&facilityId==='firesite'?'fire':null;
}
export function serviceVillage(world,sim,service,resourceId){
  const id=service==='patrol'?sim.employment?.facilityId:resourceId?.slice(5);
  return world.map.facilities.find(f=>f.id===id)?.villageId??sim.villageId??'village:0';
}
export function recordServiceEvent(world,t,type,simId,payload){
  if(type==='fire_out'){
    if(payload.by!=='self'&&!Number.isInteger(payload.by))return;
    if(payload.by!=='self'){
      const actor=world.sims.find(s=>s.id===payload.by);
      if(!actor||!canWork(actor)||actor.traits.occupation!=='firefighter'
        ||actor.state.kind!=='performing'||actor.state.action!=='respond_fire'
        ||actor.state.facilityId!=='firesite'||actor.state.resourceId!==`fire:${payload.facilityId}`)return;
    }
    const village=world.map.facilities.find(f=>f.id===payload.facilityId)?.villageId??'village:0';
    recordServiceCount(world,t,'fire',payload.by==='self'?'fire_natural_out':'fire_resolved',village);
    return;
  }
  if(type!=='action_started'&&type!=='action_completed')return;
  const service=publicServiceKind(payload.action,payload.facilityId);
  if(!service)return;
  const sim=world.sims.find(s=>s.id===simId);if(!sim)return;
  recordServiceCount(world,t,service,type==='action_started'?'started':'completed',
    serviceVillage(world,sim,service,payload.resourceId??sim.state.resourceId));
}

// Same canonical, read-only projection for HTTP, snapshot and batch. Dedup IDs
// never leave persistence, and stale buckets are ignored even before next tick.
export function publicServiceSummary(world,t=world.worldTick){
  const day=dayAt(t),villages={};
  for(const b of world.publicServiceObservation?.daily??[]){
    if(b.day<day-13||b.day>day)continue;
    for(const [village,services] of Object.entries(b.villages)){
      villages[village]??=Object.fromEntries(SERVICES.map(s=>[s,empty()]));
      for(const service of SERVICES)for(const group of ['counts','shortfalls'])
        for(const [key,n] of Object.entries(services[service][group]))villages[village][service][group][key]+=n;
    }
  }
  return {fromDay:Math.max(0,day-13),toDay:day,windowDays:14,
    countUnit:'actual_calls_or_events',shortfallUnit:'resident_service_reason_days',
    villages:Object.fromEntries(Object.entries(villages).sort(([a],[b])=>a<b?-1:a>b?1:0))};
}
