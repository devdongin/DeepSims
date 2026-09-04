// Cross-town moves reserve an existing home, then physically move the departing family.
import {bfsPath} from './pathfind.js';
import {isResidence,isWalkable} from './map.js';
import {syncResidenceVillage} from './villages.js';
import {planSettlementHouseholds} from './settlement-households.js';
import {planIndependentHousehold} from './independent-household.js';
import {planMarriedHousehold,marriageHomeResidents} from './marriage-household.js';
import {canWork} from './education.js';
import {serialize} from './serialize.js';
import {governmentFor} from './government.js';
import {relocationReady,relocationCandidate,stopRelocation,SETTLE_ACTION} from './settlement.js';
const physical=i=>i.kind==='rent_move'||i.kind==='separate'||i.kind==='marriage_move';
const pending=w=>(w.householdIntents??[]).filter(i=>physical(i)&&i.relocation);
const plan=(w,i,villageId)=>i.kind==='separate'?planIndependentHousehold(w,i.simId,villageId)
  :i.kind==='marriage_move'?planMarriedHousehold(w,i.coupleIds,i.targetHomeId):planSettlementHouseholds(w,[i.simId],villageId);
const at=(s,p)=>s.x===p.x&&s.y===p.y;
const candidate=(i,s,p)=>relocationCandidate({id:`move${i.intentId}`},s,p);
function stop(w,i,s){
  if(s?.state.resourceId?.startsWith(`pmove${i.intentId}:`))stopRelocation(w,s);
}
export function householdMigrationInTransit(w,id){
  return (w.householdIntents??[]).some(i=>physical(i)&&i.relocation?.phase==='travelling'&&i.memberIds.includes(id));
}
export function beginHouseholdMigration(w,i,target,t,emit){
  const origin=w.map.facilities.find(f=>f.id===i.fromHomeId);
  if(!origin||!w.villages.some(v=>v.id===target.villageId))return 'target_unavailable';
  const family=plan(w,i,origin.villageId);
  if(!family.ok)return family.reason;
  if(i.kind==='marriage_move'&&serialize(family.familyResidents)!==serialize(i.familyResidents))return 'household_changed';
  const occupants=marriageHomeResidents(w,target.id);
  if(i.kind==='marriage_move'&&serialize(occupants)!==serialize(i.destinationResidents))return 'target_unavailable';
  if(target.resources.length<family.residents.length+occupants.length)return 'household_capacity';
  if(pending(w).some(other=>other!==i&&(other.familyResidents??other.migrationResidents)
    .some(r=>(family.familyResidents??family.residents).some(s=>s.simId===r.simId))))return 'migration_conflict';
  i.memberIds=family.residents.map(s=>s.simId);i.migrationResidents=family.residents;
  i.targetHomeId=target.id;
  i.fromVillageId=origin.villageId;i.toVillageId=target.villageId;
  i.relocation={phase:'gathering',assembly:{...origin.door},routeVersion:-1,distance:null,startedTick:null};
  target.migrationIntentId=i.intentId;
  emit('household_migration_gathering',i.simId,{intentId:i.intentId,kind:i.kind,memberIds:[...i.memberIds],
    targetHomeId:target.id,fromVillageId:i.fromVillageId,toVillageId:i.toVillageId});
  return null;
}
function cancel(w,i,reason,emit){
  for(const id of i.memberIds)stop(w,i,w.sims.find(s=>s.id===id));
  if(i.kind==='separate'){
    const adult=w.sims.find(s=>s.id===i.simId);if(adult)adult.independenceDays=0;
  }
  for(const f of w.map.facilities)if(f.migrationIntentId===i.intentId)delete f.migrationIntentId;
  w.householdDaily.failures[reason]=(w.householdDaily.failures[reason]??0)+1;
  emit('household_intent_failed',i.simId,{intentId:i.intentId,kind:i.kind,reason});
  w.householdIntents.splice(w.householdIntents.indexOf(i),1);
}
export function householdMigrationGatherTarget(w,s){
  const i=(w.householdIntents??[]).find(i=>physical(i)&&i.relocation?.phase==='gathering'&&i.memberIds.includes(s.id));
  if(!i||i.relocation.distance===null||!relocationReady(w,s,i.relocation.distance))return null;
  return {candidate:candidate(i,s,i.relocation.assembly),hold:at(s,i.relocation.assembly)};
}
export function advanceHouseholdMigrations(w,t,emit,start){
  for(const i of pending(w).sort((a,b)=>a.intentId-b.intentId)){
    const sims=i.memberIds.map(id=>w.sims.find(s=>s.id===id));
    const home=w.map.facilities.find(f=>f.id===i.targetHomeId),r=i.relocation;
    const family=plan(w,i,i.fromVillageId);
    const changed=!family.ok||serialize(family.residents)!==serialize(i.migrationResidents)
      ||(i.kind==='marriage_move'&&serialize(family.familyResidents)!==serialize(i.familyResidents));
    const occupants=home?marriageHomeResidents(w,home.id):[];
    const occupied=i.kind==='marriage_move'?serialize(occupants)!==serialize(i.destinationResidents):occupants.length>0;
    const unavailable=!home||!isResidence(home)||home.migrationIntentId!==i.intentId||home.foundingPetitionId!=null
      ||home.villageId!==i.toVillageId||!w.villages.some(v=>v.id===i.toVillageId)||home.resources.length<sims.length+occupants.length
      ||occupied||w.incidents.some(j=>j.facilityId===home.id);
    const founding=w.founding.petitions.some(p=>['building','awaiting_settlement'].includes(p.status)
      &&p.plan?.residents?.some(s=>(i.familyResidents??i.migrationResidents).some(r=>r.simId===s.simId)));
    let reason=changed?'household_changed':unavailable?'target_unavailable':founding?'founding_conflict':null;
    if(!reason&&i.kind==='separate'&&r.phase==='gathering'){
      const adult=sims.find(s=>s.id===i.simId);
      if(!canWork(adult)||(w.logic.occupations[adult.traits.occupation]?.wagePct??0)<=0)reason='income_unstable';
      else if(adult.money<w.logic.household.reserveMoney)reason='reserve_short';
    }
    if(!reason&&r.phase==='travelling'&&sims.some(s=>s.state.action===SETTLE_ACTION&&s.state.kind==='walking'
      &&s.state.path.length&&!isWalkable(w.map,s.state.path[0].x,s.state.path[0].y)))reason='route_changed';
    if(reason){cancel(w,i,reason,emit);continue;}
    if(r.phase==='gathering'){
      if(r.routeVersion!==(w.map.reachVersion??0)){
        r.routeVersion=w.map.reachVersion??0;
        const path=bfsPath(w.map,r.assembly.x,r.assembly.y,home.door.x,home.door.y);
        r.distance=path?.length??null;
        if(path===null||sims.some(s=>bfsPath(w.map,s.x,s.y,r.assembly.x,r.assembly.y)===null)){
          cancel(w,i,'route_changed',emit);continue;
        }
      }
      if(!sims.every(s=>at(s,r.assembly)&&(s.state.kind==='idle'||['idle',SETTLE_ACTION].includes(s.state.action))
        &&relocationReady(w,s,r.distance)))continue;
      r.phase='travelling';r.startedTick=t;
      for(const s of sims)start(s,candidate(i,s,home.door));
      emit('household_migration_departed',i.simId,{intentId:i.intentId,kind:i.kind,memberIds:[...i.memberIds],
        fromVillageId:i.fromVillageId,toVillageId:i.toVillageId});
    }else{
      const interrupted=sims.filter(s=>!at(s,home.door)&&s.state.action!==SETTLE_ACTION);
      if(interrupted.some(s=>bfsPath(w.map,s.x,s.y,home.door.x,home.door.y)===null)){
        cancel(w,i,'route_changed',emit);continue;
      }
      for(const s of interrupted)start(s,candidate(i,s,home.door));
    }
  }
}
export function completeHouseholdMigrations(w,t,emit){
  for(const i of pending(w)){
    if(i.relocation.phase!=='travelling')continue;
    const home=w.map.facilities.find(f=>f.id===i.targetHomeId),sims=i.memberIds.map(id=>w.sims.find(s=>s.id===id));
    if(!home||sims.some(s=>!s||!at(s,home.door)))continue;
    // Like permanent departure, leaving office does not mint a destination office
    // or force an election outside its normal schedule.
    for(const s of sims)if(s.villageId!==i.toVillageId){
      const source=governmentFor(w,s.villageId);if(source.mayorId===s.id)source.mayorId=null;
    }
    delete home.migrationIntentId;
    if(i.kind==='marriage_move')for(const r of i.familyResidents){
      const member=w.sims.find(s=>s.id===r.simId);member.householdId=`household:marriage:${i.coupleIds[0]}:${i.coupleIds[1]}`;
    }
    for(const s of sims){const from=s.homeId;s.homeId=home.id;syncResidenceVillage(w,s.id);stop(w,i,s);
      if(i.kind==='separate'){s.householdId=`household:${i.simId}:${i.intentId}`;s.independenceDays=0;}
      emit('moved_home',s.id,{from,to:home.id,reason:i.kind==='separate'?'independence':i.kind==='marriage_move'?'marriage':'rent_pressure',villageId:i.toVillageId});}
    if(i.kind==='rent_move')w.rentPressure[i.pressureKey??i.fromHouseholdId]=0;
    emit('household_intent_applied',i.simId,{intentId:i.intentId,kind:i.kind,from:i.fromHomeId,to:home.id,villageId:i.toVillageId,
      ...(i.kind==='separate'?{householdId:`household:${i.simId}:${i.intentId}`}:i.kind==='marriage_move'
        ?{householdId:`household:marriage:${i.coupleIds[0]}:${i.coupleIds[1]}`}:{})});
    w.householdIntents.splice(w.householdIntents.indexOf(i),1);
  }
}
