import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';

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
    assert.equal(initial.world.zoneCosts.train_station,8000,'station UI receives authoritative construction price');
    ws.send(JSON.stringify({ type: 'visibility', hidden: true }));
    await waitFor((m) => m.type === 'visibility' && m.hidden === true);
    messages.length = 0;
    observer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const observerMessages = [];
    observer.on('message', (raw) => observerMessages.push(JSON.parse(raw)));
    for (let i = 0; i < 100 && !observerMessages.some((m) => m.type === 'snapshot'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(observerMessages.some((m) => m.type === 'snapshot'));
    await fetch(`http://127.0.0.1:${port}/api/speed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speed: 48 }),
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(messages.some((m) => m.type === 'tickBatch'), false);
    assert.equal(observerMessages.some((m) => m.type === 'tickBatch'), true, 'visible client keeps receiving live batches');
    assert.equal(observerMessages.find(m=>m.type==='tickBatch').zoneCosts.train_station,8000,
      'live batches retain current prices rather than reverting to a UI constant');

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
