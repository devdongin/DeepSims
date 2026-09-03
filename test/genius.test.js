import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, hashWorld, serialize, deserialize, migrateWorld } from '../sim/index.js';
import { geniusAtBirth, applyBirthTalent } from '../sim/genius.js';
import { maybeChildren } from '../sim/society.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { ABILITIES, developFromActivity } from '../sim/abilities.js';
import { makeSim } from '../sim/simfactory.js';
import { simView } from '../server/view.js';

const birthDay = DEFAULT_LOGIC.society.childCheckDays;
let giftedSeed = 1;
while (!geniusAtBirth(giftedSeed, 10, birthDay, 10)) giftedSeed++;

test('#96 population-dependent birth lottery is reproducible and not rounded to whole percentages', () => {
  let small = 0, large = 0;
  for(let seed=1;seed<=100000;seed++) {
    small += Number(geniusAtBirth(seed,10,birthDay,10));
    large += Number(geniusAtBirth(seed,10,birthDay,100));
  }
  assert.ok(small > 800 && small < 1200, `pop10: ${small}/100000, expected near 1/100`);
  assert.ok(large > 60 && large < 140, `pop100: ${large}/100000, expected near 1/1000`);
  assert.equal(geniusAtBirth(giftedSeed,10,birthDay,10), true);
});

function bornWorld() {
  const w=createWorld(giftedSeed);
  w.partners[0]=1;w.partners[1]=0;
  w.partnerStage[0]='married';w.partnerStage[1]='married';
  w.sims[1].homeId=w.sims[0].homeId;
  w.logic.family.childPermille=1000;
  const events=[];
  maybeChildren(w,birthDay*1440,birthDay,(type,simId,payload)=>events.push({type,simId,payload}));
  return {w,events};
}

test('#96 actual newborn gets a higher potential, not immediate adult mastery', () => {
  const a=bornWorld(),b=bornWorld();
  const child=a.w.sims.find(s=>s.id===10);
  assert.ok(child);
  assert.equal(child.traits.age,0);
  assert.equal(child.isGenius,true);
  assert.equal(child.isPlayer,false);
  assert.equal(child.geniusBirth.population,10);
  assert.equal(child.geniusBirth.denominator,100);
  const key=child.geniusBirth.ability;
  assert.ok(child.potential[key]>=120 && child.potential[key]<=150);
  assert.ok(child.abilities[key]<=15);
  assert.equal(ABILITIES.filter(k=>child.potential[k]>99).length,1);
  assert.equal(a.events.filter(e=>e.type==='genius_born').length,1);
  assert.equal(simView(child).isGenius,true);
  assert.deepEqual(a.events,b.events);
  assert.equal(hashWorld(a.w),hashWorld(b.w));
  assert.equal(hashWorld(a.w),hashWorld(migrateWorld(deserialize(serialize(a.w)))));
});

test('#96 private birth lottery consumes no simulation RNG; deprivation still blocks growth', () => {
  const w=createWorld(giftedSeed), template=w.sims[0];
  const child=makeSim({id:10,name:'검증',surname:'김',homeId:template.homeId,traits:{...template.traits,age:0,occupation:'child'},
    seed:giftedSeed,x:0,y:0,needs:{hunger:7000,energy:7000,social:7000,fun:7000},money:0,logic:w.logic});
  const before=JSON.stringify(w.rngSim);
  applyBirthTalent(w,child,birthDay,birthDay*1440,()=>{});
  assert.equal(JSON.stringify(w.rngSim),before);
  const key=child.geniusBirth.ability;
  child.traits.occupation=Object.entries(w.logic.abilities.keyAbility).find(([occ,k])=>k===key && occ!=='child')[0];
  child.traits.age=25;
  child.state={...child.state,kind:'performing',action:'work'};
  w.logic.development.ticksPerPoint=1;
  child.needs.hunger=0;
  const value=child.abilities[key];
  for(let t=0;t<200;t++) developFromActivity(w,child,t,()=>{});
  assert.equal(child.abilities[key],value);
  child.needs.hunger=9000;
  for(let t=0;t<200;t++) developFromActivity(w,child,t,()=>{});
  assert.equal(child.abilities[key],child.potential[key]);
});

test('#96 existing residents are not retroactively rerolled and player status is independent', () => {
  const w=createWorld(giftedSeed);w.schemaVersion=53;
  for(const s of w.sims){delete s.isGenius;delete s.geniusBirth;}
  w.sims[0].isPlayer=true;
  const before=w.sims.map(s=>({...s.abilities}));
  migrateWorld(w);
  assert.ok(w.sims.every(s=>s.isGenius===false && s.geniusBirth===null));
  assert.equal(simView(w.sims[0]).isPlayer,true);
  assert.deepEqual(w.sims.map(s=>s.abilities),before);
  assert.equal(hashWorld(w),hashWorld(migrateWorld(deserialize(serialize(w)))));
});
