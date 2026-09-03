// The original government's authority stays on world for saved-game compatibility.
// Additional villages own separate balances: never copies of the original treasury.
export const PRIMARY_GOVERNMENT='village:0';
export function newGovernment(){
  return {treasury:0,reputation:0,mayorId:null,policy:{},lastElectionDay:-1,
    termStartPolicy:null,lastFiscalDay:-1,playerPolicyDay:-1,campaigners:[],
    childAllowanceDay:-1,statsHistory:[]};
}
export function initializeGovernments(world){
  for(const v of world.villages??[])if(v.id!==PRIMARY_GOVERNMENT)v.government??=newGovernment();
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
    return view;
  });
}
export function governmentEmitter(view,emit){
  return view.municipalityId&&view.municipalityId!==PRIMARY_GOVERNMENT
    ?(type,id,payload)=>emit(type,id,{...payload,villageId:view.municipalityId}):emit;
}
