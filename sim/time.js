// 시간 모델 (PLAN §1) — 순수 함수, 서버·테스트 공용.
import { TICK_DURATION_MS, MAX_CATCHUP_TICKS } from './constants.js';

// targetTick 계산. 30일 초과분은 epoch 재고정으로 영구 폐기 (재고정은 호출자가
// 첫 배치 트랜잭션에 포함해 커밋해야 한다).
export function computeTarget({ nowUtcMs, epochUtcMs, lastSimulatedTick }) {
  const rawTarget = Math.floor((nowUtcMs - epochUtcMs) / TICK_DURATION_MS);
  let target = Math.min(rawTarget, lastSimulatedTick + MAX_CATCHUP_TICKS);
  target = Math.max(target, lastSimulatedTick); // 시계 역행 클램프
  const clamped = rawTarget > target;
  return {
    target,
    clamped,
    newEpochUtcMs: clamped ? nowUtcMs - target * TICK_DURATION_MS : epochUtcMs,
  };
}
