// Identical natural day-80 snapshot; only proactive stocking differs.
import { createWorld } from '../sim/world.js';
import { tick } from '../sim/tick.js';
import { serialize, deserialize } from '../sim/serialize.js';
import { canWork } from '../sim/education.js';

const seed = Number(process.argv[2] ?? 9200);
const initial = createWorld(seed);
for (let i = 0; i < 80 * 1440 - 1; i++) tick(initial);
console.log(JSON.stringify({ seed, warmupTick: initial.worldTick, population: initial.sims.length }));
const snapshot = serialize(initial);
for (const stocking of [false, true]) {
  const w = deserialize(snapshot);
  if (!stocking) w.logic.seasons.stockDeficit = 0;
  let zero = 0, residentTicks = 0, stockActions = 0, studentWork = 0, pantryAtWinter = null;
  const deaths = [];
  for (let i = 0; i < 40 * 1440; i++) {
    const events = tick(w);
    for (const e of events) {
      if (e.type === 'died') deaths.push(e);
      if (e.type === 'goods_purchased' && e.payload?.action === 'stock_food') stockActions++;
    }
    const winter = w.worldTick >= 90 * 1440;
    if (winter && pantryAtWinter === null) pantryAtWinter = w.sims.reduce((n, s) => n + s.groceries, 0);
    for (const s of w.sims) {
      if (winter) { residentTicks++; if (s.needs.hunger === 0) zero++; }
      if (!canWork(s) && ['work', 'supply_groceries', 'grow_groceries'].includes(s.state.action)) studentWork++;
    }
  }
  console.log(JSON.stringify({ seed, stocking, population: w.sims.length, stockActions,
    pantryAtWinter, zero, residentTicks, hungerZeroPct: 100 * zero / residentTicks, deaths, studentWork }));
}
