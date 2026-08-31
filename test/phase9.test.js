// §17 사회 시뮬레이션 테스트: 이민·질병·선거·연애·동아리·사회적 영향
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld } from '../sim/index.js';
import { applyRomance } from '../sim/society.js';
import { migrateWorld } from '../sim/migrate.js';

const SEED = 7777;

function idleAll(w, except = []) {
  for (const s of w.sims) {
    if (!except.includes(s.id)) s.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: 999999, pairedTicks: 0 };
  }
}
function resetIdle(s) {
  s.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
}
function pairAt(w, ids, facId = 'park', ticks = 200) {
  const fac = w.map.facilities.find((f) => f.id === facId);
  ids.forEach((id, i) => {
    const s = w.sims[id];
    const spot = fac.resources[i];
    s.state = { kind: 'performing', action: 'socialize', facilityId: facId, resourceId: spot.id, path: [], ticksLeft: ticks, pairedTicks: 0 };
    s.x = spot.x; s.y = spot.y;
    w.reservations[`${facId}:${spot.id}`] = id;
  });
}

test('S-1. 질병: 위험 인자에 따른 발병 + 전염 + 자연 치유, 전부 결정적', () => {
  const run = () => {
    const w = createWorld(SEED);
    const evs = advance(w, {}, 20 * 1440);
    return {
      sick: evs.filter((e) => e.type === 'fell_sick').map((e) => `${e.tick}:${e.simId}`).join(','),
      rec: evs.filter((e) => e.type === 'recovered').length,
    };
  };
  const a = run(), b = run();
  assert.deepEqual(a, b, '결정적');
  assert.ok(a.sick.length > 0, '발병 발생');
  assert.ok(a.rec > 0, '치유 발생');
});

test('S-2. 아픈 심은 진료가 최우선 후보가 된다', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  s.traits = { ...s.traits, age: 40, occupation: 'freelancer' };
  s.needs = { hunger: 8000, energy: 8000, social: 8000, fun: 8000 };
  s.money = 5000; s.mood = 0;
  s.sick = { kind: 'cold', untilTick: 999999 };
  tick(w, []);
  assert.equal(s.state.action, 'see_doctor', `아프면 병원 (실제: ${s.state.action})`);
  // 완치 정산
  const hosp = w.map.facilities.find((f) => f.id === 'hospital');
  s.state = { kind: 'performing', action: 'see_doctor', facilityId: 'hospital', resourceId: 'clinic0', path: [], ticksLeft: 1, pairedTicks: 0 };
  s.x = hosp.resources[0].x; s.y = hosp.resources[0].y;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'recovered' && e.payload.how === 'doctor'));
  assert.equal(s.sick, null);
});

test('S-3. 전염: 페어링에서 감염이 옮는다 (결정적 드로우)', () => {
  const run = () => {
    const w = createWorld(SEED);
    w.logic = JSON.parse(JSON.stringify(w.logic));
    w.logic.disease.contagionPermille = 1000; // 확정 전염으로 경로 검증
    idleAll(w, []);
    w.sims[0].sick = { kind: 'cold', untilTick: 999999 };
    pairAt(w, [0, 1]);
    const evs = tick(w, []);
    return evs.filter((e) => e.type === 'fell_sick').map((e) => e.simId).join(',');
  };
  assert.equal(run(), '1', '상대가 감염');
  assert.equal(run(), run(), '결정적');
});

