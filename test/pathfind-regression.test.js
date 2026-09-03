import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld } from '../sim/index.js';
import { bfsPath } from '../sim/pathfind.js';
import { TILE } from '../sim/map.js';

// 71f1be2 원본 BFS에서 먼저 기록한 전체 좌표열의 SHA-256. 길이만 같은 다른 길도 잡는다.
const fixtures = [
  [[5,7,5,7], '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'],
  [[5,7,6,8], 'c8ec2abae7451f6a755901a2da84b18baad9f47b44a3293feec98d316dd437d2'],
  [[5,7,1,1], 'da6a18025b3acf8582dd131d6ccbee71d897400dea6be1cb7d4d70206bf091fd'],
  [[5,7,30,50], '36efd07fb20c208de98ba6403ba079cc284481edaf095f1e8b4db10ed84056aa'],
  [[50,4,460,460], '2b1eb30ce1dc9a53c6514766f390b463005678e1296baed8f546ff73bbb49dad'],
  [[63,120,378,240], '22c0bb425fd8204822279060d153e4081aadc34cb726aee3c496908f101eceb1'],
  [[5,7,0,0], '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'],
];
test('#98 all path coordinates match pre-optimization snapshots across repeated searches', () => {
  const w = createWorld(20260831);
  for (const batch of [fixtures, fixtures.toReversed(), fixtures]) {
    for (const [points, sha] of batch) {
      const result = bfsPath(w.map, ...points);
      assert.equal(createHash('sha256').update(JSON.stringify(result)).digest('hex'), sha);
    }
  }
});

test('#98 scratch state cannot leak across map size changes or edited walls', () => {
  const map = { w: 3, h: 3, tiles: Array(9).fill(TILE.GRASS) };
  const direct = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
  assert.deepEqual(bfsPath(map, 0, 1, 2, 1), direct);
  map.tiles[4] = TILE.WALL;
  assert.deepEqual(bfsPath(map, 0, 1, 2, 1), [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:2,y:1}]);
  map.tiles[1] = TILE.WALL; map.tiles[7] = TILE.WALL;
  assert.equal(bfsPath(map, 0, 1, 2, 1), null);
  const larger = { w: 513, h: 513, tiles: Array(513 * 513).fill(TILE.GRASS) };
  assert.deepEqual(bfsPath(larger, 0, 1, 2, 1), direct);
  map.tiles.fill(TILE.GRASS);
  assert.deepEqual(bfsPath(map, 0, 1, 2, 1), direct);
});
