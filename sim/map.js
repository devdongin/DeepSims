import { rngInt } from './prng.js'; // §19 R-A 지형 생성 (별도 스트림 주입)
// 고정 저작 맵 48×48 (PLAN §2). rng를 쓰지 않는 순수 상수 데이터 생성.
// 타일: 0=grass(가능) 1=road(가능) 2=floor(가능,실내) 3=wall(불가) 4=tree(불가) 5=water(불가)

export const MAP_W = 48;          // 기본 저작 영역 (§2)
export const MAP_W2 = 64;         // §16.5 1차 확장
export const MAP_H = 48;
export const MAP_H2 = 64;
export const MAP_W3 = 128;        // §16.6 2차 확장
export const MAP_H3 = 128;
export const MAP_W4 = 512;        // §17.0 3차 확장
export const MAP_H4 = 512;
export const TILE = { GRASS: 0, ROAD: 1, FLOOR: 2, WALL: 3, TREE: 4, WATER: 5,
  // §19 R-A 지형 (append-only — 기존 코드 0..5 의미 불변)
  RIVER: 6, BANK: 7, SAND: 8, MOUNTAIN: 9, HILL: 10, BRIDGE: 11, SIDEWALK: 12 };

// 통행 가능 여부의 단일 권위 확장: 강·산은 막고, 다리·모래·언덕·강가는 통행 가능
export const BLOCKING_TILES = new Set([TILE.WATER, TILE.WALL, TILE.RIVER, TILE.MOUNTAIN]);

// 시설 대지·출입구는 공공 차도에서 보호한다. 보행 인도는 공원/연못의 열린 공간에 허용한다.
export function isRoadProtected(map, x, y, includeOpenAreas = true) {
  return map.facilities.some((f) => {
    if (f.door && Math.abs(x - f.door.x) + Math.abs(y - f.door.y) <= 1) return true;
    if (!includeOpenAreas && ['park', 'pond'].includes(f.type)) return false;
    return x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h;
  });
}

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

  // §16.5/§16.6/§17.0: 확장 체인 (신규 월드도 마이그레이션과 같은 헬퍼·같은 순서)
  const map = { w: MAP_W, h: MAP_H, tiles, facilities };
  expandMapTo64(map, null);
  expandMapTo128(map, null);
  expandMapTo512(map, null);
  addSocietyVenuesTo(map.tiles, map.facilities, map.w);
  addLeisureVenuesTo(map.tiles, map.facilities, map.w);
  addCivicVenuesTo(map.tiles, map.facilities, map.w); // §17.13
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

// §17.0: 512 확장 + 광역 간선 (가로 y=192·384, 세로 x=192·384 — GRASS만 도로화)
export function expandMapTo512(map, wear) {
  const r = expandMapTo(map, wear, MAP_W4, MAP_H4);
  const W = map.w;
  for (const yb of [192, 384]) {
    for (let x = 2; x < W - 1; x++) if (map.tiles[yb * W + x] === TILE.GRASS) map.tiles[yb * W + x] = TILE.ROAD;
  }
  for (const xb of [192, 384]) {
    for (let y = 2; y < map.h - 1; y++) if (map.tiles[y * W + xb] === TILE.GRASS) map.tiles[y * W + xb] = TILE.ROAD;
  }
  return r;
}

// §17.0: 추가 공터 64곳 (plotId 32~95) — 광역 간선변 밴드 + 원거리 4. 사용 순서 = 배열 순서.
export function extraPlots512() {
  const coords = [];
  for (const y of [64, 186, 378]) for (let x = 80; x <= 440; x += 40) coords.push([x, y]); // 가로 밴드 30
  for (const x of [63, 186, 378]) for (let y = 80; y <= 440; y += 40) coords.push([x, y]); // 세로 밴드 30
  coords.push([300, 300], [340, 340], [420, 420], [460, 460]);                              // 원거리 4
  return coords.map(([x, y], i) => ({ plotId: 32 + i, x, y, used: false }));
}

