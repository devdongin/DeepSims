import { test } from 'node:test';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick, collectCandidates, actionBlockReason } from '../sim/tick.js';
import { newEducation } from '../sim/education.js';
import { emptyState } from '../sim/simfactory.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { SUPPLY_ACTION, GROW_ACTION, deliveryQuote, completeDelivery, completeGroceryPurchase,
  refreshSupplyOrders, openSupplyMarket, initializeFoodSupply } from '../sim/food-supply.js';

const emit = () => {};
function fixture() {
  const w = createWorld(76), sim = w.sims[0], market = w.map.facilities.find(f => f.type === 'market');
  sim.traits.age = 25; sim.traits.occupation = 'office_worker'; sim.education = newEducation();
  sim.groceries = 6; market.groceryStock = 0; market.revenue = 1000;
  refreshSupplyOrders(w, 0, emit);
  return { w, sim, market };
}
const money = w => w.treasury + w.sims.reduce((n,s) => n+s.money,0)
  + w.map.facilities.reduce((n,f) => n+(f.revenue??0),0);

test('#76 delivery transfers existing goods and exact market funds while retaining the household reserve', () => {
  const { w, sim, market } = fixture(), before = money(w), goods = sim.groceries + market.groceryStock;
  const result = completeDelivery(w, sim, market.id, emit);
  assert.equal(result.quantity, 3); assert.equal(sim.groceries, 3); assert.equal(market.groceryStock, 3);
  assert.equal(money(w), before); assert.equal(sim.groceries + market.groceryStock, goods);
  assert.equal(w.foodSupply.totals.supplierIncome, 120);
});

test('#76 purchases consume store stock rather than creating groceries, preserving cash and goods', () => {
  const { w, sim, market } = fixture(); market.groceryStock = 3; sim.groceries = 0; sim.money = 1000;
  const before = money(w); const result = completeGroceryPurchase(w, sim, market.id, emit);
  assert.equal(result.ok, true); assert.equal(market.groceryStock, 0); assert.equal(sim.groceries, 3);
  assert.equal(money(w), before); assert.equal(w.foodSupply.totals.soldUnits, 3);
});

test('#76 stock races fail atomically and low stock keeps exactly one restocking order', () => {
  const { w, sim, market } = fixture(); sim.groceries = 0; sim.money = 1000;
  const before = money(w); const result = completeGroceryPurchase(w, sim, market.id, emit);
  assert.equal(result.reason, 'no_stock'); assert.equal(sim.groceries, 0); assert.equal(money(w), before);
  refreshSupplyOrders(w, 1, emit); refreshSupplyOrders(w, 2, emit);
  assert.equal(w.foodSupply.orders.filter(o=>o.facilityId===market.id).length, 1);
  assert.equal(w.foodSupply.totals.stockFailures, 1);
  assert.equal(actionBlockReason(w, sim, 'shop', 3), 'no_stock');
});

test('#76 arrival revalidates market funds and can buy only one affordable unit', () => {
  const { w, sim, market } = fixture(); assert.equal(deliveryQuote(w, sim, market).quantity, 3);
  market.revenue = 41; const before = money(w);
  const result = completeDelivery(w, sim, market.id, emit);
  assert.equal(result.quantity, 1); assert.equal(market.revenue, 1); assert.equal(sim.groceries, 5);
  assert.equal(money(w), before);
  const goods = sim.groceries + market.groceryStock;
  assert.equal(completeDelivery(w, sim, market.id, emit).reason, 'no_market_funds');
  assert.equal(sim.groceries + market.groceryStock, goods);
});

test('#76 minors, students and unfinished postgraduate courses cannot perform paid supply labor', () => {
  for (const mode of ['minor', 'student', 'postgraduate']) {
    const { w, sim, market } = fixture();
    if (mode === 'minor') sim.traits.age = 18;
    if (mode === 'student') sim.traits.occupation = 'student';
    if (mode === 'postgraduate') { sim.education.course = 'doctorate'; sim.education.completed = false; }
    const before = money(w), goods = sim.groceries;
    assert.equal(deliveryQuote(w, sim, market).ok, false);
    assert.deepEqual(collectCandidates(w, sim, [SUPPLY_ACTION, GROW_ACTION], 1, true), []);
    assert.equal(completeDelivery(w, sim, market.id, emit).ok, false);
    assert.equal(money(w), before); assert.equal(sim.groceries, goods);
  }
});

test('#76 a student resuming a legacy supply action receives no income or delivery completion', () => {
  const { w, sim, market } = fixture(); w.lastDailyDay = 0; sim.traits.occupation = 'student';
  sim.state = { ...emptyState(), kind: 'performing', action: SUPPLY_ACTION, facilityId: market.id,
    resourceId: market.resources[0].id, ticksLeft: 1 };
  const before = sim.money, goods = sim.groceries;
  const events = tick(w);
  assert.equal(sim.money, before); assert.equal(sim.groceries, goods);
  assert.ok(!events.some(e => e.type === 'supply_delivered' && e.simId === sim.id));
});

