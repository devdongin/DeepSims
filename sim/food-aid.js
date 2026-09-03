import { NEED_MAX } from './constants.js';
import { governmentFor } from './government.js';

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
  // Ingredients are purchased from outside the simulated town. No money is minted,
  // and the city hall does not remit this cost straight back into the treasury.
  world.externalOutflow = (world.externalOutflow ?? 0) + mealCost;
  const before = sim.needs.hunger;
  sim.needs.hunger = Math.min(NEED_MAX, before + hungerGain);
  sim.hungerZeroTicks = 0;
  emit('public_meal_taken', sim.id, { facilityId: facility.id, cost: mealCost,
    hungerGain: sim.needs.hunger - before, treasury: government.treasury });
  return true;
}
