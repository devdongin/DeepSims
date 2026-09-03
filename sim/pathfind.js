// BFS — 이웃 방문 순서 고정 북→동→남→서, 대각선 없음, 심은 타일을 막지 않음 (PLAN §2).
import { isWalkable } from './map.js';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

// 경로: 시작 제외, 목적지 포함한 [{x,y}] 배열. 도달 불가면 null.
let scratch = new Int32Array(0);
let visited = new Uint32Array(0);
let queue = new Int32Array(0);
let generation = 0; // 탐색별 세대: 다른 지도·타일 변경에도 과거 방문 여부가 섞이지 않는다.
export const pfStats = { calls: 0, ms: 0, cells: 0 }; // 계측 전용 (시뮬 동작 무영향)
export function bfsPath(map, sx, sy, tx, ty) {
  const _t0 = performance.now();
  const _r = bfsPathInner(map, sx, sy, tx, ty);
  pfStats.calls++; pfStats.ms += performance.now() - _t0;
  return _r;
}

function bfsPathInner(map, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  if (!isWalkable(map, tx, ty)) return null;
  if (scratch.length < map.w * map.h) {
    scratch = new Int32Array(map.w * map.h);
    visited = new Uint32Array(map.w * map.h);
    queue = new Int32Array(map.w * map.h);
    generation = 0;
  }
  generation = (generation + 1) >>> 0;
  if (generation === 0) { visited.fill(0); generation = 1; }
  const prev = scratch;
  const start = sy * map.w + sx;
  const goal = ty * map.w + tx;
  prev[start] = start;
  visited[start] = generation;
  queue[0] = start;
  let length = 1;
  for (let qi = 0; qi < length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % map.w, cy = (cur - cx) / map.w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (visited[ni] === generation) continue;
      visited[ni] = generation;
      prev[ni] = cur;
      queue[length++] = ni;
    }
  }
  pfStats.cells += length;
  if (visited[goal] !== generation) return null;
  const path = [];
  for (let cur = goal; cur !== start; cur = prev[cur]) {
    path.push({ x: cur % map.w, y: Math.floor(cur / map.w) });
  }
  path.reverse();
  return path;
}

export function manhattan(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
