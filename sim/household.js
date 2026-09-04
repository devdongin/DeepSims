// #51 Explicit households and durable, next-tick revalidated separation intents.
import { isResidence, isAvailableResidence, sameRegion } from './map.js';
import { syncResidenceVillage } from './villages.js';
import { askingRent } from './housing.js';
import { isSettlementInTransit } from './settlement.js';
import { beginHouseholdMigration } from './household-migration.js';
import { planIndependentHousehold } from './independent-household.js';
import { canWork } from './education.js';

const employed = (world, sim) => canWork(sim)
  && (world.logic.occupations[sim.traits.occupation]?.wagePct ?? 0) > 0;

const vacantResidences = (world, fromHomeId) => world.map.facilities.filter(isAvailableResidence)
  .filter(h => h.id !== fromHomeId && !world.sims.some(s => s.homeId === h.id) && h.resources.length > 0)
  .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const projectedIncome = (world, sim) => employed(world,sim)
  ? Math.floor(world.logic.actions.work.wageBase
    * world.logic.occupations[sim.traits.occupation].wagePct / 100) : 0;

function liveParentAtHome(world, sim) {
  const ids = new Set(world.parents?.[sim.id] ?? []);
  return world.sims.find(p => ids.has(p.id) && p.homeId === sim.homeId) ?? null;
}

export function applyHouseholdIntents(world, t, emit) {
  world.householdDaily ??= { day:-1, households:[], failures:{} };
  world.householdDaily.failures ??= {};
  const due = (world.householdIntents ?? []).filter(i => i.applyTick <= t)
    .sort((a,b) => a.intentId-b.intentId);
  for (const intent of due) {
    if(intent.relocation)continue; // Gathering/travel is revalidated by the physical migration path.
    if((intent.memberIds??[intent.simId]).some(id=>isSettlementInTransit(world,id)))continue;
    const sim = world.sims.find(s => s.id === intent.simId);
    let reason = null;
    if(intent.kind==='marriage_move'){
      const target=world.map.facilities.find(f=>f.id===intent.targetHomeId&&isAvailableResidence(f));
      reason=target?beginHouseholdMigration(world,intent,target,t,emit):'target_unavailable';
      if(!reason)continue;
      world.householdDaily.failures[reason]=(world.householdDaily.failures[reason]??0)+1;
      emit('household_intent_failed',intent.simId,{intentId:intent.intentId,kind:intent.kind,reason});
      world.householdIntents.splice(world.householdIntents.indexOf(intent),1);continue;
    }
    if(intent.kind==='rent_move'){
      const members=(intent.memberIds??[]).map(id=>world.sims.find(s=>s.id===id));
      const target=world.map.facilities.find(f=>f.id===intent.targetHomeId&&isAvailableResidence(f));
      if(members.some(s=>!s))reason='person_missing';
      else if(members.some(s=>s.householdId!==intent.fromHouseholdId||s.homeId!==intent.fromHomeId))reason='household_changed';
      else if(world.sims.some(s=>s.householdId===intent.fromHouseholdId&&s.homeId===intent.fromHomeId&&!intent.memberIds.includes(s.id)))reason='household_changed';
      else if(!target||world.sims.some(s=>s.homeId===target.id)||target.resources.length<members.length)reason='target_unavailable';
      else if(askingRent(world,target)>=intent.maxRent)reason='not_cheaper';
      if(!reason&&target.villageId!==sim.villageId){
        reason=beginHouseholdMigration(world,intent,target,t,emit);
        if(!reason)continue;
      }
      if(reason){world.householdDaily.failures[reason]=(world.householdDaily.failures[reason]??0)+1;
        emit('household_intent_failed',intent.simId,{intentId:intent.intentId,kind:intent.kind,reason});}
      else {for(const member of members){member.homeId=target.id;syncResidenceVillage(world,member.id);emit('moved_home',member.id,{from:intent.fromHomeId,to:target.id,reason:'rent_pressure'});}
        world.rentPressure[intent.pressureKey??intent.fromHouseholdId]=0;
        emit('household_intent_applied',intent.simId,{intentId:intent.intentId,kind:intent.kind,from:intent.fromHomeId,to:target.id});}
      world.householdIntents.splice(world.householdIntents.indexOf(intent),1);continue;
    }
    if (!sim) reason = 'person_missing';
    else if (sim.householdId !== intent.fromHouseholdId || sim.homeId !== intent.fromHomeId) reason = 'household_changed';
    else if (!liveParentAtHome(world, sim)) reason = 'parent_not_cohabiting';
    else if (!employed(world, sim)) reason = 'income_unstable';
    else if (sim.money < world.logic.household.reserveMoney) reason = 'reserve_short';
    const family=!reason&&world.villages.length>1?planIndependentHousehold(world,sim.id,sim.villageId):null;
    const origin=!reason?world.map.facilities.find(f=>f.id===sim.homeId):null;
    const vacant = reason ? null : vacantResidences(world,sim.homeId).find(h=>h.villageId===sim.villageId
      ||(family?.ok&&h.resources.length>=family.residents.length&&origin
        &&sameRegion(world.map,origin.door.x,origin.door.y,h.door.x,h.door.y)));
    if (!reason && !vacant) reason = 'no_vacant_home';
    if(!reason&&vacant.villageId!==sim.villageId){
      reason=beginHouseholdMigration(world,intent,vacant,t,emit);
      if(!reason)continue;
    }
    if (reason) {
      if (sim) sim.independenceDays = 0;
      world.householdDaily.failures[reason] = (world.householdDaily.failures[reason] ?? 0) + 1;
      emit('household_intent_failed', intent.simId, { intentId:intent.intentId, reason });
    } else {
      const from = sim.homeId;
      sim.homeId = vacant.id;
      syncResidenceVillage(world, sim.id);
      sim.householdId = `household:${sim.id}:${intent.intentId}`;
      sim.independenceDays = 0;
      emit('household_intent_applied', sim.id, { intentId:intent.intentId, from, to:vacant.id, householdId:sim.householdId });
      emit('moved_home', sim.id, { from, to:vacant.id, reason:'independence' });
    }
    world.householdIntents.splice(world.householdIntents.indexOf(intent),1);
  }
}

