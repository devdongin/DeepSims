import test from 'node:test';
import assert from 'node:assert/strict';
import {eventPayload,activeEventLines,EVENT_LABELS} from '../client/world-events-ui.js';
import {WORLD_EVENT_EFFECTS} from '../sim/world-events.js';

test('world event UI uses the same allowlist and bounded durable payload',()=>{
  assert.deepEqual(Object.keys(EVENT_LABELS).sort(),[...WORLD_EVENT_EFFECTS].sort());
  assert.deepEqual(eventPayload('mood','-2000','2'),{effect:'mood',delta:-2000,durationTicks:2880});
  assert.deepEqual(eventPayload('disease','200','1'),{effect:'disease',percent:200,durationTicks:1440});
  for(const args of [['mood','3001','1'],['disease','-1','1'],['unknown','100','1'],
    ['disease','','1'],['disease','100',''],['disease','100','0.5'],['disease','100','31']])
    assert.throws(()=>eventPayload(...args));
});
test('active event display derives remaining game time from the authoritative tick',()=>{
  const w={worldTick:10,worldEvents:[{effect:'mood',delta:-1000,startsAt:1,expiresAt:20},
    {effect:'disease',percent:200,startsAt:1,expiresAt:10}]};
  assert.deepEqual(activeEventLines(w),['기분 충격: -1000 · 남은 게임 시간 10분']);
  w.worldTick=20;assert.deepEqual(activeEventLines(w),[]);
});
