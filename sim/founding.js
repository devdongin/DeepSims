// #32 Founding evidence. This measures actual capacity; it does not create
// residents, grant funds, approve petitions, or claim a settlement exists.
import { canWork } from './education.js';
import { isResidence, plotBuildable } from './map.js';
import { PRIMARY_VILLAGE_ID } from './villages.js';

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
