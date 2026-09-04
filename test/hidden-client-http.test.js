import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import {resetSimCache,mergeSimBatch} from '../client/sim-stream.js';

test('#143 hidden client receives no tick batches and resumes with one current snapshot', { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deepsims-hidden-client-'));
  const dbPath = path.join(dir, 'test.db');
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DEEPSIMS_HOST: '127.0.0.1', DEEPSIMS_DB: dbPath, DEEPSIMS_SEED: '143' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ws, observer;
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      server.stdout.on('data', (chunk) => { output += chunk; if (output.includes('따라잡기 완료')) resolve(); });
      server.once('exit', (code) => reject(new Error(`server exited: ${code}, ${output}`)));
      server.once('error', reject);
    });
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw)));
    const waitFor = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('message timeout');
    };
    const initial = await waitFor((m) => m.type === 'snapshot');
    const industry=await (await fetch(`http://127.0.0.1:${port}/api/industry`)).json();
    assert.ok(Array.isArray(industry.employment));
    assert.ok(industry.employment.some(row=>row.villageId==='village:0'));
    for(const row of industry.employment){
      assert.equal(row.jobless,row.eligibleJobless+row.ineligibleJobless);
      assert.equal(row.scope,'resident-local-capacity-proxy');
      assert.equal(row.sectors.find(s=>s.type==='office').hiringPath,true);
      assert.ok(Number.isSafeInteger(row.officeConstruction.unmet)&&row.officeConstruction.unmet>=0);
      assert.ok(Number.isSafeInteger(row.officeConstruction.pendingCapacity));
    }

    assert.ok(initial.world.transportStats.today);assert.ok(Array.isArray(initial.world.transportStats.history));
    assert.equal(initial.world.zoneCosts.train_station,8000,'station UI receives authoritative construction price');
    const legacy=await waitFor(m=>m.type==='tickBatch');
    assert.ok(legacy.sims[0].traits,'an already-loaded legacy client receives full resident views');
    assert.equal(legacy.statics,undefined);
    ws.send(JSON.stringify({ type: 'visibility', hidden: true }));
    await waitFor((m) => m.type === 'visibility' && m.hidden === true);
    messages.length = 0;
    observer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    observer.on('open',()=>observer.send(JSON.stringify({type:'visibility',hidden:false,simStatics:true})));
    const observerMessages = [];
    observer.on('message', (raw) => observerMessages.push(JSON.parse(raw)));
    for (let i = 0; i < 100 && !observerMessages.some((m) => m.type === 'snapshot'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(observerMessages.some((m) => m.type === 'snapshot'));
    await fetch(`http://127.0.0.1:${port}/api/speed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 20 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(messages.some((m) => m.type === 'tickBatch'), false);
    assert.equal(observerMessages.some((m) => m.type === 'tickBatch'), true, 'visible client keeps receiving live batches');
    assert.equal(observerMessages.find(m=>m.type==='tickBatch').zoneCosts.train_station,8000,
      'live batches retain current prices rather than reverting to a UI constant');
    const cache=new Map();
    for(const message of observerMessages){
      if(message.type==='snapshot')resetSimCache(cache,message.world.sims);
      if(message.type!=='tickBatch')continue;
      assert.equal(message.simRefs,undefined,'internal simulation references never reach the socket');
      assert.equal(message.statKeys,undefined);
      assert.ok(Array.isArray(message.statics));assert.ok(Array.isArray(message.villages));
      assert.ok(message.rail);assert.ok(message.policyDefaults);
      for(const sim of mergeSimBatch(cache,message.sims,message.statics)){
        assert.equal(typeof sim.name,'string');assert.equal(typeof sim.villageId,'string');
        assert.ok(sim.traits);assert.ok(sim.education);assert.equal(typeof sim.state.rail,'boolean');
        assert.equal(sim.state.path,undefined);assert.equal(sim.memories,undefined);
      }
    }

    ws.send(JSON.stringify({ type: 'visibility', hidden: false }));
    const resumed = await waitFor((m) => m.type === 'snapshot');
    assert.ok(resumed.world.worldTick > initial.world.worldTick);
    assert.equal(resumed.seq, messages.find((m) => m.type === 'visibility' && m.hidden === false).seq + 1);
  } finally {
    ws?.terminate();
    observer?.terminate();
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
