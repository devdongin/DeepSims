// School stages and university enrollment. Simulation integration follows in this branch.
import { riskHash } from './chrono.js';

export const SCHOOL_TYPES = ['primary_school', 'middle_school', 'high_school', 'university'];
export function newEducation() {
  return { universityEnrolled: false, decisionYear: -1, tuitionYear: -1,
    tuitionPaid: 0, studied: { primary_school: 0, middle_school: 0, high_school: 0, university: 0 },
    universityGraduated: false, completed: false };
}

export function schoolFor(sim) {
  const age = sim.traits.age;
  if (age >= 7 && age <= 12) return 'primary_school';
  if (age >= 13 && age <= 15) return 'middle_school';
  if (age >= 16 && age <= 18) return 'high_school';
  if (age >= 19 && age <= 22 && sim.education?.universityEnrolled) return 'university';
  return null;
}

export function tuitionPayers(world, sim) {
  const parents = new Set(world.parents[sim.id] ?? []);
  return [sim, ...world.sims.filter(s => parents.has(s.id) && s.homeId === sim.homeId && s.id !== sim.id)
    .sort((a,b) => a.id-b.id)];
}

export function universityChance(sim) {
  // Aptitude and study preference are gradients, not MBTI type gates.
  return Math.min(95, 20 + Math.floor(Math.min(99, sim.abilities.intellect) * 40 / 99)
    + Math.floor((100 - sim.traits.mbti.SN) * 20 / 100) + Math.floor(sim.traits.mbti.JP * 15 / 100));
}

export function considerUniversity(world, sim, t, emit) {
  const E = sim.education;
  if (!E || sim.traits.age < 19 || sim.traits.age > 22 || E.completed) return;
  const year = Math.floor(t / (1440 * world.logic.society.yearDays));
  if (E.decisionYear === year) return;
  E.decisionYear = year;
  const campus = world.map.facilities.find(f => f.type === 'university');
  const fee = world.logic.education.annualTuition;
  const payers = tuitionPayers(world, sim);
  const available = payers.reduce((sum,s) => sum + Math.max(0,s.money), 0);
  if (!campus || available < fee) {
    E.universityEnrolled = false;
    emit('education_decided', sim.id, { choice:'deferred', reason:campus ? 'tuition' : 'no_university', year });
    return;
  }
  const interested = E.universityEnrolled || riskHash(sim.id, year, world.seed ^ 0x45445543) < universityChance(sim) * 1000;
  if (!interested) {
    emit('education_decided', sim.id, { choice:'employment', reason:'preference', year });
    E.completed = true; // a choice, not a daily reroll until acceptance
    return;
  }
  let remaining = fee;
  const payments = [];
  for (const payer of payers) {
    const amount = Math.min(Math.max(0,payer.money),remaining);
    if (amount > 0) { payer.money -= amount; remaining -= amount; payments.push({simId:payer.id,amount}); }
  }
  world.treasury += fee; // public university tuition remains in the domestic ledger
  E.tuitionPaid += fee; E.tuitionYear = year; E.universityEnrolled = true;
  emit('education_decided', sim.id, { choice:'university', campusId:campus.id, year, tuition:fee, payments });
}

export function recordStudy(sim, facilityType) {
  const stage = schoolFor(sim);
  if (!stage || facilityType !== stage) return false;
  sim.education.studied[stage] = Math.min(1000000000,sim.education.studied[stage]+1);
  return true;
}

export function finishUniversity(sim, minimumTicks) {
  if (!sim.education || sim.traits.age < 23) return;
  sim.education.universityGraduated = sim.education.studied.university >= minimumTicks;
  sim.education.universityEnrolled = false;
  sim.education.completed = true;
}
