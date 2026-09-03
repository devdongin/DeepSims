// #32 Founding evidence. This measures actual capacity; it does not create
// residents, grant funds, approve petitions, or claim a settlement exists.
import { canWork } from './education.js';
import { isResidence, plotBuildable } from './map.js';
import { PRIMARY_VILLAGE_ID } from './villages.js';

export function newFoundingState() {
  return { nextPetitionId: 0, lastDay: -1, pressure: {}, petitions: [] };
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