test('S-4. 선거: 인기 기반 후보·투표·시장, 수당과 공사 가속', () => {
  const w = createWorld(SEED);
  // 호감도 조작: 심 3을 모두가 좋아하고, 심 5를 절반이 좋아함
  for (const o of w.sims) {
    if (o.id !== 3) w.affinity[o.id][3] = 8000;
    if (o.id !== 5 && o.id % 2 === 0) w.affinity[o.id][5] = 7000;
  }
  idleAll(w, []);
  // 30일 경계로 점프해 선거 유발
  w.worldTick = 30 * 1440 - 1;
  w.weather.day = 30; // 날씨 드로우 소비 방지(테스트 단순화)
  const evs = tick(w, []);
  const el = evs.find((e) => e.type === 'election');
  assert.ok(el, '선거 발생');
  assert.equal(el.simId, 3, '최고 인기 당선');
  assert.equal(w.mayorId, 3);
  // 수당 (같은 일일 평가에서 지급)
  assert.ok(evs.some((e) => e.type === 'money_changed' && e.simId === 3 && e.payload.action === 'mayor'));
  // 시장 재임 중 프로젝트 required 감소
  w.project = null;
  for (const p of w.plots) p.used = false;
  w.lastPlanDay = -1;
  const PLAYER = { name: '동', gender: 'X', age: 30, mbti: { EI: 50, SN: 50, TF: 50, JP: 50 }, occupation: 'freelancer' };
  const evs2 = tick(w, [{ sequence: 0, command: 'create_player', payload: PLAYER }]);
  const pr = evs2.find((e) => e.type === 'project_started');
  assert.ok(pr && pr.payload.required === Math.floor(600 * 90 / 100), `시장 가속 (${pr?.payload.required})`);
});

test('S-5. 이민: 빈 침대가 있어야 오고, 인구가 늘고, 이웃 기억이 생긴다', () => {
  const w = createWorld(SEED);
  // 침대 여유 만들기: house0에 침대 2 증축 가정
  const h0 = w.map.facilities.find((f) => f.id === 'house0');
  h0.resources.push({ id: 'bed2', kind: 'bed', x: h0.x + 2, y: h0.y + 2 });
  idleAll(w, []);
  const iv = w.logic.society.immigrationIntervalDays; // 주기 하드코딩 금지 (페이싱 튜닝 내성)
  w.worldTick = iv * 1440 - 1; // 이민 주기 경계
  w.weather.day = iv;
  const popBefore = w.sims.length;
  const evs = tick(w, []);
  const im = evs.find((e) => e.type === 'immigrated');
  assert.ok(im, '이민 발생');
  assert.equal(w.sims.length, popBefore + 1);
  assert.equal(w.sims[w.sims.length - 1].name, '재현');
  assert.ok(w.sims[0].memories.some((m) => m.kind === 'new_neighbor'), '이웃 기억');
  assert.equal(w.affinity.length, w.sims.length, '매트릭스 확장');
});

test('S-6. 연애 수명주기: 교제 → 결혼(+이주) → (별도) 파혼', () => {
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  // 교제 조건 충족
  w.affinity[0][1] = 7000; w.affinity[1][0] = 7000;
  w.interactions[0][1] = 150; w.interactions[1][0] = 150;
  idleAll(w, []);
  // a의 회고 유발: 수면 진입
  const home = w.map.facilities.find((f) => f.id === a.homeId);
  a.state = { kind: 'performing', action: 'sleep', facilityId: a.homeId, resourceId: 'bed0', path: [{ x: home.resources[0].x, y: home.resources[0].y }], ticksLeft: 5, pairedTicks: 0 };
  a.state.kind = 'walking';
  a.x = home.resources[0].x - 1; a.y = home.resources[0].y;
  w.reservations[`${a.homeId}:bed0`] = 0;
  a.lastReflectedDay = -1;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'started_dating'), '교제 시작');
  assert.equal(w.partners[0], 1);
  assert.equal(w.partnerStage[1], 'dating');
  // 결혼 조건 충족 후 다음 날 회고
  w.affinity[0][1] = 9500; w.affinity[1][0] = 9500;
  w.interactions[0][1] = 400; w.interactions[1][0] = 400;
  a.lastReflectedDay = -1;
  a.state = { kind: 'walking', action: 'sleep', facilityId: a.homeId, resourceId: 'bed0', path: [{ x: home.resources[0].x, y: home.resources[0].y }], ticksLeft: 5, pairedTicks: 0 };
  a.x = home.resources[0].x - 1; a.y = home.resources[0].y;
  const evs2 = tick(w, []);
  assert.ok(evs2.some((e) => e.type === 'married'), '결혼');
  assert.equal(w.partnerStage[0], 'married');
  // 파혼 (다른 페어로)
  const w2 = createWorld(SEED);
  w2.partners[2] = 3; w2.partners[3] = 2;
  w2.partnerStage[2] = 'dating'; w2.partnerStage[3] = 'dating';
  w2.affinity[2][3] = 1000; // < breakup
  idleAll(w2, []);
  const c = w2.sims[2];
  const home2 = w2.map.facilities.find((f) => f.id === c.homeId);
  c.state = { kind: 'walking', action: 'sleep', facilityId: c.homeId, resourceId: 'bed0', path: [{ x: home2.resources[0].x, y: home2.resources[0].y }], ticksLeft: 5, pairedTicks: 0 };
  c.x = home2.resources[0].x - 1; c.y = home2.resources[0].y;
  w2.reservations[`${c.homeId}:bed0`] = 2;
  c.lastReflectedDay = -1;
  const evs3 = tick(w2, []);
  assert.ok(evs3.some((e) => e.type === 'broke_up'), '파혼');
  assert.equal(w2.partners[2], undefined);
});

