import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../sim/world.js';
import {serialize,deserialize} from '../sim/serialize.js';
import {maybeConverse} from '../sim/interaction.js';
import {applyWorldEvent,validateWorldEvent} from '../sim/world-events.js';
import {makeRng} from '../sim/prng.js';

function fixture(){
  const w=createWorld(32);
  w.logic.conversation.topicWeights={weather:10,work_gripe:10};
  w.partners={};for(const k of Object.keys(w.clubs))w.clubs[k]=[];
  for(const s of w.sims.slice(0,2)){
    s.state.pairedTicks=1;s.traits.occupation='office_worker';s.conversationTopics={};
  }
  return w;
}
function converse(w,t=2,transfer=false){
  const events=[];
  maybeConverse(w,w.sims[0],w.sims[1],'park',t,transfer,(type,id,p)=>events.push({type,id,p}));
  return events;
}
test('topic events alter actual conversation selection, expire, and survive saved state',()=>{
  const w=fixture();
  assert.equal(applyWorldEvent(w,{effect:'topic_weather',percent:0,durationTicks:10},1,()=>{}),true);
  const saved=deserialize(serialize(w));
  const events=converse(w);
  assert.deepEqual(converse(saved),events);
  assert.ok(events.some(e=>e.p.topic==='work_gripe'));
  assert.equal(serialize(saved),serialize(w));
  const expired=fixture(),control=fixture();
  applyWorldEvent(expired,{effect:'topic_weather',percent:0,durationTicks:1},1,()=>{});
  assert.deepEqual(converse(expired),converse(control));
  assert.deepEqual(expired.rngSim,control.rngSim);
});
test('topic events preserve context filters, fallback and priority invitation',()=>{
  const w=fixture();w.logic.conversation.topicWeights={food:10};
  applyWorldEvent(w,{effect:'topic_food',percent:300,durationTicks:10},1,()=>{});
  const rng=serialize(w.rngSim);
  assert.ok(converse(w).some(e=>e.p.topic==='weather'),'food cannot appear in a park');
  assert.equal(serialize(w.rngSim),rng,'empty-context fallback consumes no draw');
  assert.ok(converse(w,3,true).some(e=>e.p.topic==='party_invite'));
  assert.equal(validateWorldEvent({effect:'topic_arbitrary',percent:100,durationTicks:10}).ok,false);
});

test('positive topic weight changes deterministic selection frequency without mutating base weights',()=>{
  const base=fixture(),boost=fixture(),neutral=fixture();
  applyWorldEvent(boost,{effect:'topic_weather',percent:300,durationTicks:10},1,()=>{});
  applyWorldEvent(neutral,{effect:'topic_weather',percent:100,durationTicks:10},1,()=>{});
  let normalWeather=0,boostWeather=0;
  for(let seed=1;seed<=200;seed++){
    for(const w of [base,boost,neutral]){
      w.rngSim=makeRng(seed);w.sims[0].conversationTopics={};w.sims[1].conversationTopics={};
    }
    const a=converse(base),b=converse(boost),c=converse(neutral);
    assert.deepEqual(c,a,'100% event preserves actual utterance');
    assert.deepEqual(neutral.rngSim,base.rngSim);
    normalWeather+=Number(a.some(e=>e.p.topic==='weather'));
    boostWeather+=Number(b.some(e=>e.p.topic==='weather'));
  }
  assert.ok(boostWeather>normalWeather+20,`${normalWeather} -> ${boostWeather}`);
  assert.deepEqual(boost.logic.conversation.topicWeights,{weather:10,work_gripe:10});
});

test('zeroing all eligible weights retains the existing deterministic fallback',()=>{
  const w=fixture();
  for(const effect of ['topic_weather','topic_work_gripe'])
    applyWorldEvent(w,{effect,percent:0,durationTicks:10},1,()=>{});
  const before=serialize(w.rngSim);
  assert.ok(converse(w).some(e=>e.p.topic==='weather'));
  assert.equal(serialize(w.rngSim),before);
});
