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

test('I-3b. 실재하는 **행동**만 분류에 올라 있다', async () => {
  // 이 검사가 없어서 Q가 존재하지 않는 행동 이름('treat', 실제로는 'see_doctor')을
  // 쓰고 있었고, 그 탓에 병원을 통째로 지워도 보건업 수요가 **0건**이었다.
  // 원장이 조용히 비어 있는 것은 버그가 없는 것처럼 보여서 더 위험하다.
  const { ACTIONS } = await import('../sim/constants.js');
  for (const s of KSIC) {
    for (const a of s.actions) {
      assert.ok(ACTIONS.includes(a), `${s.code}: 존재하지 않는 행동 '${a}'`);
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
    { kind: 'no_facility', placeId: 'see_doctor', severity: 40, sinceDay: 2, count: 7 },
    { kind: 'lonely', placeId: 'park1', severity: 30, sinceDay: 3, count: 31 },
  ];
  assert.equal(purchasingPowerGap(w), 415, '구매력 부족이 따로 집계돼야 한다');
  const byCode = new Map(industryStatus(w).map((s) => [s.code, s]));
  assert.equal(byCode.get('Q').complaintEvidence, 7, 'see_doctor 좌절은 보건업(Q) 수요다');
  assert.equal(byCode.get('I').complaintEvidence, 0, '돈이 없어서 못 먹은 것은 음식점업 수요가 아니다');
});

test('I-6. 수요 원장이 결정적이고 직렬화 왕복을 견딘다', () => {
  const w = createWorld(4242);
  recordIndustryDemand(w, 'see_doctor', 5);
  recordIndustryDemand(w, 'see_doctor', 6);
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
  assert.equal(industryOfAction('see_doctor'), 'Q');
  assert.equal(industryOfFacilityType('hospital'), 'Q');
  assert.equal(industryOfOccupation('doctor'), 'Q');
  assert.equal(industryOfAction('없는행동'), null);
  assert.equal(industryOfFacilityType('없는시설'), null);
});

test('I-9. 시설을 없애면 그 산업의 수요가 실제로 쌓인다 (109차 ①)', () => {
  // 예전 적립 조건은 `위급 후보가 하나도 없을 때 critical[0]만`이라 너무 좁아,
  // 병원·도서관·시장을 통째로 지운 세계를 40,000틱 돌려도 원장이 **비어 있었다**.
  // 절대값('대조군은 0건')으로 단언하면 세계의 다른 변화로 쉽게 깨진다 (110차 ④).
  // **같은 시드에서 도서관만 빼고 그 델타**를 본다.
  const control = createWorld(4242);
  advance(control, {}, 40000);

  const stripped = createWorld(4242);
  stripped.map.facilities = stripped.map.facilities.filter((f) => f.type !== 'library');
  advance(stripped, {}, 40000);

  const before = control.industryDemand.P?.unmet ?? 0;
  const after = stripped.industryDemand.P?.unmet ?? 0;
  assert.ok(after > before,
    `도서관을 뺐는데 교육(P) 수요가 안 늘었다: ${before} → ${after}`);
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


test('I-13. \'시설이 없다\'와 \'자리가 다 찼다\'를 구분한다 (110차 ①)', async () => {
  // actionBlockReason이 null을 돌려줘도 그 안에는 시설 부재·만석·도달 불가가 섞여 있다.
  // 셋을 한 원장에 넣으면 "병원을 지어라"와 "병원을 키워라"가 구분되지 않는다.
  const { facilityShortfallKind } = await import('../sim/tick.js');
  const w = createWorld(4242);
  const sim = w.sims[0];

  // ① 병원이 있고 자리도 비어 있다 → 부족이 아니다
  assert.equal(facilityShortfallKind(w, sim, 'see_doctor', 100), null);

  // ② 병원의 모든 자리를 다른 심이 예약한다 → 만석
  const hospital = w.map.facilities.find((f) => f.type === 'hospital');
  assert.ok(hospital, '이 세계에 병원이 있어야 한다');
  for (const res of hospital.resources) w.reservations[`${hospital.id}:${res.id}`] = 999; // resKey 형식
  assert.equal(facilityShortfallKind(w, sim, 'see_doctor', 100), 'capacity_full');

  // ③ 병원 자체를 없앤다 → 시설 부재
  const w2 = createWorld(4242);
  w2.map.facilities = w2.map.facilities.filter((f) => f.type !== 'hospital');
  assert.equal(facilityShortfallKind(w2, w2.sims[0], 'see_doctor', 100), 'no_facility');

  // ④ 시설을 쓰지 않는 행동은 판정 대상이 아니다
  assert.equal(facilityShortfallKind(w, sim, 'idle', 100), null);
});

test('I-14. 만석 원장이 부재 원장과 섞이지 않는다', () => {
  const w = createWorld(4242);
  advance(w, {}, 20000);
  // 두 원장 모두 순수 객체이고 정수 카운터다
  for (const led of [w.industryDemand, w.capacityShortfall]) {
    assert.ok(led !== null && typeof led === 'object' && !Array.isArray(led));
    for (const v of Object.values(led)) {
      const n = v.unmet ?? v.full;
      assert.ok(Number.isSafeInteger(n) && n > 0, `카운터가 정수 양수가 아니다: ${JSON.stringify(v)}`);
      assert.ok(Number.isSafeInteger(v.firstDay) && v.firstDay >= 0);
      assert.ok(Number.isSafeInteger(v.lastDay) && v.lastDay >= v.firstDay);
    }
  }
  const byCode = new Map(industryStatus(w).map((s) => [s.code, s]));
  for (const s of byCode.values()) {
    assert.ok(Number.isSafeInteger(s.capacityFull) && s.capacityFull >= 0);
    assert.ok(Number.isSafeInteger(s.housing) && s.housing >= 0);
  }
  // 주거는 L의 산업 시설이 아니지만 housing으로는 보고돼야 한다 (110차 ③)
  const l = byCode.get('L');
  assert.equal(l.facilities, 0, '집이 부동산업 시설로 세어졌다');
  assert.ok(l.housing > 0, '집이 30채나 있는데 housing이 0이다 — 부재와 주택 부족이 혼동된다');
});

test('I-15. 만석이 tick을 통해 실제로 적립된다 (110차 ④ 통합)', () => {
  // I-13은 판정 함수만 본다. 실제 `tick → 후보 탈락 → 원장 적립`까지 가는지 확인한다.
  // 원장은 **위급한 필요**에만 걸리므로(needCritical 미만) 위급해지는 행동을 써야 한다 —
  // 진료(see_doctor)는 위급 목록에 없어서 병원 자리를 없애도 원장이 안 탄다.
  // 외식 자리를 없애면 '식당은 서 있는데 앉을 데가 없다'가 된다.
  const w = createWorld(4242);
  const eateries = w.map.facilities.filter((f) => ['cafe', 'restaurant'].includes(f.type));
  assert.ok(eateries.length > 0, '이 세계에 외식 시설이 있어야 한다');
  for (const f of eateries) f.resources = []; // 건물은 서 있는데 자리가 없다
  advance(w, {}, 40000);

  const cap = w.capacityShortfall.I?.full ?? 0;
  const dem = w.industryDemand.I?.unmet ?? 0;
  assert.ok(cap > 0, `자리가 없는데 만석이 안 잡혔다 (만석 ${cap})`);
  assert.equal(dem, 0, `식당이 서 있는데 '시설 부재'로 잡혔다 (부재 ${dem})`);

  const st = industryStatus(w).find((s) => s.code === 'I');
  assert.ok(st.capacityFull > 0, '현황이 만석을 보고하지 않는다');
  assert.equal(st.directUnmet, 0);
  assert.ok(st.facilities > 0, '식당은 여전히 세어져야 한다');
});

test('I-16. 가상 자원을 쓰는 행동은 판정 대상이 아니다 (111차 ①②)', async () => {
  // 경찰 근무는 patrol.targets의 좌표를, 소방 대응은 firesite를 자원으로 쓴다.
  // 시설을 세어 판정하면 후보 생성 경로와 어긋나 원장이 거짓말을 한다.
  const { facilityShortfallKind } = await import('../sim/tick.js');
  const w = createWorld(4242);
  const sim = w.sims[0];
  assert.equal(facilityShortfallKind(w, sim, 'respond_fire', 100), null);

  const police = { ...sim, traits: { ...sim.traits, occupation: 'police' } };
  // 경찰서를 통째로 지워도 판정하지 않는다 — 판정할 수 없는 것이기 때문이다
  const w2 = createWorld(4242);
  w2.map.facilities = w2.map.facilities.filter((f) => f.type !== 'police_station');
  assert.equal(facilityShortfallKind(w2, police, 'work', 100), null);
  // 반면 일반 직업의 근무는 정상 판정된다
  const office = { ...sim, traits: { ...sim.traits, occupation: 'office_worker' } };
  const w3 = createWorld(4242);
  w3.map.facilities = w3.map.facilities.filter((f) => f.type !== 'office');
  assert.equal(facilityShortfallKind(w3, office, 'work', 100), 'no_facility');
});

test('I-17. 일상 수요가 위급 원장과 따로 쌓인다 (이슈 #87)', () => {
  // §22.18 원장은 위급한 필요(needCritical 미만)에만 걸려서, 진료처럼 굶어 죽지는 않지만
  // 하고 싶은 일은 영원히 안 잡혔다 — 병원을 통째로 지워도 보건업 수요가 0건이었다.
  // 진료 의사와 지불 능력을 고정해 자연 발병·경제 변화와 시설 부재를 분리한다.
  const patientWorld = () => {
    const w = createWorld(4242);
    w.lastDailyDay = 0;
    w.sims[0].sick = { kind: 'cold', untilTick: 999999 };
    w.sims[0].money = 10000;
    return w;
  };
  const control = patientWorld();
  advance(control, {}, 1);

  const razed = patientWorld();
  razed.map.facilities = razed.map.facilities.filter((f) => f.type !== 'hospital');
  advance(razed, {}, 1);

  const seated = patientWorld();
  seated.map.facilities.find((f) => f.type === 'hospital').resources = []; // 건물은 있고 자리만 없다
  advance(seated, {}, 1);

  const q = (w) => w.industryWant.Q ?? { noFacility: 0, capacityFull: 0 };
  assert.equal(q(control).noFacility, 0, '병원이 멀쩡한데 부재 수요가 잡혔다');
  assert.ok(q(razed).noFacility > 0, `병원을 철거했는데 부재 수요가 없다 (${q(razed).noFacility})`);
  assert.equal(q(razed).capacityFull, 0, '철거를 만석으로 세면 안 된다');
  assert.ok(q(seated).capacityFull > 0, `자리가 없는데 만석 수요가 없다 (${q(seated).capacityFull})`);
  assert.equal(q(seated).noFacility, 0, '건물이 서 있는데 부재로 세면 안 된다');

  // 위급 원장과 **섞이지 않는다**
  assert.equal(razed.industryDemand.Q, undefined, '일상 수요가 위급 원장으로 새어 들어갔다');
});

test('I-18. 일상 수요가 심·행동당 하루 1회로 묶인다', () => {
  // 빈도가 높아 묶지 않으면 원장이 틱 잡음이 된다 (§22.6 approach에서 같은 실수로
  // 거절 5,924건이 나왔다).
  const w = createWorld(4242);
  w.map.facilities = w.map.facilities.filter((f) => f.type !== 'hospital');
  const DAYS = 28;
  advance(w, {}, DAYS * 1440);
  const q = w.industryWant.Q ?? { noFacility: 0 };
  const pop = w.sims.length;
  assert.ok(q.noFacility <= pop * DAYS,
    `하루 1회 상한을 넘었다: ${q.noFacility} > ${pop}명 × ${DAYS}일`);
  // 그리고 가드가 실제로 심에 남아 있다
  for (const s of w.sims) {
    assert.ok(Number.isSafeInteger(s.wantDay), `심 ${s.id}에 wantDay가 없다`);
    assert.ok(Array.isArray(s.wantedActions), `심 ${s.id}에 wantedActions가 없다`);
  }
});

test('I-19. 일상 수요 원장도 왕복 고정점이다', () => {
  const w = createWorld(4242);
  w.map.facilities = w.map.facilities.filter((f) => f.type !== 'hospital');
  advance(w, {}, 30000);
  const w2 = deserialize(serialize(w));
  assert.equal(hashWorld(w), hashWorld(w2));
  advance(w, {}, 2000); advance(w2, {}, 2000);
  assert.equal(hashWorld(w), hashWorld(w2), '왕복 뒤 세계가 갈라졌다');
  assert.deepEqual(findNonFinite(w, 5), []);
});
