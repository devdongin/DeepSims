import {isWalkable,sameRegion} from './map.js';
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

// §23.59 응답자(sim)가 주어지면 화재 스팟은 문 주변의 **도달 가능한** 칸이다 — 순찰(§19.4)과
// 같은 북→남→동→서→문 순서에서 걸을 수 있고 응답자와 같은 지역인 첫 칸. 없으면 res:null
// (patrolTarget과 같은 계약: 갈 수 없는 불에는 달려가지 않는다). 전에는 문 북쪽 한 칸으로
// 못박혀 있어, 그 칸이 나중에 지어진 벽·나무에 막히면 같은 응답자가 매 틱 no_path를 냈다
// (철도 70일 픽스처 642건, 전부 firesite:fire:school). sim 없는 호출(관측·마을 귀속)은
// 종전대로 북쪽 칸을 돌려준다. 결정적이며 rng를 쓰지 않는다.
export function fireTargets(world,sim=null){
  return world.incidents.map(inc=>{
    const facility=world.map.facilities.find(f=>f.id===inc.facilityId),d=facility.door;
    if(!sim)return {facilityId:facility.id,res:{id:`fire:${facility.id}`,x:d.x,y:d.y-1>=0?d.y-1:d.y}};
    const around=[{x:d.x,y:d.y-1},{x:d.x,y:d.y+1},{x:d.x+1,y:d.y},{x:d.x-1,y:d.y},{x:d.x,y:d.y}];
    const spot=around.find(p=>isWalkable(world.map,p.x,p.y)&&sameRegion(world.map,sim.x,sim.y,p.x,p.y));
    return {facilityId:facility.id,res:spot?{id:`fire:${facility.id}`,x:spot.x,y:spot.y}:null};
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
  const targets=fireTargets(world,sim);
  if(!targets.length)return 'no_target';
  const reachable=targets.filter(({res})=>res);
  if(!reachable.length)return 'unreachable';
  return reachable.every(({res})=>{
    const holder=world.reservations[`firesite:${res.id}`];
    return holder!==undefined&&holder!==sim.id;
  })?'reserved':null;
}
