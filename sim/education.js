// School stages, actual attendance, and university enrollment.
import { riskHash } from './chrono.js';
import { publicPostAvailable } from './publicposts.js';
import { rngInt } from './prng.js';
import { aptitudeFor } from './abilities.js';
import { occupationAllowed } from './traits.js';
import { sameRegion } from './map.js';
import { governmentFor } from './government.js';

export const SCHOOL_TYPES = ['primary_school', 'middle_school', 'high_school', 'university'];
export function newEducation() {
  return { universityEnrolled: false, decisionYear: -1, tuitionYear: -1,
    tuitionPaid: 0, studied: { primary_school: 0, middle_school: 0, high_school: 0, university: 0, masters: 0, doctorate: 0 },
    course: null, courseStartAge: -1, highestDegree: null,
    universityGraduated: false, completed: false, wantsUniversity: false, lastStage: null, studyDay: -1, dailyTicks: 0 };
}

export function schoolFor(sim) {
  const age = sim.traits.age;
  if (age >= 7 && age <= 12) return 'primary_school';
  if (age >= 13 && age <= 15) return 'middle_school';
  if (age >= 16 && age <= 18) return 'high_school';
  if (age >= 19 && sim.education?.universityEnrolled && !sim.education.completed) return 'university';
  return null;
}

// A degree program remains a student commitment even during unpaid/deferred enrollment.
export function canWork(sim) {
  return sim.traits.age >= 19 && sim.traits.occupation !== 'student'
    && !(sim.education?.course && !sim.education.completed);
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
  if (!E || sim.traits.age < 19 || E.completed) return;
  if (!E.course && sim.traits.age > 22 && sim.traits.occupation !== 'student') return;
  const year = Math.floor(t / (1440 * world.logic.society.yearDays));
  if (E.decisionYear === year) return;
  E.decisionYear = year;
  const interested = Boolean(E.course) || E.universityEnrolled || riskHash(sim.id, year, world.seed ^ 0x45445543) < universityChance(sim) * 1000;
  E.wantsUniversity = interested;
  if (!interested) {
    emit('education_decided', sim.id, { choice:'employment', reason:'preference', year });
    E.completed = true;
    return;
  }
  // Do not collect tuition for a campus the student cannot physically attend.
  const campuses = world.map.facilities.filter(f => f.type === 'university');
  const campus = campuses.find(f => f.resources.some(r => sameRegion(world.map, sim.x, sim.y, r.x, r.y)));
  const fee = world.logic.education.annualTuition;
  const payers = tuitionPayers(world, sim);
  const available = payers.reduce((sum,s) => sum + Math.max(0,s.money), 0);
  if (!campus || available < fee) {
    E.universityEnrolled = false;
    emit('education_decided', sim.id, { choice:'deferred', reason:campus ? 'tuition' : campuses.length ? 'unreachable' : 'no_university', year });
    return;
  }
  let remaining = fee;
  const payments = [];
  for (const payer of payers) {
    const amount = Math.min(Math.max(0,payer.money),remaining);
    if (amount > 0) { payer.money -= amount; remaining -= amount; payments.push({simId:payer.id,amount}); }
  }
  governmentFor(world,campus.villageId).treasury += fee; // Paid to the actual campus jurisdiction.
  if (!E.course) { E.course = 'university'; E.courseStartAge = sim.traits.age; }
  E.tuitionPaid += fee; E.tuitionYear = year; E.universityEnrolled = true;
  emit('education_decided', sim.id, { choice:'university', course:E.course, campusId:campus.id, year, tuition:fee, payments });
}

export function recordStudy(sim, facilityType) {
  const stage = schoolFor(sim);
  if (!stage || facilityType !== stage) return false;
  const key = stage === 'university' ? sim.education.course ?? 'university' : stage;
  sim.education.studied[key] = Math.min(1000000000,sim.education.studied[key]+1);
  return true;
}

