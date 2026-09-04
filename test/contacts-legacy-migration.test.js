import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,migrateWorld,serialize,deserialize,tick} from '../sim/index.js';
import {SCHEMA_VERSION} from '../sim/constants.js';

for(const version of [3,13,36])test(`pre-contact schema${version} migrates before matrix growth without losing conversations`,()=>{
  const w=createWorld(32);w.schemaVersion=version;
  delete w.contacts;delete w.recentConflicts;delete w.air;
  w.interactions[0][1]=42;w.interactions[1][0]=42;
  if(version===36)w.nextSimId+=4; // departed IDs still occupy the matrix namespace.
  const rng=serialize(w.rngSim);
  migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);
  assert.equal(w.contacts[0][1],42);assert.equal(w.contacts[1][0],42);
  assert.notEqual(w.contacts,w.interactions);assert.notEqual(w.contacts[0],w.interactions[0]);
  assert.equal(w.contacts.length,w.nextSimId);assert.ok(w.contacts.every(row=>row.length===w.nextSimId));
  assert.equal(serialize(w.rngSim),rng);
  const copy=deserialize(serialize(w));
  for(let i=0;i<10;i++)assert.deepEqual(tick(w),tick(copy));
});

test('schema1 without either conversation or contact matrix initializes both before growth',()=>{
  const w=createWorld(32);w.schemaVersion=1;
  delete w.interactions;delete w.contacts;delete w.lastGreetDay;delete w.air;
  migrateWorld(w);assert.equal(w.schemaVersion,SCHEMA_VERSION);
  assert.deepEqual(w.contacts,w.interactions);assert.ok(w.contacts.flat().every(n=>n===0));
  assert.notEqual(w.contacts[0],w.interactions[0]);
});
