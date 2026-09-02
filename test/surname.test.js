// §22.16 성씨 + 심 생성 단일 창구 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURNAMES, SURNAME_TOTAL, surnameFor, surnameHash, fullName } from '../sim/surnames.js';
import { makeSim, emptyState } from '../sim/simfactory.js';
import { createWorld, advance, hashWorld, serialize, deserialize, findNonFinite } from '../sim/index.js';

test('N-1. 성씨 표: 합계가 정확히 맞고 중복이 없다', () => {
  const sum = SURNAMES.reduce((a, s) => a + s.share, 0);
  assert.equal(sum, SURNAME_TOTAL, '누적분포 합계와 표 합계가 다르다');
  assert.equal(sum, 100000, '합계가 눈금과 다르면 분포 끝에서 확률이 샌다');
  const seen = new Set();
  for (const s of SURNAMES) {
    assert.equal(seen.has(s.hangul), false, `성씨 중복: ${s.hangul}`);
    seen.add(s.hangul);
  }
});

test('N-2. 500명 미만 성씨는 없다 (사용자 지시)', () => {
  // count는 천 명 단위. 500명 = 0.5천이므로 count >= 1이면 넉넉히 넘는다.
  for (const s of SURNAMES) {
    assert.ok(s.count >= 1, `${s.hangul}: ${s.count}천 명 — 500명 기준 미달`);
    assert.ok(s.share >= 1, `${s.hangul}: 눈금이 0이라 영원히 등장하지 않는다`);
  }
});

test('N-3. 표의 모든 성씨가 실제로 등장한다', () => {
  const seen = new Set();
  for (let i = 0; i < 400000; i++) seen.add(surnameFor(4242, i));
  assert.equal(seen.size, SURNAMES.length,
    `${SURNAMES.length}개 중 ${seen.size}개만 등장 — 눈금이 0인 성씨가 있다`);
});

test('N-4. 분포가 표와 맞는다', () => {
  const N = 400000;
  const cnt = new Map();
  for (let i = 0; i < N; i++) {
    const h = surnameFor(4242, i);
    cnt.set(h, (cnt.get(h) ?? 0) + 1);
  }
  for (const s of SURNAMES.slice(0, 10)) {
    const got = ((cnt.get(s.hangul) ?? 0) * 100000) / N;
    const diff = Math.abs(got - s.share);
    assert.ok(diff < s.share * 0.05 + 50,
      `${s.hangul}: 기대 ${s.share} 실측 ${got.toFixed(0)}`);
  }
});

test('N-5. 성씨는 rng를 소비하지 않고 (seed, simId)에서 결정된다', () => {
  // 같은 (seed, id)는 언제나 같은 성. 시드가 다르면 대체로 달라진다.
  for (let i = 0; i < 50; i++) assert.equal(surnameFor(7, i), surnameFor(7, i));
  let diff = 0;
  for (let i = 0; i < 200; i++) if (surnameFor(7, i) !== surnameFor(8, i)) diff++;
  assert.ok(diff > 100, `시드가 달라도 성씨가 거의 같다 (${diff}/200) — 믹서가 시드를 안 쓴다`);
  // seed가 undefined여도 죽지 않고, 유효 시드와 다른 값을 준다 (§21.1과 같은 이유)
  assert.equal(typeof surnameFor(undefined, 3), 'string');
  assert.ok(surnameHash(undefined, 3) < 100000);
});

test('N-6. 네 생성 경로가 모두 같은 필드를 갖는다', () => {
  // 예전에는 월드젠·이민·출생·플레이어의 필드가 서로 달랐고, 그게 §22.13의
  // 결정성 계약 위반으로 이어졌다. 창구를 하나로 모았으니 그걸 여기서 못 박는다.
  const w = createWorld(4242);
  advance(w, {
    10: [{
      sequence: 0,
      command: 'create_player',
      payload: { name: '테스터', gender: 'F', age: 31, mbti: { EI: 25, SN: 75, TF: 25, JP: 75 }, occupation: 'office_worker' },
    }],
  }, 11);
  // 이민·출생이 일어날 만큼 충분히 돌린다
  advance(w, {}, 40000);

  const worldgen = w.sims.find((s) => s.id < 10);
  const player = w.sims.find((s) => s.isPlayer);
  assert.ok(worldgen && player, '월드젠 심과 플레이어가 있어야 한다');

  const keysOf = (s) => Object.keys(s).sort().join(',');
  const ref = keysOf(worldgen);
  for (const s of w.sims) {
    assert.equal(keysOf(s), ref, `심 ${s.id}(${fullName(s)})의 필드가 다르다`);
    // 행동 중인 state는 필드가 더 붙는 게 정상이다. **빠지는 게 없는지**만 본다 —
    // 빠지면 undefined가 되고, 그게 §22.13의 직렬화 왕복 파괴로 이어진다.
    for (const k of Object.keys(emptyState())) {
      assert.ok(k in s.state, `심 ${s.id}(${fullName(s)})의 state에 ${k}가 없다`);
    }
  }
  // 그리고 직렬화가 삼키는 값이 없어야 한다 (§22.13)
  assert.deepEqual(findNonFinite(w, 10), []);
});

test('N-7. 모든 심에게 성이 있고 표시는 성+이름이다', () => {
  const w = createWorld(4242);
  advance(w, {}, 40000);
  for (const s of w.sims) {
    assert.equal(typeof s.surname, 'string', `심 ${s.id}에게 성이 없다`);
    assert.ok(s.surname.length >= 1, `심 ${s.id}의 성이 비었다`);
    assert.equal(fullName(s), `${s.surname}${s.name}`);
  }
});

test('N-8. 자녀는 부모의 성을 따른다', () => {
  const w = createWorld(4242);
  advance(w, {}, 120000); // 출생이 일어날 만큼
  const byId = new Map(w.sims.map((s) => [s.id, s]));
  let checked = 0;
  for (const [childId, pr] of Object.entries(w.parents ?? {})) {
    const child = byId.get(Number(childId));
    if (!child || !Array.isArray(pr) || pr.length < 2) continue;
    const pa = byId.get(pr[0]); const pb = byId.get(pr[1]);
    if (!pa || !pb) continue; // 부모가 사망해 사라진 경우
    const dads = [pa, pb].filter((x) => x.traits.gender === 'M');
    const expected = (dads.length === 1 ? dads[0] : (pa.id <= pb.id ? pa : pb)).surname;
    assert.equal(child.surname, expected,
      `${fullName(child)}의 성이 부모(${fullName(pa)}/${fullName(pb)})와 다르다`);
    checked++;
  }
  assert.ok(checked > 0, '검사할 자녀가 없다 — 관측 구간이 너무 짧다');
});

test('N-9. 성씨가 붙어도 저장/복구 왕복이 고정점이다', () => {
  const w = createWorld(848664808);
  advance(w, {}, 30000);
  const w2 = deserialize(serialize(w));
  assert.equal(hashWorld(w), hashWorld(w2));
  advance(w, {}, 2000);
  advance(w2, {}, 2000);
  assert.equal(hashWorld(w), hashWorld(w2), '왕복 뒤 세계가 갈라졌다');
});

test('N-10. makeSim이 rng를 소비하지 않는다', () => {
  // 같은 인자로 두 번 부르면 완전히 같은 객체가 나온다 (rng를 쓴다면 달라진다).
  const args = { id: 3, name: '민수', surname: '김', homeId: 'house1', traits: { gender: 'M' }, seed: 42, x: 1, y: 2, needs: { hunger: 1 }, money: 100 };
  assert.equal(JSON.stringify(makeSim(args)), JSON.stringify(makeSim(args)));
});
