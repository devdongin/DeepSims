import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateContract } from '../bench/candidate-contract.js';

// Captured from unoptimized 328458d, not regenerated after the optimization.
for (const [pop, expected] of [
  [10, ['7e987d33', '478b3b6a', 'cfb70613', '2fa36c30']],
  [50, ['5c93dd7d', 'da40b3d7', '28f8b23c', '1c512401']],
  [200, ['ce050617', '9c7c4bba', 'a72b7412', 'c34ec4fd']],
]) {
  test(`#97 pre-optimization ordered candidates, choices, events and world: population ${pop}`, () => {
    assert.deepEqual(Object.values(candidateContract(pop)), expected);
  });
}
