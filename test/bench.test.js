// 합성 인구 유틸 검증 (이슈 #17, Codex 교차 리뷰 ④)
// 벤치가 재는 세계가 (a) 결정적이고 (b) 전 시설이 도달 가능해야 수치가 의미를 가진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSynthWorld } from '../bench/synthpop.js';
import { hashWorld } from '../sim/serialize.js';
import { sameRegion, isWalkable } from '../sim/map.js';

const SEED = 20260831; // 이슈 #17 재현 시드

test('B1. 합성 인구: 같은 (seed, target)이면 해시까지 동일', () => {
  const a = makeSynthWorld(SEED, 50);
  const b = makeSynthWorld(SEED, 50);
  assert.equal(a.sims.length, 50);
  assert.equal(hashWorld(a), hashWorld(b), '결정성 — 벤치 간 비교의 전제');
});

test('B2. 합성 시설 전체 문 도달 가능 (격자 스캔 포함, 인구 400)', () => {
  // 인구 400이면 공터 96곳이 소진돼 격자 스캔 배치가 실제로 쓰인다 —
  // Codex 리뷰가 지적한 "도로 연결성 미보장" 경로가 이 테스트의 표적이다.
  // (도로 인접까지는 요구하지 않는다: 심은 초지도 걷는다. 요구하는 것은
  //  구시가와 같은 도달 영역에 문이 있다는 것 — 아니면 no_path가 벤치를 오염시킨다.)
  const w = makeSynthWorld(SEED, 400);
  assert.equal(w.sims.length, 400);
  const anchor = w.map.facilities.find((f) => f.id === 'house0').door;
  const bad = w.map.facilities.filter((f) => !isWalkable(w.map, f.door.x, f.door.y)
    || !sameRegion(w.map, anchor.x, anchor.y, f.door.x, f.door.y));
  assert.deepEqual(bad.map((f) => f.id), [], '도달 불가 문이 없다');
});

// §23.53 **MAX_SPEED가 엔진이 실제로 낼 수 있는 값인지 잠근다.**
//
// 이 테스트가 없어서 생긴 일: server/engine.js의 MAX_SPEED = 20에는 "인구 249 실측
// 상한이 47.6 tick/s"라는 주석이 근거로 붙어 있는데, ×20이 요구하는 값은 47.96이다.
// 47.6 < 47.96 — **×48을 없앤 이유를 설명하는 주석이, 그 자리에 넣은 ×20도 통과 못
// 하는 숫자를 기록하고 있었다.** 3회차 성능 리뷰가 "라벨만 바꿨다"를 두 회차 연속
// 지적한 자리다. 근거 숫자와 그 숫자가 정당화하는 값이 코드에서 떨어져 있었다.
//
// 여기서 재는 것은 벤치마크가 아니라 **하한**이다. 이 기계에서 같은 코드가 2배까지
// 흔들리므로(리뷰어가 그 잡음으로 유령 2배 회귀를 만들었다) 회차 최소값을 쓰고,
// 여유가 크게 남는 작은 세계로 잰다. 여기서 깨진다면 그건 잡음이 아니라
// **배속 상한이 근거를 잃었다는 뜻**이다.
test('B3. §23.53 MAX_SPEED가 라이브 루프(커밋 포함)가 실제로 내는 처리량 안에 있다', async () => {
  const { measureLiveThroughput } = await import('../bench/live-throughput.js');
  const r = measureLiveThroughput({ growDays: 40, measureTicks: 800, reps: 2 });
  assert.ok(r.population > 20, `세계가 자라지 않았다 — 인구 ${r.population}`);
  assert.ok(r.tickPerSecWorst >= r.requiredForMaxSpeed,
    `×${r.maxSpeed}는 ${r.requiredForMaxSpeed.toFixed(2)} tick/s를 요구하는데 `
    + `인구 ${r.population} 세계에서 ${r.tickPerSecWorst.toFixed(1)} tick/s밖에 안 난다 `
    + `— MAX_SPEED를 내리거나 루프를 빠르게 하라`);
});
