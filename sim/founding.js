// #32 Founding evidence. This measures actual capacity; it does not create
// residents, grant funds, or claim a settlement exists.
import { canWork } from './education.js';
import { isResidence, plotBuildable, zoneFootprint, sameRegion, addBuilding } from './map.js';
import { PRIMARY_VILLAGE_ID } from './villages.js';
import { emptyState } from './simfactory.js';
import { planSettlementHouseholds, settlementHouseholdsUnchanged } from './settlement-households.js';

const active=p=>['pending','approved','building','awaiting_settlement'].includes(p.status);

export function newFoundingState() {
  return { nextPetitionId: 0, lastDay: -1, pressure: {}, petitions: [] };
}

// Shared HTTP/simulation shape validation; world-dependent checks happen when
// the durable command is applied, not when it is admitted to the input queue.
export function validateFoundingDecision(payload) {
  const fail=error=>({ok:false,error});
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return fail('bad_payload');
  if(!Number.isSafeInteger(payload.petitionId)||payload.petitionId<0)return fail('bad_petition');
  if(!['approve','reject'].includes(payload.decision))return fail('bad_decision');
  const keys=payload.decision==='approve'?['petitionId','decision','homePlotIds','name']:['petitionId','decision','reason'];
  if(Object.keys(payload).some(k=>!keys.includes(k)))return fail('unknown_field');
  if(payload.decision==='reject'){
    if(payload.reason!==undefined&&!['not_now','site_unsuitable','budget_priority'].includes(payload.reason))return fail('bad_reason');
  }else{
    if(typeof payload.name!=='string'||payload.name!==payload.name.trim()||!payload.name.length
      ||payload.name.length>40||/[\u0000-\u001f\u007f<>]/.test(payload.name))return fail('bad_name');
    if(!Array.isArray(payload.homePlotIds)||!payload.homePlotIds.length||payload.homePlotIds.length>50000
      ||payload.homePlotIds.some(id=>!Number.isSafeInteger(id)||id<0)
      ||new Set(payload.homePlotIds).size!==payload.homePlotIds.length)return fail('invalid_sites');
  }
  return {ok:true};
}

export function applyFoundingDecision(world, payload, t, emit) {
  const reject=reason=>emit('input_rejected',null,{command:'found_village',reason});
  const shape=validateFoundingDecision(payload);
  if(!shape.ok){reject(shape.error);return;}
  const petition=world.founding.petitions.find(p=>p.id===payload.petitionId&&p.status==='pending');
  if(!petition){reject('no_pending_petition');return;}
  if(payload.decision==='reject'){
    petition.status='rejected';petition.resolvedTick=t;petition.reason=payload.reason??'not_now';
    const pressure=world.founding.pressure[petition.villageId];
    if(pressure)pressure.days=0; // A new request needs fresh constrained days.
    emit('founding_rejected',petition.petitionerId,{petitionId:petition.id,reason:petition.reason});
    return;
  }
  if(world.villages.some(v=>v.name===payload.name)
    ||world.founding.petitions.some(p=>active(p)&&p.plan?.name===payload.name)){
    reject('duplicate_name');return;
  }
  const quote=quoteFoundingSites(world,petition.id,payload.homePlotIds);
  if(!quote.ok){reject(quote.reason);return;}
  // Approval is durable authorization, not construction or a new village.
  // Dispatch must revalidate and fund this plan before reserving any site.
  petition.status='approved';petition.approvedTick=t;
  petition.plan={name:payload.name,homePlotIds:quote.homePlotIds,settlerIds:quote.settlerIds,
    residents:quote.residents,homes:quote.homes,quotedCost:quote.cost};
  emit('founding_approved',petition.petitionerId,{petitionId:petition.id,name:payload.name,
    homePlotIds:[...quote.homePlotIds],settlerIds:[...quote.settlerIds],quotedCost:quote.cost});
}

