import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,tick,serialize,deserialize,migrateWorld} from '../sim/index.js';
import {Storage} from '../db/storage.js';
import {recordServiceCount,recordServiceShortfall,recordServiceEvent,
  publicServiceSummary,rollPublicServiceObservation} from '../sim/public-service-observation.js';
import {publicServiceLines} from '../client/public-service-ui.js';
import {TILE} from '../sim/map.js';

function actorFixture(occupation='police'){
  const w=createWorld(88),s=w.sims[0];w.sims=[s];
  w.map={w:40,h:12,tiles:Array(480).fill(TILE.GRASS),reachVersion:0,facilities:[]};
  const f=(id,type,x)=>({id,type,x,y:4,w:1,h:1,villageId:'village:0',
    door:{x,y:4},resources:[{id:`${id}:seat`,x,y:4}],revenue:100000});
  w.map.facilities=[f('home','house',1),f('station',occupation==='police'?'police_station':'fire_station',4),
    f('target',w.logic.patrol.targets[0],30)];
  s.homeId='home';s.traits.age=25;s.traits.occupation=occupation;s.education.course=null;s.education.completed=true;
  s.employment=null;s.employmentSearch=null;s.patrolIdx=0;s.money=0;
  s.x=1;s.y=4;s.needs={hunger:10000,energy:10000,social:10000,fun:10000};
  w.worldTick=539;w.lastDailyDay=0;w.lastPlanDay=0;
  w.logic.occupations[occupation].workStart=0;w.logic.occupations[occupation].workEnd=1440;
  w.logic.actions.work.duration=2;w.logic.actions.respond_fire.duration=2;
  return {w,s};
}

test('real patrol attempts, starts and completions match actual events after replay',()=>{
  const {w,s}=actorFixture(),copy=deserialize(serialize(w)),events=[];
  for(let i=0;i<60;i++){
    const e=tick(w),replay=tick(copy);assert.deepEqual(e,replay);events.push(...e);
  }
  assert.equal(serialize(w),serialize(copy));
  const counts=publicServiceSummary(w).villages['village:0'].patrol.counts;
  const starts=events.filter(e=>e.type==='action_started'&&e.payload.facilityId==='patrol').length;
  const completed=events.filter(e=>e.type==='action_completed'&&e.payload.facilityId==='patrol').length;
  assert.ok(starts>0&&completed>0);assert.equal(counts.started,starts);assert.equal(counts.completed,completed);
  assert.equal(counts.attempted,starts);assert.equal(counts.no_path,0);assert.ok(s.money>0);
});

test('actual unreachable patrol records a failed attempt but never a start or arrival',()=>{
  const {w}=actorFixture();
  for(let y=0;y<12;y++)w.map.tiles[y*40+15]=TILE.WATER;
  w.map.reachVersion++;
  const events=tick(w),counts=publicServiceSummary(w).villages['village:0'].patrol.counts;
  assert.ok(events.some(e=>e.type==='action_failed'&&e.payload.reason==='no_path'));
  assert.equal(counts.attempted,1);assert.equal(counts.no_path,1);assert.equal(counts.started,0);assert.equal(counts.completed,0);
});

test('students and minors do not produce public-work attempts or shortage signals',()=>{
  for(const variant of ['minor','student','masters']){
    const {w,s}=actorFixture();
    if(variant==='minor')s.traits.age=18;
    if(variant==='student')s.traits.occupation='student';
    if(variant==='masters'){s.education.course='masters';s.education.completed=false;}
    tick(w);assert.deepEqual(publicServiceSummary(w).villages,{});
  }
});

test('eligible patrol target absence is observed once per day, off-hours are excluded',()=>{
  const {w}=actorFixture();w.map.facilities=w.map.facilities.filter(f=>f.id!=='target');
  for(let i=0;i<5;i++)tick(w);
  const p=publicServiceSummary(w).villages['village:0'].patrol;
  assert.equal(p.shortfalls.no_target,1);assert.equal(p.counts.attempted,0);
  const off=actorFixture().w;off.map.facilities=off.map.facilities.filter(f=>f.id!=='target');
  off.logic.chrono.dayShiftStart=1000;off.logic.chrono.dayShiftEnd=1200;
  tick(off);assert.deepEqual(publicServiceSummary(off).villages,{});
});

test('real fire suppression and natural-out race have separate outcome counters',()=>{
  for(const natural of [false,true]){
    const {w,s}=actorFixture('firefighter');
    // Existing emergency response is allowed off-shift; observation must not
    // silently invent a work-window gate or hide actual suppression.
    w.logic.chrono.dayShiftStart=1000;w.logic.chrono.dayShiftEnd=1200;
    w.incidents=[{facilityId:'target',sinceTick:539}];
    w.logic.incidents.selfOutTicks=natural?1:10000;
    const inputs=[{sequence:1,command:'assign',payload:{simId:s.id,actionType:'respond_fire'}}];
    const events=[...tick(w,inputs)];
    for(let i=0;i<45;i++)events.push(...tick(w));
    const c=publicServiceSummary(w).villages['village:0'].fire.counts;
    assert.equal(c.attempted,1);assert.equal(c.started,1);assert.equal(c.completed,1);
    assert.equal(c.fire_resolved,natural?0:1);assert.equal(c.fire_natural_out,natural?1:0);
    assert.equal(events.filter(e=>e.type==='heroic_save').length,natural?0:1);
  }
});