test('S-7. 동아리: 습관 임계 가입 + 주간 모임 토큰(멤버 즉시 인지)', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  s.habit['read:library'] = w.logic.club.habitMin;
  w.sims[1].habit['read:library'] = w.logic.club.habitMin;
  idleAll(w, []);
  // 가입은 회고에서
  const home = w.map.facilities.find((f) => f.id === s.homeId);
  for (const id of [0, 1]) {
    const x = w.sims[id];
    const hm = w.map.facilities.find((f) => f.id === x.homeId);
    x.state = { kind: 'walking', action: 'sleep', facilityId: x.homeId, resourceId: `bed${id % 2}`, path: [{ x: hm.resources[id % 2].x, y: hm.resources[id % 2].y }], ticksLeft: 5, pairedTicks: 0 };
    x.x = hm.resources[id % 2].x - 1; x.y = hm.resources[id % 2].y;
    x.lastReflectedDay = -1;
  }
  const evs = tick(w, []);
  assert.equal(evs.filter((e) => e.type === 'joined_club').length, 2, '두 명 가입');
  assert.deepEqual(w.clubs.book_club, [0, 1]);
  // 주간 모임: book_club dow 2 tod 1200
  w.worldTick = (7 * 5 + 2) * 1440 + 1199; // day 37 (37%7=2), tod 1200
  w.weather.day = 37; w.lastDailyDay = 37; w.lastPlanDay = 37;
  const evs2 = tick(w, []);
  const tok = evs2.find((e) => e.type === 'token_created' && e.payload.clubId === 'book_club');
  assert.ok(tok, '모임 토큰');
  assert.ok(w.sims[0].knownTokens.length > 0 && w.sims[1].knownTokens.length > 0, '멤버 즉시 인지');
});

test('S-8. 험담의 사회적 영향: 청자의 대상 호감도가 실제로 변한다', () => {
  const w = createWorld(SEED);
  w.logic = JSON.parse(JSON.stringify(w.logic));
  w.logic.conversation.topicWeights = { food: 0, gossip: 100, memory_share: 0, weather: 0, work_gripe: 0 };
  // 화자(0)가 대상(5)을 몹시 싫어함 → 부정 험담 → 청자(1)의 5 호감 하락
  w.sims[0].relTiers[5] = 'rival';
  w.affinity[0][5] = -8000;
  idleAll(w, []);
  pairAt(w, [0, 1]);
  const before = w.affinity[1][5];
  let gossiped = false;
  for (let i = 0; i < 100 && !gossiped; i++) {
    const evs = tick(w, []);
    gossiped = evs.some((e) => e.type === 'conversation' && e.payload.topic === 'gossip' && e.simId === 0);
  }
  assert.ok(gossiped, '험담 발생');
  assert.ok(w.affinity[1][5] < before, `청자 인식 하락 (${before} → ${w.affinity[1][5]})`);
});