// Approval must validate all homes and the full price before any mutation.
// “자체 시장” in #32 means an independent mayor, not a retail market.
// The caller will consume this quote in the durable approval path.
export function quoteFoundingSites(world, petitionId, homePlotIds, status='pending') {
  const fail=reason=>({ok:false,reason});
  const petition=world.founding.petitions.find(p=>p.id===petitionId&&p.status===status);
  if(!petition)return fail('no_pending_petition');
  const source=world.villages.find(v=>v.id===petition.villageId);
  if(!source)return fail('no_source_village');
  const count=world.logic.founding.minSettlers;
  if(!Array.isArray(homePlotIds)||!homePlotIds.length
    ||homePlotIds.some(id=>!Number.isSafeInteger(id))
    ||new Set(homePlotIds).size!==homePlotIds.length)return fail('invalid_sites');
  const plots=[...homePlotIds].sort((a,b)=>a-b).map(id=>world.plots.find(p=>p.plotId===id));
  if(plots.some(p=>!p||p.used))return fail('site_unavailable');
  const busy=new Set([...world.projects,...world.zoneOrders].map(p=>p.plotId));
  if(plots.some(p=>busy.has(p.plotId)))return fail('site_reserved');
  if(plots.some(p=>foundingSiteReserved(world,p)))return fail('site_reserved');
  if(plots.some(p=>!sameRegion(world.map,source.center.x,source.center.y,p.x,p.y)))return fail('unreachable');
  const evidence=foundingEvidence(world,source.id);
  const eligible=evidence.eligibleSettlerIds.filter(id=>{
    const s=world.sims.find(s=>s.id===id);
    return sameRegion(world.map,s.x,s.y,plots[0].x,plots[0].y);
  });
  if(eligible.length<count)return fail('no_settlers');
  const workers=status==='approved'?petition.plan.settlerIds:eligible.slice(0,count);
  if(workers.length!==count||workers.some(id=>!eligible.includes(id)))return fail('settlers_changed');
  const family=planSettlementHouseholds(world,workers,source.id);
  if(!family.ok)return fail(family.reason);
  if(plots.length!==family.homes.length)return fail('invalid_sites');
  const shapes=family.homes.map(h=>zoneFootprint(h.type,0));
  if(plots.some((p,i)=>!plotBuildable(world.map,p,shapes[i].w,shapes[i].h)))return fail('not_buildable');
  const overlaps=(a,sa,b,sb)=>a.x<b.x+sb.w&&b.x<a.x+sa.w&&a.y<b.y+sb.h&&b.y<a.y+sa.h;
  for(let i=0;i<plots.length;i++)for(let j=0;j<i;j++){
    if(overlaps(plots[i],shapes[i],plots[j],shapes[j]))return fail('sites_overlap');
  }
  for(const order of [...world.projects,...world.zoneOrders]){
    const reserved=world.plots.find(p=>p.plotId===order.plotId);
    if(reserved&&plots.some((p,i)=>overlaps(p,shapes[i],reserved,zoneFootprint(order.type,order.dir??0))))return fail('site_reserved');
  }
  const distance=(p,q)=>Math.abs(p.x-q.x)+Math.abs(p.y-q.y);
  const radius=world.logic.zone.centerRadius;
  if(plots.some(p=>world.villages.some(v=>distance(p,v.center)<radius*2)
    ||distance(p,plots[0])>radius))return fail('invalid_distance');
  if(plots.some(p=>!sameRegion(world.map,source.center.x,source.center.y,p.x,p.y)))return fail('unreachable');
  // Empty grass can be reachable while the completed houses wall off their own
  // doors. Preview all footprints together without touching the live map.
  const preview={...world.map,tiles:world.map.tiles.slice(),facilities:[...world.map.facilities]};
  const homes=plots.map((p,i)=>addBuilding(preview,family.homes[i].type,p,0));
  if(homes.some(f=>!sameRegion(preview,source.center.x,source.center.y,f.door.x,f.door.y)))return fail('blocked_entrance');
  if(evidence.population<evidence.beds||evidence.vacantHomes||evidence.localBuildablePlots||evidence.pendingHomes)return fail('conditions_changed');
  const cost=family.homes.reduce((n,h)=>n+world.logic.zone.costs[h.type],0);
  if(!Number.isSafeInteger(cost)||cost<0||world.treasury<cost)return fail('treasury_short');
  return {ok:true,petitionId,sourceVillageId:source.id,homePlotIds:plots.map(p=>p.plotId),cost,
    settlerIds:[...workers],residents:family.residents,
    homes:family.homes.map((h,i)=>({...h,plotId:plots[i].plotId}))};
}

// A paid founding site cannot be stolen by a later zone order or by an
// overlapping plot with a different id. Ordinary paths use this same guard.
export function foundingSiteReserved(world, plot, type='house', dir=0, ownPetitionId=null) {
  const shape=zoneFootprint(type,dir);
  return world.plots.some(p=>{
    if(p.foundingPetitionId==null||p.foundingPetitionId===ownPetitionId)return false;
    const reserved=zoneFootprint(p.foundingType??'house',0),doorX=p.x+(p.foundingType==='apartment'?3:2);
    return (plot.x<p.x+reserved.w&&p.x<plot.x+shape.w&&plot.y<p.y+reserved.h&&p.y<plot.y+shape.h)
      ||(doorX>=plot.x&&doorX<plot.x+shape.w&&p.y+reserved.h>=plot.y&&p.y+reserved.h<plot.y+shape.h);
  });
}