test('#76 physical delivery completes only after walking, and saving in transit replays exactly', () => {
  const { w, sim, market } = fixture(); w.lastDailyDay = 0;
  for (const s of w.sims) s.state = { ...emptyState(), kind: 'performing', action: 'idle', ticksLeft: 10000 };
  sim.state = emptyState();
  const events = tick(w, [{ sequence: 0, command: 'assign', payload: { simId: sim.id, actionType: SUPPLY_ACTION } }]);
  assert.ok(events.some(e => e.type === 'action_started' && e.payload.action === SUPPLY_ACTION));
  assert.equal(sim.state.kind, 'walking'); assert.equal(market.groceryStock, 0); assert.equal(sim.groceries, 6);
  const copy = deserialize(serialize(w)); let delivered = false;
  for (let i = 0; i < 200; i++) {
    const a = tick(w), b = tick(copy); assert.deepEqual(a,b);
    delivered ||= a.some(e => e.type === 'supply_delivered' && e.simId === sim.id);
  }
  assert.equal(delivered, true); assert.equal(hashWorld(w), hashWorld(copy));
});

test('#76 finite opening inventory is installed once; new stores receive actual treasury capital, not goods', () => {
  const w = createWorld(76), opening = w.foodSupply.totals.openingUnits;
  initializeFoodSupply(w); assert.equal(w.foodSupply.totals.openingUnits, opening);
  const fac = { id: 'new-market', type: 'market', revenue: 0 }; w.map.facilities.push(fac);
  const before = money(w); w.treasury = 100; const afterSet = money(w);
  openSupplyMarket(w, fac, emit);
  assert.equal(fac.groceryStock, 0); assert.equal(fac.revenue, 100); assert.equal(w.treasury, 0);
  assert.equal(money(w), afterSet); assert.ok(before > 0);
  openSupplyMarket(w, fac, emit); assert.equal(fac.revenue, 100);
});

test('#76 completed gardening records actual produced units and does not directly restock stores', () => {
  const { w, sim, market } = fixture(); w.lastDailyDay = 0; sim.groceries = 0;
  sim.state = { ...emptyState(), kind: 'performing', action: 'garden', facilityId: sim.homeId, resourceId: 'bed0', ticksLeft: 1 };
  tick(w); assert.equal(sim.groceries, 1); assert.equal(w.foodSupply.totals.producedUnits, 1);
  assert.equal(market.groceryStock, 0);
});

test('#76 v62 migration installs finite store stock, durable ledgers and action defaults without RNG', () => {
  const w = createWorld(76), rng = serialize(w.rngSim); w.schemaVersion = 62;
  w.logic.logicSchemaVersion = 59; delete w.logic.supply; delete w.logic.actions[SUPPLY_ACTION]; delete w.logic.actions[GROW_ACTION]; delete w.foodSupply;
  for (const f of w.map.facilities) delete f.groceryStock;
  migrateWorld(w);
  assert.equal(w.schemaVersion, SCHEMA_VERSION); assert.equal(w.logic.logicSchemaVersion, DEFAULT_LOGIC.logicSchemaVersion);
  assert.equal(w.foodSupply.totals.openingUnits, 12); assert.equal(serialize(w.rngSim), rng);
  const state = serialize(w); migrateWorld(w); assert.equal(serialize(w), state);
});

test('#76 procurement claims stay in the facility wallet and cannot be consumed by wages', () => {
  const { w, sim, market } = fixture(); w.lastDailyDay = 0;
  for (const s of w.sims) s.state = { ...emptyState(), kind: 'performing', action: 'idle', ticksLeft: 10000 };
  sim.traits.occupation = 'clerk';
  sim.state = { ...emptyState(), kind: 'performing', action: 'work', facilityId: market.id,
    resourceId: market.resources[0].id, ticksLeft: 1 };
  tick(w);
  assert.equal(market.revenue, 480); assert.equal(w.foodSupply.orders[0].reservedCash, 480);
  const before = money(w); assert.equal(completeDelivery(w, sim, market.id, emit).quantity, 3);
  assert.equal(money(w), before); assert.equal(market.revenue, 360);
});

test('#76 funded restocking demand enables real production, but no cash is paid until delivery', () => {
  const { w, sim, market } = fixture(); w.lastDailyDay = 0; sim.groceries = 0;
  assert.equal(actionBlockReason(w, sim, GROW_ACTION, 1), null);
  sim.state = { ...emptyState(), kind: 'performing', action: GROW_ACTION, facilityId: sim.homeId, resourceId: 'bed0', ticksLeft: 1 };
  const before = sim.money; tick(w);
  assert.equal(sim.groceries, 3); assert.equal(w.foodSupply.totals.producedUnits, 3);
  assert.equal(sim.money, before); assert.equal(market.groceryStock, 0);
});
