// 영속화 테스트 (PLAN §7 5, 7, 8, 16)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../db/storage.js';
import { createWorld, advance, hashWorld, deserialize } from '../sim/index.js';

const SEED = 777;
function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deepsims-')), 'test.db');
}

test('5a. 입력 멱등: 같은 clientInputId는 원래 부여값 반환', () => {
  const st = new Storage(tmpDb());
  st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const a = st.addInput({ clientInputId: 'abc', command: 'assign', payload: { simId: 1, actionType: 'eat' }, targetTick: 5 });
  const b = st.addInput({ clientInputId: 'abc', command: 'assign', payload: { simId: 1, actionType: 'eat' }, targetTick: 99 });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.targetTick, 5, '원래 target 유지');
  assert.equal(b.sequence, a.sequence);
  st.close();
});

test('5b. 같은 틱 sequence 순차 부여 + UNIQUE 보장', () => {
  const st = new Storage(tmpDb());
  st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const a = st.addInput({ clientInputId: 'x1', command: 'assign', payload: {}, targetTick: 10 });
  const b = st.addInput({ clientInputId: 'x2', command: 'assign', payload: {}, targetTick: 10 });
  assert.equal(a.sequence, 0);
  assert.equal(b.sequence, 1);
  st.close();
});

test('5c. 스테일 입력 재타게팅 + ops_log 기록', () => {
  const dbPath = tmpDb();
  const st = new Storage(dbPath);
  st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  st.addInput({ clientInputId: 's1', command: 'assign', payload: {}, targetTick: 3 });
  st.retargetStaleInputs(10, 2000); // lastSimulatedTick=10 → target 3은 스테일
  const pending = st.getPendingInputs(11);
  assert.ok(pending[11], '11틱으로 재타게팅');
  const ops = st.db.prepare('SELECT * FROM ops_log').all();
  assert.equal(ops[0].type, 'inputs_retargeted');
  st.close();
});

test('7. 커밋/로드 왕복: 배치 커밋 후 재오픈 시 동일 상태', () => {
  const dbPath = tmpDb();
  let st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 500);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  const h = hashWorld(world);
  st.close();
  st = new Storage(dbPath);
  const loaded = st.loadOrCreate({ seed: SEED, nowUtcMs: 9999 });
  assert.equal(loaded.lastSimulatedTick, 500);
  assert.equal(hashWorld(loaded.world), h);
  st.close();
});

test('7b. 무결성 위반(스냅샷/meta 불일치) 시 안전 정지', () => {
  const dbPath = tmpDb();
  let st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  advance(world, {}, 100);
  st.commitBatch({ world, events: [], appliedInputIds: [], epochUtcMs: 1000 });
  st.db.prepare("UPDATE meta SET value = '999' WHERE key = 'lastSimulatedTick'").run(); // 손상 주입
  st.close();
  st = new Storage(dbPath);
  assert.throws(() => st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 }), /corruption/);
  st.close();
});

test('8. 미커밋 틱 재생: 스냅샷 + 내구 입력만으로 동일 상태 재구성', () => {
  const dbPath = tmpDb();
  const st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  advance(world, {}, 100);
  st.commitBatch({ world, events: [], appliedInputIds: [], epochUtcMs: 1000 });
  // 입력은 내구 저장됐지만 시뮬레이션은 커밋 전 크래시 시나리오
  st.addInput({ clientInputId: 'c1', command: 'assign', payload: { simId: 2, actionType: 'play' }, targetTick: 101 });
  const inputsByTick = {
    101: st.getPendingInputs(101)[101],
  };
  const liveWorld = deserialize(st.db.prepare('SELECT state FROM snapshot WHERE id = 1').get().state);
  advance(liveWorld, inputsByTick, 50); // 크래시로 유실됐다고 가정한 라이브 진행
  const lostHash = hashWorld(liveWorld);
  // "재부팅": 커밋된 스냅샷에서 같은 내구 입력으로 재실행
  const rebooted = st.loadOrCreate({ seed: SEED, nowUtcMs: 9999 });
  const replayInputs = { 101: st.getPendingInputs(101)[101] };
  advance(rebooted.world, replayInputs, 50);
  assert.equal(hashWorld(rebooted.world), lostHash, '스냅샷+입력 로그만으로 동일 재생');
  st.close();
});

test('16. 리포트 커서: (cursor, upto] 경계 + 반복 호출 멱등', () => {
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 2000);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  const r1 = st.getReport(0, 2000);
  const r2 = st.getReport(0, 2000);
  assert.deepEqual(r1, r2, '멱등');
  assert.equal(r1.nextCursor, 2000);
  const r3 = st.getReport(2000, 2000);
  assert.equal(r3.counts.length, 0, '커서 exclusive');
  // 분할 조회 합 == 전체 조회
  const a = st.getReport(0, 1000), b = st.getReport(1000, 2000);
  const sum = (r, t) => r.counts.find((c) => c.type === t)?.n ?? 0;
  for (const { type } of r1.counts) {
    assert.equal(sum(a, type) + sum(b, type), sum(r1, type), type);
  }
  st.close();
});

test('16b. 프루닝: 30일 이전 이벤트 → 일 집계 축약', () => {
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 1440); // 1일치
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  const before = st.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  assert.ok(before > 0);
  st.pruneEvents(31 * 1440 + 1); // 31일 후 시점의 프루닝
  const after = st.db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  assert.equal(after, 0, '이벤트 삭제');
  const agg = st.db.prepare('SELECT COUNT(*) AS n FROM event_daily_aggregates').get().n;
  assert.ok(agg > 0, '집계 생성');
  st.close();
});

test('R5. 프루닝 후 하루 중간 커서 리포트가 그 날 집계를 포함', () => {
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 1440);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  st.pruneEvents(31 * 1440 + 1); // day0 이벤트가 집계로 축약됨
  const rep = st.getReport(100, 31 * 1440 + 1); // 커서가 day0 한가운데
  assert.ok(rep.prunedAggregates.length > 0, '교집합하는 날의 집계 포함');
  st.close();
});