// §17.13: 치안·소방 — police_station/fire_station (단일 권위, §16.A 방식)
export function addCivicVenuesTo(tiles, facilities, W) {
  const bld = (bx, by, bw, bh, dx, dy) => {
    for (let j = by; j < by + bh; j++) for (let i = bx; i < bx + bw; i++) tiles[j * W + i] = TILE.WALL;
    for (let j = by + 1; j < by + bh - 1; j++) for (let i = bx + 1; i < bx + bw - 1; i++) tiles[j * W + i] = TILE.FLOOR;
    tiles[dy * W + dx] = TILE.FLOOR;
  };
  if (!facilities.some((f) => f.id === 'fire_station')) {
    bld(16, 64, 7, 5, 19, 64);
    facilities.push({
      id: 'fire_station', type: 'fire_station', x: 16, y: 64, w: 7, h: 5, door: { x: 19, y: 64 },
      resources: [0, 1, 2].map((k) => ({ id: `slot${k}`, kind: 'slot', x: 17 + k * 2, y: 66 })),
    });
  }
  if (!facilities.some((f) => f.id === 'police_station')) {
    bld(34, 64, 7, 5, 37, 64);
    facilities.push({
      id: 'police_station', type: 'police_station', x: 34, y: 64, w: 7, h: 5, door: { x: 37, y: 64 },
      resources: [0, 1, 2].map((k) => ({ id: `slot${k}`, kind: 'slot', x: 35 + k * 2, y: 66 })),
    });
  }
}

// §17.2: 공공시설 — hospital/city_hall/school (단일 권위, §16.A 방식)
export function addSocietyVenuesTo(tiles, facilities, W) {
  const bld = (bx, by, bw, bh, dx, dy) => {
    for (let j = by; j < by + bh; j++) for (let i = bx; i < bx + bw; i++) tiles[j * W + i] = TILE.WALL;
    for (let j = by + 1; j < by + bh - 1; j++) for (let i = bx + 1; i < bx + bw - 1; i++) tiles[j * W + i] = TILE.FLOOR;
    tiles[dy * W + dx] = TILE.FLOOR;
  };
  if (!facilities.some((f) => f.id === 'hospital')) {
    bld(58, 26, 8, 6, 61, 26);
    facilities.push({
      id: 'hospital', type: 'hospital', x: 58, y: 26, w: 8, h: 6, door: { x: 61, y: 26 },
      resources: [
        { id: 'clinic0', kind: 'clinic', x: 59, y: 28 },
        { id: 'clinic1', kind: 'clinic', x: 64, y: 28 },
        { id: 'slot0', kind: 'slot', x: 59, y: 30 },
        { id: 'slot1', kind: 'slot', x: 61, y: 30 },
        { id: 'slot2', kind: 'slot', x: 64, y: 30 },
      ],
    });
  }
  if (!facilities.some((f) => f.id === 'city_hall')) {
    bld(26, 56, 8, 6, 29, 56);
    facilities.push({
      id: 'city_hall', type: 'city_hall', x: 26, y: 56, w: 8, h: 6, door: { x: 29, y: 56 },
      resources: [0, 1, 2, 3].map((k) => ({
        id: `slot${k}`, kind: 'slot', x: 27 + (k % 2) * 5, y: 58 + Math.floor(k / 2) * 2,
      })),
    });
  }
  if (!facilities.some((f) => f.id === 'school')) {
    bld(44, 56, 7, 5, 47, 56);
    facilities.push({
      id: 'school', type: 'primary_school', x: 44, y: 56, w: 7, h: 5, door: { x: 47, y: 56 },
      resources: [0, 1, 2].map((k) => ({
        id: `slot${k}`, kind: 'slot', x: 45 + k * 2, y: 58,
      })),
    });
  }
}

