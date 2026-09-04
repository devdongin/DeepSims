import assert from 'node:assert/strict';
import {tick,hashWorld} from '../sim/index.js';
import {serialize,deserialize,findNonFinite} from '../sim/serialize.js';
import {governmentFor,publicBalance} from '../sim/government.js';
import {plotBuildable,isWalkable} from '../sim/map.js';

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

export function observeSettlementTraffic(initial,{days=30,resume=false}={}){
  assert.ok(Number.isInteger(days)&&days>0&&days<=365);
  let w=initial;
  const startTick=w.worldTick,initialMunicipalities=municipalities(w),money=closedMoney(w);
  const arrivals=arrivalObserver(w.transportStats.today),noPath={},noPathSamples=[],started={},construction=[],migration={};
  for(let n=0;n<days*1440;n++){
    if(resume&&n===Math.floor(days*1440/2))w=deserialize(serialize(w));
    const events=tick(w);arrivals.collect(w.transportStats.today);
    for(const e of events){
      const villageId=w.sims.find(s=>s.id===e.simId)?.villageId??'unknown';
      if(e.type==='action_failed'&&e.payload.reason==='no_path'){
        noPath[villageId]=(noPath[villageId]??0)+1;
        if(noPathSamples.length<50){
          const s=w.sims.find(s=>s.id===e.simId);
          const targets=Object.entries(s?.noPathCool??{}).filter(([,until])=>until===e.tick+w.logic.construct.noPathCoolTicks)
            .map(([key])=>{
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
  return {world:w,report:{days,startTick,endTick:w.worldTick,initialMunicipalities,finalMunicipalities:municipalities(w),
    arrivals:arrivals.rows(),noPath,noPathSamples,started,construction,migrations:Object.values(migration),
    transport:{cars:w.sims.filter(s=>s.hasCar).length,stationUnlocked:w.transit.stationUnlocked,demand:w.transit.demand,
      stations:w.map.facilities.filter(f=>f.type==='train_station').map(f=>({id:f.id,villageId:f.villageId}))},
    closedMoney:money,hash:hashWorld(w)}};
}
