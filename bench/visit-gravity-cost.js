// Controlled synthetic population/jurisdiction benchmark, never edits a live save.
// Run separately in each revision; behavior differs, so this is not an oracle for
// equal work or an optimization speedup claim. node bench/visit-gravity-cost.js
import {makeSynthWorld} from './synthpop.js';
import {advance} from '../sim/tick.js';
import {pfStats} from '../sim/pathfind.js';
import {newGovernment} from '../sim/government.js';
const w=makeSynthWorld(20260831,200);
const xs=w.map.facilities.map(f=>f.x).sort((a,b)=>a-b),boundary=xs[Math.floor(xs.length/2)];
w.villages.push({id:'village:1',name:'계측구역',center:{x:boundary,y:20},government:newGovernment()});
for(const f of w.map.facilities)if(f.x>=boundary)f.villageId='village:1';
for(const s of w.sims)s.villageId=w.map.facilities.find(f=>f.id===s.homeId).villageId;
advance(w,{},1440);
const before={...pfStats},start=performance.now(),events=advance(w,{},1440);
const choices=events.filter(e=>e.type==='action_started'&&e.payload.reason?.visitChoice);
console.log(JSON.stringify({fixture:'synthetic200 with median-x jurisdiction split',days:1,
  population:w.sims.length,msPerDay:performance.now()-start,
  bfsCalls:pfStats.calls-before.calls,bfsMs:pfStats.ms-before.ms,bfsCells:pfStats.cells-before.cells,
  gravityChoices:choices.length,gravityDraws:choices.filter(e=>e.payload.reason.visitChoice.draw!==null).length,
  visits:w.transportStats.history.at(-1)?.municipalVisits??{}},null,2));
