import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld} from '../sim/index.js';
import {newGovernment} from '../sim/government.js';
import {TILE} from '../sim/map.js';
import {recordTransportDeparture,recordTransportStep,recordTransportArrival,
  pruneTransportTrips,rollTransportDay,transportSummary} from '../sim/transport-stats.js';

function fixture(){
  const w=createWorld(32),s=w.sims[0],f=w.map.facilities.find(f=>f.type==='park'),r=f.resources[0];
  w.villages.push({id:'village:1',name:'새솔',center:{...f.door},government:newGovernment()});
  f.villageId='village:1';s.villageId='village:0';s.hasCar=false;
  s.x=r.x-1;s.y=r.y;w.map.tiles[s.y*w.map.w+s.x]=TILE.GRASS;
  s.state={...s.state,kind:'walking',action:'play',facilityId:f.id,resourceId:r.id,
    path:[{x:r.x,y:r.y}],ticksLeft:100,journey:null};
  w.lastDailyDay=0;w.lastPlanDay=0;
  return {w,s,f,r};
}
const rows=w=>Object.values(w.transportStats.today.municipalVisits??{});
test('actual tick arrival records foreign facility visit without changing residency and replays in flight',()=>{
  const {w,s}=fixture(),home=s.homeId;
  recordTransportDeparture(w,s,s.state.path,0);
  const b=deserialize(serialize(w));
  assert.deepEqual(tick(w),tick(b));assert.equal(hashWorld(w),hashWorld(b));
  assert.deepEqual(rows(w),[{from:'village:0',to:'village:1',purpose:'leisure',arrivals:1,walkingTicks:1}]);
  assert.equal(s.homeId,home);assert.equal(s.villageId,'village:0');
  recordTransportArrival(w,s);assert.equal(rows(w)[0].arrivals,1,'arrival counts once');
});
test('arrival day owns complete trip duration and history retains observed visit rows',()=>{
  const {w,s,r}=fixture(),rng=serialize(w.rngSim);
  recordTransportDeparture(w,s,s.state.path,1439);recordTransportStep(w,s,1439,TILE.GRASS);
  rollTransportDay(w,1440);s.x=r.x;s.y=r.y;
  recordTransportStep(w,s,1440,TILE.GRASS);recordTransportArrival(w,s);
  assert.equal(rows(w)[0].walkingTicks,2);assert.equal(w.transportStats.history[0].municipalVisits,undefined);
  rollTransportDay(w,2880);
  assert.equal(transportSummary(w.transportStats.history[1]).municipalVisits['["village:0","village:1","leisure"]'].arrivals,1);
  assert.equal(serialize(w.rngSim),rng);
});
test('partial, cancelled, relocated, reassigned, wrong-coordinate and home trips never invent visits',()=>{
  for(const kind of ['partial','cancelled','relocated','reassigned','wrong-coordinate','home','settle','same-town']){
    const {w,s,f,r}=fixture();
    if(kind==='home')s.state.action='sleep';
    if(kind==='settle')s.state.action='settle_village';
    if(kind==='same-town')f.villageId=s.villageId;
    recordTransportDeparture(w,s,s.state.path,0,kind!=='partial');
    if(kind==='cancelled'){s.state.kind='idle';pruneTransportTrips(w);}
    if(kind==='relocated')s.villageId='village:1';
    if(kind==='reassigned')f.villageId='village:0';
    if(kind!=='wrong-coordinate'){s.x=r.x;s.y=r.y;}
    recordTransportArrival(w,s);assert.deepEqual(rows(w),[],kind);
  }
});
test('single-town transport representation stays identical and old pending records are not backfilled',()=>{
  const {w,s,r}=fixture();w.villages=w.villages.slice(0,1);
  recordTransportDeparture(w,s,s.state.path,0);
  assert.equal(w.transportStats.pending[s.id].municipalVisit,undefined);
  w.villages.push({id:'village:1'});s.x=r.x;s.y=r.y;recordTransportArrival(w,s);
  assert.equal(w.transportStats.today.municipalVisits,undefined);
});
