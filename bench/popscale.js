// 인구 스케일 벤치 (이슈 #17, G6 게이트) — 합성 인구 10/50/100/200/400에서 틱 비용을 잰다.
// 성장 soak(§17.21)과 달리 인구가 고정 조건이라 "인구가 늘어서 느려졌다"는 교란이 없다.
//
//   node bench/popscale.js                 # 표: pop별 ms/일·tick/s·µs/sim-tick
//   node bench/popscale.js --pops 100,200  # 부분 실행
//   node bench/popscale.js --days 5        # 측정 일수 변경 (기본 3)
//   node --cpu-prof --cpu-prof-dir=logs bench/popscale.js --profile 200
//                                          # 단일 인구 프로파일 (병목 지목용)
//
// 예산: G6 = 인구 200에서 20k tick/s. µs/sim-tick(인구 정규화)이 인구에 따라 오르면
// 초선형 항이 있다는 뜻이다 — 절대치와 함께 보라.
import { advance } from '../sim/tick.js';
import { pfStats } from '../sim/pathfind.js';
import { TICKS_PER_DAY } from '../sim/constants.js';
import { makeSynthWorld } from './synthpop.js';

const SEED = 20260831; // 이슈 #17 재현 시드 (Codex 지정)
const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const DAYS = Number(argOf('--days', 3));
const REPS = Number(argOf('--reps', 1)); // 소음 있는 기계에서는 best-of-N (최소 ms 채택)
const WARMUP_DAYS = 1;
const profilePop = argOf('--profile', null);
const pops = profilePop
  ? [Number(profilePop)]
  : argOf('--pops', '10,50,100,200,400').split(',').map(Number);

function bench(pop) {
  const w = makeSynthWorld(SEED, pop);
  advance(w, {}, WARMUP_DAYS * TICKS_PER_DAY); // 워밍업 — 기억·습관·페어링이 자리잡는다
  const ticks = DAYS * TICKS_PER_DAY;
  const pf0 = { ...pfStats }; // BFS 분리 계측 (pathfind.js의 기존 계측 훅 — 시뮬 동작 무영향)
  const t0 = process.hrtime.bigint();
  const events = advance(w, {}, ticks);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const tps = Math.round(ticks / (ms / 1000));
  // sim-tick = 틱 × 그 시점 인구. 측정 중 이민·출생으로 인구가 조금 변하므로 평균 인구로 근사.
  const endPop = w.sims.length;
  const avgPop = (pop + endPop) / 2;
  const usPerSimTick = (ms * 1000) / (ticks * avgPop);
  const bfsCalls = pfStats.calls - pf0.calls;
  const bfsMs = pfStats.ms - pf0.ms;
  const bfsCells = pfStats.cells - pf0.cells;
  const started = events.filter((e) => e.type === 'action_started').length;
  return {
    pop, endPop, fac: w.map.facilities.length, ms, msPerDay: ms / DAYS, tps, usPerSimTick,
    started, bfsCalls, bfsMs, bfsCells,
  };
}

console.log(`seed ${SEED} · 워밍업 ${WARMUP_DAYS}일 · 측정 ${DAYS}일 (${(DAYS * TICKS_PER_DAY).toLocaleString()}틱)${REPS > 1 ? ` · best-of-${REPS}` : ''}`);
console.log('| 인구(시작→끝) | 시설 | ms/일 | tick/s | µs/sim-tick | 결정/일 | BFS 호출/일 | BFS ms/일 (비중) | 방문칸/호출 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const pop of pops) {
  let r = null;
  for (let i = 0; i < REPS; i++) {
    const ri = bench(pop); // 세계 구축부터 결정적으로 반복 — 같은 일을 재고 최소 ms 채택
    if (!r || ri.ms < r.ms) r = ri;
  }
  console.log(`| ${r.pop}→${r.endPop} | ${r.fac} | ${r.msPerDay.toFixed(0)} | ${r.tps.toLocaleString()} | ${r.usPerSimTick.toFixed(2)} | ${Math.round(r.started / DAYS).toLocaleString()} | ${Math.round(r.bfsCalls / DAYS).toLocaleString()} | ${(r.bfsMs / DAYS).toFixed(0)} (${(r.bfsMs / r.ms * 100).toFixed(0)}%) | ${r.bfsCalls ? Math.round(r.bfsCells / r.bfsCalls).toLocaleString() : 0} |`);
}
