// #92 Calendar-derived seasons. No random draws, cash grants, or inventory grants.
import { TILE } from './map.js';

export const STOCK_ACTION = 'stock_food';
const NAMES = ['spring', 'summer', 'autumn', 'winter'];

export function seasonAt(world, t) {
  const day = Math.floor(t / 1440), yearDays = world.logic.society.yearDays;
  const dayOfYear = day % yearDays, index = Math.floor(dayOfYear * 4 / yearDays);
  const winterStart = Math.ceil(yearDays * 3 / 4);
  return { day, yearDays, year: Math.floor(day / yearDays), dayOfYear, index, name: NAMES[index],
    daysUntilWinter: (winterStart - dayOfYear + yearDays) % yearDays };
}

export function updateSeason(world, t, emit) {
  if (world.season?.day === Math.floor(t / 1440) && world.season.yearDays === world.logic.society.yearDays) return;
  const previous = world.season, next = seasonAt(world, t);
  world.season = next;
  if (previous && previous.index !== next.index) emit('season_changed', null, { from: previous.name, to: next.name, season: next });
}

export function shouldStockFood(world, sim, t) {
  const S = world.logic.seasons, season = seasonAt(world, t);
  return S.stockDeficit > 0 && sim.groceries < Math.min(S.stockTarget, world.logic.market.maxGroceries)
    && (season.index === 3 || (season.index === 2 && season.daysUntilWinter <= S.stockLeadDays));
}

export function seasonalYield(world, amount, t, kind = 'harvest') {
  if (seasonAt(world, t).index !== 3) return amount;
  const pct = kind === 'fish' ? world.logic.seasons.winterFishPct : world.logic.seasons.winterHarvestPct;
  return Math.floor(amount * pct / 100);
}

export function winterExposureCost(world, sim) {
  if (world.season.index !== 3) return 0;
  const state = sim.state;
  const outdoors = state.kind === 'walking'
    ? world.map.tiles[sim.y * world.map.w + sim.x] !== TILE.FLOOR
    : state.kind === 'performing' && (['garden', 'grow_groceries'].includes(state.action)
      || world.map.facilities.some(f => f.id === state.facilityId && ['park', 'pond'].includes(f.type)));
  return outdoors ? world.logic.seasons.winterOutdoorEnergy : 0;
}
