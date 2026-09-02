// 영속화 테스트 (PLAN §7 5, 7, 8, 16)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../db/storage.js';
import { Engine } from '../server/engine.js';
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

test('16d. 프루닝 보존: 타입·심별 총량이 집계로 정확히 이월된다', () => {
  // Codex 교차 리뷰 ④: 프루닝은 세부 이벤트를 지우지만 **총량은 잃지 않아야** 한다.
  // (getReport의 counts는 원본 구간 전용이고, 프루닝된 구간은 prunedAggregates로
  //  돌아온다는 의미 계약은 getReport 주석 참조 — 여기서는 이월 산수 자체를 검증)
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 1440);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  const before = st.db.prepare('SELECT type, COUNT(*) AS n FROM events GROUP BY type').all();
  const moneyBefore = st.db.prepare(
    "SELECT COALESCE(SUM(json_extract(payload, '$.delta')), 0) AS s FROM events WHERE type = 'money_changed'").get().s;
  st.pruneEvents(31 * 1440 + 1);
  for (const { type, n } of before) {
    const agg = st.db.prepare(
      'SELECT COALESCE(SUM(count), 0) AS n FROM event_daily_aggregates WHERE category = ?').get(type).n;
    assert.equal(agg, n, `${type} 총량 보존`);
  }
  const moneyAfter = st.db.prepare(
    "SELECT COALESCE(SUM(sum), 0) AS s FROM event_daily_aggregates WHERE category = 'money_changed'").get().s;
  assert.equal(moneyAfter, moneyBefore, 'money delta 합 보존');
  st.close();
});

// §22.12 회귀: 예전에는 pruneEvents가 **부팅 때 한 번만** 불려서, 서버를 켜 둔 채
// 오래 돌리면 events가 무한 증가했다 (실측 107게임일 205,092행·53.8MB, 시간당 +31MB).
// 이제 따라잡기 배치·라이브 커밋 양쪽에서 일 경계마다 프루닝된다.
test('16c. 라이브 프루닝(§22.12): 긴 세션에서 events가 30일 상한 안에 머문다', async () => {
  const st = new Storage(tmpDb());
  const DAY = 1440;
  // ① 따라잡기 경로: 32일치를 일 배치로 따라잡는다 → 31일차부터 매 배치 프루닝
  let nowMs = 1000; // 생성 시점이 epoch가 된다 — 그 뒤 시계를 32일 밀어 따라잡게 한다
  const engine = new Engine(st, { seed: SEED, now: () => nowMs });
  nowMs += 32 * DAY * 1000; // TICK_DURATION_MS = 1000
  await engine.catchUp();
  const cutoff1 = engine.world.worldTick - 30 * DAY;
  const min1 = st.db.prepare('SELECT MIN(tick) AS t FROM events').get().t;
  assert.ok(min1 > cutoff1, `따라잡기 중 프루닝: MIN(tick)=${min1} > cutoff=${cutoff1}`);
  const pruned1 = st.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE type = 'events_pruned'").get().n;
  assert.ok(pruned1 >= 1, '따라잡기 배치에서 events_pruned 기록');
  assert.ok(st.db.prepare('SELECT COUNT(*) AS n FROM event_daily_aggregates').get().n > 0, '집계 생성');
  // ② 라이브 경로: 이틀 더 라이브로 전진 → 일 경계마다 커밋 후행 프루닝
  engine.runLive(DAY);
  engine.runLive(DAY);
  engine.flushLive();
  const cutoff2 = engine.world.worldTick - 30 * DAY;
  const min2 = st.db.prepare('SELECT MIN(tick) AS t FROM events').get().t;
  assert.ok(min2 > cutoff2, `라이브 중 프루닝: MIN(tick)=${min2} > cutoff=${cutoff2}`);
  const pruned2 = st.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE type = 'events_pruned'").get().n;
  assert.ok(pruned2 >= pruned1 + 2, `라이브 일 경계 2회 프루닝 (${pruned1} → ${pruned2})`);
  // 상한: 남은 이벤트는 최근 30일 + 진행 중인 오늘 것뿐이다
  const stale = st.db.prepare('SELECT COUNT(*) AS n FROM events WHERE tick <= ?').get(cutoff2).n;
  assert.equal(stale, 0, '30일 이전 행 0');
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
