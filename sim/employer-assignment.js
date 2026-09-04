import {canWork} from './education.js';
import {sameRegion} from './map.js';
import {bfsPath} from './pathfind.js';
import {rngNext} from './prng.js';
import {airStructurallyReachable,chooseAirJourney} from './air-journey.js';

const cmp=(a,b)=>a<b?-1:a>b?1:0;
const workplaceTypes=(world,sim)=>[].concat(world.logic.workplace[sim.traits.occupation]??[]);
function reachable(world,home,facility,allowAir){
  if(!home?.door||!facility?.door)return false;
  return (sameRegion(world.map,home.door.x,home.door.y,facility.door.x,facility.door.y)
    ||allowAir&&airStructurallyReachable(world,home.door,facility.door))
    &&facility.resources.some(r=>sameRegion(world.map,facility.door.x,facility.door.y,r.x,r.y));
}

// Employment is a lasting relationship, not a daily choice of the richest seat.
// No wages, revenue, population or positions are created here. Existing occupation
// hiring/quota logic remains authoritative; this assigns its physical employer.
export function updateEmployment(world,t,emit,onlySimId=null){
  const facilities=new Map(world.map.facilities.map(f=>[f.id,f]));
  // Siblings sharing a home need the same synchronous distance observation.
  // Discard at return: no invalidation contract or stale cross-tick distance cache.
  const distances=new Map();
  const airSearch=world.air?.links.length?JSON.stringify([world.air.links.map(l=>[l.id,l.blocked]),world.incidents.map(i=>i.facilityId)]):null;
  for(const sim of [...world.sims].sort((a,b)=>a.id-b.id)){
    if(onlySimId!==null&&sim.id!==onlySimId)continue;
    sim.employment??=null;sim.employmentSearch??=null;
    const types=workplaceTypes(world,sim),eligible=canWork(sim)&&types.length>0
      &&world.logic.occupations[sim.traits.occupation]?.wagePct>0;
    const home=facilities.get(sim.homeId),previous=sim.employment;
    const allowAir=sim.traits.occupation!=='police'; // Patrol remains a ground-only public duty.
    const facility=previous&&facilities.get(previous.facilityId);
    if(previous&&eligible&&previous.occupation===sim.traits.occupation
      &&types.includes(facility?.type)&&reachable(world,home,facility,allowAir))continue;
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
      world.map.reachVersion??0,world.map.facilities.length,...(airSearch?[airSearch]:[])]);
    if(sim.employmentSearch===search)continue;
    sim.employmentSearch=search;
    const options=[];
    for(const f of [...facilities.values()].sort((a,b)=>cmp(a.id,b.id))){
      if(!types.includes(f.type)||!reachable(world,home,f,allowAir))continue;
      const key=JSON.stringify([home.id,f.id]);
      if(!distances.has(key)){
        const path=bfsPath(world.map,home.door.x,home.door.y,f.door.x,f.door.y);
        const air=path===null&&allowAir?chooseAirJourney(world,{...home.door,hasCar:false},
          {action:'work',facilityId:f.id,res:f.door},t,null):null;
        distances.set(key,path?.length??air?.physicalDistance??null);
      }
      const distance=distances.get(key);if(distance===null)continue;
      const weight=1000000n/BigInt(distance+1);
      if(weight>0n)options.push({facilityId:f.id,distance,weight});
    }
    if(!options.length)continue;
    const total=options.reduce((n,o)=>n+o.weight,0n);
    let selected=options[0],draw=null;
    if(options.length>1){
      draw=rngNext(world.rngSim);
      let sum=0n;
      for(const o of options){sum+=o.weight;if(BigInt(draw)*total<sum*4294967296n){selected=o;break;}}
    }
    sim.employment={facilityId:selected.facilityId,occupation:sim.traits.occupation,
      assignedTick:t,homeId:sim.homeId};
    sim.employmentSearch=null;
    // Event payloads have a hard 1KB persistence limit. Keep sufficient selected
    // draw evidence, not an unbounded list of every facility in a mature world.
    emit('employment_started',sim.id,{...sim.employment,draw,model:'inverse_home_path_distance',
      candidateCount:options.length,totalWeight:Number(total),distance:selected.distance,weight:Number(selected.weight)});
  }
}

export function employerAllows(world,sim,facilityId){
  return canWork(sim)&&sim.employment?.occupation===sim.traits.occupation
    &&sim.employment.facilityId===facilityId;
}
