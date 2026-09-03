import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import { Storage } from '../db/storage.js';
import { serialize } from '../sim/serialize.js';
import { newGovernment } from '../sim/government.js';

for (const municipal of [false, true]) test(`#119/#32 HTTP input -> live event -> reconnect snapshot preserves a ${municipal ? 'municipal' : 'legacy'} planned center`, { timeout: 20000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deepsims-center-http-'));
  const dbPath = path.join(dir, 'test.db');
  const st = new Storage(dbPath);
  const { world } = st.loadOrCreate({ seed: 119, nowUtcMs: Date.now() });
  world.treasury = 10000;
  if (municipal) world.villages.push({ id: 'village:1', name: '새마을', foundedTick: 0,
    center: { x: 80, y: 80 }, government: { ...newGovernment(), treasury: 10000 } });
  st.db.prepare('UPDATE snapshot SET state = ? WHERE id = 1').run(serialize(world));
  const point = { ...world.map.facilities[0].door, ...(municipal ? { villageId: 'village:1' } : {}) };
  st.close();
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DEEPSIMS_HOST: '127.0.0.1', DEEPSIMS_DB: dbPath, DEEPSIMS_SEED: '119' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ws;
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      server.stdout.on('data', (chunk) => { output += chunk; if (output.includes('따라잡기 완료')) resolve(); });
      server.once('exit', (code) => reject(new Error(`server exited: ${code}, ${output}`)));
      server.once('error', reject);
    });
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const waitMessage = (predicate) => new Promise((resolve) => {
      const handler = (raw) => {
        const msg = JSON.parse(raw);
        if (predicate(msg)) { ws.off('message', handler); resolve(msg); }
      };
      ws.on('message', handler);
    });
    const initial = await waitMessage((m) => m.type === 'snapshot');
    assert.deepEqual(initial.world.centers, []);
    assert.equal(initial.world.plannedCenterCost, 5000);
    const received = waitMessage((m) => m.events?.some((e) => e.type === 'center_planned'));
    const response = await fetch(`http://127.0.0.1:${port}/api/input`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientInputId: 'center-http-test', command: 'plan_center', payload: point }),
    });
    assert.equal(response.status, 200);
    const batch = await received;
    const event = batch.events.find((e) => e.type === 'center_planned');
    assert.equal(batch.policyDefaults.taxPct, initial.world.policyDefaults.taxPct);
    if (municipal) {
      assert.equal(batch.villages.find(v => v.id === 'village:1').government.treasury, 5000);
      assert.equal(batch.villages.find(v => v.id === 'village:1').government.cityTier, 0);
      assert.equal(batch.publicTreasury, batch.treasury + 5000);
    }
    assert.equal(event.payload.cost, 5000);
    assert.equal(event.payload.treasury, (municipal ? 10000 : initial.world.treasury) - 5000);
    assert.equal(event.payload.villageId, municipal ? 'village:1' : undefined);
    const synced = waitMessage((m) => m.type === 'snapshot');
    ws.send(JSON.stringify({ type: 'resync' }));
    const final = (await synced).world;
    assert.equal(final.centers[0].centerId, event.payload.centerId);
    assert.equal(final.centers[0].villageId, municipal ? 'village:1' : undefined);
    if (municipal) assert.equal(final.villages.find(v => v.id === 'village:1').government.treasury, 5000);
  } finally {
    ws?.terminate();
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
