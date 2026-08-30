// 세이브 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 임시 RNG만 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { DEFAULT_LOGIC, mergeLogicDefaults } from './logic.js';

export function migrateWorld(world) {
  const from = world.schemaVersion ?? 1;
  if (from < 2) {
    for (const sim of world.sims) {
      if (!sim.traits) sim.traits = migrationTraits(world.seed, sim.id);
      if (sim.mood === undefined) sim.mood = 0;
      if (sim.isPlayer === undefined) sim.isPlayer = false;
    }
    if (!world.logic) world.logic = DEFAULT_LOGIC;
  }
  if (from < 3) {
    // Phase 3 인지 상태 — 결정적 기본값
    for (const sim of world.sims) {
      sim.memories ??= [];
      sim.memorySeq ??= 0;
      sim.habit ??= {};
      sim.relTiers ??= {};
      sim.lastReflectedDay ??= -1;
      sim.reflectionMemoryCursor ??= 0;
      if (sim.pendingMood === undefined) sim.pendingMood = null;
    }
    world.interactions ??= world.sims.map(() => new Array(world.sims.length).fill(0));
  }
  if (from < 4) {
    // Phase 4: 토큰·계획 상태
    for (const sim of world.sims) {
      sim.knownTokens ??= [];
      if (sim.plan === undefined) sim.plan = null;
      sim.lastPlannedDay ??= -1;
    }
    world.tokens ??= [];
    world.tokenCounter ??= 0;
  }
  if (from < 5) {
    // D9: 인사 가드 매트릭스
    world.lastGreetDay ??= world.sims.map(() => new Array(world.sims.length).fill(-1));
  }
  // 구버전 logic에 새 섹션 기본값 병합 (D2 — pending 정합 이전, 로드 시점)
  if ((world.logic.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
    world.logic = mergeLogicDefaults(world.logic);
  }
  world.schemaVersion = 5;
  return world;
}
