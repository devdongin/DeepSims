// #93 Deterministic land value, closed-accounting rent, and durable cheaper-home moves.
import { isResidence, isAvailableResidence } from './map.js';
import { governmentFor } from './government.js';

const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const at = f => f.door ?? { x:f.x, y:f.y };
const distance = (a,b) => Math.abs(at(a).x-at(b).x)+Math.abs(at(a).y-at(b).y);

export function landValue(world, home, uses = world.facilityUseToday ?? {}) {
  const H=world.logic.housing;let value=H.baseLandValue;
  for(const type of H.serviceTypes){
    const services=world.map.facilities.filter(f=>f.type===type);
    if(services.length===0)continue;
    const nearest=[...services].sort((a,b)=>distance(home,a)-distance(home,b)||cmp(a.id,b.id))[0];
    const d=distance(home,nearest);
    value+=Math.max(0,H.proximityRadius-d)*H.proximityPoint;
    if(d<=H.proximityRadius)value+=Math.min(H.useCap,uses[nearest.id]??0)*H.usePoint;
  }
  return value;
}

export function askingRent(world,home,uses=world.facilityUseToday??{}){
  return world.logic.housing.baseRent
    + Math.floor(landValue(world,home,uses)*world.logic.housing.landRentPct/100)
    + home.resources.length*world.logic.housing.bedRent;
}

const incomeOf=(world,s)=>!['student','child'].includes(s.traits.occupation)
  ? Math.floor(world.logic.actions.work.wageBase*(world.logic.occupations[s.traits.occupation]?.wagePct??0)/100):0;

function take(members,amount){
  let left=amount;
  for(const s of [...members].sort((a,b)=>b.money-a.money||a.id-b.id)){
    const paid=Math.min(Math.max(0,s.money),left);s.money-=paid;left-=paid;if(left===0)break;
  }
  return amount-left;
}

export function settleHousing(world,t,day,emit){
  const uses=world.facilityUseToday??{},homes=world.map.facilities.filter(isResidence)
    .sort((a,b)=>cmp(a.id,b.id));
  const rows=[],claimedTargets=new Set(world.householdIntents.filter(i=>i.kind==='rent_move').map(i=>i.targetHomeId));
  const activeObligations=new Set();let charged=0,paid=0,shortfall=0;
  for(const home of homes){
    home.ownerSimId ??= null;
    const residents=world.sims.filter(s=>s.homeId===home.id).sort((a,b)=>a.id-b.id);
    const groups=new Map();for(const s of residents){if(!groups.has(s.householdId))groups.set(s.householdId,[]);groups.get(s.householdId).push(s);}
    const quote=askingRent(world,home,uses),share=groups.size?Math.ceil(quote/groups.size):quote;
    rows.push({homeId:home.id,landValue:landValue(world,home,uses),askingRent:quote,
      ownerSimId:home.ownerSimId,occupied:residents.length,households:groups.size,usage:uses[home.id]??0});
    for(const [householdId,members] of [...groups].sort((a,b)=>cmp(String(a[0]),String(b[0])))){
      const pressureKey=`${householdId}@${home.id}`;activeObligations.add(pressureKey);
      const owner=world.sims.find(s=>s.id===home.ownerSimId)??null;
      if(owner&&members.some(s=>s.id===owner.id)){world.rentPressure[pressureKey]=0;continue;}
      const got=take(members,share);charged+=share;paid+=got;shortfall+=share-got;
      if(owner)owner.money+=got;else governmentFor(world,home.villageId).treasury+=got;
      emit('rent_paid',members[0].id,{householdId,homeId:home.id,charged:share,paid:got,
        shortfall:share-got,recipient:owner?`sim:${owner.id}`:'treasury'});
      if(got<share)emit('rent_shortfall',members[0].id,{householdId,homeId:home.id,shortfall:share-got});
      const income=members.reduce((n,s)=>n+incomeOf(world,s),0);
      const pressured=got<share||share*100>income*world.logic.housing.maxIncomePct;
      world.rentPressure[pressureKey]=pressured?(world.rentPressure[pressureKey]??0)+1:0;
      if(world.rentPressure[pressureKey]<world.logic.housing.moveAfterDays
        ||world.sims.some(s=>s.householdId===householdId&&s.homeId!==home.id)
        ||world.householdIntents.some(i=>i.fromHouseholdId===householdId))continue;
      const target=homes.filter(h=>isAvailableResidence(h)&&h.id!==home.id&&!world.sims.some(s=>s.homeId===h.id)
        &&!claimedTargets.has(h.id)&&h.resources.length>=members.length&&askingRent(world,h,uses)<share)
        .sort((a,b)=>askingRent(world,a,uses)-askingRent(world,b,uses)||cmp(a.id,b.id))[0];
      if(!target)continue;
      const intent={intentId:world.nextHouseholdIntentId++,kind:'rent_move',simId:members[0].id,
        memberIds:members.map(s=>s.id),fromHouseholdId:householdId,fromHomeId:home.id,
        targetHomeId:target.id,maxRent:share,pressureKey,createdTick:t,applyTick:t+1};
      world.householdIntents.push(intent);emit('household_intent_created',members[0].id,{...intent});
      claimedTargets.add(target.id);
    }
  }
  for(const id of Object.keys(world.rentPressure))if(!activeObligations.has(id))delete world.rentPressure[id];
  world.housingMarket={day,homes:rows,facilityUse:Object.fromEntries(Object.entries(uses).sort((a,b)=>cmp(a[0],b[0]))),
    totals:{charged,paid,shortfall}};
  world.facilityUseToday={};
}
