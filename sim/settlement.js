// #32 Physical household relocation. Until every family member has arrived,
// homes and village membership remain unchanged. This is not labor.
import { bfsPath } from './pathfind.js';
import { isWalkable } from './map.js';
import { emptyState } from './simfactory.js';
import { cancelFoundingConstruction } from './founding.js';
import { settlementHouseholdsUnchanged } from './settlement-households.js';

export const SETTLE_ACTION='settle_village';
const pending=world=>(world.founding?.petitions??[]).filter(p=>p.status==='awaiting_settlement');
const at=(s,p)=>s.x===p.x&&s.y===p.y;
export function isSettlementInTransit(world,id){
  return pending(world).some(p=>p.plan.relocation?.phase==='travelling'&&p.plan.residents.some(r=>r.simId===id));
}
function homeFor(world,p,id){
  const spec=p.plan.homes.find(h=>h.residentIds.includes(id));
  const built=p.plan.completedHomes?.find(h=>h.plotId===spec?.plotId);
  return world.map.facilities.find(f=>f.id===built?.homeId);
}
function stop(world,sim){
  if(sim.state.action!==SETTLE_ACTION)return;
  const key=`${sim.state.facilityId}:${sim.state.resourceId}`;
  if(world.reservations[key]===sim.id)delete world.reservations[key];
  sim.state=emptyState();
}
function tripBudget(world,sim,length){
  const L=world.logic;
  // Budget for night-time decay, age and current illness/hangover, with winter
  // exposure headroom. Unforeseen life events remain part of the simulation.
  const base=L.decay.energy+(sim.traits.age>=L.ageDecay.oldMin?L.ageDecay.oldEnergyAdd:0);
  const energy=Math.ceil((Math.ceil(base*Math.max(...L.circadian.energyPct)/100)
    +(sim.hangoverUntil>world.worldTick?L.coping.hangoverEnergyDecay:0)+L.seasons.winterOutdoorEnergy)
    *(1+(sim.sick?L.disease.decayFactorNum/L.disease.decayFactorDen:0)));
  return {hunger:L.needCritical+(length+2)*L.decay.hunger,energy:L.needCritical+(length+2)*energy};
}
function ready(world,sim,length){
  const budget=tripBudget(world,sim,length);
  return sim.needs.hunger>=budget.hunger&&sim.needs.energy>=budget.energy;
}
function candidate(p,sim,target){
  return {action:SETTLE_ACTION,facilityId:'settlement',resourceId:`p${p.id}:s${sim.id}`,
    res:{id:`p${p.id}:s${sim.id}`,x:target.x,y:target.y},score:1,core:1,moodMod:0,
    deficit:0,persFactor:100,planFactor:100,weatherFactor:100,memoryMod:0,stateMod:0,habitMod:0,cited:[]};
}

// Idle decision hook: gather at the old household home. Hungry/tired members
// remain free to meet needs before returning; no instant assembly or forced work.
export function settlementGatherTarget(world,sim){
  const p=pending(world).find(p=>p.plan.relocation?.phase==='gathering'&&p.plan.residents.some(r=>r.simId===sim.id));
  if(!p)return null;
  const home=homeFor(world,p,sim.id);if(!home)return null;
  const assembly=p.plan.relocation.assembly;
  const length=p.plan.relocation.distances?.[home.id];
  if(length==null||!ready(world,sim,length))return null;
  return {candidate:candidate(p,sim,assembly),hold:at(sim,assembly)};
}