// §17.10: 여가 시설 — restaurant/gym/cinema (단일 권위)
export function addLeisureVenuesTo(tiles, facilities, W) {
  const bld = (bx, by, bw, bh, dx, dy) => {
    for (let j = by; j < by + bh; j++) for (let i = bx; i < bx + bw; i++) tiles[j * W + i] = TILE.WALL;
    for (let j = by + 1; j < by + bh - 1; j++) for (let i = bx + 1; i < bx + bw - 1; i++) tiles[j * W + i] = TILE.FLOOR;
    tiles[dy * W + dx] = TILE.FLOOR;
  };
  if (!facilities.some((f) => f.id === 'restaurant')) {
    bld(72, 26, 7, 5, 75, 26);
    facilities.push({
      id: 'restaurant', type: 'restaurant', x: 72, y: 26, w: 7, h: 5, door: { x: 75, y: 26 },
      resources: [0, 1, 2, 3].map((k) => ({
        id: `seat${k}`, kind: 'seat', x: 73 + (k % 2) * 4, y: 27 + Math.floor(k / 2) * 2,
      })),
    });
  }
  if (!facilities.some((f) => f.id === 'gym')) {
    bld(72, 34, 7, 5, 75, 34);
    facilities.push({
      id: 'gym', type: 'gym', x: 72, y: 34, w: 7, h: 5, door: { x: 75, y: 34 },
      resources: [0, 1, 2, 3].map((k) => ({
        id: `spot${k}`, kind: 'spot', x: 73 + (k % 2) * 4, y: 35 + Math.floor(k / 2) * 2,
      })),
    });
  }
  if (!facilities.some((f) => f.id === 'cinema')) {
    bld(72, 42, 8, 6, 75, 42);
    facilities.push({
      id: 'cinema', type: 'cinema', x: 72, y: 42, w: 8, h: 6, door: { x: 75, y: 42 },
      resources: [0, 1, 2, 3, 4, 5].map((k) => ({
        id: `seat${k}`, kind: 'seat', x: 73 + (k % 3) * 2, y: 44 + Math.floor(k / 3) * 2,
      })),
    });
  }
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

// §17.23/18.T2: 공터 건축 가능 검증 — 지을 footprint(기본 최악 7×5, 회전 시 치수 전달) 전 타일 GRASS
export function plotBuildable(map, plot, w = 7, h = 5) {
  for (let j = plot.y; j < plot.y + h; j++) {
    for (let i = plot.x; i < plot.x + w; i++) {
      if (i < 0 || j < 0 || i >= map.w || j >= map.h) return false;
      if (map.tiles[j * map.w + i] !== TILE.GRASS) return false;
    }
  }
  return true;
}

// §16.5.B: 완공 축조 — 좌표·id 규칙은 PLAN §16.5 확정 명세 그대로 (신규/마이그레이션 동일)
// §18.T2 회전: dir 0..3, 90°마다 (lx,ly)→(h-1-ly, lx) — footprint·문·자원 단일 변환 (47차 합의)
function rotateLocal(lx, ly, w0, h0, dir) {
  let x = lx; let y = ly; let w = w0; let h = h0;
  for (let d = 0; d < dir; d++) {
    const nx = h - 1 - y; const ny = x;
    x = nx; y = ny;
    const t = w; w = h; h = t;
  }
  return { x, y };
}
export function rotatedSize(w0, h0, dir) { return dir % 2 === 0 ? { w: w0, h: h0 } : { w: h0, h: w0 }; }

// §18.T2: 타입별 기본 footprint (dir 0 기준) — zone 검증·회전 치수의 단일 권위
export const ZONE_DIMS = { house: [6, 5], cafe: [7, 5], office: [7, 5], park: [7, 5],
  primary_school: [8,6], middle_school: [8,6], high_school: [8,6],
  apartment: [7, 5], factory: [8, 6], mall: [8, 6], university: [8, 6] }; // §18.T3
// §18.T3: 주거 시설 판정 단일 권위 — 이민·합가·자녀·완공 이사·수면(HOME_ONLY는 homeId 기준이라 무관)
export function isResidence(f) { return f.type === 'house' || f.type === 'apartment'; }

export function zoneFootprint(type, dir) {
  const [w0, h0] = ZONE_DIMS[type];
  return rotatedSize(w0, h0, dir);
}

export function addBuilding(map, type, plot, dir = 0) {
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
  } else if (type === 'office') { // §17.21: 일자리 건설 — 카페와 동일 배열, kind desk
    bld(x, y, 7, 5, x + 3, y + 4);
    fac = {
      id, type, x, y, w: 7, h: 5, door: { x: x + 3, y: y + 4 },
      resources: [
        { id: 'desk0', kind: 'desk', x: x + 1, y: y + 1 },
        { id: 'desk1', kind: 'desk', x: x + 4, y: y + 1 },
        { id: 'desk2', kind: 'desk', x: x + 1, y: y + 3 },
        { id: 'desk3', kind: 'desk', x: x + 4, y: y + 3 },
      ],
    };
  } else if (type === 'apartment') { // §18.T3: 고밀 주거 — 침대 8
    bld(x, y, 7, 5, x + 3, y + 4);
    fac = {
      id, type, x, y, w: 7, h: 5, door: { x: x + 3, y: y + 4 },
      resources: Array.from({ length: 8 }, (_, k) => ({
        id: `bed${k}`, kind: 'bed', x: x + 1 + (k % 4) * 1 + (k % 4 >= 2 ? 1 : 0), y: y + 1 + Math.floor(k / 4) * 2,
      })),
      extraBedSlots: [],
    };
  } else if (type === 'factory') { // §18.T3: 고용 8 — 공해 트레이드오프
    bld(x, y, 8, 6, x + 4, y);
    fac = {
      id, type, x, y, w: 8, h: 6, door: { x: x + 4, y },
      resources: Array.from({ length: 8 }, (_, k) => ({
        id: `slot${k}`, kind: 'slot', x: x + 1 + (k % 4) * 2, y: y + 2 + Math.floor(k / 4) * 2,
      })),
    };
  } else if (type === 'mall') { // §18.T3: 쇼핑(till)+여가(seat) 복합 — 51차: till 결정적 명시
    bld(x, y, 8, 6, x + 4, y + 5);
    fac = {
      id, type, x, y, w: 8, h: 6, door: { x: x + 4, y: y + 5 },
      resources: [
        { id: 'till0', kind: 'till', x: x + 1, y: y + 1 },
        { id: 'till1', kind: 'till', x: x + 3, y: y + 1 },
        { id: 'till2', kind: 'till', x: x + 6, y: y + 1 },
        { id: 'seat0', kind: 'seat', x: x + 1, y: y + 4 },
        { id: 'seat1', kind: 'seat', x: x + 3, y: y + 4 },
        { id: 'seat2', kind: 'seat', x: x + 6, y: y + 4 },
      ],
    };
  } else if (['university','primary_school','middle_school','high_school'].includes(type)) {
    bld(x, y, 8, 6, x + 4, y + 5);
    fac = {
      id, type, x, y, w: 8, h: 6, door: { x: x + 4, y: y + 5 },
      resources: [0, 1, 2, 3].map((k) => ({ id: `slot${k}`, kind: 'slot', x: x + 1 + k * 2, y: y + 2 })),
    };
  } else { // park: 무벽 스팟 6
    fac = {
      id, type: 'park', x, y, w: 7, h: 5, door: { x, y: y + 2 },
      resources: Array.from({ length: 6 }, (_, k) => ({
        id: `spot${k}`, kind: 'spot', x: x + 1 + (k % 3) * 2, y: y + 1 + Math.floor(k / 3) * 2,
      })),
    };
  }
  // §18.T2: dir > 0 이면 로컬 좌표 전체 회전 (타일은 회전된 footprint로 재배치)
  if (dir > 0 && fac.w) {
    const w0 = fac.w; const h0 = fac.h;
    const sz = rotatedSize(w0, h0, dir);
    const rot = (px, py) => {
      const r = rotateLocal(px - x, py - y, w0, h0, dir);
      return { x: x + r.x, y: y + r.y };
    };
    // 타일 재배치: 기존 분기가 그린 dir0 벽·바닥을 지우고(초지) 회전본으로 다시
    if (fac.type !== 'park') {
      for (let j = y; j < y + Math.max(w0, h0); j++) for (let i = x; i < x + Math.max(w0, h0); i++) {
        if (i < x + w0 && j < y + h0) map.tiles[j * W + i] = TILE.GRASS;
      }
      for (let j = y; j < y + sz.h; j++) for (let i = x; i < x + sz.w; i++) map.tiles[j * W + i] = TILE.WALL;
      for (let j = y + 1; j < y + sz.h - 1; j++) for (let i = x + 1; i < x + sz.w - 1; i++) map.tiles[j * W + i] = TILE.FLOOR;
    }
    const nd = rot(fac.door.x, fac.door.y);
    fac.door = nd;
    if (fac.type !== 'park') map.tiles[nd.y * W + nd.x] = TILE.FLOOR;
    for (const r of fac.resources) { const p2 = rot(r.x, r.y); r.x = p2.x; r.y = p2.y; }
    if (fac.extraBedSlots) for (const s2 of fac.extraBedSlots) { const p2 = rot(s2.x, s2.y); s2.x = p2.x; s2.y = p2.y; }
    fac.w = sz.w; fac.h = sz.h;
  }
  fac.dir = dir;
  fac.revenue ??= 0; // §20.2 매출 원장 — 신축 시설도 0에서 시작 (이슈 #43)
  map.reachVersion = (map.reachVersion ?? 0) + 1; // §20.3 벽이 생기면 도달 영역이 바뀐다
  map.facilities.push(fac);
  return fac;
}

