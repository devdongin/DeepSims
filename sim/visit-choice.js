import {bfsPath} from './pathfind.js';
import {sameRegion} from './map.js';
import {rngNext} from './prng.js';
import {chooseAirJourney} from './air-journey.js';

// Free destination choice, not work/school assignment, an emergency, freight,
// childcare, a construction site or a household's private resources.
const VISITS=new Set(['eat','socialize','play','drink','binge_eat','exercise','read',
  'shop','fish','stroll','volunteer','board_game','stock_food','visit_culture']);
const cmp=(a,b)=>a<b?-1:a>b?1:0;

// Stable observation for one idle-decision phase; never retain across ticks.
export function visitContext(world){
  const populations=new Map();
  for(const s of world.sims)populations.set(s.villageId,(populations.get(s.villageId)??0)+1);
  return {villages:new Set(world.villages.map(v=>v.id)),
    facilities:new Map(world.map.facilities.map(f=>[f.id,f])),populations};
}

export function chooseVisit(world,sim,candidates,best,pickBest,urgent=false,context=null){
  const t=world.worldTick+1;
  if(!best||urgent||world.villages.length<2||!VISITS.has(best.action)||best.partyPull)
    return {candidate:best};
  const {villages,facilities,populations}=context??visitContext(world);
  const groups=new Map();
  for(const c of candidates){
    if(c.action!==best.action||c.partyPull)continue;
    const f=facilities.get(c.facilityId);
    if(!f||!villages.has(f.villageId))continue;
    const group=groups.get(f.villageId)??[];group.push(c);groups.set(f.villageId,group);
  }
  // No cross-town choice means no new path searches or RNG consumption.
  if(groups.size<2)return {candidate:best};
  const options=[];
  for(const [villageId,group] of [...groups].sort((a,b)=>cmp(a[0],b[0]))){
    while(group.length){
      const c=pickBest(group);group.splice(group.indexOf(c),1);
      const path=sameRegion(world.map,sim.x,sim.y,c.res.x,c.res.y)
        ?bfsPath(world.map,sim.x,sim.y,c.res.x,c.res.y):null;
      const air=path===null?chooseAirJourney(world,sim,c,t,null):null;
      if(path===null&&!air)continue;
      const population=populations.get(villageId)??0,distance=Math.max(1,path?.length??air.physicalDistance);
      options.push({candidate:c,path,air,villageId,population,distance,
        weight:BigInt(population)*1000000n/BigInt(distance)});
      break;
    }
  }
  if(!options.length)return {candidate:best};
  const positive=options.filter(o=>o.weight>0),total=positive.reduce((sum,o)=>sum+o.weight,0n);
  let selected,draw=null;
  if(positive.length<2){
    const preferred=positive.length?null:pickBest(options.map(o=>o.candidate));
    selected=positive[0]??options.find(o=>o.candidate===preferred);
  }else{
    draw=rngNext(world.rngSim);let sum=0n;
    for(const o of options){sum+=o.weight;if(BigInt(draw)*total<sum*4294967296n){selected=o;break;}}
  }
  return {candidate:selected.candidate,path:selected.path,...(selected.air?{air:selected.air}:{}),evidence:{model:'conditional_gravity',
    action:best.action,fromVillageId:sim.villageId,origin:{x:sim.x,y:sim.y},draw,
    selectedVillageId:selected.villageId,candidates:options.map(o=>({villageId:o.villageId,
      facilityId:o.candidate.facilityId,resourceId:o.candidate.resourceId,population:o.population,
      distance:o.distance,weight:Number(o.weight)}))}};
}
