// 세이브 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 임시 RNG만 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { DEFAULT_LOGIC, mergeLogicDefaults } from './logic.js';
import { addBarTo, addVenuesTo, expandMapTo64, defaultPlots } from './map.js';

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
  if (from < 6) {
    // §15.1: 술집 주입(buildMap과 동일 헬퍼 = 신규 월드와 바이트 동일), 마모·숙취 상태
    addBarTo(world.map.tiles, world.map.facilities);
    for (const f of world.map.facilities) {
      if (f.type === 'house' && !f.extraBedSlots) {
        f.extraBedSlots = [{ x: f.x + 2, y: f.y + 2 }, { x: f.x + 3, y: f.y + 2 }];
      }
    }
    world.wear ??= new Array(world.map.w * world.map.h).fill(0);
    for (const sim of world.sims) sim.hangoverUntil ??= -1;
  }
  if (from < 7) {
    // §16: 신규 시설 주입 — footprint 타일은 무조건 덮어씀 (v6에서 형성된 도로도 건물이 우선,
    // 결정적. wear 값은 남지만 GRASS가 아니게 되어 무해). WATER는 영구 비보행 (Codex 22차 항목 3).
    addVenuesTo(world.map.tiles, world.map.facilities);
    world.weather ??= { day: 0, kind: 'sunny' }; // 신규 월드와 동일 초기값 — 첫 드로우는 day 경계에서
    world.lostItems ??= [];
    world.itemCounter ??= 0;
    for (const sim of world.sims) sim.groceries ??= 0;
  }
  if (from < 8) {
    // §16.5: 맵 64 확장(좌표 보존·경계 개방·도로 연장 — 신규 월드와 단일 헬퍼) + 공터
    const r = expandMapTo64(world.map, world.wear);
    world.wear = r.wear;
    world.plots ??= defaultPlots();
    if (world.project === undefined) world.project = null;
    if (world.project && world.project.required === undefined) world.project.required = 600;
    world.lastPlanDay ??= -1;
  }
  // 구버전 logic에 새 섹션 기본값 병합 (D2 — pending 정합 이전, 로드 시점)
  if ((world.logic.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
    world.logic = mergeLogicDefaults(world.logic);
  }
  world.schemaVersion = 8;
  return world;
}
