import {isAvailableResidence,sameRegion} from './map.js';

// Marriage joins spouses and their cohabiting minor descendants, not roommates/parents.
export function planMarriedHousehold(w,coupleIds,targetHomeId){
  const couple=coupleIds.map(id=>w.sims.find(s=>s.id===id));
  if(couple.some(s=>!s||s.traits.age<19))return {ok:false,reason:'couple_changed'};
  if(couple.some((s,n)=>w.partnerStage[s.id]!=='married'||w.partners[s.id]!==couple[1-n].id))
    return {ok:false,reason:'couple_changed'};
  const group=[...couple],ids=new Set(coupleIds);
  for(let n=0;n<group.length;n++)for(const s of w.sims){
    if(!ids.has(s.id)&&s.traits.age<19&&s.homeId===group[n].homeId&&(w.parents[s.id]??[]).includes(group[n].id)){
      group.push(s);ids.add(s.id);
    }
  }
  const familyResidents=group.sort((a,b)=>a.id-b.id).map(s=>({
    simId:s.id,homeId:s.homeId,householdId:s.householdId,villageId:s.villageId,
  }));
  return {ok:true,familyResidents,residents:familyResidents.filter(s=>s.homeId!==targetHomeId)};
}
export const marriageHomeResidents=(w,id)=>w.sims.filter(s=>s.homeId===id).map(s=>s.id).sort((a,b)=>a-b);

// Return true when a cross-town attempt (or pending move) owns this cohabitation.
// False keeps the existing local romance path and its RNG/event ordering.
export function queueMarriageMigration(w,lo,hi,t,emit,allowFresh){
  if(w.villages.length<2||lo.homeId===hi.homeId)return false;
  const coupleIds=[lo.id,hi.id],base=planMarriedHousehold(w,coupleIds,null);
  if(!base.ok)return true;
  const familyIds=base.familyResidents.map(s=>s.simId);
  if(w.householdIntents.some(i=>(i.familyResidents?.map(s=>s.simId)??i.memberIds??[i.simId]).some(id=>familyIds.includes(id))))return true;
  const loHome=w.map.facilities.find(f=>f.id===lo.homeId);
  const free=h=>h.resources.length-marriageHomeResidents(w,h.id).length;
  const legacy=loHome&&isAvailableResidence(loHome)&&free(loHome)>0?loHome
    :allowFresh?w.map.facilities.find(h=>isAvailableResidence(h)&&free(h)>=2):null;
  if(legacy&&[lo,hi].every(s=>s.villageId===legacy.villageId))return false;
  const candidates=[loHome,...(allowFresh?w.map.facilities:[])];
  const target=candidates.find(h=>{
    if(!h||!isAvailableResidence(h)||!w.villages.some(v=>v.id===h.villageId)||w.incidents.some(j=>j.facilityId===h.id))return false;
    const moving=base.familyResidents.filter(s=>s.homeId!==h.id);
    if(!moving.length||free(h)<moving.length)return false;
    return moving.every(r=>{
      const origin=w.map.facilities.find(f=>f.id===r.homeId),s=w.sims.find(s=>s.id===r.simId);
      return origin&&sameRegion(w.map,origin.door.x,origin.door.y,h.door.x,h.door.y)
        &&sameRegion(w.map,s.x,s.y,h.door.x,h.door.y);
    });
  });
  if(!target)return true; // No feasible home yet; the normal married retry remains available.
  const family=planMarriedHousehold(w,coupleIds,target.id),first=family.residents[0];
  const intent={intentId:w.nextHouseholdIntentId++,kind:'marriage_move',simId:first.simId,coupleIds,
    fromHomeId:first.homeId,fromHouseholdId:first.householdId,targetHomeId:target.id,
    memberIds:family.residents.map(s=>s.simId),familyResidents:family.familyResidents,
    destinationResidents:marriageHomeResidents(w,target.id),createdTick:t,applyTick:t+1};
  w.householdIntents.push(intent);emit('household_intent_created',intent.simId,{...intent});
  return true;
}
