import assert from 'node:assert/strict';
import {tick,hashWorld} from '../sim/index.js';
import {serialize,deserialize,findNonFinite} from '../sim/serialize.js';
import {governmentFor,publicBalance} from '../sim/government.js';
import {plotBuildable,isWalkable,zoneFootprint,sameRegion} from '../sim/map.js';
import {foundingSiteReserved} from '../sim/founding.js';
import {campusSiteReserved} from '../sim/center-plots.js';
import {stationConstructionObserver} from './station-construction-observer.js';

// A window may start partway through a day. Count only new arrivals, not the
// pre-window part of today's counters; retain totals beyond the 14-day ring.
export function arrivalObserver(today){
  let day=today.day;
  let last=new Map(Object.entries(today.municipalVisits??{}).map(([key,row])=>[key,{...row}]));
  const totals=new Map();
  return {
    collect(current){
      assert.ok(current.day>=day,'transport day cannot go backwards');
      if(current.day!==day){day=current.day;last=new Map();}
      for(const [key,row] of Object.entries(current.municipalVisits??{})){
        const old=last.get(key),arrivals=row.arrivals-(old?.arrivals??0),walkingTicks=row.walkingTicks-(old?.walkingTicks??0);
        assert.ok(arrivals>=0&&walkingTicks>=0,'daily arrival counters must be monotone');
        if(arrivals||walkingTicks){
          const total=totals.get(key)??{...row,arrivals:0,walkingTicks:0};
          total.arrivals+=arrivals;total.walkingTicks+=walkingTicks;totals.set(key,total);
        }
        last.set(key,{...row});
      }
    },
    rows(){return [...totals].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,r])=>({...r}));},
  };
}
const closedMoney=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
const municipalities=w=>w.villages.map(v=>{
  const g=governmentFor(w,v.id),facilities={};
  for(const f of w.map.facilities)if(f.villageId===v.id)facilities[f.type]=(facilities[f.type]??0)+1;
  const unusedPlots=w.plots.filter(p=>(p.villageId??'village:0')===v.id&&!p.used);
  return {id:v.id,population:w.sims.filter(s=>s.villageId===v.id).length,
    treasury:g.treasury,mayorId:g.mayorId,tier:g.cityTier,facilities,
    unusedPlots:unusedPlots.length,buildableUnusedPlots:unusedPlots.filter(p=>plotBuildable(w.map,p)).length};
});

