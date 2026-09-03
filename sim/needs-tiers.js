// #91 Achieved living standards, independent of wealth, job and education.
export const CULTURE_ACTION = 'visit_culture';

export function newNeedsTier() {
  return { level: 0, fulfilledTicks: 0, deprivedTicks: 0, culture: 10000, visits: 0 };
}

export function updateNeedsTier(sim, L, emit) {
  const state = sim.needsTier, T = L.needsTiers;
  const fulfilled = Object.values(sim.needs).every(n => n >= T.fulfilledMin);
  const deprived = sim.needs.hunger < T.deprivedMax || sim.needs.energy < T.deprivedMax;
  if (state.level === 0) {
    if (fulfilled) state.fulfilledTicks = Math.min(T.promoteTicks, state.fulfilledTicks + 1);
    if (deprived) state.fulfilledTicks = Math.max(0, state.fulfilledTicks - 1);
    if (state.fulfilledTicks >= T.promoteTicks) {
      state.level = 1; state.deprivedTicks = 0;
      emit('needs_tier_changed', sim.id, { from: 0, to: 1, fulfilledTicks: state.fulfilledTicks });
    }
  } else {
    state.deprivedTicks = deprived ? Math.min(T.demoteTicks, state.deprivedTicks + 1) : 0;
    state.culture = Math.max(0, state.culture - T.cultureDecay);
    if (state.deprivedTicks >= T.demoteTicks) {
      state.level = 0; state.fulfilledTicks = 0; state.culture = 10000;
      emit('needs_tier_changed', sim.id, { from: 1, to: 0, deprivedTicks: state.deprivedTicks });
    }
  }
}

export function cultureBlockReason(world, sim) {
  if (sim.needsTier.level !== 1 || sim.needsTier.culture >= 10000) return 'not_needed';
  if (sim.money < world.logic.actions[CULTURE_ACTION].cost + world.logic.actions.eat.cost) return 'no_money';
  return null;
}

export function completeCultureVisit(world, sim, facilityId, emit) {
  const blocked = cultureBlockReason(world, sim);
  if (blocked) return { ok: false, reason: blocked };
  const facility = world.map.facilities.find(f => f.id === facilityId && ['library', 'cinema'].includes(f.type));
  if (!facility || world.incidents.some(i => i.facilityId === facilityId)) return { ok: false, reason: 'no_facility' };
  const cost = world.logic.actions[CULTURE_ACTION].cost;
  sim.money -= cost; facility.revenue = (facility.revenue ?? 0) + cost;
  sim.needsTier.culture = 10000; sim.needsTier.visits++;
  sim.needs.fun = Math.min(10000, sim.needs.fun + world.logic.needsTiers.cultureFun);
  emit('money_changed', sim.id, { delta: -cost, balance: sim.money, action: CULTURE_ACTION });
  return { ok: true };
}
