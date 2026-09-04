import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

test('world-review reports test failures and then fails the check, including missing results',()=>{
  const source=readFileSync(new URL('../.github/workflows/world-review.yml',import.meta.url),'utf8');
  const marker='      - name: 테스트 실패를 체크 상태에 반영';
  const index=source.indexOf(marker);assert.ok(index>source.indexOf('await github.rest.issues.createComment('));
  const gate=source.slice(index);
  assert.match(gate,/if: always\(\)/);
  assert.ok(gate.includes('TEST_EXIT: ${{ steps.tests.outputs.exit }}'));
  const run=gate.split('        run: |\n')[1];assert.ok(run);
  // Execute the actual workflow shell, rather than a duplicate predicate.
  for(const code of ['0','1','137','', 'unexpected']){
    const result=spawnSync('bash',['-c',run],{encoding:'utf8',env:{...process.env,TEST_EXIT:code}});
    assert.equal(result.status,code==='0'?0:1,`test exit ${JSON.stringify(code)}`);
    if(code!=='0')assert.match(result.stdout,/::error::/);
  }
});
