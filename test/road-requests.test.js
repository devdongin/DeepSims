import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { TILE, plotBuildable } from '../sim/map.js';
import { bfsPath } from '../sim/pathfind.js';
import { maybePublicWorks } from '../sim/society.js';

function fixture(tile = TILE.RIVER) {
  const w = createWorld(118);
  w.map = { w: 24, h: 24, tiles: Array(576).fill(TILE.GRASS), facilities: [], reachVersion: 0 };
  for (let y = 0; y <= 16; y++) w.map.tiles[y * 24 + 10] = tile;
  w.worldTick = 4 * 1440; w.lastDailyDay = 4; w.lastPlanDay = 4; w.weather.day = 4;
  for (const s of w.sims) s.state = { ...s.state, kind: 'performing', action: 'idle', ticksLeft: 10000 };
  w.mayorId = w.sims[0].id; w.treasury = 1000000;
  const sim = w.sims[1]; sim.x = 8; sim.y = 8;
  return w;
}

function walk(w, toX, events) {
  const s = w.sims[1], path = bfsPath(w.map, s.x, s.y, toX, 8);
  const length = path.length;
  s.state = { ...s.state, kind: 'walking', action: 'idle', path,
    journey: { x: s.x, y: s.y, walked: 0 }, ticksLeft: 10000 };
  while (s.state.kind === 'walking') events.push(...tick(w));
  assert.equal(s.state.journey, null);
  return length;
}
function report(w) {
  const events = [];
  assert.equal(walk(w, 12, events), 22);
  walk(w, 8, events);
  assert.equal(events.filter(e => e.type === 'road_requested').length, 0);
  walk(w, 12, events);
  assert.equal(events.filter(e => e.type === 'road_requested').length, 1);
  assert.equal(w.roadReports.length, 1, 'reverse trips belong to the same corridor');
  assert.equal(w.complaints.find(c => c.kind === 'road_detour').count, 1);
  return events;
}
function review(w, day, events) {
  maybePublicWorks(w, day * 1440, day, (type, simId, payload) => events.push({ type, simId, payload }));
}

test('#118 actual repeated walks cause a phased bridge that shortens travel, with exact accounting', () => {
  const run = () => {
    const w = fixture(), events = report(w);
    const cash = w.treasury, out = w.externalOutflow;
    const population = w.sims.map(s => s.id);
    review(w, 5, events);
    assert.equal(events.at(-1).type, 'road_work_planned');
    assert.equal(w.map.tiles[8 * 24 + 10], TILE.RIVER, 'planning is not instant construction');
    assert.equal(w.treasury, cash);
    const restored = migrateWorld(deserialize(serialize(w)));
    assert.equal(hashWorld(restored), hashWorld(w));
    review(restored, 10, events);
    const result = events.at(-1);
    assert.equal(result.type, 'public_works');
    assert.equal(result.payload.kind, 'route');
    assert.deepEqual([result.payload.before, result.payload.after], [22, 4]);
    assert.equal(bfsPath(restored.map, 8, 8, 12, 8).length, 4);
    assert.equal(restored.map.tiles[8 * 24 + 10], TILE.BRIDGE);
    assert.equal(restored.map.reachVersion, 1);
    assert.equal(restored.treasury, cash - restored.logic.publicWorks.bridgeCostPerTile);
    assert.equal(restored.externalOutflow, out + restored.logic.publicWorks.bridgeCostPerTile);
    assert.equal(restored.roadReports.length, 0);
    assert.equal(restored.complaints.some(c => c.kind === 'road_detour'), false);
    assert.deepEqual(restored.sims.map(s => s.id), population);
    return { hash: hashWorld(restored), events };
  };
  assert.deepEqual(run(), run(), 'same seed/input and save/resume reproduce all events and world state');
});

test('#118 facilities, mountains, stale reports, poor/player mayors are not construction targets', () => {
  for (const condition of ['facility', 'mountain', 'stale', 'poor', 'player']) {
    const w = fixture(condition === 'mountain' ? TILE.MOUNTAIN : TILE.TREE);
    report(w);
    if (condition === 'facility') w.map.facilities.push({ id:'park', type:'park', x:10,y:8,w:1,h:1,door:{x:10,y:8} });
    if (condition === 'poor') w.treasury = 0;
    if (condition === 'player') w.sims[0].isPlayer = true;
    const before = [...w.map.tiles], money = w.treasury, events = [];
    review(w, condition === 'stale' ? 10 : 5, events);
    review(w, 20, events);
    assert.deepEqual(w.map.tiles, before, condition);
    assert.equal(w.treasury, money, condition);
    assert.equal(events.length, 0, condition);
  }
});

test('#118 tree connector revalidates protection and funds after planning', () => {
  const w = fixture(TILE.TREE), events = report(w);
  review(w, 5, events);
  w.map.facilities.push({ id:'house', type:'house',x:10,y:8,w:1,h:1,door:{x:10,y:8} });
  review(w, 10, events);
  assert.equal(w.map.tiles[8 * 24 + 10], TILE.TREE);
  w.map.facilities = [];
  review(w, 20, events);
  assert.equal(w.map.tiles[8 * 24 + 10], TILE.SIDEWALK);
  assert.equal(events.at(-1).payload.cost, w.logic.publicWorks.paveCostPerTile);
});

test('#118 zoning charges demolition and clears wear with client tile changes', () => {
  const w = createWorld(118);
  w.treasury = 100000;
  w.lastDailyDay = 0; w.lastPlanDay = 0;
  const p = w.plots.find(p => plotBuildable(w.map, p));
  const index = p.y * w.map.w + p.x;
  w.map.tiles[index] = TILE.SIDEWALK; w.wear[index] = 300;
  const events = tick(w, [{ sequence:0, command:'zone', payload:{plotId:p.plotId,type:'house',dir:0} }]);
  const e = events.find(e => e.type === 'zoned');
  assert.ok(e);
  assert.equal(e.payload.demolitionCost, w.logic.zone.demolitionCostPerTile);
  assert.deepEqual(e.payload.tileChanges, [{ index, tile:TILE.GRASS }]);
  assert.equal(w.wear[index], undefined);
  assert.equal(w.treasury, 100000 - e.payload.cost - e.payload.demolitionCost);
});

test('#118 v51 migration adds no fabricated trips and is idempotent', () => {
  const w = createWorld(118);
  w.schemaVersion = 51; delete w.roadReports;
  w.logic.logicSchemaVersion = 46;
  for (const s of w.sims) delete s.state.journey;
  const migrated = migrateWorld(w);
  assert.deepEqual(migrated.roadReports, []);
  assert.ok(migrated.sims.every(s => s.state.journey === null));
  assert.equal(migrated.logic.transport.detourRepeat, 3);
  assert.equal(hashWorld(migrated), hashWorld(migrateWorld(deserialize(serialize(migrated)))));
});