test('S-9. 직업별 근무지: doctor는 병원, barista는 카페로 출근', () => {
  const w = createWorld(SEED);
  const [d, ba] = w.sims;
  d.traits = { ...d.traits, age: 40, occupation: 'doctor' };
  ba.traits = { ...ba.traits, age: 40, occupation: 'barista' };
  idleAll(w, []);
  resetIdle(d); resetIdle(ba);
  w.reservations = {};
  for (const s of [d, ba]) { s.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 }; s.money = 0; s.mood = 0; }
  w.worldTick = 599; // 10:00 — 둘 다 근무 가능 시간
  tick(w, []);
  assert.equal(d.state.action, 'work');
  assert.equal(d.state.facilityId, 'hospital');
  assert.equal(ba.state.action, 'work');
  assert.equal(ba.state.facilityId, 'cafe');
});

test('S-10. 전 사회 기능 분할 불변성 (30일) + 결정성', () => {
  const a = createWorld(SEED);
  advance(a, {}, 30 * 1440);
  const b = createWorld(SEED);
  for (const n of [10000, 1, 20000, 13199]) advance(b, {}, n); // 합 43200
  assert.equal(hashWorld(a), hashWorld(b));
});

test('S-11. §17.9: 결혼식 잔치 토큰·유세·새해 (결정적)', () => {
  // 결혼식: S-6과 같은 세팅으로 married 유발 → 잔치 토큰이 친구들에게 인지되는지
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  w.partners[0] = 1; w.partners[1] = 0;
  w.partnerStage[0] = 'dating'; w.partnerStage[1] = 'dating';
  w.affinity[0][1] = 9500; w.affinity[1][0] = 9500;
  w.interactions[0][1] = 400; w.interactions[1][0] = 400;
  // 하객: 티어는 회고가 원천에서 재계산하므로 원천을 설정 (aff≥3000 && inter≥60 → friend)
  w.affinity[0][4] = 5000; w.interactions[0][4] = 100;
  idleAll(w, []);
  const home = w.map.facilities.find((f) => f.id === a.homeId);
  a.state = { kind: 'walking', action: 'sleep', facilityId: a.homeId, resourceId: 'bed0', path: [{ x: home.resources[0].x, y: home.resources[0].y }], ticksLeft: 5, pairedTicks: 0 };
  a.x = home.resources[0].x - 1; a.y = home.resources[0].y;
  w.reservations[`${a.homeId}:bed0`] = 0;
  a.lastReflectedDay = -1;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'married'));
  const tok = evs.find((e) => e.type === 'token_created' && e.payload.wedding);
  assert.ok(tok, '잔치 토큰');
  assert.ok(w.sims[4].knownTokens.includes(tok.payload.tokenId), '하객 즉시 인지');
  assert.equal(w.recentCouples[w.recentCouples.length - 1].kind, 'married');

  // 유세: D-3에 캐시, 선거일에 클리어 후 선거
  const w2 = createWorld(SEED);
  for (const o of w2.sims) if (o.id !== 3) w2.affinity[o.id][3] = 8000;
  idleAll(w2, []);
  w2.worldTick = 27 * 1440 - 1; // day 27 = D-3
  w2.weather.day = 27;
  tick(w2, []);
  assert.ok(w2.campaigners.includes(3), '유세 시작');
  w2.worldTick = 30 * 1440 - 1;
  w2.weather.day = 30; w2.lastDailyDay = 29;
  const evs2 = tick(w2, []);
  assert.ok(evs2.some((e) => e.type === 'election'));
  assert.deepEqual(w2.campaigners, [], '선거일 클리어');

  // 새해: 나이·졸업·은퇴
  const w3 = createWorld(SEED);
  w3.sims[0].traits = { ...w3.sims[0].traits, age: 25, occupation: 'student' };
  w3.sims[1].traits = { ...w3.sims[1].traits, age: 64, occupation: 'office_worker' };
  idleAll(w3, []);
  w3.worldTick = 360 * 1440 - 1;
  w3.weather.day = 360;
  const evs3 = tick(w3, []);
  assert.ok(evs3.some((e) => e.type === 'new_year'));
  assert.ok(evs3.some((e) => e.type === 'graduated' && e.simId === 0));
  assert.ok(evs3.some((e) => e.type === 'retired_now' && e.simId === 1));
  assert.equal(w3.sims[0].traits.occupation, 'office_worker');
  assert.equal(w3.sims[1].traits.occupation, 'retired');
});