export function fundFoundingPlans(world,t,emit){
  for(const p of world.founding.petitions.filter(p=>p.status==='building')){
    if(p.plan.settlerIds.some(id=>{
      const s=world.sims.find(s=>s.id===id);
      return !s||!canWork(s)||s.villageId!==p.villageId;
    }))cancelFoundingConstruction(world,p.id,'settlers_changed',t,emit);
    else if(!settlementHouseholdsUnchanged(world,p.plan,p.villageId))cancelFoundingConstruction(world,p.id,'household_changed',t,emit);
  }
  for(const petition of world.founding.petitions.filter(p=>p.status==='approved'&&p.approvedTick<t)
    .sort((a,b)=>a.id-b.id)){
    const plan=petition.plan;
    const quote=quoteFoundingSites(world,petition.id,plan.homePlotIds,'approved');
    let reason=quote.ok?null:quote.reason;
    if(!reason&&!settlementHouseholdsUnchanged(world,plan,petition.villageId))reason='household_changed';
    if(!reason&&quote.cost>plan.quotedCost)reason='quote_expired';
    if(!reason&&plan.homePlotIds.some(id=>foundingSiteReserved(world,world.plots.find(p=>p.plotId===id))))reason='site_reserved';
    const target=world.plots.find(p=>p.plotId===plan.homePlotIds[0]);
    if(!reason&&(plan.settlerIds.length!==world.logic.founding.minSettlers||plan.settlerIds.some(id=>{
      const sim=world.sims.find(s=>s.id===id);
      return !sim||sim.villageId!==petition.villageId||!canWork(sim)
        ||!sameRegion(world.map,sim.x,sim.y,target.x,target.y);
    })))reason='settlers_changed';
    if(reason){
      petition.status='cancelled';petition.resolvedTick=t;petition.reason=reason;
      const pressure=world.founding.pressure[petition.villageId];if(pressure)pressure.days=0;
      emit('founding_cancelled',petition.petitionerId,{petitionId:petition.id,reason});continue;
    }
    // All checks precede the single payment; construction costs use the same
    // external-contractor accounting as normal paid zoning. No new wallet.
    world.treasury-=quote.cost;world.externalOutflow=(world.externalOutflow??0)+quote.cost;
    petition.status='building';plan.fundedTick=t;plan.fundedCost=quote.cost;plan.completedHomeIds=[];plan.completedHomes=[];
    for(const {plotId,type} of plan.homes){
      const plot=world.plots.find(p=>p.plotId===plotId);plot.foundingPetitionId=petition.id;plot.foundingType=type;
      world.zoneOrders.push({plotId,type,dir:0,foundingPetitionId:petition.id,
        fundedCost:world.logic.zone.costs[type]});
    }
    emit('founding_funded',petition.petitionerId,{petitionId:petition.id,cost:quote.cost,
      plotIds:[...plan.homePlotIds],settlerIds:[...plan.settlerIds]});
  }
}

export function foundingWorkerAllowed(world,sim,project){
  if(project.foundingPetitionId===undefined)return true;
  const p=world.founding.petitions.find(p=>p.id===project.foundingPetitionId);
  return p?.status==='building'&&canWork(sim)&&p.plan.settlerIds.includes(sim.id);
}

export function recordFoundingHome(world,project,fac,t,emit){
  if(project.foundingPetitionId===undefined)return;
  const p=world.founding.petitions.find(p=>p.id===project.foundingPetitionId);
  fac.foundingPetitionId=project.foundingPetitionId; // unavailable until actual settlement
  if(!p||p.status!=='building')return;
  endFoundingWorkAt(world,new Set([project.plotId]));
  p.plan.completedHomeIds.push(fac.id);
  p.plan.completedHomes.push({plotId:project.plotId,homeId:fac.id});
  if(p.plan.completedHomeIds.length===p.plan.homePlotIds.length){
    p.status='awaiting_settlement';p.plan.builtTick=t;
    emit('founding_homes_built',p.petitionerId,{petitionId:p.id,homeIds:[...p.plan.completedHomeIds]});
  }
}

function endFoundingWorkAt(world,plotIds){
  for(const sim of world.sims){
    const state=sim.state,match=/^p(\d+):spot[0-3]$/.exec(state.resourceId??'');
    if(state.facilityId!=='site'||!match||!plotIds.has(Number(match[1])))continue;
    const key=`site:${state.resourceId}`;
    if(world.reservations[key]===sim.id)delete world.reservations[key];
    sim.state=emptyState();
  }
}

