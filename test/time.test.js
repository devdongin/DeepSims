// 시간 모델 테스트 (PLAN §7 6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTarget } from '../sim/time.js';
import { createWorld, advance, hashWorld } from '../sim/index.js';
import { Engine } from '../server/engine.js';
import { Storage } from '../db/storage.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TICK = 1000;
const MAX = 240 * 1440; // §22.1 따라잡기 클램프 (게임 2년치)

test('6a. 기본: 경과 실시간 → 틱', () => {
  const r = computeTarget({ nowUtcMs: 100 * TICK, epochUtcMs: 0, lastSimulatedTick: 50 });
  assert.equal(r.target, 100);
  assert.equal(r.clamped, false);
  assert.equal(r.newEpochUtcMs, 0);
});

test('6b. 시계 역행: target이 lastSimulatedTick 아래로 내려가지 않음', () => {
  const r = computeTarget({ nowUtcMs: 10 * TICK, epochUtcMs: 0, lastSimulatedTick: 500 });
  assert.equal(r.target, 500);
});

test('6c. 30일 클램프 + 앵커 재고정: 재계산 시 target 불변', () => {
  const now = (MAX + 99999) * TICK;
  const r1 = computeTarget({ nowUtcMs: now, epochUtcMs: 0, lastSimulatedTick: 0 });
  assert.equal(r1.target, MAX);
  assert.equal(r1.clamped, true);
  // 재고정된 epoch로 같은 now에서 재계산 → 같은 target (초과분 영구 폐기 검증, PLAN §1)
  const r2 = computeTarget({ nowUtcMs: now, epochUtcMs: r1.newEpochUtcMs, lastSimulatedTick: 0 });
  assert.equal(r2.target, MAX);
  assert.equal(r2.clamped, false, '폐기된 시간이 재등장하지 않음');
});

test('6d. 전진 점프 = 오프라인 경과와 동일 취급', () => {
  const r = computeTarget({ nowUtcMs: 5000 * TICK, epochUtcMs: 0, lastSimulatedTick: 100 });
  assert.equal(r.target, 5000);
});

test('T-8. §20 배속: 목표 틱만 배율, 시뮬 결과는 불변', () => {
  const base = { nowUtcMs: 60_000, epochUtcMs: 0, lastSimulatedTick: 0 };
  assert.equal(computeTarget({ ...base }).target, 60, 'x1 = 60틱');
  assert.equal(computeTarget({ ...base, speed: 2 }).target, 120, 'x2 = 2배');
  assert.equal(computeTarget({ ...base, speed: 3 }).target, 180, 'x3 = 3배');
  // 같은 틱 수를 진행하면 배속과 무관하게 세계가 동일하다 (결정성 계약)
  const a = createWorld(4242);
  const b = createWorld(4242);
  advance(a, {}, 500);
  advance(b, {}, 500);
  assert.equal(hashWorld(a), hashWorld(b), '틱 수가 같으면 결과 동일');
  // 배속 변경 시 epoch 재기준화가 시간축을 연속으로 유지한다
  const t1 = computeTarget({ nowUtcMs: 100_000, epochUtcMs: 0, lastSimulatedTick: 100, speed: 1 });
  const rebased = 100_000 - Math.floor((100 * 1000) / 2); // setSpeed(2)의 재기준화 공식
  const t2 = computeTarget({ nowUtcMs: 100_000, epochUtcMs: rebased, lastSimulatedTick: 100, speed: 2 });
  assert.equal(t2.target, 100, '재기준화 직후 목표는 현재 틱 (시간축 점프 없음)');
  assert.ok(t1.target >= 100);
});

