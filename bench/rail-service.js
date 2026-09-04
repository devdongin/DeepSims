// Unmodified seed world, two paid mayor station orders after actual unlock.
// No forced passengers, construction labor, terrain or treasury changes.
// This measures a service, NOT two naturally founded municipalities or growth effects.
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld,findNonFinite} from '../sim/index.js';
import {plotBuildable,zoneFootprint} from '../sim/map.js';
import {publicBalance,governmentFor} from '../sim/government.js';
let w=createWorld(Number(process.argv[2]??32));
const money=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+w.externalOutflow-w.externalInflow;
const initialMoney=money(w),fp=zoneFootprint('train_station',0),orders=[],built=[],directions={};
let firstServiceTick=null,resumed=false,noPath=0;
for(let n=0;n<120*1440;n++){
  const inputs=[];
  if(orders.length<2&&w.transit.stationUnlocked){
    const busy=new Set([...w.projects,...w.zoneOrders].map(p=>p.plotId));
    const p=[...w.plots].sort((a,b)=>a.plotId-b.plotId).find(p=>!p.used&&!busy.has(p.plotId)
      &&p.foundingPetitionId==null&&plotBuildable(w.map,p,fp.w,fp.h)
      &&governmentFor(w,p.villageId).treasury>=w.logic.zone.costs.train_station);
    if(p)inputs.push({sequence:0,command:'zone',payload:{plotId:p.plotId,type:'train_station',dir:0}});
  }
  const events=tick(w,inputs);
  if(inputs.length)assert.ok(events.some(e=>e.type==='zoned'&&e.payload.type==='train_station'));
  for(const e of events){
    if(e.type==='zoned'&&e.payload.type==='train_station')orders.push({tick:e.tick,...e.payload});
    if(e.type==='facility_built'&&e.payload.type==='train_station')built.push({tick:e.tick,...e.payload});
    if(e.type==='rail_opened')firstServiceTick??=e.tick;
    if(e.type==='rail_boarded'){
      const key=`${e.payload.from}>${e.payload.to}`;directions[key]=(directions[key]??0)+1;
    }
    if(e.type==='action_failed'&&e.payload.reason==='no_path')noPath++;
  }
  assert.equal(money(w),initialMoney);
  for(const l of w.rail.links)assert.ok(l.train.passengers.length<=l.capacity);
  if(process.argv.includes('--resume')&&!resumed&&firstServiceTick!=null&&w.worldTick-firstServiceTick>=15*1440){
    w=deserialize(serialize(w));resumed=true;
  }
  if(firstServiceTick!=null&&w.worldTick-firstServiceTick>=30*1440)break;
}
assert.equal(built.length,2,'two ordinary station projects complete within120 days');
assert.ok(firstServiceTick!=null&&w.worldTick-firstServiceTick>=30*1440,'observe30 complete service days');
if(process.argv.includes('--resume'))assert.ok(resumed);
assert.deepEqual(findNonFinite(w),[]);
console.log(JSON.stringify({fixture:'unmodified seed; two paid mayor orders; autonomous passengers; not natural multi-town proof',
  seed:w.seed,orders,built,firstServiceTick,endTick:w.worldTick,directions,stats:w.rail.stats,
  noPath,population:w.sims.length,closedMoney:initialMoney,hash:hashWorld(w)},null,2));
