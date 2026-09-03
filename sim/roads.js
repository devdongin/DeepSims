// Completed walks are evidence, not predicted demand. No RNG consumption.
import { TILE, isWalkable, isRoadProtected } from './map.js';
import { bfsPath } from './pathfind.js';
import { PRIMARY_GOVERNMENT } from './government.js';

// Maintenance jurisdiction, not new demand: only observed wear is eligible.
// Founded centers and an explicit id tie-break keep ownership replay-stable.
export function roadMaintenanceVillage(world, index) {
  const root = world.rootWorld ?? world;
  if ((root.villages?.length ?? 0) <= 1) return PRIMARY_GOVERNMENT;
  const x = index % root.map.w, y = Math.floor(index / root.map.w);
  let best = null, distance = Infinity;
  for (const v of root.villages) {
    const d = Math.abs(x - v.center.x) + Math.abs(y - v.center.y);
    if (d < distance || (d === distance && v.id < best)) { best = v.id; distance = d; }
  }
  return best;
}

export function recordRoadTrip(world, sim, journey, t, emit) {
  if (!journey) return; // old saves/cancelled trips have no invented origin
  const direct = Math.abs(sim.x - journey.x) + Math.abs(sim.y - journey.y);
  const P = world.logic.transport;
  if (!direct || journey.walked - direct < P.detourMinExtra ||
      journey.walked * 100 < direct * P.detourRatioPct) return;
  const day = Math.floor(t / 1440);
  const a = journey.y * world.map.w + journey.x, b = sim.y * world.map.w + sim.x;
  const villageId = sim.villageId ?? PRIMARY_GOVERNMENT;
  const jurisdiction = villageId === PRIMARY_GOVERNMENT ? {} : { villageId };
  const key = `${villageId === PRIMARY_GOVERNMENT ? '' : `${villageId}/`}${Math.min(a, b)}:${Math.max(a, b)}`;
  world.roadReports = (world.roadReports ?? []).filter(r =>
    r.plannedDay != null || day - r.lastDay <= world.logic.complaints.windowDays);
  let report = world.roadReports.find(r => r.key === key);
  if (!report) {
    report = { key, from: Math.min(a, b), to: Math.max(a, b), direct,
      walked: journey.walked, lastDay: day, reporters: [], plannedDay: null, ...jurisdiction };
    world.roadReports.push(report);
  }
  report.lastDay = day;
  report.walked = journey.walked;
  report.reporters = report.reporters.filter(r => day - r.lastDay <= world.logic.complaints.windowDays);
  let person = report.reporters.find(r => r.simId === sim.id);
  if (!person) { person = { simId: sim.id, count: 0, lastDay: day }; report.reporters.push(person); }
  person.count = Math.min(P.detourRepeat, person.count + 1);
  person.lastDay = day;
  if (person.count >= P.detourRepeat) {
    const existing = world.complaints.find(c => c.kind === 'road_detour' && c.placeId === key);
    if (existing) { existing.count++; existing.severity = Math.min(100, existing.severity + 1); }
    else {
      world.complaints.push({ kind: 'road_detour', placeId: key, severity: 1, sinceDay: day, count: 1, ...jurisdiction });
      emit('road_requested', sim.id, { routeKey: key, from: report.from, to: report.to,
        walked: journey.walked, direct, repeated: person.count, ...jurisdiction });
    }
    sim.complaintDays.road_detour = day;
    while (world.complaints.length > world.logic.complaints.cap) world.complaints.shift();
  }
  // Preserve projects in progress; deterministic oldest-first eviction otherwise.
  while (world.roadReports.length > world.logic.complaints.cap) {
    const i = world.roadReports.findIndex(r => r.plannedDay == null);
    if (i < 0) break;
    world.roadReports.splice(i, 1);
  }
}

