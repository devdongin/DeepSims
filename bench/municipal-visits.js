// Controlled jurisdiction fixture, NOT natural founding or population-growth proof.
// Existing population, facilities and coordinates are retained. Only jurisdiction
// labels divide the original town, so this diagnoses existing cross-town behavior.
import {createWorld,tick,hashWorld,serialize,deserialize} from '../sim/index.js';
import {newGovernment} from '../sim/government.js';
const days=Number(process.argv[2]??30);
if(!Number.isInteger(days)||days<1||days>365)throw new Error('days must be 1..365');
let w=createWorld(32);
w.villages.push({id:'village:1',name:'관측구역',center:{x:10,y:20},foundedTick:0,government:newGovernment()});
for(const f of w.map.facilities)if(f.x<20)f.villageId='village:1';
for(const s of w.sims)s.villageId=w.map.facilities.find(f=>f.id===s.homeId).villageId;
const initialPopulation=w.sims.length,visits={},residenceMoves=[];
const migration={gathered:0,departed:0,completed:0,failed:0},migrationIds=new Set();
const migrationByKind={},migrationKinds=new Map();
let observedDay=0,noPath=0,gravityChoices=0,gravityDraws=0;
const collect=day=>{
  for(const [key,row] of Object.entries(day?.municipalVisits??{})){
    const result=visits[key]??={...row,arrivals:0,walkingTicks:0};
    result.arrivals+=row.arrivals;result.walkingTicks+=row.walkingTicks;
  }
};
for(let i=0;i<days*1440;i++){
  if(process.argv[3]==='resume'&&i===Math.floor(days*1440/2))w=deserialize(serialize(w));
  const events=tick(w);
  for(const e of events)if(e.type==='action_started'&&e.payload.reason?.visitChoice){
    gravityChoices++;if(e.payload.reason.visitChoice.draw!==null)gravityDraws++;
  }
  noPath+=events.filter(e=>e.type==='action_failed'&&e.payload.reason==='no_path').length;
  for(const e of events)if(e.type==='moved_home')residenceMoves.push(e);
  for(const e of events){
    if(e.type==='household_migration_gathering'){
      migration.gathered++;migrationIds.add(e.payload.intentId);migrationKinds.set(e.payload.intentId,e.payload.kind);
      (migrationByKind[e.payload.kind]??={gathered:0,departed:0,completed:0,failed:0}).gathered++;
    }
    if(e.type==='household_migration_departed'){
      migration.departed++;migrationByKind[migrationKinds.get(e.payload.intentId)].departed++;
    }
    if(migrationIds.has(e.payload?.intentId)){
      if(e.type==='household_intent_applied'){migration.completed++;migrationByKind[migrationKinds.get(e.payload.intentId)].completed++;}
      if(e.type==='household_intent_failed'){migration.failed++;migrationByKind[migrationKinds.get(e.payload.intentId)].failed++;}
    }
  }
  if(w.transportStats.today.day!==observedDay){
    collect(w.transportStats.history.at(-1));observedDay=w.transportStats.today.day;
  }
}
collect(w.transportStats.today);
console.log(JSON.stringify({fixture:'existing-town jurisdiction split, not natural settlement',days,
  initialPopulation,finalPopulation:w.sims.length,noPath,gravityChoices,gravityDraws,visits:Object.values(visits),
  residenceMoves:residenceMoves.length,migration,migrationByKind,hash:hashWorld(w)},null,2));
