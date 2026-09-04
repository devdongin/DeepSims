import assert from 'node:assert/strict';
import {canWork} from '../sim/education.js';

// Observation only. The retained project reference records its final labor tick
// even when completion removes it from world.projects in that same tick.
export function stationConstructionObserver(){
  const rows=new Map();
  return {
    before(world){
      return world.projects.filter(p=>p.type==='train_station').map(project=>({
        project,progress:project.progress,plot:world.plots.find(p=>p.plotId===project.plotId),
        workers:world.sims.filter(s=>s.state.action==='construct'
          &&s.state.resourceId?.startsWith(`p${project.plotId}:`))
          .map(s=>({sim:s,x:s.x,y:s.y,kind:s.state.kind,eligible:canWork(s)})),
      }));
    },
    after(world,events,frame){
      for(const e of events)if(e.type==='project_started'&&e.payload.type==='train_station'){
        const p=e.payload;rows.set(p.plotId,{plotId:p.plotId,startedTick:e.tick,required:p.required,
          labor:0,positiveLaborTicks:0,constructionStarts:0,walkingSteps:0,eligibleWorkers:[]});
      }
      for(const e of events)if(e.type==='action_started'&&e.payload.action==='construct'){
        const id=Number(/^p(\d+):/.exec(e.payload.resourceId)?.[1]),row=rows.get(id);
        if(row)row.constructionStarts++;
      }
      for(const f of frame){
        const row=rows.get(f.project.plotId);if(!row)continue;
        const delta=f.project.progress-f.progress;assert.ok(delta>=0);
        const right=(f.project.dir??0)%2===1?4:5;
        const present=f.workers.filter(w=>w.eligible&&['walking','performing'].includes(w.kind)
          &&[f.plot.x+1,f.plot.x+right].includes(w.sim.x)&&[f.plot.y+1,f.plot.y+3].includes(w.sim.y));
        assert.ok(delta<=present.length,'station labor cannot exceed eligible construction workers physically on site');
        row.labor+=delta;
        if(delta>0){row.positiveLaborTicks++;row.eligibleWorkers=[...new Set([...row.eligibleWorkers,...present.map(w=>w.sim.id)])].sort((a,b)=>a-b);}
        for(const w of f.workers)if(w.kind==='walking')row.walkingSteps+=Math.abs(w.sim.x-w.x)+Math.abs(w.sim.y-w.y);
      }
    },
    rows(){return [...rows.values()].sort((a,b)=>a.plotId-b.plotId).map(r=>({...r,eligibleWorkers:[...r.eligibleWorkers]}));},
  };
}
