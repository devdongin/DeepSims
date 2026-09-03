// #32 Founding evidence. This measures actual capacity; it does not create
// residents, grant funds, approve petitions, or claim a settlement exists.
import { canWork } from './education.js';
import { isResidence, plotBuildable, zoneFootprint, sameRegion, addBuilding } from './map.js';
import { PRIMARY_VILLAGE_ID } from './villages.js';

export function newFoundingState() {
  return { nextPetitionId: 0, lastDay: -1, pressure: {}, petitions: [] };
}

// Approval must validate all homes and the full price before any mutation.
// “자체 시장” in #32 means an independent mayor, not a retail market.
// The caller will consume this quote in the durable approval path.
export function quoteFoundingSites(world, petitionId, homePlotIds) {
  const fail=reason=>({ok:false,reason});
  const petition=world.founding.petitions.find(p=>p.id===petitionId&&p.status==='pending');
  if(!petition)return fail('no_pending_petition');
  const source=world.villages.find(v=>v.id===petition.villageId);
  if(!source)return fail('no_source_village');
  const count=world.logic.founding.minSettlers;
  if(!Array.isArray(homePlotIds)||homePlotIds.length!==Math.ceil(count/2)
    ||homePlotIds.some(id=>!Number.isSafeInteger(id))
    ||new Set(homePlotIds).size!==homePlotIds.length)return fail('invalid_sites');
  const plots=[...homePlotIds].sort((a,b)=>a-b).map(id=>world.plots.find(p=>p.plotId===id));
  if(plots.some(p=>!p||p.used))return fail('site_unavailable');
  const busy=new Set([...world.projects,...world.zoneOrders].map(p=>p.plotId));
  if(plots.some(p=>busy.has(p.plotId)))return fail('site_reserved');
  const shape=zoneFootprint('house',0);
  if(plots.some(p=>!plotBuildable(world.map,p,shape.w,shape.h)))return fail('not_buildable');
  const overlaps=(a,sa,b,sb)=>a.x<b.x+sb.w&&b.x<a.x+sa.w&&a.y<b.y+sb.h&&b.y<a.y+sa.h;
  for(let i=0;i<plots.length;i++)for(let j=0;j<i;j++){
    if(overlaps(plots[i],shape,plots[j],shape))return fail('sites_overlap');
  }
  for(const order of [...world.projects,...world.zoneOrders]){
    const reserved=world.plots.find(p=>p.plotId===order.plotId);
    if(reserved&&plots.some(p=>overlaps(p,shape,reserved,zoneFootprint(order.type,order.dir??0))))return fail('site_reserved');
  }
  const distance=(p,q)=>Math.abs(p.x-q.x)+Math.abs(p.y-q.y);
  const radius=world.logic.zone.centerRadius;
  if(plots.some(p=>world.villages.some(v=>distance(p,v.center)<radius*2)
    ||distance(p,plots[0])>radius))return fail('invalid_distance');
  if(plots.some(p=>!sameRegion(world.map,source.center.x,source.center.y,p.x,p.y)))return fail('unreachable');
  // Empty grass can be reachable while the completed houses wall off their own
  // doors. Preview all footprints together without touching the live map.
  const preview={...world.map,tiles:world.map.tiles.slice(),facilities:[...world.map.facilities]};
  const homes=plots.map(p=>addBuilding(preview,'house',p,0));
  if(homes.some(f=>!sameRegion(preview,source.center.x,source.center.y,f.door.x,f.door.y)))return fail('blocked_entrance');
  const cost=world.logic.zone.costs.house*plots.length;
  if(!Number.isSafeInteger(cost)||cost<0||world.treasury<cost)return fail('treasury_short');
  const evidence=foundingEvidence(world,source.id);
  if(evidence.population<evidence.beds||evidence.vacantHomes||evidence.localBuildablePlots||evidence.pendingHomes)return fail('conditions_changed');
  const eligible=evidence.eligibleSettlerIds.filter(id=>{
    const s=world.sims.find(s=>s.id===id);
    return sameRegion(world.map,s.x,s.y,plots[0].x,plots[0].y);
  });
  if(eligible.length<count)return fail('no_settlers');
  return {ok:true,petitionId,sourceVillageId:source.id,homePlotIds:plots.map(p=>p.plotId),cost,
    settlerIds:eligible.slice(0,count)};
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
    const existing=state.petitions.find(p=>p.villageId===village.id&&p.status==='pending');
    if (existing && !constrained) {
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
  // Pending requests remain actionable. Only old terminal records are pruned.
  while(state.petitions.filter(p=>p.status!=='pending').length>32){
    state.petitions.splice(state.petitions.findIndex(p=>p.status!=='pending'),1);
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
