// Controlled initial towns, services, historical demand, treasury and job roles.
// Airports themselves use real zone payments and DEFAULT 60,000 labor. After
// opening, no residents, funds, needs, activity choices or demand are replenished.
// This is a 30-service-day integration audit, not a natural airport-growth claim.
// Known limitation: the prior TWO-resident setup (ONE resident per town) did
// not finish both airports in 60 days: the isolated resident stayed socially
// deprived and never chose construction. Fixture4 does not validate or fix
// that growth case; #176 fixes its starvation, not its construction behavior.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createWorld,tick,serialize,deserialize,hashWorld,migrateWorld} from '../sim/index.js';
import {TILE,addBuilding} from '../sim/map.js';
import {newGovernment,publicBalance} from '../sim/government.js';
import {Storage} from '../db/storage.js';
import {SCHEMA_VERSION} from '../sim/constants.js';
import {collectCandidates} from '../sim/tick.js';
import {shortlistMemories,prepareShortlist} from '../sim/cognition.js';

const days=Number(process.argv[2]??30);
assert.ok(Number.isSafeInteger(days)&&days>=30&&days<=90);
const w=createWorld(32),started=performance.now();
w.map={w:128,h:128,tiles:Array(16384).fill(TILE.GRASS),facilities:[],reachVersion:0};
for(let y=0;y<128;y++)w.map.tiles[y*128+64]=TILE.WATER;
w.villages[0].center={x:8,y:54};
w.villages.push({id:'village:1',name:'Audit town',center:{x:88,y:54},government:newGovernment()});
w.sims=w.sims.slice(0,4);w.projects=[];w.zoneOrders=[];w.centers=[];w.lastDailyDay=0;w.lastPlanDay=0;
const homes=[];
for(let i=0;i<2;i++){
  const villageId=`village:${i}`;homes.push(addBuilding(w.map,'house',{x:5+80*i,y:50,villageId}));
}
// Two residents per town provide an actual possible conversation partner. A
// one-resident town never satisfies social need and is a separate growth case.
for(let i=0;i<4;i++){
  const villageId=`village:${i%2}`,home=homes[i%2],s=w.sims[i];
  s.villageId=villageId;s.homeId=home.id;Object.assign(s,home.door);
  s.traits.age=30;s.traits.occupation='jobless';s.education.course=null;s.education.completed=true;s.money=10000;
}
const office=addBuilding(w.map,'office',{x:5,y:65,villageId:'village:0'});
const cafe=addBuilding(w.map,'cafe',{x:85,y:65,villageId:'village:1'});
const restaurant=addBuilding(w.map,'restaurant',{x:20,y:65,villageId:'village:0'});
office.revenue=100000;cafe.revenue=100000;restaurant.revenue=100000;
w.cityTier=w.villages[1].government.cityTier=3;w.treasury=w.villages[1].government.treasury=100000;
w.plots=[{plotId:500,x:15,y:35,villageId:'village:0',used:false},{plotId:501,x:95,y:35,villageId:'village:1',used:false}];
w.transportStats.today.municipalVisits={controlledHistory:{from:'village:0',to:'village:1',arrivals:12,walkingTicks:120}};
const money=world=>publicBalance(world)+world.sims.reduce((n,s)=>n+s.money,0)
  +world.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+(world.externalOutflow??0)-(world.externalInflow??0);
const baseline=money(w),beforeOutflow=w.externalOutflow??0;
const events=tick(w,w.plots.map((p,sequence)=>({sequence,command:'zone',payload:{plotId:p.plotId,type:'airport',dir:0}})));
assert.equal(w.projects.length,2);assert.ok(w.projects.every(p=>p.required===60000&&p.fundedCost===30000));
assert.equal(w.treasury,70000);assert.equal(w.villages[1].government.treasury,70000);
assert.equal(w.externalOutflow-beforeOutflow,60000);
assert.equal(events.filter(e=>e.type==='zoned').reduce((n,e)=>n+e.payload.cost,0),60000);
for(let i=0;i<60*1440&&w.air.airports.length<2;i++){
  events.push(...tick(w));assert.equal(money(w),baseline);
  if(process.env.AIR_AUDIT_DIAG==='1'&&w.worldTick===7200){
    const s=w.sims.find(s=>s.id===1);
    const shortlist=shortlistMemories(s,w.worldTick,w.logic),prep=prepareShortlist(shortlist,w.worldTick,w.logic);
    console.log(JSON.stringify({tick:w.worldTick,sim:s,candidates:collectCandidates(w,s,['eat','sleep','socialize'],w.worldTick,true,{urgency:true,shortlist,prep})},null,2));
    process.exit(0);
  }
}
assert.equal(w.air.airports.length,2,`both real paid airports must finish default labor: ${JSON.stringify({tick:w.worldTick,
  projects:w.projects,sims:w.sims.map(s=>({id:s.id,x:s.x,y:s.y,needs:s.needs,action:s.state.action,kind:s.state.kind})),
  deaths:events.filter(e=>e.type==='died'),emigrations:events.filter(e=>e.type==='emigrated'),
  activity:events.filter(e=>e.simId===1&&['action_failed','action_completed'].includes(e.type)).reduce((out,e)=>{
    const key=`${e.type}:${e.payload.action}:${e.payload.reason??e.payload.facilityId}`;out[key]=(out[key]??0)+1;return out;
  },{})})}`);