export function advanceSettlementPlans(world,t,emit,start){
  for(const p of pending(world).sort((a,b)=>a.id-b.id)){
    const plan=p.plan;
    const validFamily=settlementHouseholdsUnchanged(world,plan,p.villageId);
    const sims=(plan.residents??[]).map(r=>world.sims.find(s=>s.id===r.simId));
    const homes=sims.map(s=>s&&homeFor(world,p,s.id));
    const validHomes=homes.every((f,i)=>f&&f.foundingPetitionId===p.id
      &&f.resources.length>=plan.homes.find(h=>h.residentIds.includes(sims[i].id)).residentIds.length
      &&!world.incidents.some(j=>j.facilityId===f.id)&&!world.sims.some(s=>s.homeId===f.id));
    let reason=!validFamily?'household_changed':!validHomes?'home_unavailable':null;
    if(!reason&&plan.relocation?.phase==='travelling'&&sims.some(s=>s.state.kind==='walking'
      &&s.state.action===SETTLE_ACTION&&s.state.path.length&&!isWalkable(world.map,s.state.path[0].x,s.state.path[0].y)))reason='route_changed';
    if(reason){
      for(const sim of sims)if(sim)stop(world,sim);
      cancelFoundingConstruction(world,p.id,reason,t,emit);continue;
    }
    if(!plan.relocation){
      const origin=world.map.facilities.find(f=>f.id===plan.residents[0].homeId);
      if(!origin){cancelFoundingConstruction(world,p.id,'home_unavailable',t,emit);continue;}
      plan.relocation={phase:'gathering',assembly:{...origin.door},startedTick:null,routeVersion:-1,distances:{}};
      emit('founding_gathering',p.petitionerId,{petitionId:p.id,residentIds:sims.map(s=>s.id)});
    }
    const r=plan.relocation;
    if(r.phase==='gathering'&&r.routeVersion!==(world.map.reachVersion??0)){
      r.routeVersion=world.map.reachVersion??0;r.distances={};
      for(const home of new Set(homes)){
        const path=bfsPath(world.map,r.assembly.x,r.assembly.y,home.door.x,home.door.y);
        r.distances[home.id]=path===null?null:path.length;
      }
    }
    if(r.phase==='travelling'){
      // Lifecycle updates can end an action at a day boundary. Resume the
      // remaining real route, never freeze a child or teleport to catch up.
      const interrupted=sims.map((s,i)=>({s,home:homes[i]}))
        .filter(({s,home})=>!at(s,home.door)&&s.state.action!==SETTLE_ACTION);
      if(interrupted.some(({s,home})=>bfsPath(world.map,s.x,s.y,home.door.x,home.door.y)===null)){
        for(const sim of sims)stop(world,sim);
        cancelFoundingConstruction(world,p.id,'route_changed',t,emit);continue;
      }
      for(const {s,home} of interrupted){
        start(s,candidate(p,s,home.door));
      }
      continue;
    }
    if(r.phase!=='gathering'||!sims.every(s=>at(s,r.assembly)
      &&(s.state.kind==='idle'||['idle',SETTLE_ACTION].includes(s.state.action))))continue;
    const paths=homes.map(f=>bfsPath(world.map,r.assembly.x,r.assembly.y,f.door.x,f.door.y));
    if(paths.some(path=>path===null)||sims.some((s,i)=>!ready(world,s,paths[i].length)))continue;
    r.phase='travelling';r.startedTick=t;
    // Each household shares an origin and destination, moves one tile/tick,
    // and keeps its dependent children with the adult caregivers.
    for(let i=0;i<sims.length;i++)start(sims[i],candidate(p,sims[i],homes[i].door));
    emit('founding_departed',p.petitionerId,{petitionId:p.id,residentIds:sims.map(s=>s.id)});
  }
}

export function completeSettlementArrivals(world,t,emit){
  for(const p of pending(world)){
    const plan=p.plan;if(plan.relocation?.phase!=='travelling')continue;
    const sims=plan.residents.map(r=>world.sims.find(s=>s.id===r.simId));
    const homes=sims.map(s=>s&&homeFor(world,p,s.id));
    if(sims.some((s,i)=>!s||!homes[i]||!at(s,homes[i].door)))continue;
    const id=`village:${world.nextVillageId++}`;
    // Government and treasury are still shared in this stage; don't duplicate
    // balances or pretend an independent mayor/election already exists.
    const village={id,name:plan.name,foundedTick:t,center:{...homes[0].door}};
    world.villages.push(village);
    for(const f of new Set(homes)){f.villageId=id;delete f.foundingPetitionId;}
    for(const plot of world.plots)if(plot.foundingPetitionId===p.id){
      plot.villageId=id;delete plot.foundingPetitionId;delete plot.foundingType;
    }
    for(let i=0;i<sims.length;i++){
      const s=sims[i],from=s.homeId;s.homeId=homes[i].id;s.villageId=id;stop(world,s);
      emit('moved_home',s.id,{from,to:s.homeId,reason:'settlement',villageId:id});
    }
    p.status='completed';p.resolvedTick=t;plan.relocation.phase='settled';plan.villageId=id;
    emit('village_founded',p.petitionerId,{...village,homeIds:[...new Set(homes.map(f=>f.id))],residentIds:sims.map(s=>s.id)});
  }
}
