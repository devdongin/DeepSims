// Conditional destination choice AFTER an existing household decides it must move.
// Source population cancels when normalizing P_source * P_destination / distance.
import {bfsPath} from './pathfind.js';
import {sameRegion} from './map.js';
import {rngNext} from './prng.js';
const compare=(a,b)=>a<b?-1:a>b?1:0;
const PRECISION=1000000n; // Fixed-point representation, not a behavioral multiplier.

export function chooseMigrationHome(world,origin,options){
  const ordered=[...options].sort((a,b)=>a.rent-b.rent||compare(a.home.id,b.home.id));
  if(!ordered.length)return null;
  // Preserve the original single-town path, including its RNG consumption.
  if(world.villages.length<2)return {home:ordered[0].home};
  const groups=new Map();
  for(const option of ordered){
    const home=option.home;
    if(!world.villages.some(v=>v.id===home.villageId)||groups.has(home.villageId))continue;
    if(!sameRegion(world.map,origin.door.x,origin.door.y,home.door.x,home.door.y))continue;
    groups.set(home.villageId,option); // Cheapest reachable home, not one gravity ticket per home.
  }
  const populations=new Map();
  for(const sim of world.sims)populations.set(sim.villageId,(populations.get(sim.villageId)??0)+1);
  const candidates=[];
  for(const [villageId,option] of [...groups].sort((a,b)=>compare(a[0],b[0]))){
    const home=option.home,path=bfsPath(world.map,origin.door.x,origin.door.y,home.door.x,home.door.y);
    if(path===null)continue;
    const distance=Math.max(1,path.length),population=populations.get(villageId)??0;
    const weight=BigInt(population)*PRECISION/BigInt(distance);
    candidates.push({villageId,homeId:home.id,rent:option.rent,population,distance,weight:Number(weight)});
  }
  if(!candidates.length)return null;
  const total=candidates.reduce((n,c)=>n+BigInt(c.weight),0n);
  const positive=candidates.filter(c=>c.weight>0);
  let selected,draw=null,fallback=null;
  if(candidates.length===1){selected=candidates[0];fallback='single_destination';}
  else if(positive.length===1){selected=positive[0];fallback='single_positive_destination';}
  else if(total===0n){
    // No observed population to weight: retain economic choice, do not invent mass.
    selected=[...candidates].sort((a,b)=>a.rent-b.rent||compare(a.homeId,b.homeId))[0];fallback='zero_population';
  }else{
    draw=rngNext(world.rngSim);let cumulative=0n;
    for(const c of candidates){
      cumulative+=BigInt(c.weight);
      if(BigInt(draw)*total<cumulative*4294967296n){selected=c;break;}
    }
  }
  return {home:groups.get(selected.villageId).home,evidence:{model:'conditional_gravity',
    fromVillageId:origin.villageId,sourcePopulation:populations.get(origin.villageId)??0,
    candidates,draw,fallback,selectedVillageId:selected.villageId}};
}
