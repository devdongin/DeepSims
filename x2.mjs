import { createWorld, advance } from './sim/index.js';
import fs from 'fs';
const seeds = Array.from({length:20},(_,i)=>i+1);
const out = [];
for (const s of seeds) {
  const w = createWorld(s);
  const ev = advance(w, {}, 1440*120);
  const types = {};
  for (const e of ev) types[e.type]=(types[e.type]||0)+1;
  const pop = w.sims.length;
  const alive = w.sims.filter(x=>!x.dead).length;
  out.push({seed:s, pop, alive, types, tick:w.tick||w.worldTick});
  fs.writeFileSync(`/tmp/ds/ev_${s}.json`, JSON.stringify(ev));
  console.log('seed',s,'pop',pop,'alive',alive,'events',ev.length);
}
fs.writeFileSync('/tmp/ds/summary.json', JSON.stringify(out));
