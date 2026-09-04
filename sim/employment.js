// Read-only labor evidence. Labor supply is not consumer demand, and a desk is
// not an executable hiring path. Do not add these counts to unmet purchases.
import {canWork} from './education.js';
import {occupationAllowed} from './traits.js';
import {PRIMARY_GOVERNMENT} from './government.js';

export function employmentStatus(world){
  const root=world.rootWorld??world,L=root.logic;
  const belongs=x=>x.villageId??PRIMARY_GOVERNMENT;
  const ids=[...new Set([PRIMARY_GOVERNMENT,...(root.villages??[]).map(v=>v.id)])].sort();
  const plotOwners=new Map(root.plots.map(p=>[p.plotId,belongs(p)]));
  return ids.map(villageId=>{
    const residents=root.sims.filter(s=>belongs(s)===villageId);
    const jobless=residents.filter(s=>s.traits.occupation==='jobless');
    const seekers=jobless.filter(s=>canWork(s)&&s.traits.age<L.society.retireAge);
    const facilities=root.map.facilities.filter(f=>belongs(f)===villageId);
    const pending=new Map();
    for(const p of [...root.projects,...root.zoneOrders]){
      if(p.foundingPetitionId!=null||plotOwners.get(p.plotId)!==villageId)continue;
      if(!pending.has(p.plotId))pending.set(p.plotId,p);
    }
    const sectors=['office',...Object.keys(L.industry.openings).filter(t=>t!=='office')].sort().map(type=>{
      const occupation=type==='office'?'office_worker':L.industry.openings[type];
      const sites=facilities.filter(f=>f.type===type);
      // Initial offices use legacy `slot` resources; work accepts those too.
      const capacity=type==='office'?sites.reduce((n,f)=>n+f.resources.length,0)
        :sites.length*L.industry.workersPerFacility;
      // There is no employer assignment yet (#112): resident occupation counts
      // are a planning proxy, not measured occupied seats or commuting flows.
      const workers=residents.filter(s=>canWork(s)&&(type==='office'
        ?L.workplace[s.traits.occupation]==='office'&&L.occupations[s.traits.occupation].wagePct>0
        :s.traits.occupation===occupation)).length;
      const revenue=sites.reduce((n,f)=>n+(f.revenue??0),0);
      const demandBacked=type!=='office'&&(revenue>=L.industry.minRevenueToHire
        ||(['workshop','lab','warehouse'].includes(type)&&root.unlockedIndustries?.includes(type))||false);
      const hiringPath=type!=='office'; // maybeJobSwitch currently has no office opening.
      const vacantCapacity=Math.max(0,capacity-workers);
      return {type,occupation,facilities:sites.length,capacity,workers,vacantCapacity,
        eligibleApplicants:seekers.filter(s=>occupationAllowed(occupation,s.traits.age)).length,
        revenue,demandBacked,hiringPath,
        recruitmentVacancies:hiringPath&&demandBacked?vacantCapacity:0,
        pendingFacilities:[...pending.values()].filter(p=>p.type===type).length};
    });
    return {villageId,scope:'resident-local-capacity-proxy',jobless:jobless.length,eligibleJobless:seekers.length,
      ineligibleJobless:jobless.length-seekers.length,sectors};
  });
}
