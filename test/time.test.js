// 시간 모델 테스트 (PLAN §7 6)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTarget } from '../sim/time.js';
import { createWorld, advance, hashWorld } from '../sim/index.js';

const TICK = 1000;
const MAX = 30 * 1440;

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
