// 고정 저작 맵 48×48 (PLAN §2). rng를 쓰지 않는 순수 상수 데이터 생성.
// 타일: 0=grass(가능) 1=road(가능) 2=floor(가능,실내) 3=wall(불가) 4=tree(불가) 5=water(불가)

export const MAP_W = 48;          // 기본 저작 영역 (§2)
export const MAP_W2 = 64;         // §16.5 1차 확장
export const MAP_H = 48;
export const MAP_H2 = 64;
export const MAP_W3 = 128;        // §16.6 2차 확장
export const MAP_H3 = 128;
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

// 술집 주입 — buildMap과 v5→v6 마이그레이션이 공유하는 단일 권위 (Codex 20차 항목 1).
// footprint (30,41) 7×5, 문 (33,41), 좌석 4개 고정 좌표. facilities 배열 끝에 append.
export function addBarTo(tiles, facilities) {
  if (facilities.some((f) => f.id === 'bar')) return;
  building(tiles, 30, 41, 7, 5, 33, 41);
  facilities.push({
    id: 'bar', type: 'bar', x: 30, y: 41, w: 7, h: 5,
    door: { x: 33, y: 41 },
    resources: [
      { id: 'seat0', kind: 'seat', x: 31, y: 42 },
      { id: 'seat1', kind: 'seat', x: 35, y: 42 },
      { id: 'seat2', kind: 'seat', x: 31, y: 44 },
      { id: 'seat3', kind: 'seat', x: 35, y: 44 },
    ],
  });
}

// 세계관 확장 시설 (§16.A) — 신규/마이그레이션 단일 권위. facilities 끝에 append (bar 방식).
export function addVenuesTo(tiles, facilities) {
  if (!facilities.some((f) => f.id === 'library')) {
    building(tiles, 3, 10, 7, 5, 6, 14);
    facilities.push({
      id: 'library', type: 'library', x: 3, y: 10, w: 7, h: 5,
      door: { x: 6, y: 14 },
      resources: [0, 1, 2, 3].map((k) => ({
        id: `seat${k}`, kind: 'seat', x: 4 + (k % 2) * 4, y: 11 + Math.floor(k / 2) * 2,
      })),
    });
  }
  if (!facilities.some((f) => f.id === 'market')) {
    building(tiles, 12, 10, 7, 5, 15, 14);
    facilities.push({
      id: 'market', type: 'market', x: 12, y: 10, w: 7, h: 5,
      door: { x: 15, y: 14 },
      resources: [0, 1].map((k) => ({
        id: `till${k}`, kind: 'till', x: 13 + k * 4, y: 12,
      })),
    });
  }
  if (!facilities.some((f) => f.id === 'pond')) {
    // 낚시터: 내부 3×2 물 + 둘레 잔디, 물가 스팟 4
    rect(tiles, 40, 43, 3, 2, TILE.WATER);
    facilities.push({
      id: 'pond', type: 'pond', x: 38, y: 42, w: 8, h: 5,
      door: { x: 39, y: 44 },
      resources: [
        { id: 'spot0', kind: 'spot', x: 39, y: 43 },
        { id: 'spot1', kind: 'spot', x: 43, y: 43 },
        { id: 'spot2', kind: 'spot', x: 39, y: 45 },  // 물 남쪽 잔디
        { id: 'spot3', kind: 'spot', x: 43, y: 45 },
      ],
    });
  }
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
      // 증축 침대 예비 슬롯 — 이 순서대로 사용 (§15.1.B)
      extraBedSlots: [{ x: hx + 2, y: hy + 2 }, { x: hx + 3, y: hy + 2 }],
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

  // 술집·확장 시설 — facilities 맨 끝 append (마이그레이션과 삽입 순서 동일)
  addBarTo(tiles, facilities);
  addVenuesTo(tiles, facilities);

  // §16.5/§16.6: 확장 체인 (신규 월드도 마이그레이션과 같은 헬퍼·같은 순서)
  const map = { w: MAP_W, h: MAP_H, tiles, facilities };
  expandMapTo64(map, null);
  expandMapTo128(map, null);
  return map;
}

// §16.5.A/§16.6: 좌표 보존 확장 — buildMap(신규)과 마이그레이션의 단일 권위 (파라미터화).
// 옛 외곽 물(구 경계 열·행, 코너 포함) 개방, 새 외곽 물 테두리, 주 도로(y23-24, x23-24) 연장.
export function expandMapTo(map, wear, W, H) {
  if (map.w >= W) return { map, wear };
  const oldW = map.w, oldH = map.h;
  const tiles = new Array(W * H).fill(TILE.GRASS);
  const newWear = new Array(W * H).fill(0);
  for (let y = 0; y < oldH; y++) {
    for (let x = 0; x < oldW; x++) {
      tiles[y * W + x] = map.tiles[y * oldW + x];
      newWear[y * W + x] = wear ? wear[y * oldW + x] : 0;
    }
  }
  // 옛 동·남 경계 물 개방 (코너 포함)
  for (let y = 0; y < oldH; y++) if (tiles[y * W + (oldW - 1)] === TILE.WATER) tiles[y * W + (oldW - 1)] = TILE.GRASS;
  for (let x = 0; x < oldW; x++) if (tiles[(oldH - 1) * W + x] === TILE.WATER) tiles[(oldH - 1) * W + x] = TILE.GRASS;
  // 새 외곽 물
  for (let x = 0; x < W; x++) { tiles[0 * W + x] = TILE.WATER; tiles[(H - 1) * W + x] = TILE.WATER; }
  for (let y = 0; y < H; y++) { tiles[y * W + 0] = TILE.WATER; tiles[y * W + (W - 1)] = TILE.WATER; }
  // 주 도로 연장
  for (let x = oldW - 2; x < W - 1; x++) { tiles[23 * W + x] = TILE.ROAD; tiles[24 * W + x] = TILE.ROAD; }
  for (let y = oldH - 2; y < H - 1; y++) { tiles[y * W + 23] = TILE.ROAD; tiles[y * W + 24] = TILE.ROAD; }
  map.w = W; map.h = H; map.tiles = tiles;
  return { map, wear: newWear };
}

