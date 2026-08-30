// BFS — 이웃 방문 순서 고정 북→동→남→서, 대각선 없음, 심은 타일을 막지 않음 (PLAN §2).
import { isWalkable } from './map.js';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N, E, S, W

// 경로: 시작 제외, 목적지 포함한 [{x,y}] 배열. 도달 불가면 null.
export function bfsPath(map, sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  if (!isWalkable(map, tx, ty)) return null;
  const prev = new Int32Array(map.w * map.h).fill(-1);
  const start = sy * map.w + sx;
  const goal = ty * map.w + tx;
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % map.w, cy = (cur - cx) / map.w;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const ni = ny * map.w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
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
