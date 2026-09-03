import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { TILE } from '../sim/map.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { makeTransportStats, rollTransportDay, recordTransportDeparture, recordTransportStep,
  recordTransportArrival, pruneTransportTrips, recordTransportEvent, transportSummary } from '../sim/transport-stats.js';

function trip() {
  const w = createWorld(48), sim = w.sims[0];
  sim.hasCar = true;
  sim.state = { ...sim.state, kind: 'walking', action: 'work', facilityId: 'office', resourceId: 'desk0' };
  return { w, sim, path: [{ x: 33, y: 33 }, { x: 34, y: 33 }] };
}

test('#48 departures record purpose, coarse OD, mode and integer route distance without RNG', () => {
  const { w, sim, path } = trip(), rng = serialize(w.rngSim);
  w.logic.transport.longTripMin = 2;
  recordTransportDeparture(w, sim, path, 1);
  const d = w.transportStats.today;
  assert.equal(d.departures, 1); assert.equal(d.carTrips, 1); assert.equal(d.longTrips, 1);
  assert.equal(d.pathTiles, 2); assert.equal(d.maxPathTiles, 2); assert.equal(d.byPurpose.work, 1);
  assert.equal(Object.values(d.od)[0], 1); assert.match(Object.keys(d.od)[0], /^work\|.*>1,1\|car$/);
  assert.equal(serialize(w.rngSim), rng);
});

test('#48 a car traversing two tiles in one tick consumes one observed travel tick', () => {
  const { w, sim, path } = trip(); recordTransportDeparture(w, sim, path, 1);
  recordTransportStep(w, sim, 2, TILE.ROAD); recordTransportStep(w, sim, 2, TILE.SIDEWALK);
  recordTransportArrival(w, sim);
  const d = transportSummary(w.transportStats.today);
  assert.equal(d.walkingTicks, 1); assert.equal(d.walkedTiles, 2);
  assert.equal(d.roadTiles, 1); assert.equal(d.sidewalkTiles, 1);
  assert.equal(d.arrivals, 1); assert.equal(d.avgWalkingTicks, 1); assert.equal(d.avgPathTiles, 2);
  assert.deepEqual(w.transportStats.pending, {});
});

test('#48 midnight assigns steps to their actual day and retains whole-trip duration at arrival', () => {
  const { w, sim, path } = trip(); recordTransportDeparture(w, sim, path, 1439);
  recordTransportStep(w, sim, 1439, TILE.ROAD); rollTransportDay(w, 1440);
  recordTransportStep(w, sim, 1440, TILE.ROAD); recordTransportArrival(w, sim);
  assert.equal(w.transportStats.history[0].day, 0);
  assert.equal(w.transportStats.history[0].walkingTicks, 1);
  assert.equal(w.transportStats.today.day, 1); assert.equal(w.transportStats.today.departures, 0);
  assert.equal(w.transportStats.today.walkingTicks, 1); assert.equal(w.transportStats.today.completedWalkingTicks, 2);
});

test('#48 interrupted trips are cancelled once, not reported as successful arrivals', () => {
  const { w, sim, path } = trip(); recordTransportDeparture(w, sim, path, 1);
  sim.state.kind = 'performing'; pruneTransportTrips(w); pruneTransportTrips(w);
  assert.equal(w.transportStats.today.cancelledTrips, 1); assert.equal(w.transportStats.today.arrivals, 0);
});

test('#48 old in-flight journeys are explicitly partial, with no fabricated departure or duration', () => {
  const { w, sim, path } = trip(); recordTransportDeparture(w, sim, path, 1, false);
  recordTransportStep(w, sim, 2, TILE.BRIDGE); recordTransportArrival(w, sim);
  const d = w.transportStats.today;
  assert.equal(d.departures, 0); assert.equal(d.arrivals, 0); assert.equal(d.partialArrivals, 1);
  assert.equal(d.completedWalkingTicks, 0); assert.equal(d.walkedTiles, 1);
});

test('#48 zero-distance starts and actual formation events remain separate from journeys', () => {
  const { w, sim } = trip(); recordTransportDeparture(w, sim, [], 1);
  recordTransportEvent(w, 'road_formed'); recordTransportEvent(w, 'sidewalk_formed');
  recordTransportEvent(w, 'action_started');
  assert.equal(w.transportStats.today.zeroDistanceStarts, 1); assert.equal(w.transportStats.today.departures, 0);
  assert.equal(w.transportStats.today.roadsFormed, 1); assert.equal(w.transportStats.today.sidewalksFormed, 1);
});

test('#48 the detailed daily ring is capped at 14 and zero denominators return integer zero', () => {
  const w = createWorld(48);
  for (let day = 1; day <= 20; day++) rollTransportDay(w, day * 1440);
  assert.equal(w.transportStats.history.length, 14); assert.equal(w.transportStats.history[0].day, 6);
  assert.equal(transportSummary(w.transportStats.today).avgWalkingTicks, 0);
  assert.equal(transportSummary(w.transportStats.today).avgPathTiles, 0);
});

test('#48 v60 migration starts at the current day without backfilling unknown travel', () => {
  const w = createWorld(48), rng = serialize(w.rngSim); w.worldTick = 5000; w.schemaVersion = 60;
  delete w.transportStats; migrateWorld(w);
  assert.deepEqual(w.transportStats, makeTransportStats(3)); assert.equal(serialize(w.rngSim), rng);
  assert.equal(w.schemaVersion,67);
});

test('#48 saving in flight and crossing a daily boundary preserves events, ledgers and world hash', () => {
  const a = createWorld(48);
  for (let i = 0; i < 1370; i++) tick(a);
  const b = deserialize(serialize(a));
  assert.ok(Object.keys(a.transportStats.pending).length > 0);
  for (let i = 0; i < 160; i++) assert.deepEqual(tick(a), tick(b));
  assert.equal(hashWorld(a), hashWorld(b));
  assert.equal(a.transportStats.history.length, 1);
  assert.deepEqual(a.statsHistory.at(-1).transport, transportSummary(a.transportStats.history[0]));
});
