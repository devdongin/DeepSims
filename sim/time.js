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
  // 클램프는 양쪽으로 일어나고 **둘 다 epoch 재고정이 필요하다** (§22.11).
  //   ahead : 한도 초과분을 폐기했다 — 폐기한 시간이 재등장하지 않도록 재고정.
  //   behind: epoch가 현재 틱보다 뒤에 있다 — 시계 역행이거나, epoch와 speed가
  //           어긋난 상태다(epoch는 저장되는데 speed는 안 돼서 ×48 기준 epoch에
  //           ×1로 붙는 경우). 재고정하지 않으면 실시간이 그 간극을 메울 때까지
  //           세계가 통째로 멈추고 **스스로 회복하지 못한다** — 가상 플레이어 2인이
  //           독립적으로 밟은 블로커였다.
  const clampedAhead = rawTarget > target;
  const clampedBehind = rawTarget < lastSimulatedTick;
  const clamped = clampedAhead || clampedBehind;
  return {
    target,
    clamped,
    clampedAhead,
    clampedBehind,
    newEpochUtcMs: clamped ? nowUtcMs - Math.ceil((target * TICK_DURATION_MS) / speed) : epochUtcMs,
  };
}