// Only undelivered construction is refunded. Already completed houses remain
// real public housing; neither residents nor finished buildings are erased.
export function cancelFoundingConstruction(world,petitionId,reason,t,emit){
  const p=world.founding.petitions.find(p=>p.id===petitionId&&['building','awaiting_settlement'].includes(p.status));
  if(!p)return;
  const unbuilt=new Map([...world.zoneOrders,...world.projects]
    .filter(q=>q.foundingPetitionId===petitionId).map(q=>[q.plotId,q.fundedCost]));
  const refund=[...unbuilt.values()].reduce((n,c)=>n+c,0);
  endFoundingWorkAt(world,new Set(unbuilt.keys()));
  world.zoneOrders=world.zoneOrders.filter(q=>q.foundingPetitionId!==petitionId);
  world.projects=world.projects.filter(q=>q.foundingPetitionId!==petitionId);
  world.treasury+=refund;world.externalInflow=(world.externalInflow??0)+refund;
  for(const plot of world.plots)if(plot.foundingPetitionId===petitionId){delete plot.foundingPetitionId;delete plot.foundingType;}
  for(const fac of world.map.facilities)if(fac.foundingPetitionId===petitionId)delete fac.foundingPetitionId;
  p.status='cancelled';p.resolvedTick=t;p.reason=reason;p.plan.refundedCost=refund;
  const pressure=world.founding.pressure[p.villageId];if(pressure)pressure.days=0;
  emit('founding_cancelled',p.petitionerId,{petitionId,reason,refund});
  return true;
}

export function evaluateFoundingPetitions(world, t, emit) {
  const state=world.founding, day=Math.floor(t/1440), F=world.logic.founding;
  if (day===state.lastDay) return;
  const consecutive=state.lastDay===day-1;
  state.lastDay=day;
  for (const village of world.villages) {
    const evidence=foundingEvidence(world,village.id);
    const constrained=evidence.population>0 && evidence.population>=evidence.beds
      && evidence.vacantHomes===0 && evidence.localBuildablePlots===0
      && evidence.pendingHomes===0 && evidence.eligibleSettlerIds.length>=F.minSettlers;
    const previous=state.pressure[village.id];
    const days=constrained ? Math.min(F.petitionDays,(consecutive ? previous?.days??0 : 0)+1) : 0;
    state.pressure[village.id]={ day, days, evidence };
    const existing=state.petitions.find(p=>p.villageId===village.id&&active(p));
    if (existing?.status==='pending' && !constrained) {
      existing.status='withdrawn';existing.resolvedTick=t;existing.reason='conditions_changed';
      emit('founding_petition_withdrawn',existing.petitionerId,{petitionId:existing.id,villageId:village.id});
    }
    if (!constrained || days<F.petitionDays || existing) continue;
    const petition={id:state.nextPetitionId++,villageId:village.id,petitionerId:evidence.eligibleSettlerIds[0],
      createdTick:t,status:'pending',resolvedTick:null,reason:null,evidence};
    state.petitions.push(petition);
    emit('founding_petition_created',petition.petitionerId,{petitionId:petition.id,villageId:village.id,
      constrainedDays:days,population:evidence.population,vacantHomes:0,localBuildablePlots:0});
  }
  // Approved plans are still active work, not terminal history.
  const terminal=p=>['withdrawn','rejected','cancelled','completed'].includes(p.status);
  while(state.petitions.filter(terminal).length>32){
    state.petitions.splice(state.petitions.findIndex(terminal),1);
  }
}

export function foundingEvidence(world, villageId) {
  const village = world.villages.find(v => v.id === villageId);
  if (!village) return null;
  const residents = world.sims.filter(s => s.villageId === villageId);
  const homes = world.map.facilities.filter(f => f.villageId === villageId && isResidence(f));
  const occupancy = new Map();
  for (const s of world.sims) occupancy.set(s.homeId, (occupancy.get(s.homeId) ?? 0) + 1);
  const busy = new Set(world.projects.map(p => p.plotId));
  for (const order of world.zoneOrders) busy.add(order.plotId);
  const localPlots = world.plots.filter(p => (p.villageId ?? PRIMARY_VILLAGE_ID) === villageId
    && !p.used && !busy.has(p.plotId)
    && Math.abs(p.x-village.center.x)+Math.abs(p.y-village.center.y) <= world.logic.zone.centerRadius
    && plotBuildable(world.map,p));
  const pendingHomes = new Set([...world.projects, ...world.zoneOrders].filter(p => {
    const plot = world.plots.find(q => q.plotId === p.plotId);
    return plot && ['house','apartment'].includes(p.type)
      && (plot?.villageId ?? PRIMARY_VILLAGE_ID) === villageId;
  }).map(p=>p.plotId)).size;
  return {
    villageId, population: residents.length, homes: homes.length,
    beds: homes.reduce((n,h)=>n+h.resources.length,0),
    vacantHomes: homes.filter(h=>h.resources.length>0&&!occupancy.has(h.id)).length,
    overcrowdedPeople: homes.reduce((n,h)=>n+Math.max(0,(occupancy.get(h.id)??0)-h.resources.length),0),
    localBuildablePlots: localPlots.length, pendingHomes,
    eligibleSettlerIds: residents.filter(canWork).map(s=>s.id).sort((a,b)=>a-b),
  };
}
