import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, migrateWorld, hashWorld } from '../sim/index.js';
import { maybePlanCenter } from '../sim/tick.js';
import { isWalkable } from '../sim/map.js';

test('#119 계획 중심점은 국고·이벤트·영속 상태를 결정적으로 갱신한다', () => {
  const a = createWorld(119);
  const b = createWorld(119);
  a.treasury = 10000;
  b.treasury = 10000;
  const hall = a.map.facilities.find((f) => f.type === 'city_hall');
  const point = { x: hall.door.x, y: hall.door.y + 1 };
  assert.equal(isWalkable(a.map, point.x, point.y), true);
  const before = a.treasury;
  const eventsA = tick(a, [{ command: 'plan_center', sequence: 1, payload: point }]);
  const eventsB = tick(b, [{ command: 'plan_center', sequence: 1, payload: point }]);
  const planned = eventsA.find((e) => e.type === 'center_planned');
  assert.equal(planned.payload.cost, 5000);
  assert.equal(a.treasury, before - 5000);
  assert.deepEqual(a.centers, [{ centerId: 'center0', ...point, createdTick: 1 }]);
  assert.deepEqual(eventsA, eventsB);
  assert.equal(tick(a, [{ command: 'plan_center', sequence: 1, payload: point }])[0].payload.reason, 'duplicate');
});

test('#119 malformed, unaffordable and duplicate plans do not spend money', () => {
  const w = createWorld(119);
  w.lastDailyDay = 0;
  for (const payload of [null, {}, { x: -1, y: 10 }, { x: 1.5, y: 20 }, { x: 0, y: 0 }]) {
    const money = w.treasury;
    const events = tick(w, [{ command: 'plan_center', payload, sequence: 0 }]);
    assert.equal(events[0].type, 'input_rejected');
    assert.equal(w.treasury, money);
    assert.equal(w.centers.length, 0);
  }
  w.treasury = 0;
  const door = w.map.facilities[0].door;
  assert.equal(tick(w, [{ command: 'plan_center', payload: door }])[0].payload.reason, 'treasury_short');
});

function emptyTown() {
  const w = createWorld(119);
  w.sims = [];
  w.map = { w: 128, h: 128, tiles: Array(128 * 128).fill(0), facilities: [] };
  w.plots = [{ plotId: 9, x: 80, y: 80, used: false }, { plotId: 1, x: 5, y: 5, used: false }];
  w.treasury = 10000;
  w.lastDailyDay = 0;
  return w;
}

test('#119 nearest center beats plot order; absent centers fall back to plotId; replay survives saves', () => {
  const w = emptyTown();
  const old = deserialize(serialize(w));
  assert.equal(tick(old).find((e) => e.type === 'project_started').payload.plotId, 1);
  const input = [{ command: 'plan_center', payload: { x: 82, y: 82 }, sequence: 0 }];
  const replay = deserialize(serialize(w));
  assert.equal(tick(w, input).find((e) => e.type === 'project_started').payload.plotId, 9);
  tick(replay, input);
  assert.equal(hashWorld(w), hashWorld(replay));
  assert.equal(hashWorld(migrateWorld(deserialize(serialize(w)))), hashWorld(w));
  const legacy = createWorld(119);
  legacy.schemaVersion = 50;
  legacy.logic.logicSchemaVersion = 45;
  delete legacy.centers;
  delete legacy.logic.zone.plannedCenterCost;
  delete legacy.logic.zone.centerRadius;
  migrateWorld(legacy);
  assert.deepEqual(legacy.centers, []);
  assert.equal(legacy.logic.zone.plannedCenterCost, 5000);
  assert.equal(legacy.logic.zone.centerRadius, 32);
});

test('#119 NPC mayor invests in an inhabited outlying cluster, respects funds and player rule', () => {
  const w = emptyTown();
  w.map.facilities = [{ id: 'home', type: 'house', x: 75, y: 75, door: { x: 76, y: 76 }, resources: [] },
    { id: 'hall', type: 'city_hall', x: 5, y: 5 }];
  w.sims = Array.from({ length: 4 }, (_, id) => ({ id, homeId: 'home', money: 0, isPlayer: false }));
  w.mayorId = 0;
  const events = [];
  const emit = (type, simId, payload) => events.push({ type, simId, payload });
  w.sims[0].isPlayer = true;
  maybePlanCenter(w, 1, 0, emit);
  assert.equal(events.length, 0);
  w.sims[0].isPlayer = false;
  w.treasury = 4999;
  maybePlanCenter(w, 1, 0, emit);
  assert.equal(events.length, 0);
  w.treasury = 10000;
  maybePlanCenter(w, 1, 0, emit);
  assert.equal(events[0].payload.source, 'mayor');
  assert.equal(events[0].payload.x, 80);
  assert.equal(w.treasury, 5000);
  maybePlanCenter(w, 2, 0, emit);
  assert.equal(events.length, 1);
});
