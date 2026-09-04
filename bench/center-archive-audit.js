// Read an existing archive ONLY. All migration/repair/forward ticks are in memory.
// Never attach this connection to Storage or write the player's/archive DB.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {deserialize,serialize,migrateWorld,tick} from '../sim/index.js';
import {repairCenterPlots} from '../sim/center-plots.js';
import {plotBuildable} from '../sim/map.js';

assert.ok(process.argv[2],'readonly archive path required');
const db=new Database(process.argv[2],{readonly:true,fileMustExist:true});
let world;
try{world=deserialize(db.prepare('SELECT state FROM snapshot ORDER BY tick DESC LIMIT 1').get().state);}
finally{db.close();}
migrateWorld(world);
const beforeTick=world.worldTick,tiles=serialize(world.map.tiles),repairs=[];
repairCenterPlots(world,(type,id,payload)=>repairs.push({type,payload}));
assert.equal(serialize(world.map.tiles),tiles,'repair must not erase any road/sidewalk/terrain');
const repaired=new Set(repairs.map(e=>e.payload.plotId));
assert.ok(repaired.size>0,'archive must reproduce a repairable center');
for(const p of world.plots.filter(p=>repaired.has(p.plotId)))assert.ok(plotBuildable(world.map,p,12,10));
const construction=[];
// Cross one planning-day boundary without injecting needs, money or inputs.
const end=(Math.floor(world.worldTick/1440)+1)*1440+1;
while(world.worldTick<end){
  for(const e of tick(world))if(['project_started','construction_completed'].includes(e.type)
    &&repaired.has(e.payload.plotId))construction.push(e);
}
console.log(JSON.stringify({pass:true,scope:'readonly archive; only in-memory migration and forward simulation',
  seed:world.seed,beforeTick,endTick:world.worldTick,repairs,construction,
  repairedProjects:world.projects.filter(p=>repaired.has(p.plotId)),
  centers:world.centers,treasury:world.treasury},null,2));
