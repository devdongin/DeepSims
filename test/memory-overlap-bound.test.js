import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LOGIC} from '../sim/index.js';
import {memoryModFast,memoryModFor,prepareShortlist} from '../sim/cognition.js';

test('#99 bounded overlap buckets preserve exact scores and citations across all legal caps',()=>{
  const logic=structuredClone(DEFAULT_LOGIC);
  const memories=Array.from({length:32},(_,i)=>({memorySeq:31-i,tick:(i%6)*1440,
    importance:1+i%9,kind:i%3===0?'argument':'meal',
    tags:['work','facility:office',...(i%2?['socialize']:[]),...(i%4?[]:['play'])]}));
  const candidates=[[],['absent'],['work'],['work','facility:office'],['work','work'],
    ['socialize','play','work','facility:office'],Array(20).fill('work'),
    ['absent','play','absent','work','socialize']];
  for(const size of [0,1,7,32])for(const time of [0,10000,50000]){
    const shortlist=memories.slice(0,size);
    for(let cap=0;cap<=16;cap++)for(const topK of [1,8,32]){
      logic.memory.relevanceCap=cap;logic.memory.topK=topK;
      const prepared=prepareShortlist(shortlist,time,logic);
      const before=JSON.stringify(prepared);
      for(const tags of candidates){
        assert.deepEqual(memoryModFast(prepared,tags,logic),memoryModFor(shortlist,tags,time,logic),
          `size=${size} time=${time} cap=${cap} topK=${topK} tags=${tags}`);
        assert.equal(JSON.stringify(prepared),before,'prepared memory entries stay unchanged');
      }
    }
  }
});

test('#99 equal retrieval ties and changing scratch sizes retain original ordering',()=>{
  const logic=structuredClone(DEFAULT_LOGIC);
  const memories=Array.from({length:32},(_,i)=>({memorySeq:31-i,tick:0,importance:1,
    kind:i%2?'argument':'meal',tags:i%3?['work']:['other']}));
  for(const cap of [16,0,4,1,16,2])for(const topK of [1,8,32]){
    logic.memory.relevanceCap=cap;logic.memory.topK=topK;logic.memory.relevancePer=0;
    const prepared=prepareShortlist(memories,0,logic);
    for(const tags of [Array(20).fill('work'),[],['work','work'],['other']])
      assert.deepEqual(memoryModFast(prepared,tags,logic),memoryModFor(memories,tags,0,logic));
  }
});
