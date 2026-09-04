import {isResidence,isAvailableResidence,sameRegion} from './map.js';
import {syncResidenceVillage} from './villages.js';
import {recordFact} from './cognition.js';
import {isSettlementInTransit} from './settlement.js';
import {planSettlementHouseholds} from './settlement-households.js';
import {beginHouseholdMigration} from './household-migration.js';
const compare=(a,b)=>a<b?-1:a>b?1:0;
function committed(w,id){
  return isSettlementInTransit(w,id)
    ||w.householdIntents.some(i=>(i.familyResidents?.map(r=>r.simId)??i.memberIds??[i.simId]).includes(id))
    ||w.founding.petitions.some(p=>['building','awaiting_settlement'].includes(p.status)
      &&p.plan?.residents?.some(r=>r.simId===id));
}

export function assignCompletedResidence(w,home,t,emit){
  if(!isAvailableResidence(home))return;
  const crowded=w.map.facilities.filter(f=>isResidence(f)&&f.id!==home.id).map(f=>{
    const residents=w.sims.filter(s=>s.homeId===f.id);
    return {home:f,residents,over:residents.length-f.resources.length};
  }).filter(row=>row.over>0).sort((a,b)=>b.over-a.over||compare(a.home.id,b.home.id));
  const deferred={};
  const count=reason=>deferred[reason]=(deferred[reason]??0)+1;
  for(const row of crowded){
    const seen=new Set();
    for(const mover of [...row.residents].sort((a,b)=>b.id-a.id)){
      if(seen.has(mover.id))continue;
      if(committed(w,mover.id)){count('migration_conflict');continue;}
      if(row.home.villageId===home.villageId||w.villages.length<2){
        // Preserve the documented local completion-tick move/event ordering.
        mover.homeId=home.id;syncResidenceVillage(w,mover.id);
        emit('moved_home',mover.id,{from:row.home.id,to:home.id});
        recordFact(mover,t,w.logic,'built_bed',{placeId:home.id,tags:['home']});return;
      }
      const family=planSettlementHouseholds(w,[mover.id],row.home.villageId);
      if(!family.ok){count(family.reason);continue;}
      for(const r of family.residents)seen.add(r.simId);
      if(family.residents.length>home.resources.length){count('household_capacity');continue;}
      if(family.residents.some(r=>committed(w,r.simId))){count('migration_conflict');continue;}
      if(family.residents.some(r=>{
        const source=w.map.facilities.find(f=>f.id===r.homeId),s=w.sims.find(s=>s.id===r.simId);
        return !source||!sameRegion(w.map,source.door.x,source.door.y,home.door.x,home.door.y)
          ||!sameRegion(w.map,s.x,s.y,home.door.x,home.door.y);
      })){count('route_changed');continue;}
      const intent={intentId:w.nextHouseholdIntentId++,kind:'construction_move',simId:mover.id,
        memberIds:family.residents.map(r=>r.simId),fromHomeId:row.home.id,fromHouseholdId:mover.householdId,
        targetHomeId:home.id,createdTick:t,applyTick:t+1};
      w.householdIntents.push(intent);emit('household_intent_created',mover.id,{...intent});
      // Reserve at completion, before the same tick's immigration/other projects.
      // The gather/travel stage runs at the next tick's normal relocation step.
      const reason=beginHouseholdMigration(w,intent,home,t,emit);
      if(!reason)return;
      w.householdIntents.splice(w.householdIntents.indexOf(intent),1);
      w.householdDaily.failures[reason]=(w.householdDaily.failures[reason]??0)+1;
      emit('household_intent_failed',mover.id,{intentId:intent.intentId,kind:intent.kind,reason});count(reason);
    }
  }
  if(Object.keys(deferred).length)emit('construction_relocation_deferred',null,{homeId:home.id,reasons:deferred});
}
