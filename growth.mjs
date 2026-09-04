import { createWorld, advance } from './sim/index.js';
import { plotBuildable } from './sim/map.js';
for (const seed of [9001, 4242, 111]) {
  const w = createWorld(seed);
  const ev = advance(w, {}, 300*1440);
  const beds = w.map.facilities.filter(f=>f.type==='house'||f.type==='apartment').reduce((n,f)=>n+f.resources.length,0);
  const free = w.plots.filter(p=>!p.used);
  const byType={}; for(const e of ev) if(e.type==='facility_built') byType[e.payload.type]=(byType[e.payload.type]??0)+1;
  console.log('seed', seed, '300일 | 인구', String(w.sims.length).padStart(4), '· 침대', String(beds).padStart(4),
    '· 시설', String(w.map.facilities.length).padStart(3), '· 남은 공터', String(free.length).padStart(3),
    '· 그중 집 가능', free.filter(p=>plotBuildable(w.map,p,6,5)).length);
  console.log('   완공:', JSON.stringify(byType));
}