assert.equal(w.air.links.length,1);assert.equal(events.filter(e=>e.type==='airport_opened').length,2);
// Controlled occupation setup for the commute audit; no wages or employment are
// directly granted. The next tick assigns real employers through the normal path.
for(const s of w.sims)s.traits.occupation=s.villageId==='village:0'?'barista':'office_worker';
const openedTick=w.worldTick,endTick=openedTick+days*1440;
let resumed=migrateWorld(deserialize(serialize(w))),batch=[],stored=events.length;
const byType={},directions={},arrivals={},samples=[],storage=new Storage(':memory:');
let committedTick=0;
const commitAndReload=expected=>{
  storage.commitBatch({world:w,events:expected,appliedInputIds:[],epochUtcMs:1000});
  const rows=storage.db.prepare('SELECT tick,ordinal,type,sim_id,payload,schema_version FROM events WHERE tick>? AND tick<=? ORDER BY tick,ordinal')
    .all(committedTick,w.worldTick).map(r=>({tick:r.tick,ordinal:r.ordinal,type:r.type,simId:r.sim_id,payload:JSON.parse(r.payload),schemaVersion:r.schema_version}));
  assert.deepEqual(rows,expected.map(e=>({tick:e.tick,ordinal:e.ordinal,type:e.type,simId:e.simId,payload:e.payload??{},schemaVersion:SCHEMA_VERSION})));
  committedTick=w.worldTick;
  const loaded=storage.loadOrCreate({seed:32,nowUtcMs:1000});
  assert.equal(loaded.lastSimulatedTick,w.worldTick);assert.equal(serialize(loaded.world),serialize(w));
  return loaded.world;
};
try{
  storage.loadOrCreate({seed:32,nowUtcMs:1000});
  resumed=commitAndReload(events);
  while(w.worldTick<endTick){
    const actual=tick(w),replay=tick(resumed);assert.deepEqual(actual,replay);
    assert.equal(money(w),baseline,`closed money at ${w.worldTick}`);
    assert.equal(money(resumed),baseline);batch.push(...actual);
    for(const e of actual){
      byType[e.type]=(byType[e.type]??0)+1;
      if(e.type==='flight_boarded')directions[`${e.payload.from}>${e.payload.to}`]=(directions[`${e.payload.from}>${e.payload.to}`]??0)+1;
      if(e.type==='action_completed'&&e.payload.action==='work')arrivals[e.payload.facilityId]=(arrivals[e.payload.facilityId]??0)+1;
    }
    if((w.worldTick-openedTick)%1440===0){
      assert.equal(hashWorld(w),hashWorld(resumed));
      resumed=commitAndReload(batch);stored+=batch.length;batch=[];
      samples.push({tick:w.worldTick,pop:w.sims.length,hash:hashWorld(w),aircraft:w.air.links.length});
    }
  }
  assert.ok(Object.keys(directions).length>=2,'real boardings in both directions');
  assert.ok(arrivals[office.id]>0&&arrivals[cafe.id]>0,'actual completed work at both employers');
  assert.equal(w.air.links.length,1,'no free aircraft during 30 days');
  assert.equal(byType.airport_opened??0,0,'no extra airport completions during service audit');
  assert.equal(byType.zoned??0,0,'no additional construction payments during service audit');
  assert.equal(storage.db.prepare('SELECT count(*) AS n FROM events').get().n,stored);
  console.log(JSON.stringify({pass:true,days,openedTick,endTick,initialAirportCost:60000,
    defaultLaborPerAirport:60000,closedMoney:baseline,storedEvents:stored,directions,completedWork:arrivals,
    flightBoarded:byType.flight_boarded??0,flightAlighted:byType.flight_alighted??0,
    suspensions:byType.flight_service_suspended??0,holding:byType.flight_holding??0,
    finalHash:hashWorld(w),samples,elapsedMs:Math.round(performance.now()-started)},null,2));
}finally{storage.close();}
