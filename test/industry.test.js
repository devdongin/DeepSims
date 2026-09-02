// §22.18 산업 분류 + 수요 원장 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KSIC, KSIC_CODES, industryStatus, purchasingPowerGap, industryOfAction, industryOfFacilityType, industryOfOccupation, recordIndustryDemand } from '../sim/industry.js';
import { createWorld, advance, hashWorld, serialize, deserialize, findNonFinite } from '../sim/index.js';
import { OCCUPATIONS } from '../sim/traits.js';

test('I-1. KSIC 대분류 21개가 A~U로 빠짐없이 있다', () => {
  const expected = 'ABCDEFGHIJKLMNOPQRSTU'.split('');
  assert.deepEqual(KSIC_CODES, expected, '대분류가 빠지거나 순서가 다르다');
  for (const s of KSIC) {
    assert.ok(s.nameKo.length > 0, `${s.code}: 한국어 이름이 없다`);
    assert.ok(s.note.length > 0, `${s.code}: 이 분류가 지금 세계에서 어떤 상태인지 적혀 있어야 한다`);
  }
});

test('I-2. 분류가 겹치지 않는다 — 시설·직업·행동이 두 산업에 속하지 않는다', () => {
  for (const key of ['facilityTypes', 'occupations', 'actions']) {
    const seen = new Map();
    for (const s of KSIC) {
      for (const v of s[key]) {
        assert.equal(seen.has(v), false, `${key} '${v}'가 ${seen.get(v)}와 ${s.code} 양쪽에 있다`);
        seen.set(v, s.code);
      }
    }
  }
});

test('I-3. 실재하는 직업·시설만 분류에 올라 있다', () => {
  const w = createWorld(4242);
  const facTypes = new Set(w.map.facilities.map((f) => f.type));
  for (const s of KSIC) {
    for (const o of s.occupations) {
      assert.ok(OCCUPATIONS.includes(o), `${s.code}: 없는 직업 ${o}`);
    }
    for (const f of s.facilityTypes) {
      // 아직 안 지어진 시설 타입(factory 등)은 허용하되, zone 비용표에는 있어야 한다
      const known = facTypes.has(f) || f in (w.logic.zone?.costs ?? {});
      assert.ok(known, `${s.code}: 세계에도 zone 비용표에도 없는 시설 타입 ${f}`);
    }
  }
});

test('I-4. 산업 현황이 21개를 모두 상태와 함께 보고한다', () => {
  const w = createWorld(4242);
  advance(w, {}, 20000);
  const st = industryStatus(w);
  assert.equal(st.length, 21);
  for (const s of st) {
    assert.ok(['active', 'nascent', 'absent'].includes(s.state), `${s.code}: 알 수 없는 상태 ${s.state}`);
    assert.ok(Number.isSafeInteger(s.facilities) && s.facilities >= 0);
    assert.ok(Number.isSafeInteger(s.workers) && s.workers >= 0);
    assert.ok(Number.isSafeInteger(s.directUnmet) && s.directUnmet >= 0);
    assert.ok(Number.isSafeInteger(s.complaintEvidence) && s.complaintEvidence >= 0);
    assert.ok(Number.isSafeInteger(s.participants) && s.participants >= 0);
  }
  // 상태는 **불변식**으로 검사한다. 특정 분류를 콕 집으면 인구가 적은 세계에서
  // 깨진다 — 실제로 13명짜리 세계에는 시청·경찰서·소방서가 있는데 공무원이 하나도
  // 없어 O가 nascent다. 그건 버그가 아니라 그 마을의 사실이다.
  for (const s of st) {
    if (s.facilities > 0 && s.workers > 0) {
      assert.equal(s.state, 'active', `${s.code}: 시설 ${s.facilities}·종사자 ${s.workers}인데 ${s.state}`);
    }
    const meta = KSIC.find((k) => k.code === s.code);
    if (s.facilities === 0 && s.workers === 0 && meta.actions.length === 0) {
      assert.equal(s.state, 'absent', `${s.code}: 아무것도 없는데 ${s.state}`);
    }
  }
  // 21개 중 적어도 하나는 실제로 돌아가고 있어야 한다 (전부 absent면 매핑이 깨진 것)
  assert.ok(st.some((s) => s.state === 'active'), '활성 산업이 하나도 없다 — 매핑이 끊겼다');
});

test('I-5. 구매력 부족은 산업 수요와 **분리**돼야 한다', () => {
  // 살아 있는 마을의 실제 값이 이 구분의 이유다: no_facility 0건, no_money@eat 415건.
  // 둘을 섞었다면 '식당을 더 지어라'는 정반대 처방이 나왔을 것이다.
  const w = createWorld(4242);
  w.complaints = [
    { kind: 'no_money', placeId: 'eat', severity: 100, sinceDay: 1, count: 415 },
    { kind: 'no_facility', placeId: 'treat', severity: 40, sinceDay: 2, count: 7 },
    { kind: 'lonely', placeId: 'park1', severity: 30, sinceDay: 3, count: 31 },
  ];
  assert.equal(purchasingPowerGap(w), 415, '구매력 부족이 따로 집계돼야 한다');
  const byCode = new Map(industryStatus(w).map((s) => [s.code, s]));
  assert.equal(byCode.get('Q').complaintEvidence, 7, 'treat 좌절은 보건업(Q) 수요다');
  assert.equal(byCode.get('I').complaintEvidence, 0, '돈이 없어서 못 먹은 것은 음식점업 수요가 아니다');
});

