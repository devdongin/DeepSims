import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';

const schools = ['primary_school', 'middle_school', 'high_school'];
const client = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');

test('#96 distinct schools load exteriors, all rotations and interiors, not silent tile fallbacks', () => {
  const types = client.match(/const BLD_TYPES = \[([\s\S]*?)\];/)[1];
  const rotations = client.match(/for \(const t of \[([^\]]+)\]\) for \(const d of \[1, 2, 3\]\)/)[1];
  const interiors = client.match(/for \(const t of \[([^\]]+)\]\) \{\s*BLD_KEYS.push\(\[`bld_\$\{t\}_int`/)[1];
  for (const type of schools) {
    for (const list of [types, rotations, interiors]) assert.ok(list.includes(`'${type}'`), type);
    assert.ok(client.includes(`${type}: 'bld_${type}'`), `${type} facility mapping`);
  }
});

test('#96 school five-sprite sets are unique PNGs with real transparent padding', () => {
  const hashes = new Set();
  for (const type of schools) for (const suffix of ['', '_d1', '_d2', '_d3', '_int']) {
    const name = `bld_${type}${suffix}.png`;
    const data = readFileSync(new URL(`../client/public/props/${name}`, import.meta.url));
    const hash = createHash('sha256').update(data).digest('hex');
    assert.ok(!hashes.has(hash), `${name} must not be a duplicate direction/type`);
    hashes.add(hash);
    const png = PNG.sync.read(data);
    let transparent = 0, nearlyOpaque = 0;
    for (let i = 3; i < png.data.length; i += 4) {
      if (png.data[i] === 0) transparent++;
      // The generator encodes solid foreground mostly at alpha 253, not 255.
      if (png.data[i] >= 250) nearlyOpaque++;
    }
    const pixels = png.width * png.height;
    assert.ok(transparent > pixels * 0.1, `${name}: no painted checkerboard/backdrop`);
    assert.ok(nearlyOpaque > pixels * 0.1, `${name}: visible building`);
    for (const i of [0, png.width - 1, pixels - png.width, pixels - 1]) {
      assert.equal(png.data[i * 4 + 3], 0, `${name}: transparent corners`);
    }
  }
});
