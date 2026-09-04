// §23.53 **라이브 루프를 있는 그대로 재는 벤치.** 성능 리뷰 3회차의 "다음 한 가지"다.
//
// 왜 필요했나: bench/popscale.js는 `advance()`만 잰다 — 커밋도, 스냅샷 직렬화도,
// 연대기 삽입도 없다. 그런데 실측하면 **커밋이 루프 비용의 38~48%**다. 그래서
// popscale의 숫자로 배속 상한을 정하면 절반짜리 근거로 정하는 셈이 된다.
//
// 실제로 그 사고가 났다. server/engine.js의 MAX_SPEED = 20은 "인구 249 실측 상한이
// 47.6 tick/s"라는 주석을 근거로 달려 있는데, ×20이 요구하는 값은 **47.96 tick/s**다.
// ×48을 없앤 이유를 적은 주석이, 그 자리에 넣은 ×20도 통과 못 하는 숫자를 기록하고 있다.
// 그리고 같은 리뷰어가 실제로 자란 세계(200일·인구 182)에서 **커밋 포함 192 tick/s**를
// 쟀다. 47.6과 192 중 어느 쪽이 라이브의 진실인지 **아무도 모르는 것**이 진짜 문제였다.
//
// 그래서 이 벤치는 세 가지를 popscale과 다르게 한다:
//   ① 합성 인구가 아니라 **실제로 자란 세계**를 쓴다. 합성 fixture는 틱 비용이
//      1.24~1.64배 싸고, 무엇보다 기억 포화가 다르다 — 실제 세계는 심의 98%가
//      memory.cap(256)에 닿아 있는데 합성은 4.5%다.
//   ② `Engine.runLive`를 그대로 돌린다. 진짜 sqlite에 진짜로 커밋한다.
//   ③ **반복하고 최소값을 쓴다.** 이 기계에서 같은 코드가 97~312 tick/s로 흔들린다.
//      단일 숫자는 2배까지 거짓말한다 — 리뷰어가 그 벤치로 유령 2배 회귀를 만들었다.
//
//   node bench/live-throughput.js                      # 기본: 200게임일 성장 후 3회 측정
//   node bench/live-throughput.js --grow 260 --reps 5
//   node bench/live-throughput.js --json               # 테스트가 읽는 형태
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../db/storage.js';
import { Engine, MAX_SPEED } from '../server/engine.js';
import { TICK_DURATION_MS } from '../sim/constants.js';

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : def;
};
const GROW_DAYS = argOf('--grow', 200);
const MEASURE_TICKS = argOf('--ticks', 2000);
const REPS = argOf('--reps', 3);
const SEED = argOf('--seed', 9001);
const JSON_OUT = args.includes('--json');

export function measureLiveThroughput({ growDays = 200, measureTicks = 2000, reps = 3, seed = 9001 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepsims-live-'));
  const dbPath = path.join(dir, 'bench.db');
  try {
    const storage = new Storage(dbPath);
    const engine = new Engine(storage, { seed, now: () => 0 });
    // 세계를 실제로 키운다 — 인구·기억 포화·id 공간이 라이브와 같은 모양이 되도록.
    for (let d = 0; d < growDays; d++) engine.runLive(1440);
    engine.flushLive();

    const runs = [];
    for (let r = 0; r < reps; r++) {
      const t0 = process.hrtime.bigint();
      engine.runLive(measureTicks);
      engine.flushLive();
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      runs.push({ ms, tickPerSec: (measureTicks / ms) * 1000 });
    }
    const rates = runs.map((r) => r.tickPerSec);
    // **최소값을 쓴다.** 경합하는 기계에서 평균은 낙관적이고 최대는 거짓말이다.
    const worst = Math.min(...rates);
    const best = Math.max(...rates);
    return {
      seed, growDays, measureTicks, reps,
      population: engine.world.sims.length,
      idSpace: engine.world.nextSimId,
      worldTick: engine.world.worldTick,
      dbBytes: fs.statSync(dbPath).size,
      tickPerSecWorst: worst, tickPerSecBest: best,
      spreadPct: ((best - worst) / worst) * 100,
      // ×N 배속이 요구하는 값 = N / (TICK_DURATION_MS / 1000)
      requiredForMaxSpeed: MAX_SPEED / (TICK_DURATION_MS / 1000),
      maxSpeed: MAX_SPEED,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = measureLiveThroughput({ growDays: GROW_DAYS, measureTicks: MEASURE_TICKS, reps: REPS, seed: SEED });
  if (JSON_OUT) { console.log(JSON.stringify(r)); }
  else {
    console.log(`세계: 시드 ${r.seed} · ${r.growDays}게임일 · 인구 ${r.population} · id 공간 ${r.idSpace}`);
    console.log(`DB: ${(r.dbBytes / 1e6).toFixed(1)} MB`);
    console.log(`처리량(커밋 포함, ${r.reps}회 중 최소): ${r.tickPerSecWorst.toFixed(1)} tick/s`
      + `  [최대 ${r.tickPerSecBest.toFixed(1)}, 편차 ${r.spreadPct.toFixed(0)}%]`);
    console.log(`×${r.maxSpeed}가 요구하는 값: ${r.requiredForMaxSpeed.toFixed(2)} tick/s`);
    const ok = r.tickPerSecWorst >= r.requiredForMaxSpeed;
    console.log(ok
      ? `→ 통과 (여유 ${(r.tickPerSecWorst / r.requiredForMaxSpeed).toFixed(1)}배)`
      : `→ **못 낸다** — MAX_SPEED가 엔진이 못 내는 배속을 요구한다`);
  }
}
