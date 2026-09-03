import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick } from '../sim/index.js';
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
