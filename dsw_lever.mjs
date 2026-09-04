import { createWorld, tick } from './sim/index.js';
import fs from 'fs';
const seed = Number(process.argv[2]);
const mode = process.argv[3];
const DAYS = Number(process.argv[4] ?? 80);
const OUT = process.argv[5];
const w = createWorld(seed);
const L = w.logic;
// A/B 대조군 스위치 — 시장의 자동 재정조정을 끈다 (logic.fiscal 자체 제공 스위치)
if (mode !== 'live') { L.fiscal.stepTaxPct = 0; L.fiscal.stepWelfare = 0; }
if (mode.startsWith('tax')) L.economy.taxPct = Number(mode.slice(3));
if (mode.startsWith('wcap')) L.economy.welfareDailyCap = Number(mode.slice(4));
if (mode.startsWith('wamt')) L.economy.welfareAmount = Number(mode.slice(4));
const ev = {};
for (let d = 0; d < DAYS; d++) for (let i = 0; i < 1440; i++) {
  for (const e of tick(w, [])) ev[e.type] = (ev[e.type]??0)+1;
}
const cash = w.sims.reduce((a,s)=>a+s.money,0);
const rev = w.map.facilities.reduce((a,f)=>a+(f.revenue??0),0);
const pop = w.sims.length;
const out = { seed, mode, pop, treasury: w.treasury, cash, rev,
  cashPct: Math.round(cash*1000/(cash+rev+Math.max(0,w.treasury)))/10,
  poor: w.sims.filter(s=>s.money<300).length,
  mood: Math.round(w.sims.reduce((a,s)=>a+s.mood,0)/Math.max(1,pop)),
  beds: w.map.facilities.filter(f=>f.type==='house'||f.type==='apartment').reduce((a,f)=>a+f.resources.length,0),
  facilities: w.map.facilities.length,
  rep: w.reputation, tier: w.cityTier,
  taxPct: w.policy.taxPct ?? L.economy.taxPct,
  welfarePaid: ev.welfare_paid??0, wageShort: ev.wage_shortfall??0, died: ev.died??0,
  emigrated: ev.emigrated??0, immigrated: ev.immigrated??0, starving: ev.starving??0,
  built: ev.facility_built??0, supplierIncome: w.foodSupply?.totals?.supplierIncome??0,
  soldUnits: w.foodSupply?.totals?.soldUnits??0, stockFail: w.foodSupply?.totals?.stockFailures??0,
  inflow: w.externalInflow, outflow: w.externalOutflow };
fs.writeFileSync(OUT, JSON.stringify(out));
