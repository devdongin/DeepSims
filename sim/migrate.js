// v1 → v2 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 심별 임시 RNG 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { DEFAULT_LOGIC } from './logic.js';

export function migrateWorld(world) {
  if ((world.schemaVersion ?? 1) >= 2) return world;
  for (const sim of world.sims) {
    if (!sim.traits) sim.traits = migrationTraits(world.seed, sim.id);
    if (sim.mood === undefined) sim.mood = 0;
    if (sim.isPlayer === undefined) sim.isPlayer = false;
  }
  if (!world.logic) world.logic = DEFAULT_LOGIC; // v1 등가 기본값 설치 — 이후 파일 params가 입력으로 등록됨
  world.schemaVersion = 2;
  return world;
}
