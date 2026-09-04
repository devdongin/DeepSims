import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, serialize, deserialize, migrateWorld, hashWorld, tick } from '../sim/index.js';
import { newGovernment, governmentViews, governmentEmitter, publicBalance } from '../sim/government.js';
import { maybeImmigration, maybePromotion, zoneAllowedTypes } from '../sim/society.js';
import { villageSummary } from '../sim/villages.js';
import { TILE, plotBuildable } from '../sim/map.js';

function fixture() {
  const w = createWorld(32), homes = w.map.facilities.filter(f => f.type === 'house');
  w.villages.push({ id: 'village:1', name: '새솔', center: { ...homes[0].door }, foundedTick: 0,
    government: newGovernment() });
  for (const f of homes.slice(0, 3)) f.villageId = 'village:1';
  for (const s of w.sims) s.villageId = w.map.facilities.find(f => f.id === s.homeId).villageId;
  // Controlled capacity fixture, not a population change in the production path.
  w.sims = [w.sims.find(s => s.villageId === 'village:0'), w.sims.find(s => s.villageId === 'village:1')];
  w.cityTier = 0; w.reputation = 0;
  return w;
}
function immigrate(w) {
  const events = [], day = w.logic.society.immigrationIntervalDays;
  maybeImmigration(w, day * 1440, day, (type, id, payload) => events.push({ type, id, payload }));
  return events;
}
function closed(w) {
  return publicBalance(w) + w.sims.reduce((n,s) => n+s.money,0)
    + w.map.facilities.reduce((n,f) => n+(f.revenue??0),0) + w.externalOutflow - w.externalInflow;
}

test('#32 immigration uses each municipality reputation and available beds, with root IDs/RNG/accounting', () => {
  const w = fixture(), g = w.villages[1].government;
  g.reputation = w.logic.growth.immigPerExtra * 2;
  const before = closed(w), primary = w.treasury, local = g.treasury;
  const oldIds = new Set(w.sims.map(s => s.id));
  const replay = deserialize(serialize(w)), events = immigrate(w);
  assert.deepEqual(events, immigrate(replay)); assert.equal(hashWorld(w), hashWorld(replay));
  const added = w.sims.filter(s => !oldIds.has(s.id));
  assert.equal(added.filter(s => s.villageId === 'village:0').length, 1);
  assert.equal(added.filter(s => s.villageId === 'village:1').length, 3);
  assert.equal(new Set(w.sims.map(s => s.id)).size, w.sims.length);
  for (const s of added) {
    assert.equal(w.map.facilities.find(f => f.id === s.homeId).villageId, s.villageId);
    assert.deepEqual([s.x,s.y], [2,23], 'enters at real existing entrance, not new home teleport');
  }
  assert.equal(events.filter(e => e.type === 'immigrated' && e.payload.villageId === 'village:1').length, 3);
  assert.equal(closed(w), before); assert.equal(w.treasury, primary); assert.equal(g.treasury, local);
  const state = serialize(w); migrateWorld(w); assert.equal(serialize(w), state);
});

test('#32 a full or disconnected municipality cannot borrow neighbor beds or consume phantom arrival draws', () => {
  for (const condition of ['full', 'disconnected']) {
    const w = fixture(), baseline = deserialize(serialize(w));
    const localHomes = w.map.facilities.filter(f => f.type === 'house' && f.villageId === 'village:1');
    if (condition === 'full') for (const h of localHomes) h.resources = h.resources.slice(0, w.sims.filter(s => s.homeId === h.id).length);
    else {
      for (const h of localHomes) w.map.tiles[h.door.y*w.map.w+h.door.x] = TILE.MOUNTAIN;
      w.map.reachVersion = (w.map.reachVersion??0)+1;
    }
    // No local capacity in the reference: exactly the same primary arrivals/draws.
    for (const h of baseline.map.facilities.filter(f => f.type === 'house' && f.villageId === 'village:1')) h.resources = [];
    const before = w.sims.filter(s => s.villageId === 'village:1').length;
    immigrate(w); immigrate(baseline);
    assert.equal(w.sims.filter(s => s.villageId === 'village:1').length, before, condition);
    assert.deepEqual(w.rngSim, baseline.rngSim, condition);
    assert.equal(w.immigrantCounter, baseline.immigrantCounter, condition);
  }
});

