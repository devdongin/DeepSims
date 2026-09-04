import {canWork} from './education.js';
import {sameRegion} from './map.js';
import {bfsPath} from './pathfind.js';
import {rngNext} from './prng.js';

const cmp=(a,b)=>a<b?-1:a>b?1:0;
const workplaceTypes=(world,sim)=>[].concat(world.logic.workplace[sim.traits.occupation]??[]);
function reachable(world,home,facility){
  return home?.door&&facility?.door
    &&sameRegion(world.map,home.door.x,home.door.y,facility.door.x,facility.door.y)
    &&facility.resources.some(r=>sameRegion(world.map,home.door.x,home.door.y,r.x,r.y));
}

// Employment is a lasting relationship, not a daily choice of the richest seat.
// No wages, revenue, population or positions are created here. Existing occupation
// hiring/quota logic remains authoritative; this assigns its physical employer.
export function updateEmployment(world,t,emit){
  const facilities=new Map(world.map.facilities.map(f=>[f.id,f]));
  // Siblings sharing a home need the same synchronous distance observation.
  // Discard at return: no invalidation contract or stale cross-tick distance cache.
  const distances=new Map();
  for(const sim of [...world.sims].sort((a,b)=>a.id-b.id)){
    sim.employment??=null;sim.employmentSearch??=null;
    const types=workplaceTypes(world,sim),eligible=canWork(sim)&&types.length>0;
    const home=facilities.get(sim.homeId),previous=sim.employment;
    const facility=previous&&facilities.get(previous.facilityId);
    if(previous&&eligible&&previous.occupation===sim.traits.occupation
      &&types.includes(facility?.type)&&reachable(world,home,facility))continue;
    if(previous){
      sim.employment=null;sim.employmentSearch=null;
      emit('employment_ended',sim.id,{facilityId:previous.facilityId,occupation:previous.occupation,
        reason:!eligible?'ineligible':previous.occupation!==sim.traits.occupation?'occupation_changed'
          :!facility?'facility_removed':'unreachable'});
    }
    if(!eligible){sim.employmentSearch=null;continue;}
    // Failed searches retry on a new day, home/job change, or map/network change.
    // Temporary full seats/fire never dissolve an otherwise valid relationship.
    const search=JSON.stringify([Math.floor(t/1440),sim.homeId,sim.traits.occupation,
      world.map.reachVersion??0,world.map.facilities.length]);
    if(sim.employmentSearch===search)continue;
    sim.employmentSearch=search;
    const options=[];
    for(const f of [...facilities.values()].sort((a,b)=>cmp(a.id,b.id))){
      if(!types.includes(f.type)||!reachable(world,home,f))continue;
      const key=JSON.stringify([home.id,f.id]);
      if(!distances.has(key)){
        const path=bfsPath(world.map,home.door.x,home.door.y,f.door.x,f.door.y);
        distances.set(key,path?.length??null);
      }
      const distance=distances.get(key);if(distance===null)continue;
      const weight=1000000n/BigInt(distance+1);
      if(weight>0n)options.push({facilityId:f.id,distance,weight});
    }
    if(!options.length)continue;
    let selected=options[0],draw=null;
    if(options.length>1){
      draw=rngNext(world.rngSim);
      const total=options.reduce((n,o)=>n+o.weight,0n);let sum=0n;
      for(const o of options){sum+=o.weight;if(BigInt(draw)*total<sum*4294967296n){selected=o;break;}}
    }
    sim.employment={facilityId:selected.facilityId,occupation:sim.traits.occupation,
      assignedTick:t,homeId:sim.homeId};
    sim.employmentSearch=null;
    emit('employment_started',sim.id,{...sim.employment,draw,model:'inverse_home_path_distance',
      candidates:options.map(o=>({...o,weight:Number(o.weight)}))});
  }
}

export function employerAllows(world,sim,facilityId){
  return canWork(sim)&&sim.employment?.occupation===sim.traits.occupation
    &&sim.employment.facilityId===facilityId;
}
