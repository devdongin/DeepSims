// Labor evidence and capacity-bound recruitment. Labor supply is not consumer
// demand. Do not add jobseeker counts to unmet purchases.
import {canWork} from './education.js';
import {occupationAllowed} from './traits.js';
import {PRIMARY_GOVERNMENT} from './government.js';
import {sameRegion} from './map.js';
import {aptitudeFor} from './abilities.js';
import {dayHash} from './chrono.js';

// Existing office construction creates four resources. Pending seats prevent
// duplicate orders, but are never usable recruitment capacity before completion.
export const PLANNED_OFFICE_SEATS=4;
export function officeConstructionDemand(world,villageId=world.municipalityId??PRIMARY_GOVERNMENT,evidence=null){
  const root=world.rootWorld??world,L=root.logic;
  const rows=employmentStatus(root),row=evidence??rows.find(r=>r.villageId===villageId);
  if(!row)return {workers:0,jobseekers:0,servicePlacements:0,capacity:0,pendingCapacity:0,unmet:0};
  const office=row.sectors.find(s=>s.type==='office');
  const allSeekers=office.hiringPath?root.sims.filter(s=>s.traits.occupation==='jobless'&&canWork(s)&&s.traits.age<L.society.retireAge
    &&occupationAllowed('office_worker',s.traits.age)).sort((a,b)=>a.id-b.id):[];
  const seekers=allSeekers.filter(s=>(s.villageId??PRIMARY_GOVERNMENT)===villageId);
  const remaining=new Set(allSeekers.map(s=>s.id));
  // Recruitment counts service workers globally. Reserve each real global slot
  // and seeker only once, even when workers live outside the facility's town.
  // Recompute the same deterministic allocation for every municipality view.
  for(const sector of row.sectors.filter(s=>s.type!=='office')){
    let vacancies=Math.max(0,root.map.facilities.filter(f=>f.type===sector.type).length*L.industry.workersPerFacility
      -root.sims.filter(s=>s.traits.occupation===sector.occupation).length);
    const localVacancies=new Map(rows.map(r=>[r.villageId,r.sectors.find(s=>s.type===sector.type).recruitmentVacancies]));
    const candidates=[...allSeekers].sort((a,b)=>aptitudeFor(b,sector.occupation,L)-aptitudeFor(a,sector.occupation,L)||a.id-b.id);
    for(const s of candidates){
      if(!vacancies)break;
      if(!remaining.has(s.id)||!occupationAllowed(sector.occupation,s.traits.age))continue;
      const id=s.villageId??PRIMARY_GOVERNMENT,local=localVacancies.get(id)??0;
      const pct=Math.min(L.industry.switchMaxPct,Math.floor(aptitudeFor(s,sector.occupation,L)*L.industry.switchPctPerApt/100));
      if(local<=0||pct<=0)continue;
      localVacancies.set(id,local-1);
      remaining.delete(s.id);vacancies--;
    }
  }
  const pendingCapacity=office.pendingFacilities*PLANNED_OFFICE_SEATS;
  const unplaced=seekers.filter(s=>remaining.has(s.id)).length;
  return {workers:office.workers,jobseekers:seekers.length,servicePlacements:seekers.length-unplaced,
    capacity:office.capacity,pendingCapacity,
    unmet:Math.max(0,office.workers+unplaced-office.capacity-pendingCapacity)};
}

// Offices already belong to the export/base-wage economy. Hiring only grants
// the occupation: wages still require actual work through the existing ledger.
export function recruitOfficeWorkers(world,t,day,emit){
  const L=world.logic,I=L.industry,belongs=x=>x.villageId??PRIMARY_GOVERNMENT;
  if(L.workplace.office_worker!=='office'||L.occupations.office_worker.wagePct<=0)return;
  const offices=world.map.facilities.filter(f=>f.type==='office'
    &&!world.incidents.some(i=>i.facilityId===f.id));
  const isWorker=s=>canWork(s)&&L.workplace[s.traits.occupation]==='office'
    &&L.occupations[s.traits.occupation].wagePct>0;
  let globalWorkers=world.sims.filter(isWorker).length;
  const globalCapacity=offices.reduce((n,f)=>n+f.resources.length,0);
  for(const villageId of [...new Set(offices.map(belongs))].sort()){
    if(globalWorkers>=globalCapacity)break;
    const local=offices.filter(f=>belongs(f)===villageId);
    const workers=world.sims.filter(s=>belongs(s)===villageId&&isWorker(s)).length;
    const candidates=world.sims.filter(s=>belongs(s)===villageId&&s.traits.occupation==='jobless'
      &&canWork(s)&&s.traits.age<L.society.retireAge&&occupationAllowed('office_worker',s.traits.age)
      &&local.reduce((n,f)=>n+f.resources.filter(r=>sameRegion(world.map,s.x,s.y,r.x,r.y)).length,0)>workers);
    candidates.sort((a,b)=>aptitudeFor(b,'office_worker',L)-aptitudeFor(a,'office_worker',L)||a.id-b.id);
    const s=candidates[0];if(!s)continue;
    const aptitude=aptitudeFor(s,'office_worker',L);
    const pct=Math.min(I.switchMaxPct,Math.floor(aptitude*I.switchPctPerApt/100));
    if(dayHash(s.id,day,53)>=pct)continue;
    s.traits.occupation='office_worker';s.unpaidDays=0;globalWorkers++;
    emit('job_changed',s.id,{from:'jobless',to:'office_worker',facilityType:'office',
      aptitude,villageId,reason:'existing_office_capacity'});
  }
}

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
      const demandBacked=type==='office'||revenue>=L.industry.minRevenueToHire
        ||(['workshop','lab','warehouse'].includes(type)&&root.unlockedIndustries?.includes(type))||false;
      const hiringPath=type!=='office'||(L.workplace.office_worker==='office'&&L.occupations.office_worker.wagePct>0);
      const vacantCapacity=Math.max(0,capacity-workers);
      const recruitmentCapacity=type==='office'?sites.filter(f=>!root.incidents.some(i=>i.facilityId===f.id))
        .reduce((n,f)=>n+f.resources.length,0):capacity;
      return {type,occupation,facilities:sites.length,capacity,workers,vacantCapacity,
        eligibleApplicants:seekers.filter(s=>occupationAllowed(occupation,s.traits.age)).length,
        revenue,demandBacked,hiringPath,
        recruitmentCapacity,
        recruitmentVacancies:hiringPath&&demandBacked?Math.max(0,recruitmentCapacity-workers):0,
        pendingFacilities:[...pending.values()].filter(p=>p.type===type).length};
    });
    return {villageId,scope:'resident-local-capacity-proxy',jobless:jobless.length,eligibleJobless:seekers.length,
      ineligibleJobless:jobless.length-seekers.length,sectors};
  });
}
