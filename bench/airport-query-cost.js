// Synthetic 200-resident route-query cost, not natural airport demand/growth.
// Includes native facilities but controlled traversable terrain and two airports.
import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {makeSynthWorld} from './synthpop.js';
import {clearTerrainKeepingFacilities} from './founding-fixture.js';
import {addBuilding,airportSiteBuildable,plotBuildable} from '../sim/map.js';
import {commissionAirport} from '../sim/air-network.js';
import {chooseAirJourney} from '../sim/air-journey.js';
import {bfsPath} from '../sim/pathfind.js';
import {fnv1a,serialize} from '../sim/serialize.js';
const w=makeSynthWorld(32,200);clearTerrainKeepingFacilities(w.map);
// Optional frozen checkout for before/after comparison of exactly the same cases.
const choose=process.argv[2]?(await import(pathToFileURL(path.resolve(process.argv[2],'sim/air-journey.js')))).chooseAirJourney:chooseAirJourney;
const sites=[];
for(let y=2;y<w.map.h-14;y+=16)for(let x=2;x<w.map.w-22;x+=24)
  if(airportSiteBuildable(w.map,{x,y},0))sites.push({x,y});
for(const [i,site] of [sites[0],sites.at(-1)].entries()){
  const f=addBuilding(w.map,'airport',{...site,villageId:`village:${i}`});
  commissionAirport(w.air,f,`query-fixture:${i}`,0,{speed:8,dwellTicks:10,capacity:8});
}
const target=w.map.facilities.find(f=>f.type==='cafe');
const farSite=sites.slice().reverse().find(p=>plotBuildable(w.map,p,7,5));
const farTarget=addBuilding(w.map,'cafe',{...farSite,villageId:'village:1'});
const queries=w.sims.map((s,i)=>{
  const f=i<196?target:farTarget;
  return {s,target:{action:'eat',facilityId:f.id,res:f.resources[0]},
    path:bfsPath(w.map,s.x,s.y,f.resources[0].x,f.resources[0].y)};
});
const samples=[];
for(let repeat=0;repeat<3;repeat++){
  const start=performance.now(),results=queries.map(q=>choose(w,q.s,q.target,500,q.path));
  samples.push({elapsedMs:Math.round(performance.now()-start),selected:results.filter(Boolean).length,
    hash:fnv1a(serialize(results))});
}
console.log(JSON.stringify({population:w.sims.length,queries:queries.length,airports:w.air.airports.map(a=>a.door),samples},null,2));
