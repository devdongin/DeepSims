// §22.16 성씨 + 심 생성 단일 창구 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SURNAMES, SURNAME_TOTAL, surnameFor, surnameHash, fullName } from '../sim/surnames.js';
import { makeSim, emptyState } from '../sim/simfactory.js';
import { createWorld, advance, hashWorld, serialize, deserialize, findNonFinite } from '../sim/index.js';
import { maybeChildren } from '../sim/society.js';

function familyWorld() {
  const w = createWorld(4242);
  // 성의 상속/이관을 검증하므로 실제 출생 경로에 필요한 부부·주거·출생 확률을 고정한다.
  // 장기 세계에서 우연히 결혼하고 아이를 낳을 때까지 기다리는 것은 이 계약의 전제가 아니다.
  w.partners[0] = 1; w.partners[1] = 0;
  w.partnerStage[0] = 'married'; w.partnerStage[1] = 'married';
  w.sims[1].homeId = w.sims[0].homeId;
  w.logic.family.childPermille = 1000;
  const day = w.logic.society.childCheckDays;
  maybeChildren(w, day * 1440, day, () => {});
  maybeChildren(w, day * 2880, day * 2, () => {});
  assert.equal(Object.keys(w.parents).length, 2, '실제 출생 함수에서 두 자녀를 만든다');
  return w;
}

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
  const w = familyWorld();
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

test('N-11. 플레이어가 이민자와 같은 id를 받지 않는다 (설계 검증 ①)', () => {
  // 예전에는 create_player가 `마지막 심의 id + 1`로 id를 만들고 nextSimId를
  // 전진시키지 않아, 플레이어와 나중에 온 이민자가 **같은 id**를 받았다.
  // 호감도·상호작용·인사 행렬과 world.parents·relTiers가 전부 id로 색인되므로
  // 두 심이 서로의 관계를 덮어쓴다. 성씨도 (seed, id) 유도라 성까지 같아졌다.
  const w = createWorld(4242);
  advance(w, {
    10: [{
      sequence: 0,
      command: 'create_player',
      payload: { name: '테스터', gender: 'F', age: 31, mbti: { EI: 25, SN: 75, TF: 25, JP: 75 }, occupation: 'office_worker' },
    }],
  }, 11);
  const player = w.sims.find((s) => s.isPlayer);
  assert.ok(player, '플레이어가 만들어져야 한다');
  assert.ok(w.nextSimId > player.id, 'nextSimId가 플레이어 id를 지나쳐야 한다');

  advance(w, {}, 60000); // 이민이 여러 번 일어날 만큼
  const ids = w.sims.map((s) => s.id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepEqual(dup, [], `id 중복: ${dup.join(',')}`);
  // 행렬도 id 공간을 덮어야 한다
  assert.ok(w.affinity.length >= w.nextSimId, '호감도 행렬이 id 공간보다 작다');
});

test('N-12. 마이그레이션 성씨가 부모 생사에 좌우되지 않는다 (설계 검증 ②)', async () => {
  // 사망한 심은 world.sims에서 제거되지만 world.parents에는 남는다. 예전 백필은
  // **살아 있는 부모만** 봤기 때문에, 같은 세계라도 언제 마이그레이션을 돌렸는지에 따라
  // 형제끼리 성이 갈렸다. 지금은 계보(world.parents)만 보고 뿌리를 찾으므로 생사와 무관하다.
  //
  // 재는 것은 '출생 시 규칙과 같은가'가 아니라 **'마이그레이션끼리 같은가'**다.
  // 출생은 부성 원칙(민법 781조)으로 정하고, 마이그레이션은 죽은 부모의 성별을 알 수
  // 없어 id 순서로 뿌리를 찾는다 — 둘은 다를 수 있지만, 마이그레이션은 언제 돌려도
  // 같아야 한다. 그게 리플레이가 기대는 성질이다.
  const { migrateWorld } = await import('../sim/migrate.js');
  const w = familyWorld();

  const runMigration = (world) => {
    const c = deserialize(serialize(world));
    c.schemaVersion = 43; // 성씨 재계산 블록을 타게 한다
    migrateWorld(c);
    return new Map(c.sims.map((s) => [s.id, s.surname]));
  };

  const full = runMigration(w);

  // 부모를 인위적으로 '사망' 처리(배열에서 제거)한 뒤 같은 마이그레이션을 돌린다
  const pruned = deserialize(serialize(w));
  const parentIds = new Set(Object.values(pruned.parents ?? {}).flat());
  pruned.sims = pruned.sims.filter((s) => !parentIds.has(s.id));
  assert.ok(pruned.sims.length > 0, '검사할 심이 남아야 한다');
  assert.ok(parentIds.size > 0, '부모가 있는 세계여야 의미가 있다');
  const after = runMigration(pruned);

  for (const [id, sur] of after) {
    assert.equal(sur, full.get(id),
      `심 ${id}: 부모가 사라지자 성이 ${full.get(id)} → ${sur}로 바뀌었다`);
  }
});
