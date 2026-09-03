// Controlled jurisdiction fixture, NOT natural founding or gravity-model proof.
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
let observedDay=0,noPath=0;
const collect=day=>{
  for(const [key,row] of Object.entries(day?.municipalVisits??{})){
    const result=visits[key]??={...row,arrivals:0,walkingTicks:0};
    result.arrivals+=row.arrivals;result.walkingTicks+=row.walkingTicks;
  }
};
for(let i=0;i<days*1440;i++){
  if(process.argv[3]==='resume'&&i===Math.floor(days*1440/2))w=deserialize(serialize(w));
  const events=tick(w);
  noPath+=events.filter(e=>e.type==='action_failed'&&e.payload.reason==='no_path').length;
  for(const e of events)if(e.type==='moved_home')residenceMoves.push(e);
  if(w.transportStats.today.day!==observedDay){
    collect(w.transportStats.history.at(-1));observedDay=w.transportStats.today.day;
  }
}
collect(w.transportStats.today);
console.log(JSON.stringify({fixture:'existing-town jurisdiction split, not natural settlement',days,
  initialPopulation,finalPopulation:w.sims.length,noPath,visits:Object.values(visits),
  residenceMoves:residenceMoves.length,hash:hashWorld(w)},null,2));