// §20.3 도달 가능 영역 (Codex 80차 ②). 심은 타일을 막지 않으므로 연결성은 **타일에만** 의존한다.
// 사회적 중력이 강물 건너·산 너머 시설을 이기게 되면 no_path가 폭증하므로,
// 같은 영역이 아닌 시설에는 중력을 주지 않는다.
// 캐시는 map.tiles 객체를 키로 하는 WeakMap — 세이브에 들어가지 않고 해시에 영향이 없다.
// 재계산은 고정된 주사 순서라 항상 같은 라벨을 낸다 (결정성 보존).
const regionCache = new WeakMap();
function regionsOf(map) {
  const hit = regionCache.get(map.tiles);
  if (hit !== undefined && hit.version === (map.reachVersion ?? 0)) return hit.comp;
  const W = map.w, H = map.h;
  const comp = new Int32Array(W * H).fill(-1);
  let next = 0;
  const queue = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (comp[i] !== -1 || !isWalkable(map, x, y)) continue;
      const label = next++;
      comp[i] = label;
      queue.length = 0;
      queue.push(i);
      for (let qi = 0; qi < queue.length; qi++) {
        const cur = queue[qi];
        const cx = cur % W, cy = (cur - cx) / W;
        // BFS와 같은 이웃 순서 (북→동→남→서)
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (comp[ni] !== -1 || !isWalkable(map, nx, ny)) continue;
          comp[ni] = label;
          queue.push(ni);
        }
      }
    }
  }
  regionCache.set(map.tiles, { version: map.reachVersion ?? 0, comp });
  return comp;
}

