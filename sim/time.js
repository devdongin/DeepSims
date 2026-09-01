// 시간 모델 (PLAN §1) — 순수 함수, 서버·테스트 공용.
import { TICK_DURATION_MS, MAX_CATCHUP_TICKS } from './constants.js';
export { TICK_DURATION_MS }; // §20 배속 재기준화에서 사용

// targetTick 계산. 30일 초과분은 epoch 재고정으로 영구 폐기 (재고정은 호출자가
// 첫 배치 트랜잭션에 포함해 커밋해야 한다).
// speed: 벽시계 대비 진행 배율 (1·2·3). **틱 내용은 불변** — 같은 틱을 더 자주 돌릴 뿐이라
// state[t] = simulate(state[t-1], inputs[t]) 계약과 결정성에 영향이 없다 (§20).
export function computeTarget({ nowUtcMs, epochUtcMs, lastSimulatedTick, speed = 1 }) {
  const rawTarget = Math.floor(((nowUtcMs - epochUtcMs) * speed) / TICK_DURATION_MS);
  let target = Math.min(rawTarget, lastSimulatedTick + MAX_CATCHUP_TICKS);
  target = Math.max(target, lastSimulatedTick); // 시계 역행 클램프
  const clamped = rawTarget > target;
  return {
    target,
    clamped,
    newEpochUtcMs: clamped ? nowUtcMs - Math.floor((target * TICK_DURATION_MS) / speed) : epochUtcMs,
  };
}
