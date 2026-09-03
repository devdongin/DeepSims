import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { tick, actionBlockReason } from '../sim/tick.js';
import { seasonAt, updateSeason, shouldStockFood, seasonalYield, winterExposureCost, STOCK_ACTION } from '../sim/seasons.js';
import { completeGroceryPurchase, purchaseCost } from '../sim/food-supply.js';
import { serialize, deserialize, hashWorld } from '../sim/serialize.js';
import { migrateWorld } from '../sim/migrate.js';
import { TILE } from '../sim/map.js';

test('#92 seasons are a pure calendar function at every quarter/year boundary', () => {
  const w = createWorld(92), before = serialize(w);
  for (const [day, name] of [[0,'spring'],[29,'spring'],[30,'summer'],[59,'summer'],[60,'autumn'],[89,'autumn'],[90,'winter'],[119,'winter'],[120,'spring']]) {
    assert.equal(seasonAt(w, day*1440).name, name);
  }
  assert.equal(serialize(w), before);
  w.logic.society.yearDays = 31;
  assert.equal(seasonAt(w, 23*1440).name, 'autumn'); assert.equal(seasonAt(w, 24*1440).name, 'winter');
  assert.equal(seasonAt(w, 31*1440).name, 'spring');
});

test('#92 winter preparation starts at the exact lead boundary, stops at pantry target, and does not spend the last meal', () => {
  const w = createWorld(92), s = w.sims[0]; s.traits.occupation='office_worker';s.traits.age=25;s.groceries=3;s.money=1000;
  assert.equal(shouldStockFood(w,s,79*1440),false);assert.equal(shouldStockFood(w,s,80*1440),true);
  assert.equal(shouldStockFood(w,s,119*1440),true);assert.equal(shouldStockFood(w,s,120*1440),false);
  assert.equal(actionBlockReason(w,s,STOCK_ACTION,80*1440),null);
  s.money=600;assert.equal(actionBlockReason(w,s,STOCK_ACTION,80*1440),'not_needed');
  s.groceries=6;assert.equal(shouldStockFood(w,s,80*1440),false);
});

test('#92 stocking buys only real remaining pantry capacity and pays proportionally without minting goods or money', () => {
  const w=createWorld(92),s=w.sims[0],f=w.map.facilities.find(f=>f.type==='market');
  s.groceries=5;s.money=1000;f.groceryStock=12;f.revenue=0;
  const cash=s.money+f.revenue,goods=s.groceries+f.groceryStock;
  assert.equal(purchaseCost(w,s,STOCK_ACTION),200);
  assert.equal(completeGroceryPurchase(w,s,f.id,()=>{},STOCK_ACTION).quantity,1);
  assert.equal(s.groceries,6);assert.equal(s.money,800);assert.equal(s.money+f.revenue,cash);
  assert.equal(s.groceries+f.groceryStock,goods);
  s.groceries=5;s.money=200;
  assert.equal(completeGroceryPurchase(w,s,f.id,()=>{},STOCK_ACTION).reason,'no_money');
  assert.equal(s.groceries,5);assert.equal(s.money,200);
});

test('#92 winter harvest/fish multipliers use integer floors and do not consume RNG', () => {
  const w=createWorld(92),rng=serialize(w.rngSim);
  assert.equal(seasonalYield(w,3,89*1440),3);assert.equal(seasonalYield(w,3,90*1440),1);
  assert.equal(seasonalYield(w,101,90*1440,'fish'),50);assert.equal(serialize(w.rngSim),rng);
});

test('#92 cold costs energy only during winter outdoor activity, not indoor rest', () => {
  const w=createWorld(92),s=w.sims[0];w.season=seasonAt(w,90*1440);
  s.state.kind='walking';w.map.tiles[s.y*w.map.w+s.x]=TILE.ROAD;
  assert.equal(winterExposureCost(w,s),1);
  w.map.tiles[s.y*w.map.w+s.x]=TILE.FLOOR;assert.equal(winterExposureCost(w,s),0);
  s.state.kind='performing';s.state.action='sleep';s.state.facilityId=s.homeId;
  assert.equal(winterExposureCost(w,s),0);
  s.state.action='garden';assert.equal(winterExposureCost(w,s),1);
  w.season=seasonAt(w,0);assert.equal(winterExposureCost(w,s),0);
});

test('#92 seasonal transitions emit once and save/resume remains identical across winter entry', () => {
  const a=createWorld(92);a.worldTick=90*1440-2;a.season=seasonAt(a,a.worldTick);
  const b=deserialize(serialize(a));const events=[];
  for(let i=0;i<5;i++){const ea=tick(a),eb=tick(b);assert.deepEqual(ea,eb);events.push(...ea);}
  assert.equal(events.filter(e=>e.type==='season_changed').length,1);assert.equal(hashWorld(a),hashWorld(b));
  const seen=[];updateSeason(a,a.worldTick,(...args)=>seen.push(args));assert.equal(seen.length,0);
});

test('#92 v63 migration derives current season and installs stock action without RNG draws', () => {
  const w=createWorld(92),rng=serialize(w.rngSim);w.worldTick=100*1440;w.schemaVersion=63;
  w.logic.logicSchemaVersion=60;delete w.logic.seasons;delete w.logic.actions[STOCK_ACTION];delete w.season;
  migrateWorld(w);assert.equal(w.schemaVersion,65);assert.equal(w.logic.logicSchemaVersion,62);
  assert.equal(w.season.name,'winter');assert.equal(serialize(w.rngSim),rng);
});
