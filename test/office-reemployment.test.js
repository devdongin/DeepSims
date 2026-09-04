import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,hashWorld} from '../sim/index.js';
import {recruitOfficeWorkers} from '../sim/employment.js';
import {maybeJobSwitch} from '../sim/society.js';
import {emptyState} from '../sim/simfactory.js';
import {TILE} from '../sim/map.js';
import {publicBalance} from '../sim/government.js';

const closedMoney=w=>publicBalance(w)+w.sims.reduce((n,s)=>n+s.money,0)
  +w.map.facilities.reduce((n,f)=>n+(f.revenue??0),0)+(w.externalOutflow??0)-(w.externalInflow??0);

function fixture(){
  const w=createWorld(32);w.sims=w.sims.slice(0,1);
  const s=w.sims[0],office=w.map.facilities.find(f=>f.type==='office');
  s.traits.age=30;s.traits.occupation='jobless';s.education.course=null;
  s.abilities={stamina:50,dexterity:50,intellect:50,charisma:50};
  s.x=office.resources[0].x;s.y=office.resources[0].y;
  s.state=emptyState();s.needs={hunger:9000,energy:9000,social:9000,fun:9000};
  return {w,s,office};
}
const recruit=w=>{const events=[];for(let day=0;day<100;day++)recruitOfficeWorkers(w,day*1440,day,(...e)=>events.push(e));return events;};

test('office recruitment uses existing capacity, is replayable and grants no money until real work',()=>{
  const {w,s}=fixture(),copy=deserialize(serialize(w)),rng=serialize(w.rngSim),money=s.money,treasury=w.treasury;
  assert.deepEqual(recruit(w),recruit(copy));assert.equal(serialize(w),serialize(copy));
  assert.equal(s.traits.occupation,'office_worker');assert.equal(s.money,money);assert.equal(w.treasury,treasury);
  assert.equal(serialize(w.rngSim),rng);
  w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;
  let saved=deserialize(serialize(w)),paid=false;const closed=closedMoney(w);
  for(let i=0;i<400&&!paid;i++){
    const inputs=i===0?[{sequence:0,command:'assign',payload:{simId:s.id,actionType:'work'}}]:[];
    const events=tick(w,inputs);assert.deepEqual(events,tick(saved,inputs));assert.equal(hashWorld(w),hashWorld(saved));
    assert.equal(closedMoney(w),closed);
    if(i===120)saved=deserialize(serialize(w));
    paid=events.some(e=>e.type==='money_changed'&&e.simId===s.id&&e.payload.action==='work'&&e.payload.delta>0);
  }
  assert.ok(paid,'employment leads to actual work wages through existing accounting');
});

test('office recruitment excludes students, unfinished degrees, minors, retirement and existing workers',()=>{
  for(const kind of ['student','degree','minor','retirement','employed']){
    const {w,s}=fixture();
    if(kind==='student')s.traits.occupation='student';
    if(kind==='degree'){s.education.course='masters';s.education.completed=false;}
    if(kind==='minor')s.traits.age=18;
    if(kind==='retirement')s.traits.age=65;
    if(kind==='employed')s.traits.occupation='barista';
    const before=s.traits.occupation;assert.equal(recruit(w).length,0,kind);assert.equal(s.traits.occupation,before);
  }
});

test('missing, unreachable, incident, full and foreign office capacity never hires',()=>{
  for(const kind of ['missing','unreachable','incident','full','foreign']){
    const {w,s,office}=fixture();
    if(kind==='missing')w.map.facilities=w.map.facilities.filter(f=>f!==office);
    if(kind==='unreachable'){for(const r of office.resources)w.map.tiles[r.y*w.map.w+r.x]=TILE.WALL;w.map.reachVersion++;}
    if(kind==='incident')w.incidents.push({facilityId:office.id});
    if(kind==='foreign')office.villageId='village:other';
    if(kind==='full')for(let id=1;id<=office.resources.length;id++){
      const staff=structuredClone(s);staff.id=id;staff.traits.occupation='office_worker';w.sims.push(staff);
    }
    recruit(w);assert.equal(s.traits.occupation,'jobless',kind);
  }
});

test('competing office candidates use aptitude/ID order and never exceed existing capacity',()=>{
  const {w,s,office}=fixture();office.resources=office.resources.slice(0,1);
  const other=structuredClone(s);other.id=99;w.sims=[other,s];
  recruit(w);assert.equal(s.traits.occupation,'office_worker');assert.equal(other.traits.occupation,'jobless');
});

test('the daily industry recruitment entry point includes offices after service opportunities',()=>{
  const {w,s}=fixture();for(const f of w.map.facilities)f.revenue=0;
  for(let day=0;day<100;day++)maybeJobSwitch(w,day*1440,day,()=>{});
  assert.equal(s.traits.occupation,'office_worker');
});
