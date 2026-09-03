// #71: quote from current funds; settle only a completed, attended medical visit.
// Public subsidy is a transfer to the hospital, not newly created money. Its later
// public-revenue remittance must not be counted as an additional net fiscal cost.
export function medicalQuote(world, patient) {
  const cost = world.logic.actions.see_doctor.cost;
  const copayPct = world.policy.healthCopayPct ?? world.logic.economy.healthCopayPct;
  const requestedSubsidy = cost - Math.floor(cost * copayPct / 100);
  const subsidy = Math.min(requestedSubsidy, Math.max(0, world.treasury));
  const patientCost = cost - subsidy;
  const parents = new Set(world.parents[patient.id] ?? []);
  const dependent = patient.traits.age < 19 || patient.traits.occupation === 'student';
  const payers = [patient, ...(dependent ? world.sims.filter(s => s.id !== patient.id
    && parents.has(s.id) && s.homeId === patient.homeId).sort((a, b) => a.id - b.id) : [])];
  let remaining = patientCost;
  const payments = [];
  for (const payer of payers) {
    const amount = Math.min(remaining, Math.max(0, payer.money));
    if (amount > 0) payments.push({ simId: payer.id, amount });
    remaining -= amount;
    if (remaining === 0) break;
  }
  return { ok: remaining === 0, cost, copayPct, subsidy, patientCost, payments };
}

export function medicalBlockReason(world, patient) {
  if (!medicalQuote(world, patient).ok) return 'no_money';
  if (!patient.sick) return 'healthy';
  return null;
}

export function completeMedicalVisit(world, patient, emit) {
  const state = patient.state;
  if (state.kind !== 'performing' || state.action !== 'see_doctor' || state.ticksLeft > 0
      || !patient.sick || !world.sims.includes(patient)) return false;
  const facility = world.map.facilities.find(f => f.id === state.facilityId);
  const resource = facility?.resources.find(r => r.id === state.resourceId);
  if (facility?.type !== 'hospital' || !resource || patient.x !== resource.x || patient.y !== resource.y
      || world.reservations[`${facility.id}:${resource.id}`] !== patient.id) return false;
  const quote = medicalQuote(world, patient);
  if (!quote.ok) return false;
  // Recomputed and applied synchronously, so concurrent completions cannot overspend.
  for (const payment of quote.payments) {
    const payer = world.sims.find(s => s.id === payment.simId);
    payer.money -= payment.amount;
    emit('money_changed', payer.id, { delta: -payment.amount, balance: payer.money,
      action: 'see_doctor', patientId: patient.id });
  }
  world.treasury -= quote.subsidy;
  facility.revenue = (facility.revenue ?? 0) + quote.cost;
  patient.sick = null;
  emit('medical_visit_paid', patient.id, { facilityId: facility.id, cost: quote.cost,
    patientCost: quote.patientCost, subsidy: quote.subsidy, copayPct: quote.copayPct,
    payments: quote.payments, treasury: world.treasury });
  emit('recovered', patient.id, { how: 'doctor' });
  return true;
}
