// 월드 생성 — rngWorldgen만 사용, 이후 런타임은 rngSim (PLAN §2 네임드 스트림).
import { buildMap } from './map.js';
import { makeRng, rngNext, rngInt } from './prng.js';

export const SIM_NAMES = ['민수', '지연', '하준', '서연', '도윤', '은지', '태호', '수아', '준호', '예린'];
export const SIM_COUNT = 10;

export function createWorld(seed) {
  const rngWorldgen = makeRng(seed);
  const map = buildMap();

  const sims = [];
  for (let id = 0; id < SIM_COUNT; id++) {
    const homeId = `house${Math.floor(id / 2)}`;
    const home = map.facilities.find((f) => f.id === homeId);
    sims.push({
      id,
      name: SIM_NAMES[id],
      homeId,
      x: home.door.x,
      y: home.door.y + 1, // 문 앞 도로변
      needs: {
        hunger: 5000 + rngInt(rngWorldgen, 4000),
        energy: 5000 + rngInt(rngWorldgen, 4000),
        social: 5000 + rngInt(rngWorldgen, 4000),
        fun: 5000 + rngInt(rngWorldgen, 4000),
      },
      money: 1000 + rngInt(rngWorldgen, 500),
      state: { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 },
    });
  }

  const affinity = Array.from({ length: SIM_COUNT }, () => new Array(SIM_COUNT).fill(0));

  return {
    schemaVersion: 1,
    seed,
    worldTick: 0,
    rngSim: makeRng(rngNext(rngWorldgen)),
    rngWorldgen, // 생성 후 미사용 (보존만)
    map,
    sims,
    affinity,
    reservations: {}, // "facilityId:resourceId" -> simId
  };
}
