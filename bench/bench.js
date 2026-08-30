// 성능 벤치 (PLAN §1) — CI 단정 아님. 인지 전체(Phase 3~4) 활성 기준 예산 ≥ 20k tick/s
// (50k는 인지 없는 Phase 1 코어 시절 예산 — 현재 시뮬레이션엔 §1의 Phase 3~4 예산이 적용된다).
import { createWorld, advance } from '../sim/index.js';
import { recordFact } from '../sim/cognition.js';

const DAYS = 30;
const TICKS = DAYS * 1440;

function run(label, budget, setup) {
  const w = createWorld(42);
  if (setup) setup(w);
  advance(w, {}, 1440); // 워밍업
  const t0 = process.hrtime.bigint();
  advance(w, {}, TICKS);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const tps = Math.round(TICKS / (ms / 1000));
  console.log(`${label}: ${ms.toFixed(0)}ms → ${tps.toLocaleString()} tick/s — 예산 ${budget / 1000}k: ${tps >= budget ? '충족 ✓' : '미달 ✗'}`);
}

run(`통상 ${DAYS}일(${TICKS.toLocaleString()}틱)`, 20000);
run('최악 케이스 (전 심 기억 256 만재)', 20000, (w) => {
  for (const s of w.sims) {
    for (let i = 0; i < w.logic.memory.cap; i++) {
      recordFact(s, 1, w.logic, i % 2 ? 'meal' : 'argument', { placeId: 'cafe', tags: ['eat', 'facility:cafe'] });
    }
  }
});
