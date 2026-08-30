// 고정 저작 맵 48×48 (PLAN §2). rng를 쓰지 않는 순수 상수 데이터 생성.
// 타일: 0=grass(가능) 1=road(가능) 2=floor(가능,실내) 3=wall(불가) 4=tree(불가) 5=water(불가)

export const MAP_W = 48;
export const MAP_H = 48;
export const TILE = { GRASS: 0, ROAD: 1, FLOOR: 2, WALL: 3, TREE: 4, WATER: 5 };

function rect(tiles, x, y, w, h, v) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) tiles[j * MAP_W + i] = v;
}

// 건물: 둘레 wall + 내부 floor + 문(도로 쪽 wall 하나를 floor로)
function building(tiles, x, y, w, h, doorX, doorY) {
  rect(tiles, x, y, w, h, TILE.WALL);
  rect(tiles, x + 1, y + 1, w - 2, h - 2, TILE.FLOOR);
  tiles[doorY * MAP_W + doorX] = TILE.FLOOR;
}

export function buildMap() {
  const tiles = new Array(MAP_W * MAP_H).fill(TILE.GRASS);

  // 외곽 물 + 나무 띠
  rect(tiles, 0, 0, MAP_W, 1, TILE.WATER);
  rect(tiles, 0, MAP_H - 1, MAP_W, 1, TILE.WATER);
  rect(tiles, 0, 0, 1, MAP_H, TILE.WATER);
  rect(tiles, MAP_W - 1, 0, 1, MAP_H, TILE.WATER);

  // 도로 격자
  rect(tiles, 2, 23, 44, 2, TILE.ROAD);   // 가로 중앙
  rect(tiles, 23, 2, 2, 44, TILE.ROAD);   // 세로 중앙
  rect(tiles, 2, 8, 44, 1, TILE.ROAD);    // 가로 북
  rect(tiles, 2, 39, 44, 1, TILE.ROAD);   // 가로 남

  const facilities = [];

  // 집 5채 (6×5), 침대 2개씩. 문은 남쪽 도로 방향.
  const housePos = [
    [3, 2], [12, 2], [30, 2], [39, 2], [3, 33],
  ];
  housePos.forEach(([hx, hy], i) => {
    building(tiles, hx, hy, 6, 5, hx + 2, hy + 4);
    facilities.push({
      id: `house${i}`, type: 'house', x: hx, y: hy, w: 6, h: 5,
      door: { x: hx + 2, y: hy + 4 },
      resources: [
        { id: 'bed0', kind: 'bed', x: hx + 1, y: hy + 1 },
        { id: 'bed1', kind: 'bed', x: hx + 4, y: hy + 1 },
      ],
    });
  });

  // 직장 (8×6), 슬롯 6
  building(tiles, 30, 31, 8, 6, 33, 31);
  facilities.push({
    id: 'office', type: 'office', x: 30, y: 31, w: 8, h: 6,
    door: { x: 33, y: 31 },
    resources: [0, 1, 2, 3, 4, 5].map((k) => ({
      id: `slot${k}`, kind: 'slot', x: 31 + (k % 3) * 2, y: 33 + Math.floor(k / 3) * 2,
    })),
  });

  // 카페 (7×5), 좌석 4
  building(tiles, 12, 32, 7, 5, 15, 32);
  facilities.push({
    id: 'cafe', type: 'cafe', x: 12, y: 32, w: 7, h: 5,
    door: { x: 15, y: 32 },
    resources: [0, 1, 2, 3].map((k) => ({
      id: `seat${k}`, kind: 'seat', x: 13 + (k % 2) * 3, y: 33 + Math.floor(k / 2) * 2,
    })),
  });

  // 공원 (나무 테두리 + 잔디), 스팟 16 (심 10명 대비 사실상 무제한 — PLAN의 '무제한' 구현 근사)
  for (let i = 28; i < 44; i++) { tiles[12 * MAP_W + i] = TILE.TREE; tiles[21 * MAP_W + i] = TILE.TREE; }
  for (let j = 12; j < 22; j++) { tiles[j * MAP_W + 28] = TILE.TREE; tiles[j * MAP_W + 43] = TILE.TREE; }
  tiles[16 * MAP_W + 28] = TILE.GRASS; // 입구 서
  tiles[21 * MAP_W + 35] = TILE.GRASS; // 입구 남
  facilities.push({
    id: 'park', type: 'park', x: 28, y: 12, w: 16, h: 10,
    door: { x: 28, y: 16 },
    resources: Array.from({ length: 16 }, (_, k) => ({
      id: `spot${k}`, kind: 'spot', x: 30 + (k % 4) * 3, y: 14 + Math.floor(k / 4) * 2,
    })),
  });

  return { w: MAP_W, h: MAP_H, tiles, facilities };
}

export function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.tiles[y * map.w + x];
  return t === TILE.GRASS || t === TILE.ROAD || t === TILE.FLOOR;
}
