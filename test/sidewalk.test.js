import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { TILE, isRoadProtected } from '../sim/map.js';
import { maybePublicWorks } from '../sim/society.js';

test('#117 public roads protect parks, facilities and every rotated doorway', () => {
  const w = createWorld(119);
  w.map = { w: 32, h: 32, tiles: Array(1024).fill(TILE.GRASS), facilities: [
    { id: 'park', type: 'park', x: 4, y: 4, w: 6, h: 6, door: { x: 4, y: 6 } },
    { id: 'house', type: 'house', x: 20, y: 20, w: 6, h: 5, door: { x: 25, y: 22 } },
  ] };
  w.mayorId = 0; w.treasury = 1000000;
  const protectedPoints = [[5,5], [21,21], [26,22], [4,6]];
  w.wear = Object.fromEntries([...protectedPoints, [15,15]].map(([x,y]) => [y * 32 + x, 399]));
  for (const [x,y] of protectedPoints) assert.equal(isRoadProtected(w.map, x, y), true);
  assert.equal(isRoadProtected(w.map, 5, 5, false), false, '공원의 보행 인도는 허용');
  const events = [];
  maybePublicWorks(w, 5 * 1440, 5, (type, simId, payload) => events.push({type, payload}));
  assert.deepEqual(events[0].payload.tiles, [15 * 32 + 15]);
  for (const [x,y] of protectedPoints) assert.equal(w.map.tiles[y * 32 + x], TILE.GRASS);
  assert.equal(w.treasury, 1000000 - w.logic.publicWorks.paveCostPerTile);
});

test('#117 walking makes park sidewalks but cannot pave building footprints or entrances', () => {
  const run = (type, door, point) => {
    const w = createWorld(119);
    w.map.facilities.push({ id:'protection-test', type, x:90, y:90, w:6, h:5, door, resources:[] });
    const [x,y] = point;
    const idx = y * w.map.w + x;
    w.map.tiles[idx] = TILE.GRASS;
    w.wear[idx] = w.logic.build.wearThreshold - 1;
    w.lastDailyDay = 0; w.lastPlanDay = 0;
    const sim = w.sims[0];
    sim.state = { ...sim.state, kind:'walking', action:'play', facilityId:'park', resourceId:'spot0', path:[{x,y},{x:x+1,y}], ticksLeft:60 };
    const events = tick(w);
    return { w, idx, events };
  };
  for (const [type, point, expected] of [['park',[92,92],TILE.SIDEWALK], ['house',[92,92],TILE.GRASS], ['house',[96,92],TILE.GRASS]]) {
    const a = run(type, {x:95,y:92}, point);
    const b = run(type, {x:95,y:92}, point);
    assert.equal(a.w.map.tiles[a.idx], expected);
    assert.equal(a.events.some((e) => e.type === 'sidewalk_formed'), expected === TILE.SIDEWALK);
    assert.equal(hashWorld(a.w), hashWorld(b.w));
    assert.equal(hashWorld(migrateWorld(deserialize(serialize(a.w)))), hashWorld(a.w));
  }
});
