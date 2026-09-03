// #32 R-C storage foundation only. No founding, population, money or RNG changes.
export const PRIMARY_VILLAGE_ID = 'village:0';

export function initializeVillages(world) {
  const hall = world.map.facilities.find(f => f.type === 'city_hall');
  world.villages ??= [{ id: PRIMARY_VILLAGE_ID, name: '해솔', foundedTick: 0,
    center: { x: hall?.door.x ?? 0, y: hall?.door.y ?? 0 } }];
  world.nextVillageId ??= 1;
  for (const f of world.map.facilities) f.villageId ??= PRIMARY_VILLAGE_ID;
  const homes = new Map(world.map.facilities.map(f => [f.id, f]));
  for (const sim of world.sims) sim.villageId = homes.get(sim.homeId)?.villageId ?? PRIMARY_VILLAGE_ID;
}

// Residency follows the actual home, not a temporary work/shopping destination.
export function syncResidenceVillage(world, simId) {
  const sim = world.sims.find(s => s.id === simId);
  if (!sim) return;
  sim.villageId = world.map.facilities.find(f => f.id === sim.homeId)?.villageId ?? PRIMARY_VILLAGE_ID;
}

// Read-only current facts. Treasury/reputation/government remain shared world
// authority in this first slice; do not invent duplicate village balances.
export function villageSummary(world) {
  const result = world.villages.map(v => ({ ...v, center: { ...v.center }, population: 0,
    facilities: 0, homes: 0, beds: 0, occupiedBeds: 0 }));
  const byId = new Map(result.map(v => [v.id, v]));
  const residents = new Map();
  for (const sim of world.sims) {
    const village = byId.get(sim.villageId); if (village) village.population++;
    residents.set(sim.homeId, (residents.get(sim.homeId) ?? 0) + 1);
  }
  for (const f of world.map.facilities) {
    const village = byId.get(f.villageId); if (!village) continue;
    village.facilities++;
    if (f.type === 'house' || f.type === 'apartment') {
      village.homes++; village.beds += f.resources.length;
      village.occupiedBeds += Math.min(f.resources.length, residents.get(f.id) ?? 0);
    }
  }
  return result;
}