export function evaluateHouseholds(world, t, day, emit) {
  const H = world.logic.household;
  for (const sim of [...world.sims].sort((a,b)=>a.id-b.id)) {
    const parent = sim.traits.age >= H.independenceAge ? liveParentAtHome(world,sim) : null;
    const stable = parent && employed(world,sim) && sim.money >= H.reserveMoney
      && vacantResidences(world,sim.homeId).length > 0;
    sim.independenceDays = stable ? (sim.independenceDays ?? 0) + 1 : 0;
    if (!stable || sim.independenceDays < H.stableDays
      || world.householdIntents.some(i=>i.simId===sim.id||i.fromHouseholdId===sim.householdId)) continue;
    const intent = { intentId:world.nextHouseholdIntentId++, kind:'separate', simId:sim.id,
      fromHouseholdId:sim.householdId, fromHomeId:sim.homeId, createdTick:t, applyTick:t+1 };
    world.householdIntents.push(intent);
    emit('household_intent_created',sim.id,{...intent});
  }
  const groups = new Map();
  for (const sim of [...world.sims].sort((a,b)=>a.id-b.id)) {
    const id=sim.householdId; if(!groups.has(id))groups.set(id,[]); groups.get(id).push(sim);
  }
  world.householdDaily = { day, failures: {}, households:[...groups]
    .sort((a,b)=>String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0).map(([householdId,members])=>{
      const homes=[...new Set(members.map(s=>s.homeId))].sort();
      const beds=world.map.facilities.filter(f=>homes.includes(f.id)&&isResidence(f)).reduce((n,f)=>n+f.resources.length,0);
      const occupied=members.length;
      return { householdId, members:members.map(s=>s.id), homes,
        residents:members.map(s=>({ simId:s.id, homeId:s.homeId, partnerId:world.partners?.[s.id] ?? null,
          parentIds:[...(world.parents?.[s.id] ?? [])].sort((a,b)=>a-b), employed:employed(world,s),
          income:projectedIncome(world,s) })),
        money:members.reduce((n,s)=>n+s.money,0), income:members.reduce((n,s)=>n+projectedIncome(world,s),0),
        employed:members.filter(s=>employed(world,s)).length, beds, freeBeds:Math.max(0,beds-occupied) };
    }) };
}
