import { governmentFor, governmentViews, governmentEmitter, PRIMARY_GOVERNMENT } from './government.js';
import { isResidence, isAvailableResidence, plotBuildable, zoneFootprint, addBuilding } from './map.js';
import { neededSchool, SCHOOL_TYPES } from './education.js';
import { foundingSiteReserved } from './founding.js';
import { INDUSTRY_DEVELOPMENTS, industryDevelopmentEvidence, neededIndustryFacility } from './industry.js';
import { evalStationDemand, zoneAllowedTypes } from './society.js';
import { campusSiteReserved } from './center-plots.js';
import { officeConstructionDemand } from './employment.js';

export function projectMunicipality(world,project){
  if(project.foundingPetitionId!==undefined){
    const petition=world.founding.petitions.find(p=>p.id===project.foundingPetitionId);
    if(petition)return petition.villageId;
  }
  return world.plots.find(p=>p.plotId===project.plotId)?.villageId??PRIMARY_GOVERNMENT;
}
export function municipalProjectLimit(world,id){
  const G=world.logic.growth;
  return Math.max(1,Math.min(G.maxProjectSlots,1+Math.floor(governmentFor(world,id).treasury/G.slotPerTreasury)));
}
const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const capacityCache=new Map();
function plannedCapacity(type){
  if(!capacityCache.has(type)){
    const map={w:32,h:32,tiles:Array(1024).fill(0),facilities:[],reachVersion:0};
    capacityCache.set(type,addBuilding(map,type,{x:2,y:2},0).resources.length);
  }
  return capacityCache.get(type);
}

// This view is read-only planning evidence. Queued capacity is not usable beds.
export function municipalConstructionView(world,id){
  const source=governmentViews(world).find(v=>(v.municipalityId??PRIMARY_GOVERNMENT)===id);
  const local=source===world?{...world,map:{...world.map}}:source;
  local.projects=world.projects.filter(p=>projectMunicipality(world,p)===id);
  local.zoneOrders=world.zoneOrders.filter(p=>projectMunicipality(world,p)===id);
  local.plots=world.plots.filter(p=>(p.villageId??PRIMARY_GOVERNMENT)===id);
  local.transit={...world.transit};
  evalStationDemand(local,world.worldTick,()=>{});
  local.unlockedIndustries=(world.unlockedIndustries??[]).filter(id=>{
    const def=INDUSTRY_DEVELOPMENTS.find(d=>d.id===id);
    return def&&industryDevelopmentEvidence(local,def)>=world.logic.industryDevelopment[id];
  });
  return local;
}

export function planMunicipalConstruction(world,t,limits,emit){
  for(const village of world.villages){
    const id=village.id;
    while(world.projects.filter(p=>projectMunicipality(world,p)===id).length<limits.get(id)){
      const local=municipalConstructionView(world,id),L=world.logic;
      if(!local.sims.length)break;
      const busy=new Set([...world.projects,...world.zoneOrders].map(p=>p.plotId));
      const centers=[...local.map.facilities.filter(f=>['city_hall','market'].includes(f.type)),
        ...(world.centers??[]).filter(c=>(c.villageId??PRIMARY_GOVERNMENT)===id)];
      const candidates=local.plots.filter(p=>!p.used&&!busy.has(p.plotId)&&plotBuildable(world.map,p,6,5)
        &&!foundingSiteReserved(world,p,'house')&&!campusSiteReserved(world,p,'house'));
      const scores=new Map(candidates.map(p=>[p.plotId,centers.length?Math.min(...centers.map(c=>distance(p,c))):0]));
      candidates.sort((a,b)=>scores.get(a.plotId)-scores.get(b.plotId)||a.plotId-b.plotId);
      if(!candidates.length)break;
      // Paid founding capacity serves relocating households, not spare local demand.
      const pending=[...local.projects,...local.zoneOrders].filter(p=>p.foundingPetitionId===undefined);
      const capacity=(types,filter=f=>types.includes(f.type))=>local.map.facilities.filter(filter)
        .reduce((n,f)=>n+f.resources.length,0)+pending.filter(p=>types.includes(p.type))
        .reduce((n,p)=>n+plannedCapacity(p.type),0);
      // A spouse home can be reserved while already occupied. Hold its spare
      // capacity for arrival, but do not erase beds serving current residents.
      const occupiedHeldBeds=local.map.facilities.filter(f=>isResidence(f)&&f.migrationIntentId!=null)
        .reduce((n,f)=>n+Math.min(f.resources.length,local.sims.filter(s=>s.homeId===f.id).length),0);
      const beds=capacity(['house','apartment'],isAvailableResidence)+occupiedHeldBeds;
      const recent=(local.statsHistory??[]).slice(-7);
      const growth=recent.length>=2?Math.max(0,(recent.at(-1).pop-recent[0].pop)/(recent.length-1)):0;
      const headroom=Math.min(20,L.growth.headroomBeds+Math.ceil(growth*3));
      const residents=new Map(local.sims.map(s=>[s.id,s]));
      let separated=0;
      for(const s of local.sims){
        const partner=residents.get(world.partners[s.id]);
        if(partner&&s.id<partner.id&&world.partnerStage[s.id]==='married'&&s.homeId!==partner.homeId)separated++;
      }
      let type=neededSchool(local);
      if(type&&!zoneAllowedTypes(world,id).includes(type))type=null;
      if(type==='university'&&!candidates.some(p=>{
        const fp=zoneFootprint(type,0);
        return plotBuildable(world.map,p,fp.w,fp.h)&&!foundingSiteReserved(world,p,type)
          &&!campusSiteReserved(world,p,type);
      }))type=null;
      if(!type)type=neededIndustryFacility(local);
      if(!type&&local.sims.length+separated+headroom>beds)type=local.cityTier>=1?'apartment':'house';
      const employmentDemand=officeConstructionDemand(world,id);
      if(!type&&employmentDemand.unmet>0)type='office';
      if(!type&&local.sims.length>capacity(['cafe'])*L.construct.cafeRatio)type='cafe';
      if(!type&&local.sims.length>capacity(['park'])*L.construct.parkRatio)type='park';
      if(!type)break;
      const fits=type=>candidates.find(p=>{
        const fp=zoneFootprint(type,0);
        return plotBuildable(world.map,p,fp.w,fp.h)&&!foundingSiteReserved(world,p,type)&&!campusSiteReserved(world,p,type);
      });
      let plot=fits(type);
      if(!plot&&type==='apartment'){type='house';plot=fits(type);}
      if(!plot)break;
      const localEmit=governmentEmitter(local,emit),g=governmentFor(world,id);
      if(SCHOOL_TYPES.includes(type)||['office','workshop','lab','warehouse'].includes(type)){
        const cost=L.zone.costs[type];if(g.treasury<cost)break;
        g.treasury-=cost;world.externalOutflow=(world.externalOutflow??0)+cost;
        if(SCHOOL_TYPES.includes(type))localEmit('school_planned',null,{type,plotId:plot.plotId,cost,treasury:g.treasury});
        if(type==='office')localEmit('employment_construction_planned',null,{plotId:plot.plotId,cost,treasury:g.treasury,...employmentDemand});
      }
      const base=L.construct.requiredByType?.[type]??L.construct.laborRequired;
      const required=g.mayorId!==null?Math.floor(base*L.election.mayorLaborPct/100):base;
      world.projects.push({plotId:plot.plotId,type,progress:0,required});
      localEmit('project_started',null,{plotId:plot.plotId,type,x:plot.x,y:plot.y,required});
    }
  }
}
