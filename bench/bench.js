// 성능 벤치 (PLAN §1) — CI 단정 아님. Phase 1 목표: ≥ 50k tick/s.
import { createWorld, advance } from '../sim/index.js';

const DAYS = 30;
const TICKS = DAYS * 1440;

const w = createWorld(42);
advance(w, {}, 1440); // 워밍업
const t0 = process.hrtime.bigint();
advance(w, {}, TICKS);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const tps = Math.round(TICKS / (ms / 1000));

console.log(`${DAYS}일(${TICKS.toLocaleString()}틱) 시뮬레이션: ${ms.toFixed(0)}ms → ${tps.toLocaleString()} tick/s`);
console.log(`Phase 1 예산(50k tick/s): ${tps >= 50000 ? '충족 ✓' : '미달 ✗'}`);