test('service gaps deduplicate resident/reason/day, actual events do not, IDs stay private',()=>{
  const w=createWorld(88),s=w.sims[0],rng=serialize(w.rngSim),industry=serialize(w.industryDemand);
  assert.equal(recordServiceShortfall(w,1,s,'patrol','reserved'),true);
  assert.equal(recordServiceShortfall(w,2,s,'patrol','reserved'),false);
  assert.equal(recordServiceShortfall(w,2,s,'patrol','unreachable'),true);
  recordServiceCount(w,1,'patrol','attempted','village:0');
  recordServiceCount(w,2,'patrol','attempted','village:0');
  const summary=publicServiceSummary(w,2),p=summary.villages['village:0'].patrol;
  assert.equal(p.shortfalls.reserved,1);assert.equal(p.shortfalls.unreachable,1);assert.equal(p.counts.attempted,2);
  assert.equal(JSON.stringify(summary).includes('seen'),false);
  assert.equal(JSON.stringify(summary).includes('residentIds'),false);
  assert.equal(serialize(w.rngSim),rng);assert.equal(serialize(w.industryDemand),industry);
  assert.equal(recordServiceShortfall(w,1440,s,'patrol','reserved'),true);
  assert.equal(publicServiceSummary(w,1440).villages['village:0'].patrol.shortfalls.reserved,2);
});

test('fourteen-day retention expires buckets and dedup IDs, with read-only zero fallback',()=>{
  const w=createWorld(88),s=w.sims[0];
  for(let day=0;day<20;day++)recordServiceShortfall(w,day*1440,s,'fire','reserved');
  assert.equal(w.publicServiceObservation.daily.length,14);
  assert.equal(w.publicServiceObservation.daily[0].day,6);
  assert.equal(publicServiceSummary(w,19*1440).villages['village:0'].fire.shortfalls.reserved,14);
  const before=serialize(w);
  assert.deepEqual(publicServiceSummary(w,40*1440).villages,{});
  assert.equal(serialize(w),before);
  rollPublicServiceObservation(w,40*1440);
  assert.deepEqual(w.publicServiceObservation.daily,[]);
  delete w.publicServiceObservation;
  assert.deepEqual(publicServiceSummary(w).villages,{});
});

test('late fire action completion is not suppression; natural fire-out is separate and local',()=>{
  const {w,s}=actorFixture('firefighter'),fac=w.map.facilities[0];
  fac.villageId='village:1';s.state.resourceId=`fire:${fac.id}`;
  recordServiceEvent(w,1,'fire_out',null,{facilityId:fac.id,by:'self'});
  recordServiceEvent(w,1,'action_completed',s.id,{action:'respond_fire',facilityId:'firesite'});
  let c=publicServiceSummary(w,1).villages['village:1'].fire.counts;
  assert.equal(c.completed,1);assert.equal(c.fire_natural_out,1);assert.equal(c.fire_resolved,0);
  recordServiceEvent(w,2,'fire_out',null,{facilityId:fac.id,by:s.id});
  assert.equal(publicServiceSummary(w,2).villages['village:1'].fire.counts.fire_resolved,0,'unrelated numeric actor is not suppression');
  Object.assign(s.state,{kind:'performing',action:'respond_fire',facilityId:'firesite'});
  recordServiceEvent(w,2,'fire_out',null,{facilityId:fac.id,by:s.id});
  c=publicServiceSummary(w,2).villages['village:1'].fire.counts;
  assert.equal(c.fire_resolved,1);
  const text=publicServiceLines(publicServiceSummary(w,2),[{id:'village:1',name:'강 건너'}]).join('\n');
  assert.match(text,/강 건너/);assert.match(text,/실제 진압 1 · 자연 소화 1/);
  assert.match(text,/시설 신축 수요\/필요 인원과 별개/);
});

test('SQL resume preserves daily dedup and subsequent deterministic observations',()=>{
  const w=createWorld(88),s=w.sims[0],storage=new Storage(':memory:');
  recordServiceShortfall(w,0,s,'patrol','reserved');
  try{
    storage.loadOrCreate({seed:88,nowUtcMs:1000});
    storage.commitBatch({world:w,events:[],appliedInputIds:[],epochUtcMs:1000});
    const restored=storage.loadOrCreate({seed:88,nowUtcMs:1000}).world;
    assert.equal(recordServiceShortfall(restored,0,restored.sims[0],'patrol','reserved'),false);
    assert.equal(serialize(restored),serialize(w));
    for(let i=0;i<50;i++)assert.deepEqual(tick(restored),tick(w));
    assert.equal(serialize(restored),serialize(w));
    const copy=migrateWorld(deserialize(serialize(w)));
    assert.deepEqual(copy.publicServiceObservation,w.publicServiceObservation);
  }finally{storage.close();}
});
