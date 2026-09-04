import {isWalkable} from './map.js';
import {employerAllows} from './employer-assignment.js';

// Pure shared virtual targets. Keep the existing facility/incident ordering and
// N/S/E/W/door patrol geometry; do not add BFS, cooldowns or candidate filters.
export function patrolTarget(world,sim){
  const employer=world.map.facilities.find(f=>employerAllows(world,sim,f.id));
  const spots=world.map.facilities.filter(f=>employer
    &&(f.villageId??'village:0')===(employer.villageId??'village:0')
    &&world.logic.patrol.targets.includes(f.type));
  if(!spots.length)return null;
  const facility=spots[sim.patrolIdx%spots.length],d=facility.door;
  const spot=[{x:d.x,y:d.y-1},{x:d.x,y:d.y+1},{x:d.x+1,y:d.y},
    {x:d.x-1,y:d.y},{x:d.x,y:d.y}].find(p=>isWalkable(world.map,p.x,p.y));
  return {facilityId:facility.id,res:spot?{id:`patrol:${facility.id}`,x:spot.x,y:spot.y}:null};
}

export function fireTargets(world){
  return world.incidents.map(inc=>{
    const facility=world.map.facilities.find(f=>f.id===inc.facilityId),d=facility.door;
    return {facilityId:facility.id,res:{id:`fire:${facility.id}`,x:d.x,y:d.y-1>=0?d.y-1:d.y}};
  });
}

export function patrolShortfallKind(world,sim,t){
  const target=patrolTarget(world,sim);
  if(!target)return 'no_target';
  if(!target.res)return 'unreachable';
  const {res}=target,holder=world.reservations[`patrol:${res.id}`];
  if(holder!==undefined&&holder!==sim.id)return 'reserved';
  const cool=sim.noPathCool[`patrol:${res.id}`];
  return cool!==undefined&&t<cool?'unreachable':null;
}

export function fireResponseShortfallKind(world,sim){
  const targets=fireTargets(world);
  if(!targets.length)return 'no_target';
  return targets.every(({res})=>{
    const holder=world.reservations[`firesite:${res.id}`];
    return holder!==undefined&&holder!==sim.id;
  })?'reserved':null;
}
