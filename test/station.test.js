// §19.12 기차역 언락 판정 (이슈 #52) — stationDemand는 이제 파라미터가 아니라 판정이다.
//
// 계약: rngSim 미소비(정수 산술만) · 일일 평가 서브순서 고정(통계 다음) · 1회성 이벤트 ·
// 비가역 언락 · 충족도 %를 상태로 관측 · 직렬화 왕복 고정점 · 세이브 v49 마이그레이션.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, advance, hashWorld, serialize, deserialize, findNonFinite } from '../sim/index.js';
import { evalStationDemand, zoneAllowedTypes } from '../sim/society.js';
import { makeTransitState } from '../sim/world.js';
import { migrateWorld } from '../sim/migrate.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import { DEFAULT_LOGIC, validateLogic } from '../sim/logic.js';
import { plotBuildable } from '../sim/map.js';
import { industryStatus } from '../sim/industry.js';

const SEED = 7777;

// 판정만 따로 부를 때의 이벤트 수집기
function collectEmit(events) {
  return (type, simId, payload) => events.push({ type, simId, payload });
}

// 모든 심을 '무이동' 기준 상태로 — 판정 산술을 정확히 통제한다
function zeroTransport(w) {
  for (const s of w.sims) { s.longTrips = 0; s.longTripTiles = 0; s.hasCar = false; }
}

test('ST-1. 새 월드에 transit 관측 상태가 있고 값이 전부 유한하다', () => {
  const w = createWorld(SEED);
  assert.deepEqual(w.transit, makeTransitState(), '신규 월드와 makeTransitState가 같은 모양');
  assert.equal(w.transit.stationUnlocked, false);
  assert.equal(w.transit.unlockedDay, -1);
  assert.equal(w.transit.fulfillmentPct, 0);
  for (const s of w.sims) assert.equal(s.longTripTiles, 0, '장거리 칸수 누적기 초기값');
  assert.deepEqual(findNonFinite(w), [], 'undefined/NaN 없음');
});

test('ST-2. 경계 299/300 — 문턱 미만은 잠기고 정확히 문턱에서 언락된다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  // 299: 차 없음·거리 가중 없음 → demand = Σ longTrips = 299
  w.sims[0].longTrips = 299;
  let events = [];
  evalStationDemand(w, 1440, collectEmit(events));
  assert.equal(w.transit.demand, 299);
  assert.equal(w.transit.fulfillmentPct, 99, '299×100/300 = 99 (floor)');
  assert.equal(w.transit.stationUnlocked, false, '경계 미만은 잠김');
  assert.equal(events.length, 0, '이벤트 없음');
  assert.ok(!zoneAllowedTypes(w).includes('train_station'), 'zone 메뉴에 없음');

  // 300: 정확히 문턱 → 언락 + 1회성 이벤트
  w.sims[0].longTrips = 300;
  events = [];
  evalStationDemand(w, 2880, collectEmit(events));
  assert.equal(w.transit.demand, 300);
  assert.equal(w.transit.fulfillmentPct, 100);
  assert.equal(w.transit.stationUnlocked, true, '경계에서 언락 (≥)');
  assert.equal(w.transit.unlockedDay, 2, '언락된 날 기록');
  const ev = events.filter((e) => e.type === 'station_unlocked');
  assert.equal(ev.length, 1, '1회성 이벤트');
  assert.equal(ev[0].payload.demand, 300);
  assert.equal(ev[0].payload.threshold, 300);
  assert.equal(ev[0].payload.totalLongTrips, 300);
  assert.ok(zoneAllowedTypes(w).includes('train_station'), 'zone 메뉴에 등장');
});

test('ST-3. 차 보유 할인 — 차가 있는 심의 장거리는 stationCarOwnerPct%만 센다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  // 599회를 차 보유 심에게: floorDiv(599×50,100)=299 → 잠김
  w.sims[0].hasCar = true;
  w.sims[0].longTrips = 599;
  const events = [];
  evalStationDemand(w, 1440, collectEmit(events));
  assert.equal(w.transit.totalLongTrips, 599, '원 수치는 그대로 관측');
  assert.equal(w.transit.weightedTrips, 299, '할인 적용');
  assert.equal(w.transit.carsOwned, 1);
  assert.equal(w.transit.stationUnlocked, false);
  // 600회면 300 → 언락
  w.sims[0].longTrips = 600;
  evalStationDemand(w, 2880, collectEmit(events));
  assert.equal(w.transit.weightedTrips, 300);
  assert.equal(w.transit.stationUnlocked, true);
});