// v7→v8 호환 래퍼 (마이그레이션 체인은 48→64→128 순서를 유지한다)
export function expandMapTo64(map, wear) {
  return expandMapTo(map, wear, MAP_W2, MAP_H2);
}

// §16.6: 128 확장 + 새 땅 간선 도로 (가로 y=70·세로 x=70 — 원거리 사분면 접근성)
export function expandMapTo128(map, wear) {
  const r = expandMapTo(map, wear, MAP_W3, MAP_H3);
  const W = map.w;
  if (map.tiles[70 * W + 70] !== undefined) {
    for (let x = 2; x < W - 1; x++) if (map.tiles[70 * W + x] === TILE.GRASS) map.tiles[70 * W + x] = TILE.ROAD;
    for (let y = 2; y < map.h - 1; y++) if (map.tiles[y * W + 70] === TILE.GRASS) map.tiles[y * W + 70] = TILE.ROAD;
  }
  return r;
}

// §16.6: 추가 공터 24곳 (plotId 8~31) — 간선 도로변, 사용 순서 = 배열 순서
export function extraPlots128() {
  const coords = [];
  for (const x of [72, 82, 92, 102, 112]) coords.push([x, 17], [x, 26]);   // 동측 밴드 10
  for (const y of [72, 82, 92, 102, 112]) coords.push([17, y], [26, y]);   // 남측 밴드 10
  coords.push([76, 74], [88, 86], [100, 98], [112, 110]);                   // 원거리 사분면 4
  return coords.map(([x, y], i) => ({ plotId: 8 + i, x, y, used: false }));
}

// §16.5.A: 공터 8곳 (7×5) — 사용 순서 = 배열 순서
export function defaultPlots() {
  return [
    [50, 4], [50, 14], [50, 30], [50, 42],
    [4, 50], [14, 50], [30, 50], [42, 50],
  ].map(([x, y], i) => ({ plotId: i, x, y, used: false }));
}

// §16.5.B: 완공 축조 — 좌표·id 규칙은 PLAN §16.5 확정 명세 그대로 (신규/마이그레이션 동일)
export function addBuilding(map, type, plot) {
  const { x, y } = plot;
  const count = map.facilities.filter((f) => f.type === type).length;
  const id = `${type}${count}`;
  const W = map.w;
  const bld = (bx, by, bw, bh, dx, dy) => {
    for (let j = by; j < by + bh; j++) for (let i = bx; i < bx + bw; i++) map.tiles[j * W + i] = TILE.WALL;
    for (let j = by + 1; j < by + bh - 1; j++) for (let i = bx + 1; i < bx + bw - 1; i++) map.tiles[j * W + i] = TILE.FLOOR;
    map.tiles[dy * W + dx] = TILE.FLOOR;
  };
  let fac;
  if (type === 'house') {
    bld(x, y, 6, 5, x + 2, y + 4);
    fac = {
      id, type, x, y, w: 6, h: 5, door: { x: x + 2, y: y + 4 },
      resources: [
        { id: 'bed0', kind: 'bed', x: x + 1, y: y + 1 },
        { id: 'bed1', kind: 'bed', x: x + 4, y: y + 1 },
      ],
      extraBedSlots: [{ x: x + 2, y: y + 2 }, { x: x + 3, y: y + 2 }],
    };
  } else if (type === 'cafe') {
    bld(x, y, 7, 5, x + 3, y + 4);
    fac = {
      id, type, x, y, w: 7, h: 5, door: { x: x + 3, y: y + 4 },
      resources: [
        { id: 'seat0', kind: 'seat', x: x + 1, y: y + 1 },
        { id: 'seat1', kind: 'seat', x: x + 4, y: y + 1 },
        { id: 'seat2', kind: 'seat', x: x + 1, y: y + 3 },
        { id: 'seat3', kind: 'seat', x: x + 4, y: y + 3 },
      ],
    };
  } else { // park: 무벽 스팟 6
    fac = {
      id, type: 'park', x, y, w: 7, h: 5, door: { x, y: y + 2 },
      resources: Array.from({ length: 6 }, (_, k) => ({
        id: `spot${k}`, kind: 'spot', x: x + 1 + (k % 3) * 2, y: y + 1 + Math.floor(k / 3) * 2,
      })),
    };
  }
  map.facilities.push(fac);
  return fac;
}

export function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.tiles[y * map.w + x];
  return t === TILE.GRASS || t === TILE.ROAD || t === TILE.FLOOR;
}
