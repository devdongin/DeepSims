// A new household follows the departing adult, not every member of the parents' household.
export function planIndependentHousehold(world,simId,villageId){
  const first=world.sims.find(s=>s.id===simId);
  if(!first)return {ok:false,reason:'person_missing'};
  if(first.traits.age<world.logic.household.independenceAge)return {ok:false,reason:'not_adult'};
  const parent=world.sims.find(s=>(world.parents[first.id]??[]).includes(s.id)&&s.homeId===first.homeId);
  if(!parent)return {ok:false,reason:'parent_not_cohabiting'};
  const group=[first],ids=new Set([first.id]);
  for(let i=0;i<group.length;i++)for(const s of world.sims){
    if(ids.has(s.id))continue;
    const member=group[i];
    const spouse=world.partnerStage[member.id]==='married'&&world.partners[member.id]===s.id;
    const child=s.traits.age<19&&s.homeId===member.homeId&&(world.parents[s.id]??[]).includes(member.id);
    if(spouse||child){group.push(s);ids.add(s.id);}
  }
  if(group.some(s=>s.villageId!==villageId))return {ok:false,reason:'household_split'};
  return {ok:true,residents:group.sort((a,b)=>a.id-b.id).map(s=>({
    simId:s.id,homeId:s.homeId,householdId:s.householdId,
  }))};
}
