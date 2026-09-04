import { NEED_MAX } from './constants.js';
import { governmentFor, PRIMARY_GOVERNMENT } from './government.js';
import { sellsGroceries } from './food-supply.js';

// A public meal is requested in person, not a cash grant or a global hunger reset.
export function foodAidBlockReason(world, sim) {
  if (sim.needs.hunger >= world.logic.needCritical || sim.money >= world.logic.actions.eat.cost
      || sim.groceries > 0) return 'not_needed';
  if (governmentFor(world,sim.villageId).treasury < world.logic.actions.seek_food_aid.mealCost) return 'no_funds';
  return null;
}

export function takePublicMeal(world, sim, emit) {
  if (foodAidBlockReason(world, sim) !== null) return false;
  const state = sim.state;
  const facility = world.map.facilities.find(f => f.id === state.facilityId);
  const resource = facility?.resources.find(r => r.id === state.resourceId);
  if (!['city_hall', 'market'].includes(facility?.type) || !resource
      || sim.x !== resource.x || sim.y !== resource.y) return false;
  const { mealCost, hungerGain } = world.logic.actions.seek_food_aid;
  const government=governmentFor(world,sim.villageId);
  government.treasury -= mealCost;
  // §23.57 (#164) 공공 식사의 재료를 **마을 안에서 먼저 산다.** 예전에는 전액이
  // externalOutflow(마을 밖 조달)였다 — 회계는 닫혔지만 굶주린 사람이 공공 식사를 먹어도
  // 시장·농장에 매출이 0이었다. 마을이 자기 식량을 기르는데(§grow_groceries·supply) 마을의
  // 복지는 수입 식량으로 돌아가서, 세율·복지를 움직여도 산업 지표에 닿을 통로가 없었다.
  // 규칙: 같은 마을에서 재고가 있는 식품 판매 시설을 id 순으로 골라 1단위를 단가로 산다.
  // 재고 차감 + 시설 매출 + 국고 지출은 그 가게로 간다(마을 안에 남는다). 재고가 없을 때만
  // 종전대로 외부 조달로 떨어진다. rng를 쓰지 않으며 id 순 선택이라 결정적이다.
  const unitPrice = world.logic.supply.unitPrice;
  // Codex 합의 조건 ①: "id 순"은 배열 순서에 기대지 않고 **코드가 보장한다** —
  // food-supply.js의 발주 순회와 같은 compare로 가장 작은 id를 고른다.
  let localSource = null;
  for (const f of world.map.facilities) {
    if (!sellsGroceries(f) || (f.groceryStock ?? 0) < 1) continue;
    if ((f.villageId ?? PRIMARY_GOVERNMENT) !== (sim.villageId ?? PRIMARY_GOVERNMENT)) continue;
    if (world.incidents.some((i) => i.facilityId === f.id)) continue;
    if (localSource === null || f.id < localSource.id) localSource = f;
  }
  let source = 'external';
  if (localSource) {
    // 국고는 이미 mealCost를 냈다. 그중 재료값(단가 1단위)은 가게로, 나머지(조리·운영)는
    // 종전처럼 외부로 간다 — 단가가 식사값보다 크면 식사값 전부가 가게 매출이다.
    const toShop = Math.min(mealCost, unitPrice);
    localSource.groceryStock -= 1;
    localSource.revenue = (localSource.revenue ?? 0) + toShop;
    // Codex 합의 조건 ②: soldUnits는 소매 판매 계수다 — 복지 조달은 따로 센다.
    // 섞으면 "시장이 얼마나 팔았나"와 "국가가 얼마나 사 갔나"를 가를 수 없다.
    world.foodSupply.totals.publicMealUnits = (world.foodSupply.totals.publicMealUnits ?? 0) + 1;
    world.externalOutflow = (world.externalOutflow ?? 0) + (mealCost - toShop);
    source = localSource.id;
  } else {
    // Ingredients are purchased from outside the simulated town. No money is minted,
    // and the city hall does not remit this cost straight back into the treasury.
    world.externalOutflow = (world.externalOutflow ?? 0) + mealCost;
  }
  const before = sim.needs.hunger;
  sim.needs.hunger = Math.min(NEED_MAX, before + hungerGain);
  sim.hungerZeroTicks = 0;
  emit('public_meal_taken', sim.id, { facilityId: facility.id, cost: mealCost,
    hungerGain: sim.needs.hunger - before, treasury: government.treasury, source });
  return true;
}
