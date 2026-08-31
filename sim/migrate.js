// 세이브 마이그레이션 (PLAN §12.1): 입력 처리 전 로드 시점에 완료.
// 결정적 — 임시 RNG만 사용, world의 rngSim/rngWorldgen 상태를 소비하지 않는다.
import { migrationTraits } from './traits.js';
import { DEFAULT_LOGIC, mergeLogicDefaults } from './logic.js';
import { addBarTo, addVenuesTo, addSocietyVenuesTo, addLeisureVenuesTo, addCivicVenuesTo, expandMapTo64, expandMapTo128, expandMapTo512, defaultPlots, extraPlots128, extraPlots512 } from './map.js';

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
  if (from < 9) {
    // §16.6: 128 확장 (v8 체인 뒤에 적용 — 신규 월드와 같은 헬퍼·순서) + 추가 공터 append
    const r = expandMapTo128(world.map, world.wear);
    world.wear = r.wear;
    if (world.plots.length <= 8) world.plots = [...world.plots, ...extraPlots128()];
  }
  if (from < 10) {
    // §17.0: 512 확장 → wear 희소화(>0만 이관, 새 좌표 재매핑은 expandMapTo가 밀집 기준으로 수행)
    if (Array.isArray(world.wear)) {
      const r = expandMapTo512(world.map, world.wear);
      const sparse = {};
      for (let i = 0; i < r.wear.length; i++) if (r.wear[i] > 0) sparse[i] = r.wear[i];
      world.wear = sparse;
    } else {
      expandMapTo512(world.map, null);
    }
    addSocietyVenuesTo(world.map.tiles, world.map.facilities, world.map.w);
    if (world.plots.length <= 32) world.plots = [...world.plots, ...extraPlots512()];
    for (const sim of world.sims) sim.sick ??= null;
    world.partners ??= {};
    world.partnerStage ??= {};
    world.clubs ??= { book_club: [], fishing_club: [], fitness_club: [], drinking_pals: [] };
    if (world.mayorId === undefined) world.mayorId = null;
    world.lastElectionDay ??= -1;
    world.immigrantCounter ??= 0;
    world.lastDailyDay ??= -1;
  }
  if (from < 11) {
    world.campaigners ??= [];
    world.recentCouples ??= [];
  }
  if (from < 12) {
    addLeisureVenuesTo(world.map.tiles, world.map.facilities, world.map.w); // §17.10
  }
  if (from < 13) {
    world.parents ??= {}; // §17.11
  }
  if (from < 14) {
    // 구 빌드가 required 스냅샷 없이 만든 진행 중 프로젝트 백필 — 완공 판정(progress ≥ required)이
    // 영원히 false가 되어 프로젝트 슬롯을 영구 점유하는 교착 수리. 값은 §16.5 기본 노동량.
    if (world.project && !Number.isSafeInteger(world.project.required)) world.project.required = 600;
  }
  if (from < 15) {
    // §17.13: 치안·소방 시설 주입 (신규 월드는 buildMap 체인과 동일 헬퍼)
    addCivicVenuesTo(world.map.tiles, world.map.facilities, world.map.w);
  }
  // 구버전 logic에 새 섹션 기본값 병합 (D2 — pending 정합 이전, 로드 시점)
  if ((world.logic.logicSchemaVersion ?? 1) < DEFAULT_LOGIC.logicSchemaVersion) {
    world.logic = mergeLogicDefaults(world.logic);
  }
  world.schemaVersion = 15;
  return world;
}