test('ST-4. 거리 가중 — 평균 장거리 칸수가 문턱 이상이면 수요가 커진다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  // 240회·평균 59칸: 계수 100 → 240 < 300 잠김
  w.sims[0].longTrips = 240;
  w.sims[0].longTripTiles = 240 * 59;
  evalStationDemand(w, 1440, collectEmit([]));
  assert.equal(w.transit.avgTripTiles, 59);
  assert.equal(w.transit.demand, 240);
  assert.equal(w.transit.stationUnlocked, false);
  // 같은 240회·평균 60칸: 계수 125 → 300 언락 (거리 분포가 판정에 들어간다)
  w.sims[0].longTripTiles = 240 * 60;
  evalStationDemand(w, 2880, collectEmit([]));
  assert.equal(w.transit.avgTripTiles, 60);
  assert.equal(w.transit.demand, 300, 'floorDiv(240×125, 100)');
  assert.equal(w.transit.stationUnlocked, true);
});

test('ST-5. 비가역 — 언락 뒤 수요가 줄어도 다시 잠기지 않고 이벤트도 다시 나지 않는다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  w.sims[0].longTrips = 500;
  let events = [];
  evalStationDemand(w, 1440, collectEmit(events));
  assert.equal(w.transit.stationUnlocked, true);
  assert.equal(events.filter((e) => e.type === 'station_unlocked').length, 1);
  // 수요가 사라져도 (이사·사망 등) 언락은 유지 — cityTier 승급과 같은 계약
  zeroTransport(w);
  events = [];
  evalStationDemand(w, 2880, collectEmit(events));
  assert.equal(w.transit.fulfillmentPct, 0, '충족도는 정직하게 0으로 내려간다');
  assert.equal(w.transit.stationUnlocked, true, '언락은 비가역');
  assert.equal(w.transit.unlockedDay, 1, '언락된 날은 그대로');
  assert.equal(events.length, 0, '재이벤트 없음');
  assert.ok(zoneAllowedTypes(w).includes('train_station'));
});

test('ST-6. 일일 평가 통합 — tick()이 매일 판정을 갱신하고 언락 이벤트를 낸다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  // 수요를 여러 심에 분산 (특정 심의 사망·이탈에 흔들리지 않게)
  for (let i = 0; i < 5; i++) w.sims[i].longTrips = 200;
  const events = tick(w, []); // t=1 → day 0 일일 평가 (lastDailyDay -1 → 0)
  const ev = events.filter((e) => e.type === 'station_unlocked');
  assert.equal(ev.length, 1, '일일 평가가 판정을 실행했다');
  assert.equal(w.transit.stationUnlocked, true);
  assert.ok(w.transit.totalLongTrips >= 1000, '관측 필드 갱신');
  assert.ok(w.transit.fulfillmentPct >= 100);
});

test('ST-7. 장거리 이동이 칸수를 함께 누적한다 (거리 분포의 원천)', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  advance(w, {}, 3 * 1440); // 3일 — 자연 이동으로 장거리가 쌓인다
  const total = w.sims.reduce((a, s) => a + s.longTrips, 0);
  const tiles = w.sims.reduce((a, s) => a + (s.longTripTiles ?? 0), 0);
  if (total > 0) {
    const min = w.logic.transport.longTripMin;
    assert.ok(tiles >= total * min, `장거리 ${total}회면 칸수는 최소 ${total}×${min}`);
    assert.equal(w.transit.avgTripTiles, Math.floor(tiles / total), '일일 판정이 평균을 관측');
  }
  assert.deepEqual(findNonFinite(w), [], '3일 뒤에도 undefined/NaN 없음');
});

test('ST-8. zone 계약 — 언락 전 tier_locked, 언락 후 bad_type (레시피는 후속 라운드)', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  w.treasury = 99999;
  const free = w.plots.find((p) => !p.used && plotBuildable(w.map, p));
  // 언락 전: 허용 타입에 없음 → tier_locked
  const evs0 = tick(w, [{ sequence: 0, command: 'zone', payload: { plotId: free.plotId, type: 'train_station', dir: 0 } }]);
  assert.ok(evs0.some((e) => e.type === 'input_rejected' && e.payload.reason === 'tier_locked'), '언락 전 잠김');
  // 언락 후: 허용은 되지만 ZONEABLE 레시피가 없음 → bad_type (§18.T3와 같은 대기 계약)
  w.transit.stationUnlocked = true;
  const free2 = w.plots.find((p) => !p.used && plotBuildable(w.map, p));
  const evs1 = tick(w, [{ sequence: 0, command: 'zone', payload: { plotId: free2.plotId, type: 'train_station', dir: 0 } }]);
  assert.ok(evs1.some((e) => e.type === 'input_rejected' && e.payload.reason === 'bad_type'), '레시피 미구현 대기');
  assert.equal(w.treasury, 99999, '거부된 주문은 국고를 건드리지 않는다');
});

