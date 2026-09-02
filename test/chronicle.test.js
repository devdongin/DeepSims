// §22.24 부재중 연대기 (이슈 #90) — 리포트 구성 규칙 회귀 테스트.
// 읽기 전용 투영이므로 시뮬 결정성과 무관하지만, 선별 규칙 자체가 결정적이어야
// "같은 공백 = 같은 이야기"가 성립한다. lonely 편중(48/50)의 재발을 여기서 막는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Storage } from '../db/storage.js';
import { selectChronicle, CHRONICLE_PRIORITY, PER_KIND_CAP, TOTAL_BUDGET } from '../server/chronicle.js';
import { advance } from '../sim/index.js';

const SEED = 777;
function tmpDb() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deepsims-')), 'test.db');
}

// 통제된 이벤트만 커밋하기 위한 헬퍼 — advance의 실제 이벤트는 버리고 합성 목록만 넣는다.
function storageWith(events, upto = 2000) {
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  advance(world, {}, upto);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  return st;
}

let nextOrdinal = 0;
function ev(tick, type, simId, payload = {}) {
  return { tick, ordinal: nextOrdinal++, type, simId, payload };
}

test('C1. 종류별 상한: 고빈도 이벤트가 연대기를 다 먹지 않는다 (수치는 counts로 보존)', () => {
  const events = [];
  for (let i = 0; i < 20; i++) events.push(ev(10 + i, 'lonely', 1, {}));
  for (let i = 0; i < 20; i++) events.push(ev(100 + i, 'helped', 2, { toSimId: 3, why: 'hungry' }));
  events.push(ev(500, 'died', 4, { name: '태호', age: 71, cause: 'illness', pop: 62 }));
  events.push(ev(600, 'married', 5, { withSimId: 6 }));
  events.push(ev(700, 'election', 7, { candidates: [7, 8], votes: [30, 20], incumbent: 8 }));
  const st = storageWith(events);
  const rep = st.getReport(0, 2000);
  const kinds = rep.chronicle.map((c) => c.type);
  assert.ok(!kinds.includes('lonely'), 'lonely는 연대기가 아니라 집계로 접힌다');
  assert.equal(kinds.filter((k) => k === 'helped').length, PER_KIND_CAP, '종류별 상한');
  for (const must of ['died', 'married', 'election']) assert.ok(kinds.includes(must), must);
  // 상한을 넘친 종류는 **최근 것**을 남긴다 (남긴 helped의 tick이 잘린 것보다 뒤)
  const heldTicks = rep.chronicle.filter((c) => c.type === 'helped').map((c) => c.tick);
  assert.equal(Math.min(...heldTicks), 100 + 20 - PER_KIND_CAP, '오래된 쪽이 잘린다');
  // 시간순 서사: (tick, ordinal) 오름차순
  for (let i = 1; i < rep.chronicle.length; i++) {
    const a = rep.chronicle[i - 1], b = rep.chronicle[i];
    assert.ok(a.tick < b.tick || (a.tick === b.tick && a.ordinal < b.ordinal), '시간순');
  }
  // 수치를 숨기지 않는다: 접혀도 총계는 counts에 그대로
  const count = (t) => rep.counts.find((c) => c.type === t)?.n ?? 0;
  assert.equal(count('lonely'), 20);
  assert.equal(count('helped'), 20);
  st.close();
});

test('C2. 총 예산: 낮은 우선순위부터 줄고, 사망은 끝까지 남는다 (결정적)', () => {
  const rows = [];
  let t = 1;
  for (const kind of CHRONICLE_PRIORITY) {
    for (let i = 0; i < PER_KIND_CAP; i++) rows.push(ev(t++, kind, 1, {}));
  }
  const a = selectChronicle(rows);
  const b = selectChronicle(rows);
  assert.deepEqual(a, b, '같은 입력 = 같은 이야기');
  assert.ok(a.length <= TOTAL_BUDGET, '예산 준수');
  const n = (kind) => a.filter((r) => r.type === kind).length;
  assert.equal(n('died'), PER_KIND_CAP, '최고 우선순위는 온전히 남는다');
  assert.equal(n('fell_sick'), 1, '최저 우선순위는 1건까지 줄어든다 (1차 패스 floor)');
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].tick < a[i].tick, '시간순');
});

test('C2b. 예산이 아주 작으면 2차 패스가 종류째 비운다 — 위 종류부터 살아남는다', () => {
  const rows = [];
  let t = 1;
  const kinds = ['died', 'married', 'helped', 'festival', 'fell_sick'];
  for (const kind of kinds) { rows.push(ev(t++, kind, 1, {})); rows.push(ev(t++, kind, 1, {})); }
  const out = selectChronicle(rows, { budget: 3 });
  assert.deepEqual(out.map((r) => r.type).sort(), ['died', 'helped', 'married']);
  // 종류당 남은 1건은 그 종류의 **최근** 것
  for (const kind of ['died', 'married', 'helped']) {
    const kept = out.find((r) => r.type === kind);
    const both = rows.filter((r) => r.type === kind);
    assert.equal(kept.tick, both[1].tick, `${kind}: 최근 것`);
  }
});