test('T-9. §20 따라잡기 중 배속 변경: 완료 후 재기준화되어 시간이 멈추지 않는다', async () => {
  // 회귀 방지 (Codex 74차 ①): catchUp은 시작 시 캡처한 target까지 계속 전진하므로,
  // 중간 worldTick 기준으로 epoch를 잡으면 따라잡기가 그 지점을 지나친 뒤
  // 라이브 목표가 현재 틱에 묶여 세계 시간이 멈춘다.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-speed-'));
  const st = new Storage(path.join(dir, 't.db'));
  let nowMs = 10_000_000;
  const engine = new Engine(st, { seed: 4242, now: () => nowMs });
  // BATCH_TICKS(1440)보다 훨씬 많이 밀려 있어야 배치가 여러 번 돌고, 배속 변경 시점과
  // 따라잡기 종료 시점의 worldTick이 갈라진다 — 그 간극이 바로 이 회귀가 사는 곳이다.
  engine.epochUtcMs = nowMs - 5000 * TICK;

  // 첫 진행 보고 시점 = 따라잡기 한복판에서 배속을 바꾼다
  engine.onBatch((msg) => {
    if (msg.type === 'catchingUp' && engine.speed === 1) engine.setSpeed(3);
  });
  const target = await engine.catchUp();
  assert.equal(engine.speedChangedDuringCatchup ?? false, false, '완료 시 플래그가 소진된다');

  assert.ok(target >= 5000, '따라잡기는 캡처한 목표까지 완주한다');
  assert.equal(engine.speed, 3);
  const t0 = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: engine.epochUtcMs,
    lastSimulatedTick: engine.world.worldTick, speed: engine.speed,
  });
  assert.equal(t0.target, engine.world.worldTick, '재기준화 직후 목표 = 현재 틱 (점프 없음)');

  nowMs += 10_000; // 벽시계 10초
  const t1 = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: engine.epochUtcMs,
    lastSimulatedTick: engine.world.worldTick, speed: engine.speed,
  });
  assert.equal(t1.target, engine.world.worldTick + 30, 'x3에서 10초 = 30틱 — 정지하지 않는다');
  st.close();
});

test('T-10. §22.1 ×48이면 실시간 1시간 = 게임 1년', () => {
  // 1년 = yearDays(120) × TICKS_PER_DAY(1440) = 172,800틱.
  // ×48이면 3,600초(1시간)에 그만큼 진행해야 한다.
  const YEAR_TICKS = 120 * 1440;
  const r = computeTarget({ nowUtcMs: 3600 * 1000, epochUtcMs: 0, lastSimulatedTick: 0, speed: 48 });
  assert.equal(r.target, YEAR_TICKS, '1시간 × ×48 = 1년치 틱');
  assert.equal(r.clamped, false, '2년 클램프 안에 들어온다');

  // 달력은 그대로다 — 배속은 관람 속도만 바꾼다
  assert.equal(YEAR_TICKS / 1440, 120, '1년은 여전히 120일');
});

test('T-11. §22.1 따라잡기 클램프는 ×48에서도 2시간 부재를 버티고, 넘으면 재기준화한다', () => {
  const TICK = 1000;
  // 2시간 부재 = 2년치 = 345,600틱 = 클램프 경계
  const twoHours = 2 * 3600 * 1000;
  const ok = computeTarget({ nowUtcMs: twoHours, epochUtcMs: 0, lastSimulatedTick: 0, speed: 48 });
  assert.equal(ok.clamped, false, '2시간(2년치)까지는 버리지 않는다');
  assert.equal(ok.target, MAX);

  // 그 이상은 클램프되고 epoch가 재기준화된다 (세계가 멈추지 않게)
  const over = computeTarget({ nowUtcMs: twoHours * 2, epochUtcMs: 0, lastSimulatedTick: 0, speed: 48 });
  assert.equal(over.clamped, true, '한도를 넘으면 클램프');
  assert.equal(over.target, MAX, '한도까지만 진행');
  assert.ok(over.newEpochUtcMs > 0, 'epoch 재기준화 — 다음 목표가 현재 틱 아래로 내려가지 않는다');
  const next = computeTarget({
    nowUtcMs: twoHours * 2, epochUtcMs: over.newEpochUtcMs, lastSimulatedTick: MAX, speed: 48,
  });
  assert.equal(next.target, MAX, '재기준화 직후 목표 = 현재 틱');
});
