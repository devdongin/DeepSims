// #76 One physical commodity: produced pantry surplus -> delivery -> shop stock.
import { canWork } from './education.js';
import { governmentFor } from './government.js';

export const SUPPLY_ACTION = 'supply_groceries';
export const GROW_ACTION = 'grow_groceries';
export const sellsGroceries = f => f.type === 'market' || f.type === 'mall';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function makeFoodSupply() {
  return { nextOrderId: 0, orders: [], totals: { openingUnits: 0, producedUnits: 0,
    deliveredUnits: 0, soldUnits: 0, supplierIncome: 0, workingCapital: 0, stockFailures: 0 } };
}

export function initializeFoodSupply(world) {
  world.foodSupply ??= makeFoodSupply();
  for (const f of world.map.facilities.filter(sellsGroceries)) {
    if (f.groceryStock !== undefined) continue;
    f.groceryStock = world.logic.supply.openingStock;
    world.foodSupply.totals.openingUnits += f.groceryStock;
  }
}

export function openSupplyMarket(world, fac, emit) {
  if (!sellsGroceries(fac) || fac.groceryStock !== undefined) return;
  fac.groceryStock = 0; // A new building does not produce food.
  const budget = world.logic.supply.targetStock * world.logic.supply.unitPrice;
  const government=governmentFor(world,fac.villageId);
  const paid = Math.min(Math.max(0, government.treasury), budget);
  government.treasury -= paid; fac.revenue = (fac.revenue ?? 0) + paid;
  world.foodSupply.totals.workingCapital += paid;
  emit('supply_capitalized', null, { facilityId: fac.id, amount: paid });
}

export function refreshSupplyOrders(world, t, emit) {
  const state = world.foodSupply, S = world.logic.supply;
  for (const fac of world.map.facilities.filter(sellsGroceries).sort((a, b) => compare(a.id, b.id))) {
    fac.groceryStock ??= 0;
    const order = state.orders.find(o => o.facilityId === fac.id);
    if (order) {
      order.quantity = Math.max(0, S.targetStock - fac.groceryStock);
      order.reservedCash = Math.min(Math.max(0, fac.revenue ?? 0), order.quantity * S.unitPrice);
    }
    else if (fac.groceryStock <= S.reorderAt) {
      const created = { orderId: state.nextOrderId++, facilityId: fac.id,
        quantity: Math.max(0, S.targetStock - fac.groceryStock), createdTick: t,
        reservedCash: procurementReserve(world, fac) };
      if (created.quantity) { state.orders.push(created); emit('supply_ordered', null, { ...created }); }
    }
  }
  state.orders = state.orders.filter(o => o.quantity > 0 && world.map.facilities.some(f => f.id === o.facilityId));
}

// Earmarked funds remain in facility.revenue: this is a claim, not a second wallet.
// Compute from current stock so a wage settling in the same tick as a purchase
// cannot spend the procurement budget before the end-of-tick order is written.
export function procurementReserve(world, fac) {
  if (!fac || !sellsGroceries(fac)) return 0;
  const S = world.logic.supply, stock = fac.groceryStock ?? 0;
  if (stock > S.reorderAt && !world.foodSupply.orders.some(o => o.facilityId === fac.id)) return 0;
  return Math.min(Math.max(0, fac.revenue ?? 0), Math.max(0, S.targetStock - stock) * S.unitPrice);
}

export function deliveryQuote(world, sim, fac) {
  if (!canWork(sim) || sim.traits.occupation === 'child') return { ok: false, reason: 'not_allowed' };
  if (!fac || !sellsGroceries(fac)) return { ok: false, reason: 'no_facility' };
  if (world.incidents.some(i => i.facilityId === fac.id)) return { ok: false, reason: 'invalid_site' };
  const order = world.foodSupply.orders.find(o => o.facilityId === fac.id);
  if (!order) return { ok: false, reason: 'no_order' };
  const S = world.logic.supply, surplus = Math.max(0, sim.groceries - S.keepReserve);
  if (!surplus) return { ok: false, reason: 'no_surplus' };
  const funds = Math.floor(Math.max(0, fac.revenue ?? 0) / S.unitPrice);
  if (!funds) return { ok: false, reason: 'no_market_funds' };
  const quantity = Math.min(surplus, S.maxDelivery, funds, order.quantity,
    Math.max(0, S.targetStock - (fac.groceryStock ?? 0)));
  return quantity > 0 ? { ok: true, quantity, payment: quantity * S.unitPrice, order }
    : { ok: false, reason: 'full_stock' };
}

export function completeDelivery(world, sim, facilityId, emit) {
  const fac = world.map.facilities.find(f => f.id === facilityId), quote = deliveryQuote(world, sim, fac);
  if (!quote.ok) return quote;
  sim.groceries -= quote.quantity; fac.groceryStock = (fac.groceryStock ?? 0) + quote.quantity;
  fac.revenue -= quote.payment; sim.money += quote.payment; quote.order.quantity -= quote.quantity;
  quote.order.reservedCash = procurementReserve(world, fac);
  world.foodSupply.totals.deliveredUnits += quote.quantity;
  world.foodSupply.totals.supplierIncome += quote.payment;
  emit('supply_delivered', sim.id, { facilityId, orderId: quote.order.orderId,
    quantity: quote.quantity, payment: quote.payment, stock: fac.groceryStock });
  emit('money_changed', sim.id, { delta: quote.payment, balance: sim.money, action: SUPPLY_ACTION });
  return quote;
}

export function purchaseQuantity(world, sim, action = 'shop') {
  return Math.max(0, Math.min(world.logic.actions[action].groceriesGain, world.logic.market.maxGroceries - sim.groceries));
}

export function purchaseCost(world, sim, action = 'shop') {
  const A = world.logic.actions[action];
  return Math.ceil(A.cost * purchaseQuantity(world, sim, action) / A.groceriesGain);
}

export function completeGroceryPurchase(world, sim, facilityId, emit, action = 'shop') {
  const fac = world.map.facilities.find(f => f.id === facilityId), quantity = purchaseQuantity(world, sim, action);
  const cost = purchaseCost(world, sim, action);
  if (!fac || !sellsGroceries(fac)) return { ok: false, reason: 'no_facility' };
  if (world.incidents.some(i => i.facilityId === fac.id)) return { ok: false, reason: 'invalid_site' };
  if (!quantity) return { ok: false, reason: 'not_needed' };
  const reserve = action === 'stock_food' ? world.logic.actions.eat.cost : 0;
  if (sim.money < cost + reserve) return { ok: false, reason: 'no_money' };
  if ((fac.groceryStock ?? 0) < quantity) {
    world.foodSupply.totals.stockFailures++;
    return { ok: false, reason: 'no_stock' };
  }
  fac.groceryStock -= quantity; sim.groceries += quantity;
  sim.money -= cost;
  fac.revenue = (fac.revenue ?? 0) + cost;
  world.foodSupply.totals.soldUnits += quantity;
  emit('goods_purchased', sim.id, { facilityId, quantity, stock: fac.groceryStock, action });
  emit('money_changed', sim.id, { delta: -cost, balance: sim.money, action });
  return { ok: true, quantity };
}

export function recordGardenProduce(world, sim, before, emit, source = 'garden') {
  const quantity = sim.groceries - before;
  if (quantity <= 0) return;
  world.foodSupply.totals.producedUnits += quantity;
  emit('goods_produced', sim.id, { quantity, source });
}
