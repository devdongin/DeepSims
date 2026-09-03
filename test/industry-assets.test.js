import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

test('#63 industry five-sprite sets exist and every loader path is registered', () => {
  const source=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const types=source.match(/const BLD_TYPES = \[([\s\S]*?)\];/)[1];
  const rotations=source.match(/for \(const t of \[([^\]]+)\]\) for \(const d of \[1, 2, 3\]\)/)[1];
  const interiors=source.match(/for \(const t of \[([^\]]+)\]\) \{\s*BLD_KEYS.push\(\[`bld_\$\{t\}_int`/)[1];
  for(const type of ['workshop','lab','warehouse']) {
    for(const list of [types,rotations,interiors])assert.ok(list.includes(`'${type}'`),type);
    assert.match(source,new RegExp(`${type}:\\s*'bld_${type}'`));
    for(const suffix of ['','_d1','_d2','_d3','_int']) {
      const png=PNG.sync.read(readFileSync(new URL(`../client/public/props/bld_${type}${suffix}.png`,import.meta.url)));
      assert.ok(png.width>0&&png.height>0,`${type}${suffix}`);
    }
  }
});