test('#32 promotion affects local tier, reputation and memories, not neighboring unlocks', () => {
  const w = fixture(), g = w.villages[1].government;
  w.logic.tiers[1].popMin = 2;
  // Put a second existing resident into this controlled local population.
  const source = createWorld(32).sims.find(s => !w.sims.some(x => x.id === s.id));
  source.villageId = 'village:1'; w.sims.push(source);
  const neighbor = w.sims.find(s => s.villageId === 'village:0'), untouched = serialize(neighbor);
  const events = [];
  for (const local of governmentViews(w)) maybePromotion(local, 1440,
    governmentEmitter(local, (type,id,payload) => events.push({type,id,payload})));
  assert.equal(events.length, 1); assert.equal(events[0].payload.villageId, 'village:1');
  assert.equal(g.cityTier, 1); assert.equal(w.cityTier, 0);
  assert.equal(w.reputation, 0); assert.equal(g.reputation, w.logic.promotion.repBonus);
  assert.equal(serialize(neighbor), untouched);
  assert.ok(zoneAllowedTypes(w,'village:1').includes('apartment'));
  assert.ok(!zoneAllowedTypes(w,'village:0').includes('apartment'));
  assert.equal(villageSummary(w).find(v => v.id === 'village:1').government.cityTier, 1);
  const again = []; for (const local of governmentViews(w)) maybePromotion(local,1441,(...args)=>again.push(args));
  assert.equal(again.length, 0);
});

test('#32 old saves preserve original tier and money, and local zoning cannot borrow its unlocks', () => {
  const w = fixture(), g = w.villages[1].government;
  w.schemaVersion = 71; w.cityTier = 2; delete g.cityTier;
  const before = publicBalance(w); migrateWorld(w);
  assert.equal(w.cityTier, 2); assert.equal(g.cityTier, 0); assert.equal(publicBalance(w), before);
  assert.equal(hashWorld(migrateWorld(deserialize(serialize(w)))), hashWorld(w));
  const plot = w.plots.find(p => plotBuildable(w.map,p)); plot.villageId = 'village:1';
  g.treasury = 100000; w.lastDailyDay = 0; w.lastPlanDay = 0;
  const events = tick(w,[{command:'zone',payload:{plotId:plot.plotId,type:'apartment',dir:0}}]);
  assert.equal(events[0].type,'input_rejected'); assert.equal(events[0].payload.reason,'tier_locked');
  assert.equal(g.treasury,100000);
});

test('#32 a new neighbor is remembered only by residents of the arrival municipality', () => {
  const w = fixture(), neighbor = w.sims.find(s => s.villageId === 'village:0');
  for (const h of w.map.facilities.filter(f => f.type === 'house' && f.villageId === 'village:0'))
    h.resources = h.resources.slice(0,w.sims.filter(s=>s.homeId===h.id).length);
  const untouched = serialize(neighbor), events = immigrate(w);
  assert.equal(events.filter(e => e.type === 'immigrated').length,1);
  assert.equal(serialize(neighbor),untouched);
});

test('#32 automatic housing type follows the plot municipality tier rather than the original town', () => {
  for (const localTier of [0,1]) {
    const w = fixture(); w.cityTier = localTier ? 0 : 2; w.villages[1].government.cityTier = localTier;
    w.map = { w:128,h:128,tiles:Array(128*128).fill(TILE.GRASS),facilities:[],reachVersion:0 };
    w.plots = [{plotId:1,x:80,y:80,used:false,villageId:'village:1'}];
    w.lastDailyDay=0; w.lastPlanDay=-1;
    for (const s of w.sims) { s.traits.age=25;s.traits.occupation='office_worker';s.education.course=null; }
    const events=tick(w);
    assert.equal(events.find(e=>e.type==='project_started')?.payload.type,localTier?'apartment':'house');
  }
});
