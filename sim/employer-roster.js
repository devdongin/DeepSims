import {canWork} from './education.js';
import {PRIMARY_GOVERNMENT} from './government.js';

const belongs=x=>x.villageId??PRIMARY_GOVERNMENT;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
// Read-only physical headcounts. A resident in town A employed in town B occupies
// B's capacity, not A's. Public staffing quotas are not desk counts: leave their
// capacity null here rather than invent a per-building public job limit.
export function employerRoster(world){
  const root=world.rootWorld??world,L=root.logic;
  const facilities=[...root.map.facilities].sort((a,b)=>cmp(a.id,b.id));
  const byId=new Map(facilities.map(f=>[f.id,f])),workers=new Map(),unassigned=[];
  for(const s of [...root.sims].sort((a,b)=>a.id-b.id)){
    const types=[].concat(L.workplace[s.traits.occupation]??[]);
    if(!canWork(s)||!types.length||!(L.occupations[s.traits.occupation]?.wagePct>0))continue;
    const job=s.employment,f=byId.get(job?.facilityId);
    if(!job||job.occupation!==s.traits.occupation||!f||!types.includes(f.type)){
      unassigned.push({simId:s.id,villageId:belongs(s),occupation:s.traits.occupation});continue;
    }
    const list=workers.get(f.id)??[];list.push(s);workers.set(f.id,list);
  }
  return {unassigned,facilities:facilities.map(f=>{
    const list=workers.get(f.id)??[],villageId=belongs(f);
    const capacity=f.type==='office'?f.resources.length
      :Object.hasOwn(L.industry.openings,f.type)?L.industry.workersPerFacility:null;
    return {facilityId:f.id,type:f.type,villageId,capacity,workers:list.length,
      workerIds:list.map(s=>s.id),localWorkers:list.filter(s=>belongs(s)===villageId).length,
      commuterWorkers:list.filter(s=>belongs(s)!==villageId).length,
      vacancies:capacity===null?null:Math.max(0,capacity-list.length),
      overCapacity:capacity===null?null:Math.max(0,list.length-capacity)};
  })};
}
