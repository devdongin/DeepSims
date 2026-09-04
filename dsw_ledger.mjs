import { createWorld, tick } from './sim/index.js';
import fs from 'fs';
const seed=Number(process.argv[2]), DAYS=Number(process.argv[3]), OUT=process.argv[4];
const w=createWorld(seed); const L=w.logic;
for(let d=0;d<DAYS;d++) for(let i=0;i<1440;i++) tick(w,[]);
const byType={};
for(const f of w.map.facilities){const t=f.type;(byType[t]??={n:0,rev:0}).n++;byType[t].rev+=f.revenue??0;}
const cash=w.sims.reduce((a,s)=>a+s.money,0);
const occ={}; for(const s of w.sims) occ[s.traits.occupation]=(occ[s.traits.occupation]??0)+1;
const wealth=w.sims.map(s=>s.money).sort((a,b)=>a-b);
const q=p=>wealth[Math.floor((wealth.length-1)*p)];
fs.writeFileSync(OUT, JSON.stringify({seed,days:DAYS,pop:w.sims.length,treasury:w.treasury,cash,
  rev:Object.values(byType).reduce((a,b)=>a+b.rev,0), byType, occ,
  wealth:{p10:q(.1),p50:q(.5),p90:q(.9),max:wealth[wealth.length-1]},
  gini:(()=>{let s=0;const n=wealth.length;const tot=wealth.reduce((a,b)=>a+b,0);for(let i=0;i<n;i++)s+=(2*(i+1)-n-1)*wealth[i];return tot?Math.round(1000*s/(n*tot))/1000:0})(),
  supplierIncome:w.foodSupply.totals.supplierIncome, stockFail:w.foodSupply.totals.stockFailures,
  soldUnits:w.foodSupply.totals.soldUnits, deliveredUnits:w.foodSupply.totals.deliveredUnits,
  inflow:w.externalInflow,outflow:w.externalOutflow}));
