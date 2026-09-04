import { createWorld, tick } from './sim/index.js';
import { plotBuildable } from './sim/map.js';
const seed=Number(process.argv[2]), D=Number(process.argv[3]??50), METRICS=process.argv[4]==='m';
const w=createWorld(seed);
for(let d=0;d<D;d++){ for(let i=0;i<1440;i++) tick(w,[]);
  if(METRICS){ const b=w.plots.filter(p=>!p.used&&plotBuildable(w.map,p,6,5)).length; if(d<0)console.log(b); }
}
console.log('seed',seed,'days',D,'metrics',METRICS,'pop',w.sims.length,'treasury',w.treasury);
