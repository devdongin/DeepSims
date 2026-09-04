import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../db/storage.js';
import {Engine,MAX_SPEED} from '../server/engine.js';
import {computeTarget} from '../sim/time.js';
import {TICK_DURATION_MS} from '../sim/constants.js';

test('new-world x4 is persisted atomically before any tick or speed command, and survives reopening',()=>{
  const dir=mkdtempSync(join(tmpdir(),'deepsims-new-speed-')),file=join(dir,'world.db');let st;
  try{
    st=new Storage(file);const first=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(first.createdNow,true);assert.equal(first.speed,4);assert.equal(st.getMetaInt('speed'),4);
    st.close();st=new Storage(file);
    const restored=new Engine(st,{seed:32,now:()=>1000});
    assert.equal(restored.createdNow,false);assert.equal(restored.speed,4);
    assert.equal(computeTarget({nowUtcMs:1000+10*TICK_DURATION_MS,epochUtcMs:restored.epochUtcMs,
      lastSimulatedTick:0,speed:restored.speed}).target,40);
    for(const speed of [1,10,MAX_SPEED]){
      restored.setSpeed(speed);
      assert.equal(new Engine(st,{seed:32,now:()=>1000}).speed,speed);
    }
    st.db.prepare("DELETE FROM meta WHERE key='speed'").run();
    assert.equal(new Engine(st,{seed:32,now:()=>1000}).speed,1,'legacy missing speed retains x1');
  }finally{st?.close();rmSync(dir,{recursive:true,force:true});}
});
