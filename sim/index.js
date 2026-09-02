export { createWorld, SIM_NAMES, SIM_COUNT } from './world.js';
export { DEFAULT_LOGIC, validateLogic, logicHash } from './logic.js';
export { migrateWorld } from './migrate.js';
export { generateTraits, validateTraits, mbtiString, OCCUPATIONS, GENDERS } from './traits.js';
export { tick, advance } from './tick.js';
export { serialize, deserialize, hashWorld, fnv1a, findNonFinite } from './serialize.js';
export { computeTarget } from './time.js';
export { buildMap, isWalkable, TILE, MAP_W, MAP_H } from './map.js';
export { bfsPath, manhattan } from './pathfind.js';
export { socialPresence, socialPullPct } from './tick.js'; // §20.3 테스트용 순수 규칙
export * as constants from './constants.js';

// §17: 회고 훅 바인딩 (순환 import 회피)
import { bindSocietyHooks } from './cognition.js';
import { applyRomance, checkClubJoin } from './society.js';
bindSocietyHooks(applyRomance, checkClubJoin);