test('S-12. §17.10: 실내 여가·축제', () => {
  const w = createWorld(SEED);
  for (const id of ['restaurant', 'gym', 'cinema']) {
    assert.ok(w.map.facilities.some((f) => f.id === id), id);
  }
  // 비 오는 날: gym에서 exercise 후보가 실내라 무페널티 (play도 cinema 가능)
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  s.traits = { ...s.traits, age: 40, occupation: 'freelancer', mbti: { EI: 50, SN: 50, TF: 0, JP: 50 } }; // T형: 운동 성향
  s.needs = { hunger: 9500, energy: 9500, social: 9500, fun: 9500 };
  s.money = 10000; s.mood = -8000; // coping → exercise 예상 (T형)
  w.weather = { day: 0, kind: 'rain' };
  tick(w, []);
  assert.equal(s.state.action, 'exercise');
  // coping은 거리 무시 den=16이라 시설은 타이브레이크: park가 gym보다 facilityId 사전순 뒤 → gym
  assert.equal(s.state.facilityId, 'gym', `실내 운동 (실제: ${s.state.facilityId})`);
  // 축제: day 90 경계
  const w2 = createWorld(SEED);
  idleAll(w2, []);
  w2.worldTick = 90 * 1440 - 1;
  w2.weather.day = 90; w2.lastDailyDay = 89;
  const evs = tick(w2, []);
  assert.ok(evs.some((e) => e.type === 'festival'), '축제');
  assert.ok(w2.sims.every((x) => x.knownTokens.length > 0), '전 주민 인지');
});

test('S-13. §17.11 가족: 동거 부부 새해 자녀 정착 + 가족 대화·보너스', () => {
  const run = () => {
    const w = createWorld(SEED);
    w.logic = JSON.parse(JSON.stringify(w.logic));
    w.logic.family.childPermille = 1000; // 확정 정착으로 경로 검증
    // 동거 married 부부 구성 + 빈 침대
    const [a, b] = w.sims;
    b.homeId = a.homeId;
    w.partners[0] = 1; w.partners[1] = 0;
    w.partnerStage[0] = 'married'; w.partnerStage[1] = 'married';
    const home = w.map.facilities.find((f) => f.id === a.homeId);
    home.resources.push({ id: 'bed2', kind: 'bed', x: home.x + 2, y: home.y + 2 });
    idleAll(w, []);
    w.worldTick = 360 * 1440 - 1;
    w.weather.day = 360; w.lastDailyDay = 359; w.lastPlanDay = 360;
    const evs = tick(w, []);
    return { evs, w };
  };
  const { evs, w } = run();
  const born = evs.find((e) => e.type === 'child_settled');
  assert.ok(born, '자녀 정착');
  assert.deepEqual([born.payload.parentA, born.payload.parentB], [0, 1]);
  const child = w.sims[w.sims.length - 1];
  assert.equal(child.traits.age, 15, '새해(나이+1)가 먼저, 정착이 나중 — 15 유지');
  const { w: w2 } = run();
  assert.equal(hashWorld(w), hashWorld(w2), '결정적');
  assert.equal(w.parents[child.id]?.length, 2);
  assert.equal(w.affinity[child.id][0], 5000);
});

