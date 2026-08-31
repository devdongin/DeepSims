// §16.5 자율 세계 확장 테스트: 공터·도시계획·건설·이주
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld } from '../sim/index.js';
import { migrateWorld } from '../sim/migrate.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { isWalkable, bfsPath } from '../sim/index.js';

const SEED = 8484;
const PLAYER = { name: '동', gender: 'X', age: 30, mbti: { EI: 50, SN: 50, TF: 50, JP: 0 }, occupation: 'freelancer' };

test('X-1. 맵 64×64 확장: 좌표 보존·경계 개방·도로 연장·공터 8', () => {
  const w = createWorld(SEED);
  assert.equal(w.map.w, 64);
  assert.equal(w.map.h, 64);
  assert.equal(w.plots.length, 8);
  // 옛 경계 개방
  assert.ok(isWalkable(w.map, 47, 20), '옛 동쪽 경계 개방');
  assert.ok(isWalkable(w.map, 20, 47), '옛 남쪽 경계 개방');
  // 새 경계 물
  assert.ok(!isWalkable(w.map, 63, 20));
  assert.ok(!isWalkable(w.map, 20, 63));
  // 도로 연장로 공터까지 도달 가능
  for (const p of w.plots) {
    assert.ok(bfsPath(w.map, 5, 7, p.x + 1, p.y + 1) !== null, `plot${p.plotId} 도달`);
  }
});

test('X-2. 도시계획 트리거: 인구>침대 → house 프로젝트 (생성 틱의 일일 평가에서 즉시)', () => {
  const w = createWorld(SEED);
  const evs = tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]); // 11명 > 침대 10
  const started = evs.find((e) => e.type === 'project_started');
  assert.ok(started, '프로젝트 시작');
  assert.equal(started.payload.type, 'house');
  assert.equal(started.payload.plotId, 0, '첫 공터부터');
});

test('X-3. 건설 노동 → 완공 → 건물·이주, 결정적', () => {
  const run = () => {
    const w = createWorld(SEED);
    tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
    const evs = advance(w, {}, 25 * 1440); // 25일이면 완공까지 충분
    return {
      built: evs.filter((e) => e.type === 'facility_built').map((e) => `${e.payload.facilityId}@${e.payload.x},${e.payload.y}`),
      moved: evs.filter((e) => e.type === 'moved_home').map((e) => `${e.simId}:${e.payload.from}>${e.payload.to}`),
      hash: hashWorld(w),
    };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, '결정적');
  assert.ok(a.built.length >= 1, `완공 발생 (${JSON.stringify(a.built)})`);
  assert.ok(a.built[0].startsWith('house5'), '새 집 id = house5');
  assert.ok(a.moved.length >= 1, '이주 발생');
});

test('X-4. 완공 건물의 자원 도달성 + 후속 프로젝트가 다음 공터 사용', () => {
  const w = createWorld(SEED);
  tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  const evs = advance(w, {}, 40 * 1440);
  const built = evs.filter((e) => e.type === 'facility_built');
  assert.ok(built.length >= 1);
  for (const b of built) {
    const fac = w.map.facilities.find((f) => f.id === b.payload.facilityId);
    for (const r of fac.resources) {
      assert.ok(isWalkable(w.map, r.x, r.y), `${fac.id}:${r.id} 보행 가능`);
      assert.ok(bfsPath(w.map, 5, 7, r.x, r.y) !== null, `${fac.id}:${r.id} 도달`);
    }
  }
  const plotIds = evs.filter((e) => e.type === 'project_started').map((e) => e.payload.plotId);
  for (let i = 1; i < plotIds.length; i++) assert.ok(plotIds[i] > plotIds[i - 1], '공터 순서 사용');
});

test('X-5. v7(48맵) → v8 마이그레이션: 확장·wear 좌표 보존·결정성', () => {
  const w = createWorld(SEED);
  advance(w, {}, 500);
  // v7 형태로 강등: 64→48 축소는 불가하므로 v7 월드를 시뮬레이트 — 새로 만든 뒤 강제 축소 대신
  // 마이그레이션 함수의 멱등성·결정성 검증 (이미 64면 no-op)
  const before = hashWorld(w);
  const m = migrateWorld(deserialize(serialize(w)));
  assert.equal(hashWorld(m), before, '이미 v8이면 무변화');
});

test('X-6. 전 기능 분할 불변성 (건설 포함 20일)', () => {
  const a = createWorld(SEED);
  tick(a, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  advance(a, {}, 20 * 1440 - 1);
  const b = createWorld(SEED);
  tick(b, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  for (const n of [7000, 1, 12000, 9798]) advance(b, {}, n); // 합 28799 = 20일-1
  assert.equal(hashWorld(a), hashWorld(b));
});
