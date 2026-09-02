// 영속화 (PLAN §4) — better-sqlite3, WAL. 배치 = 트랜잭션 1개.
import Database from 'better-sqlite3';
import { createWorld } from '../sim/world.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { SCHEMA_VERSION, TICKS_PER_DAY, EVENT_TYPES } from '../sim/constants.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS snapshot(
  id INTEGER PRIMARY KEY CHECK(id IN (1,2)), tick INTEGER NOT NULL, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  tick INTEGER NOT NULL, ordinal INTEGER NOT NULL, type TEXT NOT NULL,
  sim_id INTEGER, payload TEXT NOT NULL, schema_version INTEGER NOT NULL,
  PRIMARY KEY(tick, ordinal));
CREATE TABLE IF NOT EXISTS event_daily_aggregates(
  day_start_tick INTEGER NOT NULL, category TEXT NOT NULL, sim_id INTEGER NOT NULL,
  count INTEGER NOT NULL, sum INTEGER NOT NULL,
  PRIMARY KEY(day_start_tick, category, sim_id));
CREATE TABLE IF NOT EXISTS inputs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_input_id TEXT UNIQUE NOT NULL,
  target_tick INTEGER NOT NULL, sequence INTEGER NOT NULL,
  command TEXT NOT NULL, payload TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0,
  UNIQUE(target_tick, sequence));