function firstDifference(a,b,path='world'){
  if(Object.is(a,b))return null;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return {path,a,b};
  if(Array.isArray(a)&&Array.isArray(b)){
    if(a.length!==b.length)return {path:`${path}.length`,a:a.length,b:b.length};
    for(let i=0;i<a.length;i++){const d=firstDifference(a[i],b[i],`${path}.${i}`);if(d)return d;}
    return null;
  }
  const keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();
  for(const key of keys){const d=firstDifference(a[key],b[key],`${path}.${key}`);if(d)return d;}
  return null;
}
export function observeSettlementTraffic(initial,{days=30,resume=false,auditResume=false,stations=false,expandCenters=false,completeServiceWindow=false}={}){
  assert.ok(Number.isInteger(days)&&days>0&&days<=365);
  assert.ok(!expandCenters||stations,'center investment requires the explicit station-order scenario');
  assert.ok(!completeServiceWindow||(stations&&days<=335),'bounded service follow-through requires stations and at most335 opening days');
  let w=initial,shadow=null;
  const startTick=w.worldTick,initialMunicipalities=municipalities(w),money=closedMoney(w);
  const arrivals=arrivalObserver(w.transportStats.today),noPath={},noPathSamples=[],started={},construction=[],migration={};
  const stationOrders=[],centerOrders=[],ordered=new Set(),expanded=new Set(),blockedTicks={},railDirections={};
  const railBefore={...w.rail.stats};
  const stationLabor=stationConstructionObserver();
  let serviceWindow=null,serviceArrivals=null;
  // Keep the original opening deadline. Only a service that opened within it
  // may continue to finish its full30-day observation (absolute cap days+30).
  const maxTicks=(days+(completeServiceWindow?30:0))*1440;
  for(let n=0;n<maxTicks&&(n<days*1440||(serviceWindow&&w.worldTick<serviceWindow.endTick));n++){
    if(resume&&n===Math.floor(days*1440/2)){if(auditResume)shadow=w;w=deserialize(serialize(w));}
    const inputs=[];
    if(stations)for(const village of [...w.villages].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
      if(ordered.has(village.id))continue;
      const blocked=reason=>{const counts=blockedTicks[village.id]??={};counts[reason]=(counts[reason]??0)+1;};
      if(!w.transit.stationUnlocked){blocked('demand');continue;}
      if(governmentFor(w,village.id).treasury<w.logic.zone.costs.train_station){blocked('funds');continue;}
      const busy=new Set([...w.projects,...w.zoneOrders].map(p=>p.plotId)),fp=zoneFootprint('train_station',0);
      const p=[...w.plots].sort((a,b)=>a.plotId-b.plotId).find(p=>(p.villageId??'village:0')===village.id
        &&!p.used&&!busy.has(p.plotId)&&p.foundingPetitionId==null&&plotBuildable(w.map,p,fp.w,fp.h)
        &&!foundingSiteReserved(w,p,'train_station')&&!campusSiteReserved(w,p,'train_station'));
      if(!p){
        blocked('land');
        if(expandCenters&&village.id!=='village:0'&&!expanded.has(village.id)
          &&governmentFor(w,village.id).treasury>=w.logic.zone.costs.train_station+w.logic.zone.plannedCenterCost){
          const distance=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),radius=w.logic.zone.centerRadius;
          const primary=w.villages.find(v=>v.id==='village:0');
          const eligible=[...w.plots].filter(q=>q.villageId==null&&!q.used&&!busy.has(q.plotId)&&q.foundingPetitionId==null
            &&plotBuildable(w.map,q,fp.w,fp.h)&&(!primary||distance(q,primary.center)>radius)
            &&sameRegion(w.map,village.center.x,village.center.y,q.x,q.y)
            &&!w.centers.some(c=>distance(q,c)<=radius)
            &&!foundingSiteReserved(w,q,'train_station')&&!campusSiteReserved(w,q,'train_station'));
          // An explicit mayor investment scenario: prefer the service area with
          // most currently available parcels, then nearest/lowest-id. Schools
          // and housing keep their normal priority and may consume those sites.
          const scores=new Map(eligible.map(q=>[q.plotId,eligible.filter(p=>distance(p,q)<=radius).length]));
          const site=eligible.sort((a,b)=>scores.get(b.plotId)-scores.get(a.plotId)
            ||distance(a,village.center)-distance(b,village.center)||a.plotId-b.plotId)[0];
          if(site)inputs.push({sequence:inputs.length,command:'plan_center',payload:{x:site.x,y:site.y,villageId:village.id}});
        }
        continue;
      }
      inputs.push({sequence:inputs.length,command:'zone',payload:{plotId:p.plotId,type:'train_station',dir:0}});
    }
    const constructionFrame=stations?stationLabor.before(w):[];
    const events=tick(w,inputs);arrivals.collect(w.transportStats.today);
    if(stations)stationLabor.after(w,events,constructionFrame);
    if(serviceWindow&&w.worldTick<=serviceWindow.endTick)serviceArrivals.collect(w.transportStats.today);
    for(const input of inputs){
      if(input.command==='plan_center'){
        const e=events.find(e=>e.type==='center_planned'&&e.payload.villageId===input.payload.villageId);
        assert.ok(e,'ordinary paid center order must be accepted');
        expanded.add(input.payload.villageId);centerOrders.push({tick:e.tick,...e.payload});continue;
      }
      const e=events.find(e=>e.type==='zoned'&&e.payload.plotId===input.payload.plotId);
      assert.ok(e,'ordinary station order must be accepted');
      const villageId=w.plots.find(p=>p.plotId===input.payload.plotId).villageId??'village:0';
      ordered.add(villageId);stationOrders.push({tick:e.tick,villageId,...e.payload});
    }
    if(shadow){
      const shadowEvents=tick(shadow,inputs),diff=firstDifference(events,shadowEvents,'events')
        ??((w.worldTick%1440===0||n===Math.floor(days*1440/2))?firstDifference(w,shadow):null);
      if(diff)throw new Error(JSON.stringify({tick:w.worldTick,diff,events,shadowEvents}));
    }
    for(const e of events){
      if(e.type==='rail_opened'&&!serviceWindow){
        const from=w.map.facilities.find(f=>f.id===e.payload.from)?.villageId;
        const to=w.map.facilities.find(f=>f.id===e.payload.to)?.villageId;
        if(from&&to&&from!==to){
          serviceWindow={startTick:e.tick,endTick:e.tick+30*1440,directions:{}};
          serviceArrivals=arrivalObserver(w.transportStats.today);
        }
      }
      if(e.type==='rail_boarded'){
        const from=w.map.facilities.find(f=>f.id===e.payload.from)?.villageId;
        const to=w.map.facilities.find(f=>f.id===e.payload.to)?.villageId;
        const key=`${from}>${to}`;railDirections[key]=(railDirections[key]??0)+1;
        if(serviceWindow&&e.tick<=serviceWindow.endTick)
          serviceWindow.directions[key]=(serviceWindow.directions[key]??0)+1;
      }
      const villageId=w.sims.find(s=>s.id===e.simId)?.villageId??'unknown';
      if(e.type==='action_failed'&&e.payload.reason==='no_path'){
        noPath[villageId]=(noPath[villageId]??0)+1;
        if(noPathSamples.length<50){
          const s=w.sims.find(s=>s.id===e.simId);
          const targets=Object.entries(s?.noPathCool??{}).filter(([,until])=>until===e.tick+w.logic.construct.noPathCoolTicks)
            .map(([key])=>{
              // §23.57 화재 가상 스팟(firesite:fire:<시설>)은 resources에 없다 — tick.js와 같은 규칙으로 좌표를 복원한다.
              if(key.startsWith('firesite:fire:')){
                const ff=w.map.facilities.find(f=>f.id===key.slice('firesite:fire:'.length));
                if(ff){const x=ff.door.x,y=ff.door.y-1>=0?ff.door.y-1:ff.door.y;
                  return {key,x,y,walkable:isWalkable(w.map,x,y),sameRegion:s?sameRegion(w.map,s.x,s.y,x,y):null,
                    doorWalkable:isWalkable(w.map,ff.door.x,ff.door.y)};}
              }
              const f=w.map.facilities.find(f=>key.startsWith(`${f.id}:`)),r=f?.resources.find(r=>`${f.id}:${r.id}`===key);
              return {key,...(r?{x:r.x,y:r.y,walkable:isWalkable(w.map,r.x,r.y)}:{})};
            });
          noPathSamples.push({tick:e.tick,simId:e.simId,action:e.payload.action,villageId,
            source:s?{x:s.x,y:s.y,walkable:isWalkable(w.map,s.x,s.y)}:null,targets});
        }
      }
      if(e.type==='action_started'){
        const actions=started[villageId]??={};actions[e.payload.action]=(actions[e.payload.action]??0)+1;
      }
      if(e.type==='facility_built'){
        const f=w.map.facilities.find(f=>f.id===e.payload.facilityId);
        construction.push({tick:e.tick,id:f.id,type:f.type,villageId:f.villageId});
      }
      if(e.type==='household_migration_gathering')migration[e.payload.intentId]={kind:e.payload.kind,from:e.payload.fromVillageId,
        to:e.payload.toVillageId,gatheredTick:e.tick,departedTick:null,completedTick:null,failure:null};
      const journey=migration[e.payload?.intentId];
      if(journey){
        if(e.type==='household_migration_departed')journey.departedTick=e.tick;
        if(e.type==='household_intent_applied')journey.completedTick=e.tick;
        if(e.type==='household_intent_failed')journey.failure=e.payload.reason;
      }
    }
    assert.equal(closedMoney(w),money,'post-founding traffic must preserve closed accounting');
  }
  assert.deepEqual(findNonFinite(w),[]);
  return {world:w,report:{days,...(completeServiceWindow?{serviceFollowThrough:true}:{}),startTick,endTick:w.worldTick,initialMunicipalities,finalMunicipalities:municipalities(w),
    arrivals:arrivals.rows(),noPath,noPathSamples,started,construction,migrations:Object.values(migration),
    transport:{cars:w.sims.filter(s=>s.hasCar).length,stationUnlocked:w.transit.stationUnlocked,demand:w.transit.demand,
      stations:w.map.facilities.filter(f=>f.type==='train_station').map(f=>({id:f.id,villageId:f.villageId}))},
    ...(stations?{railObservation:{stationOrders,centerOrders,stationLabor:stationLabor.rows(),blockedTicks,directions:railDirections,
      serviceWindow:serviceWindow?{...serviceWindow,observedUntil:Math.min(w.worldTick,serviceWindow.endTick),
        complete:w.worldTick>=serviceWindow.endTick,arrivals:serviceArrivals.rows()}:null,
      stats:Object.fromEntries(Object.entries(w.rail.stats).map(([k,v])=>[k,v-(railBefore[k]??0)]))}}:{}),
    closedMoney:money,hash:hashWorld(w)}};
}
