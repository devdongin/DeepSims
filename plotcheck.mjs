import { createWorld, advance } from './sim/index.js';
import { plotBuildable } from './sim/map.js';
const SEEDS = Array.from({length:10},(_,i)=>1000+i*37);
const st=(a)=>{const m=a.reduce((x,y)=>x+y,0)/a.length; const sd=Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length); return `${Math.round(m*10)/10}±${Math.round(sd*10)/10}`;};
const free=[], build=[], pop=[], beds=[], built=[];
for (const seed of SEEDS) {
  const w = createWorld(seed);
  const ev = advance(w, {}, 120*1440);
  const unused = w.plots.filter(p=>!p.used);
  free.push(unused.length);
  build.push(unused.filter(p=>plotBuildable(w.map, p)).length);
  pop.push(w.sims.length);
  beds.push(w.map.facilities.filter(f=>f.type==='house'||f.type==='apartment').reduce((n,f)=>n+f.resources.length,0));
  built.push(ev.filter(e=>e.type==='facility_built').length);
}
console.log('120일 · 10시드');
console.log('  미사용 공터', st(free), '· 그중 건축가능', st(build));
console.log('  인구', st(pop), '· 침대', st(beds), '· 완공', st(built));