test('C3. 죽은 사람의 이름: deadNames가 보존 창 전체에서 모인다 (커서 구간 밖 사망 포함)', () => {
  const events = [
    ev(300, 'died', 9, { name: '연희', age: 84, cause: 'age', pop: 60 }),
    ev(300, 'bereaved', 10, { lostSimId: 9 }),
    // 이전 리포트 구간에서 죽은 부모를 이번 구간의 자립 문장이 참조하는 시나리오
    ev(600, 'child_settled', 11, { name: '한별', parentA: 9, parentB: 10, homeId: 'house1' }),
  ];
  const st = storageWith(events);
  const rep = st.getReport(0, 2000);
  assert.equal(rep.deadNames[9], '연희');
  assert.ok(rep.chronicle.some((c) => c.type === 'bereaved'), '사별이 연대기에 오른다');
  // 커서가 사망을 지나친 뒤에도 이름이 나온다 (Codex 리뷰 P2)
  const later = st.getReport(500, 2000);
  assert.deepEqual(later.chronicle.map((c) => c.type), ['child_settled'], '사망·사별은 구간 밖');
  assert.equal(later.deadNames[9], '연희', '이름은 보존 창 전체에서');
  st.close();
});

test('C3b. deadNames 보존 창: 30일(프루닝 기준)보다 오래된 사망 이름은 전송하지 않는다', () => {
  const events = [ev(300, 'died', 9, { name: '연희', age: 84, cause: 'age', pop: 60 })];
  const st = storageWith(events);
  assert.equal(st.getReport(100, 2000).deadNames[9], '연희', '창 안');
  const far = st.getReport(45000, 50000); // upto-30일 = 6800 > 사망 tick 300
  assert.ok(!(9 in far.deadNames), '창 밖 — 프루닝 시점과 무관하게 같은 출력');
  const wide = st.getReport(100, 50000); // 커서가 더 과거를 보면 그 구간의 사망은 포함
  assert.equal(wide.deadNames[9], '연희');
  st.close();
});

test('C4. 커서 경계 (cursor, upto] + 멱등', () => {
  const events = [
    ev(1000, 'married', 1, { withSimId: 2 }),
    ev(1001, 'died', 3, { name: '준호', age: 90, cause: 'age', pop: 59 }),
  ];
  const st = storageWith(events);
  const r1 = st.getReport(1000, 2000);
  const r2 = st.getReport(1000, 2000);
  assert.deepEqual(r1, r2, '멱등');
  assert.deepEqual(r1.chronicle.map((c) => c.type), ['died'], 'tick=cursor는 제외 (exclusive)');
  st.close();
});

test('C5. 총계 한 줄: 심별 나열 대신 스칼라 + 최대 증감자 (동률은 sim_id 낮은 쪽)', () => {
  const events = [
    ev(10, 'action_completed', 1, { action: 'eat' }),
    ev(11, 'action_completed', 1, { action: 'eat' }),
    ev(12, 'action_completed', 2, { action: 'eat' }),
    ev(13, 'action_completed', 2, { action: 'work' }),
    ev(20, 'money_changed', 1, { delta: 500, balance: 1500 }),
    ev(21, 'money_changed', 3, { delta: 500, balance: 900 }), // 동률 — sim 1이 이겨야 한다
    ev(22, 'money_changed', 2, { delta: -200, balance: 100 }),
    ev(23, 'money_changed', 2, { delta: 100, balance: 200 }),
  ];
  const st = storageWith(events);
  const rep = st.getReport(0, 2000);
  assert.equal(rep.totals.meals, 3);
  assert.equal(rep.totals.works, 1);
  assert.equal(rep.totals.moneyDelta, 900);
  assert.deepEqual(rep.totals.topEarner, { simId: 1, delta: 500 });
  assert.deepEqual(rep.totals.topSpender, { simId: 2, delta: -100 });
  // §22.8: 화면이 안 쓰는 옛 필드(심별 목록·lonely 편중 highlights)는 보내지 않는다
  for (const gone of ['meals', 'works', 'moneyBySim', 'highlights']) {
    assert.ok(!(gone in rep), `${gone} 필드 제거`);
  }
  st.close();
});

test('C6. 프루닝 집계 전송: 화면이 읽는 (day, category, count)만 — sim_id·sum 미전송', () => {
  const st = new Storage(tmpDb());
  const { world } = st.loadOrCreate({ seed: SEED, nowUtcMs: 1000 });
  const events = advance(world, {}, 1440);
  st.commitBatch({ world, events, appliedInputIds: [], epochUtcMs: 1000 });
  st.pruneEvents(31 * 1440 + 1);
  const rep = st.getReport(100, 31 * 1440 + 1);
  assert.ok(rep.prunedAggregates.length > 0, '교집합하는 날의 집계 포함');
  assert.deepEqual(Object.keys(rep.prunedAggregates[0]).sort(), ['category', 'count', 'day_start_tick']);
  // 같은 (day, category)가 심별로 쪼개져 중복 전송되지 않는다 (§22.8, Codex 리뷰 P1)
  const keys = rep.prunedAggregates.map((a) => `${a.day_start_tick}:${a.category}`);
  assert.equal(new Set(keys).size, keys.length);
  st.close();
});