test('I-6. 수요 원장이 결정적이고 직렬화 왕복을 견딘다', () => {
  const w = createWorld(4242);
  recordIndustryDemand(w, 'treat', 5);
  recordIndustryDemand(w, 'treat', 6);
  recordIndustryDemand(w, 'read', 6);
  assert.equal(w.industryDemand.Q.unmet, 2);
  assert.equal(w.industryDemand.Q.firstDay, 5);
  assert.equal(w.industryDemand.Q.lastDay, 6);
  assert.equal(w.industryDemand.P.unmet, 1);
  // 분류에 없는 행동은 아무것도 하지 않는다
  assert.equal(recordIndustryDemand(w, 'idle', 7), null);

  const w2 = deserialize(serialize(w));
  assert.equal(hashWorld(w), hashWorld(w2), '원장이 왕복에서 바뀐다');
  assert.deepEqual(findNonFinite(w, 5), [], '직렬화가 삼키는 값이 있다');
});

test('I-7. 산업을 추가해도 세계 진행이 결정적이다', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 20000); advance(b, {}, 20000);
  assert.equal(hashWorld(a), hashWorld(b));
  // 조회는 세계를 바꾸지 않는다
  const before = hashWorld(a);
  industryStatus(a); purchasingPowerGap(a);
  assert.equal(hashWorld(a), before, '현황 조회가 세계를 바꿨다');
});

test('I-8. 행동·시설·직업 조회가 서로 맞는다', () => {
  assert.equal(industryOfAction('eat'), 'I');
  assert.equal(industryOfAction('treat'), 'Q');
  assert.equal(industryOfFacilityType('hospital'), 'Q');
  assert.equal(industryOfOccupation('doctor'), 'Q');
  assert.equal(industryOfAction('없는행동'), null);
  assert.equal(industryOfFacilityType('없는시설'), null);
});

test('I-9. 시설을 없애면 그 산업의 수요가 실제로 쌓인다 (109차 ①)', () => {
  // 예전 적립 조건은 `위급 후보가 하나도 없을 때 critical[0]만`이라 너무 좁아,
  // 병원·도서관·시장을 통째로 지운 세계를 40,000틱 돌려도 원장이 **비어 있었다**.
  const control = createWorld(4242);
  advance(control, {}, 40000);
  assert.deepEqual(control.industryDemand, {}, '시설이 온전한데 수요가 잡혔다');

  const stripped = createWorld(4242);
  stripped.map.facilities = stripped.map.facilities
    .filter((f) => !['hospital', 'library', 'market'].includes(f.type));
  advance(stripped, {}, 40000);
  const codes = Object.keys(stripped.industryDemand).sort();
  assert.ok(codes.length > 0, '시설을 지웠는데 수요가 하나도 안 잡힌다');
  assert.ok(codes.includes('P'), `도서관을 지웠는데 교육(P) 수요가 없다: ${codes.join(',')}`);
  const p = stripped.industryDemand.P;
  assert.ok(Number.isSafeInteger(p.unmet) && p.unmet > 0);
  assert.ok(p.firstDay >= 0 && p.lastDay >= p.firstDay, '날짜 범위가 뒤집혔다');
});

test('I-10. 사유가 붙은 실패는 시설 수요로 세지 않는다 (오분류 회귀)', () => {
  // 필터가 없을 때 집밥 실패(장바구니 0)가 **196건이나** 가구내 산업(T) 수요로
  // 잘못 잡혔다. 돈·영업시간·장바구니·불필요는 전부 '갈 곳이 없다'와 다르다.
  const w = createWorld(4242);
  advance(w, {}, 40000);
  assert.equal(w.industryDemand.T, undefined,
    `집밥 실패가 가구내 산업 수요로 잡혔다: ${JSON.stringify(w.industryDemand.T)}`);
  assert.equal(w.industryDemand.I, undefined, '돈이 없어 못 먹은 것이 음식점업 수요로 잡혔다');
});

test('I-11. 학생은 이용자이지 종사자가 아니다 (109차 ②)', () => {
  // student를 종사자로 세면 **고용이 하나도 없어도** 학교가 active가 된다.
  const w = createWorld(4242);
  const byCode = new Map(industryStatus(w).map((s) => [s.code, s]));
  const p = byCode.get('P');
  const students = w.sims.filter((s) => s.traits.occupation === 'student').length;
  const teachers = w.sims.filter((s) => s.traits.occupation === 'teacher').length;
  assert.equal(p.workers, teachers, '학생이 종사자로 세어졌다');
  assert.equal(p.participants, students, '학생이 이용자로 세어지지 않았다');
  // 주거는 산업이 아니다 — 집 30채가 부동산업 활성으로 보고되면 안 된다
  const l = byCode.get('L');
  assert.equal(l.facilities, 0, '집이 부동산업 시설로 세어졌다 — 거래가 없는 세계다');
  assert.notEqual(l.state, 'active', '거래도 종사자도 없는데 부동산업이 활성이다');
});

test('I-12. 손상된 수요 원장을 마이그레이션이 고친다 (109차 ⑤)', async () => {
  const { migrateWorld } = await import('../sim/migrate.js');
  for (const bad of [[], 'nope', 42, null]) {
    const w = createWorld(4242);
    w.industryDemand = bad;
    w.schemaVersion = 44;
    migrateWorld(w);
    assert.ok(w.industryDemand !== null && typeof w.industryDemand === 'object'
      && !Array.isArray(w.industryDemand), `손상 값 ${JSON.stringify(bad)}이 안 고쳐졌다`);
  }
  // 항목 하나만 깨진 경우: 그 항목만 버리고 나머지는 지킨다
  const w = createWorld(4242);
  w.industryDemand = { P: { unmet: 3, firstDay: 1, lastDay: 2 }, Q: { unmet: -1 }, R: 'x' };
  w.schemaVersion = 44;
  migrateWorld(w);
  assert.deepEqual(Object.keys(w.industryDemand), ['P'], '멀쩡한 항목까지 버렸거나 깨진 항목이 남았다');
});
