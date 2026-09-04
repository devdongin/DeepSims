import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stationConstructionObserver} from '../bench/station-construction-observer.js';
const make=()=>({projects:[{plotId:1,type:'train_station',progress:0,required:1}],plots:[{plotId:1,x:10,y:10}],
  sims:[{id:5,traits:{age:25,occupation:'jobless'},education:{course:null},x:10,y:11,
    state:{kind:'walking',action:'construct',resourceId:'p1:spot0'}}]});
const start=[{tick:1,type:'project_started',payload:{plotId:1,type:'train_station',required:1}}];
test('station observer retains final labor after project removal without changing the world',()=>{
  const w=make(),observer=stationConstructionObserver();observer.after(w,start,[]);
  const frame=observer.before(w);w.projects[0].progress=1;w.projects=[];w.sims[0].x=11;
  const before=structuredClone(w);observer.after(w,[],frame);assert.deepEqual(w,before);
  assert.deepEqual(observer.rows()[0],{plotId:1,startedTick:1,required:1,labor:1,positiveLaborTicks:1,
    constructionStarts:0,walkingSteps:1,eligibleWorkers:[5]});
});
test('observer rejects labor without eligible on-site workers',()=>{
  for(const kind of ['student','offsite']){
    const w=make();if(kind==='student')w.sims[0].traits.occupation='student';
    const observer=stationConstructionObserver();observer.after(w,start,[]);
    const frame=observer.before(w);w.projects[0].progress=1;
    if(kind==='student')w.sims[0].x=11;
    assert.throws(()=>observer.after(w,[],frame),/eligible construction workers/);
  }
});