function graduateCourse(world, sim, t, emit) {
  const E=sim.education, L=world.logic.education, course=E.course;
  if (!course || E.completed) return;
  const years={university:L.bachelorYears,masters:L.mastersYears,doctorate:L.doctorateYears}[course];
  const required={university:L.degreeStudyTicks,masters:L.mastersStudyTicks,doctorate:L.doctorateStudyTicks}[course];
  if(sim.traits.age-E.courseStartAge<years || E.studied[course]<required) return;
  E.highestDegree={university:'bachelor',masters:'masters',doctorate:'doctorate'}[course];
  if(course==='university') E.universityGraduated=true;
  emit('education_decided',sim.id,{choice:'degree',course,degree:E.highestDegree,studied:E.studied[course]});
  const next={university:'masters',masters:'doctorate'}[course];
  const year=Math.floor(t/(1440*world.logic.society.yearDays));
  const continueStudy=next && riskHash(sim.id,year,world.seed ^ (course==='university'?0x4d415354:0x504844))
    < Math.floor(universityChance(sim)*L.postgraduatePctFactor/100)*1000;
  if(continueStudy) {
    E.course=next;E.courseStartAge=sim.traits.age;
    // The year's tuition covers the next course too; never charge twice on promotion.
    emit('education_decided',sim.id,{choice:'postgraduate',course:next});
  } else {
    E.course=null;E.completed=true;E.universityEnrolled=false;E.wantsUniversity=false;
  }
}

export function updateEducation(world, t, emit, resetActivity = () => {}) {
  for (const sim of world.sims) {
    const E = sim.education, before = sim.traits.occupation;
    graduateCourse(world,sim,t,emit);
    if (sim.traits.age >= 19) considerUniversity(world, sim, t, emit);
    const stage = schoolFor(sim);
    if (sim.traits.age < 7) sim.traits.occupation = 'child';
    else if (stage || (E.course && !E.completed)) sim.traits.occupation = 'student';
    else if (before === 'student' || before === 'child') {
      const G = world.logic.graduation;
      // §23.13 정원이 찬 공공직은 후보에서 뺀다. 스무 명 마을에 경찰 셋이 생기던 자리다.
      const pool = (E.universityGraduated ? [...G.poolBase,...G.poolUni] : G.poolBase)
        .filter(o => occupationAllowed(o,sim.traits.age))
        .filter(o => publicPostAvailable(world, o, sim.id));
      const weighted=[];
      for(const o of pool.length ? pool : ['office_worker']) {
        const n=1+Math.floor(aptitudeFor(sim,o,world.logic)*world.logic.abilities.aptitudePoolWeight/10000);
        for(let i=0;i<n;i++) weighted.push(o);
      }
      sim.traits.occupation=weighted[rngInt(world.rngSim,weighted.length)];
      emit('graduated',sim.id,{to:sim.traits.occupation,uni:E.universityGraduated,degree:E.highestDegree});
    }
    if (E.lastStage !== stage || before !== sim.traits.occupation) {
      resetActivity(sim);
      sim.unpaidDays=0;
      if(before === 'child' && sim.traits.occupation === 'student') emit('grew_up',sim.id,{age:sim.traits.age,to:'student'});
      if (stage) emit('school_enrolled',sim.id,{stage,age:sim.traits.age});
      E.lastStage=stage;
    }
  }
}

export function neededSchool(world) {
  for(const type of SCHOOL_TYPES) {
    if(world.projects.some(p=>p.type===type) || world.zoneOrders.some(p=>p.type===type)) continue;
    const learners=world.sims.filter(s=>schoolFor(s)===type || (type==='university'
      && s.traits.age>=19 && s.education.wantsUniversity && !s.education.completed)).length;
    const capacity=world.map.facilities.filter(f=>f.type===type).reduce((n,f)=>n+f.resources.length,0);
    if(learners>capacity && world.treasury>=world.logic.zone.costs[type]) return type;
  }
  return null;
}
