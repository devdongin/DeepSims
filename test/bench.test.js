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
