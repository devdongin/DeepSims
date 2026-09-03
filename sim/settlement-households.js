// #32 Labor is adult-only; relocation includes the whole existing household.
// No person, relationship, bed or currency is created by this planning step.
import { serialize } from './serialize.js';
export function planSettlementHouseholds(world,workerIds,villageId){
  const byId=new Map(world.sims.map(s=>[s.id,s]));
  const groups=[];
  const linked=(a,b)=>a.householdId===b.householdId
    ||(world.partnerStage[a.id]==='married'&&world.partners[a.id]===b.id)
    ||(a.homeId===b.homeId&&((a.traits.age<19&&(world.parents[a.id]??[]).includes(b.id))
      ||(b.traits.age<19&&(world.parents[b.id]??[]).includes(a.id))));
  const assigned=new Set();
  for(const id of [...workerIds].sort((a,b)=>a-b)){
    if(assigned.has(id))continue;
    const first=byId.get(id);if(!first)return {ok:false,reason:'settlers_changed'};
    const group=[first];assigned.add(id);
    for(let i=0;i<group.length;i++)for(const s of world.sims){
      if(!assigned.has(s.id)&&linked(group[i],s)){group.push(s);assigned.add(s.id);}
    }
    if(group.some(s=>s.villageId!==villageId))return {ok:false,reason:'household_split'};
    group.sort((a,b)=>a.id-b.id);groups.push(group);
  }
  groups.sort((a,b)=>a[0].id-b[0].id);
  const homes=[];
  for(const group of groups){
    const adults=group.filter(s=>s.traits.age>=19),minors=group.filter(s=>s.traits.age<19);
    const capacity=group.length<=2?2:8,count=Math.ceil(group.length/capacity);
    if(adults.length<count)return {ok:false,reason:'household_capacity'};
    const units=Array.from({length:count},(_,i)=>[adults[i]]);
    // Each unit keeps an adult caregiver. Household identity remains unchanged
    // even for a large family occupying adjacent apartments in the same village.
    for(const member of [...adults.slice(count),...minors]){
      units.find(unit=>unit.length<capacity).push(member);
    }
    for(const unit of units)homes.push({type:capacity===2?'house':'apartment',
      residentIds:unit.map(s=>s.id).sort((a,b)=>a-b)});
  }
  const residentIds=groups.flat().map(s=>s.id).sort((a,b)=>a-b);
  if(workerIds.some(id=>!residentIds.includes(id)))return {ok:false,reason:'settlers_changed'};
  return {ok:true,homes,residents:residentIds.map(id=>{
    const s=byId.get(id);return {simId:id,homeId:s.homeId,householdId:s.householdId};
  })};
}

export function settlementHouseholdsUnchanged(world,plan,villageId){
  if(!plan.residents||!plan.homes)return false;
  const current=planSettlementHouseholds(world,plan.settlerIds,villageId);
  return current.ok&&serialize(current.residents)===serialize(plan.residents)
    &&serialize(current.homes)===serialize(plan.homes.map(({type,residentIds})=>({type,residentIds})));
}
