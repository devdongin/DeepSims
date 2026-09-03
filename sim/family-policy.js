// Child allowance is a treasury-to-family transfer, never wages or a direct needs heal.
export function applyChildAllowance(world, t, emit) {
  const amount = world.policy.childAllowance ?? world.logic.economy.childAllowance;
  const day = Math.floor(t / 1440);
  if (amount <= 0 || world.childAllowanceDay >= day) return;
  world.childAllowanceDay = day;
  // One record per child, not per parent. Sorting does not consume RNG.
  const families = world.sims.filter(s => s.traits.age < 19).map(child => {
    const ids = new Set(world.parents[child.id] ?? []);
    const parents = world.sims.filter(s => s.id !== child.id && ids.has(s.id)
      && s.homeId === child.homeId && s.traits.age >= 19).sort((a,b) => a.money-b.money || a.id-b.id);
    return { child, parents, cash: child.money + parents.reduce((n,s) => n+s.money,0) };
  }).filter(f => f.parents.length > 0).sort((a,b) => a.cash-b.cash || a.child.id-b.child.id);
  for (const { child, parents } of families) {
    if (world.treasury < amount) break; // no debt, partial promises or money creation
    const recipient = parents[0];
    world.treasury -= amount; recipient.money += amount;
    emit('child_allowance_paid', recipient.id, { childId: child.id, homeId: child.homeId,
      amount, balance: recipient.money, treasury: world.treasury, day });
  }
}