CREATE TABLE IF NOT EXISTS ops_log(ts_utc_ms INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
`;

export class Storage {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // 최초 생성 또는 로드. 무결성 위반(snapshot.tick != meta) 시 throw (PLAN §4: 손상 = 안전 정지).
  loadOrCreate({ seed, nowUtcMs }) {
    const metaGet = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    const epochRow = metaGet.get('epochUtcMs');
    if (!epochRow) {
      const world = createWorld(seed);
      const init = this.db.transaction(() => {
        const metaSet = this.db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)');
        metaSet.run('schemaVersion', String(SCHEMA_VERSION));
        metaSet.run('behaviorVersion', String(SCHEMA_VERSION));
        metaSet.run('seed', String(seed));
        metaSet.run('epochUtcMs', String(nowUtcMs));
        metaSet.run('lastSimulatedTick', '0');
        this.db.prepare('INSERT INTO snapshot(id, tick, state) VALUES (1, 0, ?)').run(serialize(world));
      });
      init();
      // §22.7 created: 이번 실행에서 세계를 **새로 만들었는지**. 호출자가 시드를 안내하는 데 쓴다.
      return { world, epochUtcMs: nowUtcMs, lastSimulatedTick: 0, speed: 1, created: true };
    }
    const epochUtcMs = Number(epochRow.value);
    const lastSimulatedTick = Number(metaGet.get('lastSimulatedTick').value);
    const snap = this.db.prepare('SELECT tick, state FROM snapshot WHERE id = 1').get();
    if (!snap || snap.tick !== lastSimulatedTick) {
      throw new Error(
        `DB corruption: snapshot.tick(${snap?.tick}) != meta.lastSimulatedTick(${lastSimulatedTick}). ` +
        `README의 수동 복구 절차를 따라 snapshot id=2로 복구하세요.`);
    }
    // 마이그레이션은 입력 처리 전 로드 시점에 완료하고, 메타·스냅샷에 원자 커밋 (PLAN §12.1)
    const raw = deserialize(snap.state);
    const wasV1 = (raw.schemaVersion ?? 1) < SCHEMA_VERSION;
    const world = migrateWorld(raw);
    if (wasV1) {
      const tx = this.db.transaction(() => {
        this.db.prepare('UPDATE snapshot SET state = ? WHERE id = 1').run(serialize(world));
        const metaSet = this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
        metaSet.run('schemaVersion', String(SCHEMA_VERSION));
        metaSet.run('behaviorVersion', String(SCHEMA_VERSION));
      });
      tx();
    }
    // §22.11 speed는 시뮬 상태가 아니지만 **epoch와 한 쌍**이다 — epoch는 speed를
    // 기준으로 고정되므로 둘을 따로 두면 재시작 때 어긋나 세계가 멈춘다. meta에
    // 함께 두어 짝을 유지한다 (틱 내용은 여전히 배속과 무관 — 결정성 불변).
    return { world, epochUtcMs, lastSimulatedTick, speed: this.getMetaInt('speed', 1) };
  }

  getMetaInt(key, def = 0) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? Number(row.value) : def;
  }

  setMetaInt(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, String(value));
  }

  // §22.11 시계 = (epoch, speed) 한 쌍. **반드시 함께 써야 한다** (Codex 100차 ②).
  // 따로 쓰면 그 사이에 프로세스가 죽었을 때 디스크에 짝이 안 맞는 쌍이 남고,
  // 이는 이 절이 고치려던 정지 버그와 같은 부류다 — 방향만 반대라 이번에는
  // 새 배속 + 옛 epoch로 잘못된 대량 따라잡기가 일어난다.
  setClock({ epochUtcMs, speed }) {
    const set = this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
    this.db.transaction(() => {
      set.run('epochUtcMs', String(epochUtcMs));
      set.run('speed', String(speed));
    })();
  }

  // 유효 대기 로직 계산용: 미적용 logic_update를 (target, sequence) 순으로 (PLAN §14.1 부팅 정합)
  getPendingLogicUpdates() {
    return this.db.prepare(
      `SELECT id, target_tick, sequence, payload FROM inputs
       WHERE applied = 0 AND command = 'logic_update' ORDER BY target_tick, sequence`)
      .all()
      .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // 배치 커밋: 스냅샷 회전 + events + inputs.applied + meta 원자 커밋 (PLAN §4)
  commitBatch({ world, events, appliedInputIds, epochUtcMs }) {
    const tx = this.db.transaction(() => {
      const cur = this.db.prepare('SELECT tick, state FROM snapshot WHERE id = 1').get();
      this.db.prepare('INSERT OR REPLACE INTO snapshot(id, tick, state) VALUES (2, ?, ?)').run(cur.tick, cur.state);
      this.db.prepare('INSERT OR REPLACE INTO snapshot(id, tick, state) VALUES (1, ?, ?)')
        .run(world.worldTick, serialize(world));
      const evIns = this.db.prepare(
        'INSERT INTO events(tick, ordinal, type, sim_id, payload, schema_version) VALUES (?, ?, ?, ?, ?, ?)');
      for (const e of events) {
        // 영속화 경계 강제 (PLAN §4): 타입 레지스트리 + payload ≤ 1KB. 위반 = 프로그래밍 오류.
        if (!EVENT_TYPES.includes(e.type)) throw new Error(`unregistered event type: ${e.type}`);
        const payloadJson = JSON.stringify(e.payload ?? {});
        if (Buffer.byteLength(payloadJson, 'utf8') > 1024) throw new Error(`event payload > 1KB: ${e.type}`);
        evIns.run(e.tick, e.ordinal, e.type, e.simId, payloadJson, SCHEMA_VERSION);
      }
      if (appliedInputIds.length > 0) {
        const mark = this.db.prepare('UPDATE inputs SET applied = 1 WHERE id = ?');
        for (const id of appliedInputIds) mark.run(id);
      }
      const metaSet = this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
      metaSet.run('lastSimulatedTick', String(world.worldTick));
      metaSet.run('epochUtcMs', String(epochUtcMs));
    });
    tx();
  }

  // 입력 등록: sequence 부여 + insert 동일 트랜잭션. 중복이면 원래 부여값 반환 (멱등, PLAN §3)
  addInput({ clientInputId, command, payload, targetTick }) {
    const tx = this.db.transaction(() => {
      const dup = this.db.prepare('SELECT target_tick, sequence FROM inputs WHERE client_input_id = ?')
        .get(clientInputId);
      if (dup) return { targetTick: dup.target_tick, sequence: dup.sequence, duplicate: true };
      const row = this.db.prepare('SELECT COALESCE(MAX(sequence), -1) + 1 AS seq FROM inputs WHERE target_tick = ?')
        .get(targetTick);
      this.db.prepare(
        'INSERT INTO inputs(client_input_id, target_tick, sequence, command, payload) VALUES (?, ?, ?, ?, ?)')
        .run(clientInputId, targetTick, row.seq, command, JSON.stringify(payload));
      return { targetTick, sequence: row.seq, duplicate: false };
    });
    return tx();
  }

  // 미적용 입력 조회 (target_tick ≤ upto), {tick: [입력...]} 형태
  getPendingInputs(uptoTick) {
    const rows = this.db.prepare(
      'SELECT id, target_tick, sequence, command, payload FROM inputs WHERE applied = 0 AND target_tick <= ? ORDER BY target_tick, sequence')
      .all(uptoTick);
    const byTick = {};
    for (const r of rows) {
      (byTick[r.target_tick] ??= []).push({
        id: r.id, sequence: r.sequence, command: r.command, payload: JSON.parse(r.payload),
      });
    }
    return byTick;
  }

  // 부팅 시 스테일 입력 재타게팅 (정상 경로에선 불가능, PLAN §3)
  retargetStaleInputs(lastSimulatedTick, nowUtcMs) {
    const stale = this.db.prepare(
      'SELECT id FROM inputs WHERE applied = 0 AND target_tick <= ? ORDER BY target_tick, sequence')
      .all(lastSimulatedTick);
    if (stale.length === 0) return;
    const tx = this.db.transaction(() => {
      const seqRow = this.db.prepare(
        'SELECT COALESCE(MAX(sequence), -1) + 1 AS seq FROM inputs WHERE target_tick = ?')
        .get(lastSimulatedTick + 1);
      let seq = seqRow.seq;
      const upd = this.db.prepare('UPDATE inputs SET target_tick = ?, sequence = ? WHERE id = ?');
      for (const r of stale) upd.run(lastSimulatedTick + 1, seq++, r.id);
      this.db.prepare('INSERT INTO ops_log(ts_utc_ms, type, detail) VALUES (?, ?, ?)')
        .run(nowUtcMs, 'inputs_retargeted', JSON.stringify({ count: stale.length, to: lastSimulatedTick + 1 }));
    });
    tx();
  }

  opsLog(nowUtcMs, type, detail) {
    this.db.prepare('INSERT INTO ops_log(ts_utc_ms, type, detail) VALUES (?, ?, ?)')
      .run(nowUtcMs, type, JSON.stringify(detail));
  }

  // 부재중 리포트: (cursor, upto] 이벤트 집계 + 하이라이트 (PLAN §5)
  //
  // 의미 계약 (§22.12 라이브 프루닝 후 명시 — Codex 교차 리뷰 ①):
  // counts/meals/works/moneyBySim은 **원본 events가 남아 있는 구간(최근 30게임일)**의
  // 세부 통계다. 그보다 오래된 구간은 prunedAggregates(일×타입×심 단위 집계)로만
  // 돌아온다 — 합산하지 않는 것은 의도다: 두 해상도(틱 단위 원본 vs 일 단위 집계)를
  // 한 숫자로 섞으면 리포트가 어느 쪽 정밀도인지 알 수 없게 된다. 표시층이 구분해
  // 보여준다. 이는 부팅 프루닝 시절에도 같았고, 라이브 프루닝은 이 경계가 세션 중에도
  // 굴러간다는 점만 다르다.
  getReport(cursorTick, uptoTick) {
    const counts = this.db.prepare(
      `SELECT type, COUNT(*) AS n FROM events WHERE tick > ? AND tick <= ? GROUP BY type`)
      .all(cursorTick, uptoTick);
    const meals = this.db.prepare(
      `SELECT sim_id, COUNT(*) AS n FROM events WHERE tick > ? AND tick <= ?
       AND type = 'action_completed' AND json_extract(payload, '$.action') = 'eat' GROUP BY sim_id`)
      .all(cursorTick, uptoTick);
    const works = this.db.prepare(
      `SELECT sim_id, COUNT(*) AS n FROM events WHERE tick > ? AND tick <= ?
       AND type = 'action_completed' AND json_extract(payload, '$.action') = 'work' GROUP BY sim_id`)
      .all(cursorTick, uptoTick);
    const moneyBySim = this.db.prepare(
      `SELECT sim_id, SUM(json_extract(payload, '$.delta')) AS delta FROM events
       WHERE tick > ? AND tick <= ? AND type = 'money_changed' GROUP BY sim_id`)
      .all(cursorTick, uptoTick);
    const highlights = this.db.prepare(
      `SELECT tick, ordinal, type, sim_id, payload FROM events WHERE tick > ? AND tick <= ?
       AND type IN ('argument', 'starving', 'lonely', 'input_rejected', 'election', 'married', 'started_dating', 'broke_up', 'immigrated', 'facility_built', 'festival', 'fell_sick')
       ORDER BY tick DESC, ordinal DESC LIMIT 50`)
      .all(cursorTick, uptoTick)
      .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
    // 집계는 일 단위라 커서가 하루 중간이면 그 날 전체 집계를 포함시킨다 (교집합 기준).
    // 부분일 정밀도 손실은 의도된 근사 — 원본 이벤트는 이미 프루닝됨.
    const aggregates = this.db.prepare(
      `SELECT day_start_tick, category, sim_id, count, sum FROM event_daily_aggregates
       WHERE day_start_tick + ${TICKS_PER_DAY} - 1 > ? AND day_start_tick <= ?`)
      .all(cursorTick, uptoTick);
    return {
      fromTick: cursorTick, toTick: uptoTick, nextCursor: uptoTick,
      counts, meals, works, moneyBySim, highlights, prunedAggregates: aggregates,
    };
  }

  // 30게임일 이전 이벤트를 일 집계로 축약 후 삭제 (PLAN §4). 삭제 행 수를 반환한다.
  // 부팅뿐 아니라 **라이브 일 경계에서도** 호출된다 (§22.12: 부팅에만 걸면 라이브 세션이
  // 길어질수록 events가 무한 증가 — 실측 107게임일 205,092행·53.8MB, 시간당 +31MB).
  // 정착 상태에서는 cutoff 이하가 딱 하루치라 PK(tick, ordinal) 범위 스캔으로 싸다.
  pruneEvents(lastSimulatedTick) {
    const cutoff = lastSimulatedTick - 30 * TICKS_PER_DAY;
    if (cutoff <= 0) return 0;
    const tx = this.db.transaction(() => {
      const rows = this.db.prepare(
        `SELECT (tick / ${TICKS_PER_DAY}) * ${TICKS_PER_DAY} AS day_start,
                type AS category, COALESCE(sim_id, -1) AS sim_id, COUNT(*) AS n,
                COALESCE(SUM(json_extract(payload, '$.delta')), 0) AS s
         FROM events WHERE tick <= ? GROUP BY day_start, category, sim_id`)
        .all(cutoff);
      const ins = this.db.prepare(
        `INSERT INTO event_daily_aggregates(day_start_tick, category, sim_id, count, sum)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(day_start_tick, category, sim_id)
         DO UPDATE SET count = count + excluded.count, sum = sum + excluded.sum`);
      for (const r of rows) ins.run(r.day_start, r.category, r.sim_id, r.n, r.s);
      return this.db.prepare('DELETE FROM events WHERE tick <= ?').run(cutoff).changes;
    });
    return tx();
  }

  close() { this.db.close(); }
}
