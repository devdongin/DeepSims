import { plotBuildable, sameRegion, zoneFootprint } from './map.js';
import { PRIMARY_VILLAGE_ID } from './villages.js';
import { foundingSiteReserved } from './founding.js';

const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const overlaps = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;

// Attribute existing vacant land, never create land, buildings, residents or funds.
// Explicit ownership and prior commitments are immutable here.
export function allocateMunicipalLand(world,t,emit) {
  if (world.villages.length < 2) return;
  const radius = world.logic.zone.centerRadius;
  const primary = world.villages.find(v=>v.id===PRIMARY_VILLAGE_ID);
  const populated = new Set(world.sims.map(s=>s.villageId??PRIMARY_VILLAGE_ID));
  const villages = world.villages.filter(v=>v.id!==PRIMARY_VILLAGE_ID && populated.has(v.id));
  // Paid local centers are investments in another service area, not just UI
  // markers. Keep the original settlement as the reachability anchor.
  const anchors=new Map(villages.map(v=>[v.id,[v.center,
    ...(world.centers??[]).filter(c=>(c.villageId??PRIMARY_VILLAGE_ID)===v.id)]]));
  const serviceDistance=(v,p)=>Math.min(...anchors.get(v.id).map(c=>distance(p,c)));
  const busy = new Set([...world.projects,...world.zoneOrders].map(p=>p.plotId));
  const approved = [];
  for (const petition of world.founding?.petitions??[]) if (petition.status==='approved') {
    for (const id of petition.plan?.homePlotIds??[]) busy.add(id);
    for (const h of petition.plan?.homes??[]) {
      busy.add(h.plotId);
      const p=world.plots.find(p=>p.plotId===h.plotId);
      if (!p) continue;
      const shape=zoneFootprint(h.type,0);
      approved.push({...p,...shape});
      approved.push({x:p.x+(h.type==='apartment'?3:2),y:p.y+shape.h,w:1,h:1});
    }
  }
  const assigned = new Map();
  for (const p of [...world.plots].sort((a,b)=>a.plotId-b.plotId)) {
    if (p.villageId!=null || p.used || busy.has(p.plotId) || p.foundingPetitionId!=null
      || !plotBuildable(world.map,p) || foundingSiteReserved(world,p,'office')
      || approved.some(r=>overlaps({...p,w:7,h:5},r))) continue;
    if (primary && distance(p,primary.center)<=radius) continue;
    const owner = villages.filter(v=>serviceDistance(v,p)<=radius
      && sameRegion(world.map,v.center.x,v.center.y,p.x,p.y))
      .sort((a,b)=>serviceDistance(a,p)-serviceDistance(b,p)||(a.id<b.id?-1:a.id>b.id?1:0))[0];
    if (!owner) continue;
    // Never take the service area of another government's paid center.
    if ((world.centers??[]).some(c=>(c.villageId??PRIMARY_VILLAGE_ID)!==owner.id && distance(p,c)<=radius)) continue;
    p.villageId=owner.id;
    if (!assigned.has(owner.id)) assigned.set(owner.id,[]);
    assigned.get(owner.id).push(p.plotId);
  }
  for (const [villageId,plotIds] of assigned) emit('village_land_assigned',null,{villageId,plotIds});
}