// 두 지점이 서로 오갈 수 있는가. 둘 중 하나라도 통행 불가 타일이면 false.
export function sameRegion(map, ax, ay, bx, by) {
  if (!isWalkable(map, ax, ay) || !isWalkable(map, bx, by)) return false;
  const comp = regionsOf(map);
  return comp[ay * map.w + ax] === comp[by * map.w + bx];
}

export function isWalkable(map, x, y) {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
  const t = map.tiles[y * map.w + x];
  // §19 R-A: 강·산·물·벽만 막는다 (다리·모래·언덕·강가는 통행 가능 — 지형이 도시 형태를 만든다)
  return !BLOCKING_TILES.has(t) && t !== TILE.TREE;
}

// §19 R-A 지형 생성 (61차 합의: 별도 rngTerrain 스트림 1회 생성, 결과를 세이브에 고정,
// 구시가 0..CORE는 절대 재생성 금지). 강은 다리로만 건너고 산은 막는다 — 이동 제약이
// 도시 형태를 만든다(시티즈 스카이라인의 지형 제약 설계).
const CORE = 140; // 보존 경계: 구시가 + 여유
export function generateTerrain(map, seedRng, plots = null) {
  const W = map.w, H = map.h;
  const idx = (x, y) => y * W + x;
  const outside = (x, y) => x >= CORE || y >= CORE; // 구시가 밖에만 조각
  // §19 R-A (63차 ①): 공터 footprint 보호 — 지형이 공터를 덮으면 plotBuildable(GRASS 전수)이
  // 영원히 실패해 건설 불가가 된다. 최악 크기 7×5 + 여유 1칸을 금지 영역으로 둔다.
  const reserved = new Set();
  for (const p of (plots ?? [])) {
    for (let j = p.y - 1; j < p.y + 6; j++) for (let i = p.x - 1; i < p.x + 8; i++) {
      if (i >= 0 && j >= 0 && i < W && j < H) reserved.add(j * W + i);
    }
  }
  const paint = (x, y, t) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    if (!outside(x, y)) return;
    if (reserved.has(idx(x, y))) return; // 공터 보호 (63차 ①)
    if (map.tiles[idx(x, y)] !== TILE.GRASS) return; // 기존 지물 절대 침범 금지
    map.tiles[idx(x, y)] = t;
  };

  // 1) 강 2줄 — 사행(蛇行)하며 남동으로 흐른다. 폭 2~3, 양쪽에 강가.
  for (let r = 0; r < 2; r++) {
    let x = CORE + 20 + rngInt(seedRng, 60) + r * 120;
    for (let y = CORE; y < H - 2; y += 1) {
      const wobble = rngInt(seedRng, 3) - 1; // -1..1
      x = Math.max(CORE + 2, Math.min(W - 3, x + wobble));
      const width = 2 + (rngInt(seedRng, 4) === 0 ? 1 : 0);
      for (let d = 0; d < width; d++) paint(x + d, y, TILE.RIVER);
      paint(x - 1, y, TILE.BANK);
      paint(x + width, y, TILE.BANK);
    }
  }

  // 2) 산맥 — 북동 모서리에 덩어리, 주변은 언덕
  const ridges = 3;
  for (let k = 0; k < ridges; k++) {
    let cx = CORE + 60 + rngInt(seedRng, 200);
    let cy = 10 + rngInt(seedRng, 80);
    for (let step = 0; step < 90; step++) {
      cx = Math.max(2, Math.min(W - 3, cx + rngInt(seedRng, 3) - 1));
      cy = Math.max(2, Math.min(H - 3, cy + rngInt(seedRng, 3) - 1));
      const rad = 1 + rngInt(seedRng, 3);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d <= rad) paint(cx + dx, cy + dy, TILE.MOUNTAIN);
        else if (d === rad + 1) paint(cx + dx, cy + dy, TILE.HILL);
      }
    }
  }

  // 3) 남쪽 바다 + 모래 해변 (지도 남단 띠)
  const shore = H - 24 - rngInt(seedRng, 10);
  for (let y = shore; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!outside(x, y)) continue;
      const depth = y - shore;
      if (depth <= 1) paint(x, y, TILE.SAND);
      else paint(x, y, TILE.WATER);
    }
  }

  // 4) 다리 — 각 강줄기를 가로지르는 통로 (도달성 보장: 강 폭 전체를 BRIDGE로)
  const bridgeRows = [CORE + 30, CORE + 90, CORE + 160, CORE + 240];
  for (const by of bridgeRows) {
    if (by >= H - 2) continue;
    for (let x = 1; x < W - 1; x++) {
      if (map.tiles[idx(x, by)] === TILE.RIVER) map.tiles[idx(x, by)] = TILE.BRIDGE;
    }
  }
  return map;
}
