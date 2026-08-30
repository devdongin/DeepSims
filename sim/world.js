// 월드 생성 — rngWorldgen만 사용, 이후 런타임은 rngSim (PLAN §2 네임드 스트림).
// schemaVersion 2: traits(성별·나이·MBTI·직업)·mood·world.logic 포함 (PLAN §12.1).
import { buildMap } from './map.js';
import { makeRng, rngNext, rngInt } from './prng.js';
import { generateTraits } from './traits.js';
import { DEFAULT_LOGIC } from './logic.js';

export const SIM_NAMES = ['민수', '지연', '하준', '서연', '도윤', '은지', '태호', '수아', '준호', '예린'];
export const SIM_COUNT = 10;

export function createWorld(seed) {
  const rngWorldgen = makeRng(seed);
  const map = buildMap();

  const sims = [];
  for (let id = 0; id < SIM_COUNT; id++) {
    const homeId = `house${Math.floor(id / 2)}`;
    const home = map.facilities.find((f) => f.id === homeId);
    const traits = generateTraits(rngWorldgen);
    sims.push({
      id,
      name: SIM_NAMES[id],
      homeId,
      isPlayer: false,
      traits,
      mood: 0,
      x: home.door.x,
      y: home.door.y + 1, // 문 앞 도로변
      needs: {
        hunger: 5000 + rngInt(rngWorldgen, 4000),
        energy: 5000 + rngInt(rngWorldgen, 4000),
        social: 5000 + rngInt(rngWorldgen, 4000),
        fun: 5000 + rngInt(rngWorldgen, 4000),
      },
      money: DEFAULT_LOGIC.occupations[traits.occupation].startMoney + rngInt(rngWorldgen, 500),
      state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
      // Phase 3 인지 상태 (PLAN §2.5)
      memories: [],
      memorySeq: 0,
      habit: {},           // "action:facilityId" -> 누적 보너스 (§G habitMod)
      relTiers: {},        // otherSimId -> 'acquaintance'|'friend'|'rival' (stranger는 미기록)
      lastReflectedDay: -1,
      reflectionMemoryCursor: 0,
      pendingMood: null,
    });
  }

  const affinity = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));
  const interactions = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));

  return {
    schemaVersion: 3,
    seed,
    worldTick: 0,
    rngSim: makeRng(rngNext(rngWorldgen)),
    rngWorldgen, // 생성 후 미사용 (보존만)
    map,
    sims,
    affinity,
    interactions, // 페어링 틱 카운트 (대칭, PLAN §12.1 D3)
    reservations: {}, // "facilityId:resourceId" -> simId
    logic: DEFAULT_LOGIC,
  };
}
