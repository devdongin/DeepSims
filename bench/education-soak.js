// Read-only fixed-snapshot comparison. Run against baseline and candidate modules
// using the SAME serialized input. Never connects to or edits a live server.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [repo, snapshot, daysArg = '14'] = process.argv.slice(2);
if (!repo || !snapshot) throw new Error('usage: node bench/education-soak.js REPO SNAPSHOT [DAYS]');
const { migrateWorld, tick, hashWorld, findNonFinite } = await import(pathToFileURL(path.resolve(repo, 'sim/index.js')));
const raw = fs.readFileSync(snapshot, 'utf8');
const w = migrateWorld(JSON.parse(raw));
const startTick = w.worldTick, counts = {}, initial = w.sims.length;
let studied = 0, legacyStudentWorkStates = 0, studentWagePayments = 0, hungryPersonTicks = 0, personTicks = 0;
const hungerByOccupation = {};
for (let i = 0; i < Number(daysArg) * 1440; i++) {
  const students=new Set(w.sims.filter(s=>s.traits.occupation==='student').map(s=>s.id));
  for (const s of w.sims) {
    if (s.state.kind === 'performing') {
      if (s.state.action === 'study') studied++;
      if (s.state.action === 'work' && s.traits.occupation === 'student') legacyStudentWorkStates++;
    }
    hungryPersonTicks += Number(s.needs.hunger < w.logic.needCritical);
    const group=hungerByOccupation[s.traits.occupation]??={hungry:0,total:0};
    group.hungry+=Number(s.needs.hunger<w.logic.needCritical);group.total++;
    personTicks++;
  }
  for (const e of tick(w)) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if(e.type==='money_changed' && e.payload.action==='work' && students.has(e.simId)) studentWagePayments++;
  }
}
console.log(JSON.stringify({ inputSha256:createHash('sha256').update(raw).digest('hex'),
  startTick,endTick:w.worldTick,pop:[initial,w.sims.length],studyPerformingPersonTicks:studied,
  legacyStudentWorkStatesAtTickStart:legacyStudentWorkStates,studentWagePayments,
  recordedStudyTicks:w.sims.reduce((n,s)=>n+Object.values(s.education?.studied??{}).reduce((a,b)=>a+b,0),0),
  tuitionPaid:w.sims.reduce((n,s)=>n+(s.education?.tuitionPaid??0),0),
  hungryPersonTicks,personTicks,hungerByOccupation,treasury:w.treasury,
  facilities:Object.fromEntries([...new Set(w.map.facilities.map(f=>f.type))].map(type=>[type,w.map.facilities.filter(f=>f.type===type).length])),
  schoolPlanned:counts.school_planned??0,educationDecided:counts.education_decided??0,
  nonFinite:findNonFinite(w),hash:hashWorld(w) },null,2));
