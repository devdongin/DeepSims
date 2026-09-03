// The original government's authority stays on world for saved-game compatibility.
// Additional villages own separate balances: never copies of the original treasury.
export const PRIMARY_GOVERNMENT='village:0';
export function newGovernment(){
  return {treasury:0,reputation:0,mayorId:null,policy:{},lastElectionDay:-1,
    termStartPolicy:null,lastFiscalDay:-1,playerPolicyDay:-1,campaigners:[],
    childAllowanceDay:-1,statsHistory:[],petitions:{}};
}
export function initializeGovernments(world){
  for(const v of world.villages??[])if(v.id!==PRIMARY_GOVERNMENT)v.government??=newGovernment();
}
export function initializeMunicipalHistory(world){
  if((world.villages?.length??0)<=1)return;
  for(const v of world.villages){
    if(v.id===PRIMARY_GOVERNMENT)v.statsHistory??=[];
    else {v.government.statsHistory??=[];v.government.petitions??={};}
  }
}
export function governmentFor(world,villageId=world.municipalityId??PRIMARY_GOVERNMENT){
  if(villageId==null||villageId===PRIMARY_GOVERNMENT)return world.rootWorld??world;
  const village=world.villages.find(v=>v.id===villageId);
  if(!village?.government)throw new Error(`Missing government for ${villageId}`);
  return village.government;
}
export function publicBalance(world){
  const root=world.rootWorld??world;
  return root.treasury+(root.villages??[]).reduce((n,v)=>n+(v.id===PRIMARY_GOVERNMENT?0:v.government?.treasury??0),0);
}
const FIELDS=Object.keys(newGovernment());
// Only used for local government routines. People and memories are original
// objects; monetary/policy writes go to the owning authority through accessors.
export function governmentViews(world){
  if((world.villages?.length??0)<=1)return [world];
  return world.villages.map(v=>{
    const authority=governmentFor(world,v.id);
    const sims=world.sims.filter(s=>(s.villageId??PRIMARY_GOVERNMENT)===v.id);
    const day=Math.floor(world.worldTick/1440),window=world.logic.complaints.windowDays;
    const view={...world,rootWorld:world,municipalityId:v.id,sims,
      map:{...world.map,facilities:world.map.facilities.filter(f=>(f.villageId??PRIMARY_GOVERNMENT)===v.id)},
      // Aggregate complaints have no simId. Membership evidence lives on each
      // resident's complaintDays, so don't import another town's grievances.
      complaints:(world.complaints??[]).filter(c=>sims.some(s=>s.complaintDays?.[c.kind]!==undefined
        &&day-s.complaintDays[c.kind]<=window))};
    for(const key of FIELDS)Object.defineProperty(view,key,{enumerable:true,configurable:true,
      get:()=>authority[key],set:value=>{authority[key]=value;}});
    if(v.id===PRIMARY_GOVERNMENT)Object.defineProperty(view,'statsHistory',{enumerable:true,configurable:true,
      get:()=>v.statsHistory??[],set:value=>{v.statsHistory=value;}});
    return view;
  });
}
export function changeReputation(world,delta,villageId){
  const authority=governmentFor(world,villageId);
  authority.reputation=Math.max(0,Math.min(world.logic.growth.repCap,(authority.reputation??0)+delta));
}
export function reputationVillage(world,event){
  const p=event.payload??{};
  if(p.villageId)return p.villageId;
  const facilityId=p.facilityId??p.homeId??p.placeId;
  const facility=world.map.facilities.find(f=>f.id===facilityId);
  if(facility)return facility.villageId??PRIMARY_GOVERNMENT;
  return world.sims.find(s=>s.id===event.simId)?.villageId??PRIMARY_GOVERNMENT;
}
// The global series remains global. Municipal decisions consume only their own
// observed days; founding and migration never fabricate an earlier local trend.
export function recordMunicipalStats(world,day){
  if((world.villages?.length??0)<=1)return;
  for(const local of governmentViews(world)){
    const pop=local.sims.length,ids=new Set(local.map.facilities.map(f=>f.id));
    const row={day,pop,treasury:local.treasury,reputation:local.reputation,
      avgMood:pop?Math.floor(local.sims.reduce((n,s)=>n+s.mood,0)/pop):0,
      incidents:world.incidents.filter(i=>ids.has(i.facilityId)).length};
    const history=local.statsHistory;
    if(history.at(-1)?.day===day)local.statsHistory=[...history.slice(0,-1),row];
    else local.statsHistory=[...history,row].slice(-180);
  }
}
export function governmentEmitter(view,emit){
  return view.municipalityId&&view.municipalityId!==PRIMARY_GOVERNMENT
    ?(type,id,payload)=>emit(type,id,{...payload,villageId:view.municipalityId}):emit;
}
