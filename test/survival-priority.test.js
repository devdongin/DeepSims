import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize} from '../sim/index.js';
import {TILE} from '../sim/map.js';
import {emptyState} from '../sim/simfactory.js';

function fixture(){
  const w=createWorld(32),s=w.sims[1];w.sims=[s];
  w.map={w:12,h:12,tiles:Array(144).fill(TILE.GRASS),facilities:[
    {id:'house0',type:'house',villageId:'village:0',door:{x:2,y:2},resources:[{id:'bed0',x:2,y:2}]},
    {id:'cafe0',type:'cafe',villageId:'village:0',door:{x:3,y:2},resources:[{id:'seat0',x:3,y:2}],revenue:100000},
  ],reachVersion:0};
  w.worldTick=1;w.lastDailyDay=0;w.lastPlanDay=0;w.projects=[];w.zoneOrders=[];w.plots=[];
  s.homeId='house0';s.x=3;s.y=2;s.state=emptyState();s.money=10000;s.groceries=0;
  s.traits.age=30;s.traits.occupation='jobless';s.traits.mbti.EI=0;
  s.education.course=null;s.education.completed=true;
  s.needs={hunger:0,energy:0,social:0,fun:0};
  return {w,s};
}

test('#176 executable critical food wins over unpaired extrovert socializing',()=>{
  const {w,s}=fixture();tick(w);assert.equal(s.state.action,'eat');
});

test('#176 critical rest wins over socializing when fed',()=>{
  const {w,s}=fixture();s.needs.hunger=10000;tick(w);assert.equal(s.state.action,'sleep');
});

test('#176 unavailable survival actions do not suppress remaining choices',()=>{
  const {w,s}=fixture();s.money=0;s.needs.energy=10000;
  w.treasury=0;tick(w);assert.equal(s.state.action,'music');
});

test('#176 autonomous lone resident eats and sleeps repeatedly, with identical save replay',()=>{
  const {w,s}=fixture(),copy=deserialize(serialize(w)),counts={};
  for(let i=0;i<7200;i++){
    const events=tick(w);assert.deepEqual(events,tick(copy));
    for(const e of events)if(e.simId===s.id&&e.type==='action_completed')counts[e.payload.action]=(counts[e.payload.action]??0)+1;
  }
  assert.ok(counts.eat>=3,JSON.stringify(counts));assert.ok(counts.sleep>=2,JSON.stringify(counts));
  assert.ok(w.sims.includes(s));assert.equal(serialize(w),serialize(copy));
});
