// #48 Observation only. Never used by route selection, behavior, or RNG.
import { TILE } from './map.js';

const cell = (x, y) => `${Math.floor(x / 32)},${Math.floor(y / 32)}`;
const purposeOf = action => action === 'work' ? 'work'
  : action === 'supply_groceries' ? 'freight'
  : action === 'study' ? 'education'
  : ['eat', 'shop', 'stock_food'].includes(action) ? 'shopping'
  : ['see_doctor', 'escort_child_doctor'].includes(action) ? 'health'
  : ['socialize'].includes(action) ? 'social'
  : ['sleep', 'cook_eat', 'hole_up', 'build'].includes(action) ? 'home'
  : ['construct', 'respond_fire'].includes(action) ? 'public_duty' : 'leisure';

function emptyDay(day) {
  return { day, departures: 0, zeroDistanceStarts: 0, longTrips: 0, carTrips: 0,
    pathTiles: 0, maxPathTiles: 0, walkingTicks: 0, walkedTiles: 0,
    roadTiles: 0, sidewalkTiles: 0, arrivals: 0, partialArrivals: 0,
    completedWalkingTicks: 0, maxWalkingTicks: 0, cancelledTrips: 0,
    roadsFormed: 0, sidewalksFormed: 0, byPurpose: {}, od: {} };
}

export function makeTransportStats(day = 0) {
  return { today: emptyDay(day), history: [], pending: {} };
}

export function transportSummary(day) {
  const { od, ...summary } = day;
  return { ...summary,
    avgPathTiles: day.departures ? Math.floor(day.pathTiles / day.departures) : 0,
    avgWalkingTicks: day.arrivals ? Math.floor(day.completedWalkingTicks / day.arrivals) : 0 };
}

export function rollTransportDay(world, t) {
  const day = Math.floor(t / 1440), stats = world.transportStats;
  if (stats.today.day === day) return;
  stats.history.push({ ...transportSummary(stats.today), od: stats.today.od });
  while (stats.history.length > 14) stats.history.shift();
  stats.today = emptyDay(day);
}

export function recordTransportDeparture(world, sim, path, t, known = true) {
  const stats = world.transportStats, today = stats.today;
  if (stats.pending[sim.id]) { today.cancelledTrips++; delete stats.pending[sim.id]; }
  if (!path.length) { if (known) today.zeroDistanceStarts++; return; }
  const s = sim.state, destination = path[path.length - 1], purpose = purposeOf(s.action);
  stats.pending[sim.id] = { action: s.action, facilityId: s.facilityId,
    resourceId: s.resourceId, known, walkingTicks: 0, lastWalkTick: -1 };
  if (!known) return; // Old saves have no observed departure.
  today.departures++;
  today.pathTiles += path.length;
  today.maxPathTiles = Math.max(today.maxPathTiles, path.length);
  if (path.length >= world.logic.transport.longTripMin) today.longTrips++;
  if (sim.hasCar) today.carTrips++;
  today.byPurpose[purpose] = (today.byPurpose[purpose] ?? 0) + 1;
  const key = `${purpose}|${cell(sim.x, sim.y)}>${cell(destination.x, destination.y)}|${sim.hasCar ? 'car' : 'walk'}`;
  today.od[key] = (today.od[key] ?? 0) + 1;
}

export function recordTransportStep(world, sim, t, tile) {
  const stats = world.transportStats, pending = stats.pending[sim.id], today = stats.today;
  if (!pending) return;
  if (pending.lastWalkTick !== t) {
    pending.lastWalkTick = t; pending.walkingTicks++; today.walkingTicks++;
  }
  today.walkedTiles++;
  if (tile === TILE.ROAD || tile === TILE.BRIDGE) today.roadTiles++;
  if (tile === TILE.SIDEWALK) today.sidewalkTiles++;
}

export function recordTransportArrival(world, sim) {
  const stats = world.transportStats, pending = stats.pending[sim.id];
  if (!pending) return;
  if (pending.known) {
    stats.today.arrivals++;
    stats.today.completedWalkingTicks += pending.walkingTicks;
    stats.today.maxWalkingTicks = Math.max(stats.today.maxWalkingTicks, pending.walkingTicks);
  } else stats.today.partialArrivals++;
  delete stats.pending[sim.id];
}

export function pruneTransportTrips(world) {
  const stats = world.transportStats;
  const live = new Set();
  for (const sim of world.sims) {
    const trip = stats.pending[sim.id];
    if (!trip) continue;
    live.add(sim.id);
    const state = sim.state;
    if (state?.kind === 'walking' && state.action === trip.action
      && state.facilityId === trip.facilityId && state.resourceId === trip.resourceId) continue;
    stats.today.cancelledTrips++; delete stats.pending[sim.id];
  }
  for (const id of Object.keys(stats.pending)) if (!live.has(Number(id))) {
    stats.today.cancelledTrips++; delete stats.pending[id];
  }
}

export function recordTransportEvent(world, type) {
  if (type === 'road_formed') world.transportStats.today.roadsFormed++;
  if (type === 'sidewalk_formed') world.transportStats.today.sidewalksFormed++;
}
