// 합성 인구 생성 유틸 (이슈 #17) — 인구 스케일 벤치용 '성장 월드'를 결정적으로 만든다.
//
// 왜 이민 반복인가: 심 생성 경로는 makeSim 단일 창구(§22.16)지만, 필드를 직접 만들어
// 밀어 넣으면 성씨·traits·id·행렬 확장 규칙이 언젠가 실제 경로와 어긋난다.
// 실제 이민 경로(maybeImmigration → immigrateOne)를 그대로 반복하면 rngSim 소비 순서가
// 고정돼 같은 (seed, targetPop)이면 항상 같은 세계가 나온다 — 벤치 간 비교가 성립한다.
//
// 시설은 §17.21 도시계획 트리거와 **같은 수요 판정**으로 채운다 (선제 주택 → 일자리 →
// 카페 → 공원). 다만 주거는 침대 8의 아파트를 쓴다 — 인구 400이면 집(침대 2)으로는
// 공터 96곳이 모자란다. 공터를 다 쓰면 결정적 격자 스캔으로 초지에 짓는다.
// 이 유틸은 시뮬 로직을 일절 바꾸지 않는다 — createWorld 위에 기존 공개 함수만 쌓는다.
import { createWorld } from '../sim/world.js';
import { maybeImmigration } from '../sim/society.js';
import { addBuilding, plotBuildable, zoneFootprint, isResidence } from '../sim/map.js';

const noop = () => {};

// 공터 우선(게임 도시계획과 같은 기준: !used && plotBuildable 7×5), 소진 시 격자 스캔.
// 격자 스캔은 문 남쪽 한 줄 여유(h+1)까지 GRASS를 요구해 문이 물가에 막히지 않게 한다.
function nextSite(world, type) {
  const fp = zoneFootprint(type, 0);
  const plot = world.plots.find((p) => !p.used && plotBuildable(world.map, p, Math.max(fp.w, 7), Math.max(fp.h, 5)));
  if (plot) return plot;
  const map = world.map;
  for (let y = 2; y < map.h - fp.h - 2; y += fp.h + 3) {
    for (let x = 2; x < map.w - fp.w - 2; x += fp.w + 3) {
      if (plotBuildable(map, { x, y }, fp.w, fp.h + 1)) return { x, y, synthetic: true };
    }
  }
  return null;
}

function build(world, type) {
  const site = nextSite(world, type);
  if (!site) throw new Error(`synthpop: no site left for ${type}`);
  const fac = addBuilding(world.map, type, site, 0);
  if (!site.synthetic) site.used = true;
  return fac;
}

const countRes = (world, pred) => world.map.facilities.filter(pred)
  .reduce((n, f) => n + f.resources.length, 0);

// targetPop명까지 이민으로 불린 결정적 세계. worldTick은 0 그대로 — 호출자가 워밍업한다.
export function makeSynthWorld(seed, targetPop) {
  const world = createWorld(seed);
  const L = world.logic;
  const interval = L.society.immigrationIntervalDays;
  // 1) 주거: 침대 ≥ 목표 인구 + headroom (§17.21 선제 주택과 같은 여유)
  while (countRes(world, isResidence) < targetPop + L.growth.headroomBeds) build(world, 'apartment');
  // 2) 이민 반복: 평판 0이라 웨이브 1 — 호출당 1명, 이민자당 rngSim 소비 1회(고정 순서)
  let guard = targetPop * 4;
  while (world.sims.length < targetPop && guard-- > 0) {
    maybeImmigration(world, 0, interval, noop);
  }
  if (world.sims.length !== targetPop) {
    throw new Error(`synthpop: wanted ${targetPop}, got ${world.sims.length}`);
  }
  // 3) 일자리·여가: §17.21 도시계획 트리거의 수요 판정 그대로
  const officeWorkers = world.sims.filter((s) => L.workplace[s.traits.occupation] === 'office'
    && L.occupations[s.traits.occupation].wagePct > 0).length;
  while (countRes(world, (f) => f.type === 'office') < officeWorkers) build(world, 'office');
  while (targetPop > countRes(world, (f) => f.type === 'cafe') * L.construct.cafeRatio) build(world, 'cafe');
  while (targetPop > countRes(world, (f) => f.type === 'park') * L.construct.parkRatio) build(world, 'park');
  return world;
}