test('S-14. §17.11 개정: 별거 부부 신혼집 이사 + 별거 수요 건설 트리거', () => {
  // ⓑ 신혼집: lo 집도 만원 → 빈 침대 2개 집으로 부부가 함께 이사
  const w = createWorld(SEED);
  const a = w.sims[0]; const b = w.sims[2];
  w.partners[0] = 2; w.partners[2] = 0;
  w.partnerStage[0] = 'married'; w.partnerStage[2] = 'married';
  assert.notEqual(a.homeId, b.homeId, '전제: 별거');
  // 모든 집 만원(기본 상태) + 빈 집 하나 추가
  w.map.facilities.push({
    id: 'house9', type: 'house', x: 2, y: 2, w: 6, h: 5, door: { x: 4, y: 6 },
    resources: [{ id: 'bed0', kind: 'bed', x: 3, y: 3 }, { id: 'bed1', kind: 'bed', x: 5, y: 3 }],
    extraBedSlots: [{ x: 4, y: 4 }, { x: 5, y: 4 }],
  });
  const evs = [];
  applyRomance(w, a, 0, (type, simId, payload) => evs.push({ type, simId, payload }));
  const moves = evs.filter((e) => e.type === 'moved_home');
  assert.equal(moves.length, 2, '부부 동반 이사');
  assert.equal(a.homeId, 'house9');
  assert.equal(b.homeId, 'house9');

  // 별거 수요 건설 트리거: 인구=침대여도 별거 부부 있으면 house 프로젝트
  const w2 = createWorld(SEED);
  w2.partners[0] = 2; w2.partners[2] = 0;
  w2.partnerStage[0] = 'married'; w2.partnerStage[2] = 'married';
  idleAll(w2, []);
  w2.worldTick = 1440 - 1; w2.weather.day = 1; w2.lastDailyDay = 0; w2.lastPlanDay = 0;
  const evs2 = tick(w2, []);
  const proj = evs2.find((e) => e.type === 'project_started');
  assert.ok(proj, '별거 수요로 프로젝트 시작');
  assert.equal(proj.payload.type, 'house');
});

test('S-15. §17.11 개정: 증축 여력만으로 자녀 성립(빈 침대 없어도)', () => {
  const w = createWorld(SEED);
  w.logic = JSON.parse(JSON.stringify(w.logic));
  w.logic.family.childPermille = 1000;
  const [a, b] = w.sims;
  b.homeId = a.homeId; // 동거 (침대 2/거주 2 — 빈 침대 없음, 예비 슬롯 2)
  w.partners[0] = 1; w.partners[1] = 0;
  w.partnerStage[0] = 'married'; w.partnerStage[1] = 'married';
  idleAll(w, []);
  w.worldTick = 360 * 1440 - 1;
  w.weather.day = 360; w.lastDailyDay = 359; w.lastPlanDay = 360;
  const evs = tick(w, []);
  assert.ok(evs.some((e) => e.type === 'child_settled'), '증축 여력으로 자녀 성립');
  // maxExtraBeds=0이면 스킵
  const w2 = createWorld(SEED);
  w2.logic = JSON.parse(JSON.stringify(w2.logic));
  w2.logic.family.childPermille = 1000;
  w2.logic.build.maxExtraBeds = 0;
  const [a2, b2] = w2.sims;
  b2.homeId = a2.homeId;
  w2.partners[0] = 1; w2.partners[1] = 0;
  w2.partnerStage[0] = 'married'; w2.partnerStage[1] = 'married';
  idleAll(w2, []);
  w2.worldTick = 360 * 1440 - 1;
  w2.weather.day = 360; w2.lastDailyDay = 359; w2.lastPlanDay = 360;
  const evs2 = tick(w2, []);
  assert.ok(!evs2.some((e) => e.type === 'child_settled'), 'maxExtraBeds=0 → 스킵');
});

test('S-16. v14 마이그레이션: required 없는 진행 중 프로젝트 백필 → 완공 재개', () => {
  const w = createWorld(SEED);
  // 구 빌드 세이브 재현: v13 + required 없는 프로젝트 (라이브 교착 시나리오)
  w.schemaVersion = 13;
  w.project = { plotId: 0, progress: 76420, type: 'cafe' };
  const m = migrateWorld(JSON.parse(JSON.stringify(w)));
  assert.equal(m.schemaVersion, 14);
  assert.equal(m.project.required, 600, 'required 백필');
  // 완공 판정 재개: 다음 틱 4단계에서 progress ≥ required → facility_built
  idleAll(m, []);
  const evs = tick(m, []);
  assert.ok(evs.some((e) => e.type === 'facility_built'), '백필 즉시 완공');
  assert.equal(m.project, null);
});
