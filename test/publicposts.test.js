// §23.13 공공 정원 계약. 사용자 지적: "공무원이 너무 많은거지 / 인구수에 맞게
// 공무원수도 설계되어야지." 여기서 못 박는 것은 **정원이 인구를 따라가는가**다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, hashWorld, serialize, deserialize } from '../sim/index.js';
import { publicQuota, publicHeadcount, publicPostAvailable, fillPublicPosts } from '../sim/publicposts.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';

const PUB = DEFAULT_LOGIC.economy.publicWageOccupations;

test('P-1. 정원표의 모든 자리가 공공 임금 직군이다', () => {
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(PUB.includes(occ), `${occ}는 공공 임금 직군이 아닌데 정원표에 있다`);
  }
});

test('P-2. 인구가 문턱 미만이면 그런 자리는 아예 없다', () => {
  const w = createWorld(4242);
  assert.equal(w.sims.length, 10, '초기 인구 가정이 바뀌었다');
  // 열 명 마을에 파출소도 소방서도 병원도 없다 — 그게 정상이다.
  for (const occ of ['police', 'firefighter', 'doctor', 'nurse', 'teacher', 'politician']) {
    assert.equal(publicQuota(w, occ), 0, `인구 10명에 ${occ} 자리가 있다`);
    assert.equal(publicHeadcount(w, occ), 0, `인구 10명인데 ${occ}가 있다`);
  }
  assert.equal(publicQuota(w, 'civil_servant'), 1, '공무원 한 자리는 있어야 한다');
});

test('P-3. 인구가 늘면 자리도 는다', () => {
  const w = createWorld(4242);
  const at = (pop, occ) => { const saved = w.sims.length; w.sims.length = 0; w.sims.length = pop; const q = publicQuota(w, occ); w.sims.length = saved; return q; };
  assert.equal(at(10, 'police'), 0);
  assert.ok(at(60, 'police') >= 1, '예순 명 마을에는 경찰이 있어야 한다');
  assert.ok(at(300, 'police') > at(60, 'police'), '인구가 다섯 배인데 경찰이 안 늘었다');
});

test('P-4. 시작하는 마을이 스스로를 감당한다 — 국고가 첫 주에 무너지지 않는다', () => {
  // 정원제 이전 실측: 인구 10명 중 공공직 6명 → 1일차 국고 −10,766, 14일차 −76,248.
  // 공공 임금은 국고가 전액 보장하므로(§22.23) 태어나자마자 파산하는 마을이었다.
  const w = createWorld(1521715934);
  assert.ok(w.treasury > 0, '시작 국고가 0 이하다');
  const pub = w.sims.filter((s) => PUB.includes(s.traits.occupation)).length;
  assert.ok(pub * 4 <= w.sims.length, `열 명 마을에 공공직이 ${pub}명이다 (4분의 1을 넘겼다)`);
  advance(w, {}, 7 * 1440);
  assert.ok(w.treasury > -20000, `첫 주에 국고가 ${w.treasury}까지 내려갔다`);
});

test('P-5. 자리를 채우되 넘기지 않는다', () => {
  const w = createWorld(9001);
  fillPublicPosts(w); // 멱등이어야 한다 — 이미 채워진 자리를 또 채우지 않는다
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(publicHeadcount(w, occ) <= publicQuota(w, occ),
      `${occ}가 정원(${publicQuota(w, occ)})을 넘었다`);
  }
  assert.equal(fillPublicPosts(w), 0, '두 번째 호출에서 또 뽑았다 — 멱등이 아니다');
});

test('P-6. 90일을 굴려도 공공 비중이 인구를 따라간다', () => {
  const w = createWorld(9001);
  advance(w, {}, 90 * 1440);
  const pub = w.sims.filter((s) => PUB.includes(s.traits.occupation)).length;
  assert.ok(pub > 0, '공공직이 하나도 없다 — 경찰도 의사도 없는 마을이다');
  assert.ok(pub * 3 <= w.sims.length, `공공 비중이 3분의 1을 넘었다 (${pub}/${w.sims.length})`);
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(publicHeadcount(w, occ) <= publicQuota(w, occ),
      `90일 뒤 ${occ}가 정원을 넘었다 (${publicHeadcount(w, occ)}/${publicQuota(w, occ)})`);
  }
});

test('P-7. 정원 판정은 rng를 쓰지 않는다 — 결정성·직렬화 왕복 유지', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 3 * 1440); advance(b, {}, 3 * 1440);
  assert.equal(hashWorld(a), hashWorld(b));
  assert.equal(hashWorld(a), hashWorld(deserialize(serialize(a))));
});