function connector(world, report, horizontalFirst) {
  const map = world.map, changes = [];
  let x = report.from % map.w, y = Math.floor(report.from / map.w);
  const tx = report.to % map.w, ty = Math.floor(report.to / map.w);
  while (x !== tx || y !== ty) {
    if ((horizontalFirst && x !== tx) || y === ty) x += Math.sign(tx - x);
    else y += Math.sign(ty - y);
    if (isWalkable(map, x, y)) continue;
    const index = y * map.w + x, tile = map.tiles[index];
    if (isRoadProtected(map, x, y) || (tile !== TILE.TREE && tile !== TILE.RIVER)) return null;
    changes.push({ index, tile: tile === TILE.RIVER ? TILE.BRIDGE : TILE.SIDEWALK });
  }
  if (!changes.length || changes.length > world.logic.publicWorks.paveMaxPerDay) return null;
  const cost = changes.reduce((sum, c) => sum + (c.tile === TILE.BRIDGE
    ? world.logic.publicWorks.bridgeCostPerTile : world.logic.publicWorks.paveCostPerTile), 0);
  return { changes, cost };
}

// Called only behind the mayor, election, fiscal-review and surplus guards.
export function maybeRoadWorks(world, t, day, emit) {
  const root = world.rootWorld ?? world;
  const villageId = world.municipalityId ?? PRIMARY_GOVERNMENT;
  const P = world.logic.publicWorks;
  root.roadReports = (root.roadReports ?? []).filter(r =>
    r.plannedDay != null || day - r.lastDay <= world.logic.complaints.windowDays);
  const active = new Set(world.sims.map(s => s.id));
  const voices = r => r.reporters.filter(p => active.has(p.simId) &&
    day - p.lastDay <= world.logic.complaints.windowDays && p.count >= world.logic.transport.detourRepeat).length;
  const candidates = root.roadReports.filter(r => (r.villageId ?? PRIMARY_GOVERNMENT) === villageId
    && (r.plannedDay != null || voices(r) > 0))
    .sort((a, b) => (b.plannedDay != null) - (a.plannedDay != null) || voices(b) - voices(a) ||
      (b.walked - b.direct) - (a.walked - a.direct) || a.from - b.from || a.to - b.to);
  for (const r of candidates) {
    const map = root.map;
    const path = bfsPath(map, r.from % map.w, Math.floor(r.from / map.w), r.to % map.w, Math.floor(r.to / map.w));
    if (path === null || path.length <= r.direct) {
      removeRoadReport(root, r);
      continue; // already improved, or no longer a valid observed route
    }
    const plans = [connector(root, r, true), connector(root, r, false)].filter(Boolean)
      .sort((a, b) => a.cost - b.cost);
    const plan = plans[0];
    if (!plan || world.treasury - plan.cost <= 0) continue;
    if (r.plannedDay == null) {
      r.plannedDay = day;
      emit('road_work_planned', world.mayorId, { routeKey: r.key, cost: plan.cost,
        earliestDay: day + P.routeWorkDays, tiles: plan.changes.length });
      return true;
    }
    if (day < r.plannedDay + P.routeWorkDays) return true;
    // Revalidate the current map and budget at completion, no partial/unfunded bridge.
    for (const c of plan.changes) { map.tiles[c.index] = c.tile; delete root.wear[c.index]; }
    map.reachVersion = (map.reachVersion ?? 0) + 1;
    world.treasury -= plan.cost;
    root.externalOutflow = (root.externalOutflow ?? 0) + plan.cost;
    removeRoadReport(root, r);
    emit('public_works', world.mayorId, { kind: 'route', routeKey: r.key,
      tiles: plan.changes.map(c => c.index), tileChanges: plan.changes, cost: plan.cost,
      treasury: world.treasury, before: path.length, after: r.direct });
    return true;
  }
  return false;
}

function removeRoadReport(world, report) {
  world.roadReports = world.roadReports.filter(r => r !== report);
  world.complaints = world.complaints.filter(c => c.kind !== 'road_detour' || c.placeId !== report.key);
  for (const sim of world.sims) if (!world.roadReports.some(r =>
    r.reporters.some(p => p.simId === sim.id && p.count >= world.logic.transport.detourRepeat))) {
    delete sim.complaintDays.road_detour;
  }
}
