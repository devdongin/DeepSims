import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, tick, serialize, deserialize, migrateWorld, hashWorld } from '../sim/index.js';
import { fullName, surnameFor } from '../sim/surnames.js';

const traits = { gender: 'F', mbti: { EI: 25, SN: 75, TF: 25, JP: 75 } };
function create(name, extra = {}) {
  const w = createWorld(20260903);
  tick(w, [{ sequence: 0, command: 'create_player', payload: { name, ...traits, ...extra } }]);
  return w;
}

test('#103 full-name input preserves Korean, compound surname and non-Korean names exactly', () => {
  for (const name of ['선동인', '남궁민수', 'Alex Kim', '별']) {
    const w = create(name, { nameMode: 'full' });
    const sim = w.sims.find((s) => s.isPlayer);
    assert.equal(fullName(sim), name);
    assert.equal(sim.surname, '');
    assert.equal(hashWorld(w), hashWorld(create(name, { nameMode: 'full' })));
    const restored = migrateWorld(deserialize(serialize(w)));
    assert.equal(hashWorld(restored), hashWorld(w));
    assert.equal(fullName(restored.sims.find((s) => s.isPlayer)), name);
  }
});

test('#103 old inputs retain their generated or explicit surname', () => {
  const w = create('동인');
  const player = w.sims.find((s) => s.isPlayer);
  assert.equal(fullName(player), surnameFor(w.seed, player.id) + '동인');
  assert.equal(fullName(create('동인', { surname: '선' }).sims.find((s) => s.isPlayer)), '선동인');
  assert.equal(create('동인', { nameMode: 'unknown' }).sims.some((s) => s.isPlayer), false);
});