test('ST-9. 직렬화 왕복 고정점 — 언락 전·후 모두 해시가 보존된다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  w.sims[0].longTrips = 500;
  advance(w, {}, 10);
  assert.equal(hashWorld(w), hashWorld(deserialize(serialize(w))), '언락 후 왕복 고정점');
  assert.equal(w.transit.stationUnlocked, true);
  assert.deepEqual(findNonFinite(w), [], '스냅샷에 삼켜질 값 없음');
});

test('ST-10. 결정성 — 같은 시드 두 세계가 일일 판정을 지나도 같은 해시다', () => {
  const a = createWorld(SEED);
  const b = createWorld(SEED);
  advance(a, {}, 2000); // 1440 초과 — 일일 판정 최소 2회 통과
  advance(b, {}, 2000);
  assert.equal(hashWorld(a), hashWorld(b), '판정이 rngSim을 소비하면 여기서 갈린다');
});

test('ST-11. 세이브 v49 마이그레이션 — transit·longTripTiles·새 logic 파라미터 설치', () => {
  const w = createWorld(SEED);
  // v48 세이브 흉내: §19.12 상태와 파라미터 제거
  delete w.transit;
  for (const s of w.sims) delete s.longTripTiles;
  delete w.logic.transport.stationCarOwnerPct;
  delete w.logic.transport.stationDistBoostMin;
  delete w.logic.transport.stationDistBoostPct;
  w.logic.logicSchemaVersion = 43;
  w.schemaVersion = 48;
  const m = migrateWorld(deserialize(serialize(w))); // 실제 로드 경로처럼 왕복 후 이관
  assert.equal(m.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(m.transit, makeTransitState(), '관측 상태 설치');
  for (const s of m.sims) assert.equal(s.longTripTiles, 0, '칸수 누적기는 소급하지 않고 0에서');
  assert.equal(m.logic.transport.stationCarOwnerPct, DEFAULT_LOGIC.transport.stationCarOwnerPct);
  assert.equal(m.logic.transport.stationDistBoostMin, DEFAULT_LOGIC.transport.stationDistBoostMin);
  assert.equal(m.logic.transport.stationDistBoostPct, DEFAULT_LOGIC.transport.stationDistBoostPct);
  assert.equal(m.logic.logicSchemaVersion, DEFAULT_LOGIC.logicSchemaVersion, 'mergeLogicDefaults 경유');
  assert.deepEqual(findNonFinite(m), [], '이관 후 유한성');
  // 이관된 세계도 판정이 돈다
  m.sims[0].longTrips = 400;
  evalStationDemand(m, 1440, collectEmit([]));
  assert.equal(m.transit.stationUnlocked, true);
});

test('ST-12. validateLogic — 새 파라미터의 시맨틱 범위', () => {
  const p = structuredClone(DEFAULT_LOGIC);
  assert.equal(validateLogic(p).ok, true, '기본값은 통과');
  p.transport.stationCarOwnerPct = 150; // 100 초과 — 차가 수요를 부풀리면 안 된다
  assert.equal(validateLogic(p).ok, false);
  p.transport.stationCarOwnerPct = 50;
  p.transport.stationDistBoostPct = 1001;
  assert.equal(validateLogic(p).ok, false);
  p.transport.stationDistBoostPct = 25;
  p.transport.stationDistBoostMin = 0;
  assert.equal(validateLogic(p).ok, false);
  p.transport.stationDistBoostMin = 60;
  assert.equal(validateLogic(p).ok, true);
});

test('ST-13. /api/industry의 H — 이동 수요가 directUnmet과 다른 축으로 실린다', () => {
  const w = createWorld(SEED);
  zeroTransport(w);
  w.sims[0].longTrips = 450;
  evalStationDemand(w, 1440, collectEmit([]));
  const st = industryStatus(w);
  const H = st.find((s) => s.code === 'H');
  assert.ok(H.transit, 'H에만 transit 블록');
  assert.equal(H.transit.stationUnlocked, true);
  assert.equal(H.transit.totalLongTrips, 450);
  assert.equal(H.transit.stationDemand, 300);
  assert.equal(H.transit.fulfillmentPct, 150);
  assert.equal(H.directUnmet, 0, '시설 부재 좌절과 섞이지 않는다');
  for (const s of st) if (s.code !== 'H') assert.equal('transit' in s, false, `${s.code}에는 없음`);
  // 조회는 세계를 바꾸지 않는다
  const before = hashWorld(w);
  industryStatus(w);
  assert.equal(hashWorld(w), before);
});
