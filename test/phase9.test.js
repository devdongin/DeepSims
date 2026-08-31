// §17 사회 시뮬레이션 테스트: 이민·질병·선거·연애·동아리·사회적 영향
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld } from '../sim/index.js';
import { applyRomance, pairDeltaBonus as pairDeltaBonusRef } from '../sim/society.js';
import { migrateWorld } from '../sim/migrate.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import { workWindowFor as workWindowForRef, sleepWindowFor as sleepWindowForRef, slotMatches as slotMatchesRef, chronoValue as chronoValueRef } from '../sim/chrono.js';
import { buildDailyPlan as buildDailyPlanRef } from '../sim/planning.js';
import { circadianEnergyPct as circadianEnergyPctRef } from '../sim/chrono.js';

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
    const evs = advance(w, {}, 40 * 1440); // 일정 개인화로 위험 인자가 줄어 20일론 부족 (§17.13)
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
    w.logic.disease.basePermille = 0; // 일일 발병 차단 — 전염 경로만 격리 검증
    w.logic.disease.starvingBonusPermille = 0;
    w.logic.disease.rainBonusPermille = 0;
    w.logic.disease.lowEnergyBonusPermille = 0;
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
  w.treasury = 100000; // §17.15: 수당은 국고 지출 — 시드
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

test('S-16. v14+ 마이그레이션: required 없는 진행 중 프로젝트 백필 → 완공 재개', () => {
  const w = createWorld(SEED);
  // 구 빌드 세이브 재현: v13 + required 없는 프로젝트 (라이브 교착 시나리오)
  w.schemaVersion = 13;
  w.project = { plotId: 0, progress: 76420, type: 'cafe' };
  const m = migrateWorld(JSON.parse(JSON.stringify(w)));
  assert.equal(m.schemaVersion, SCHEMA_VERSION); // 백필 후 최신 버전
  assert.equal(m.project.required, 600, 'required 백필');
  // 완공 판정 재개: 다음 틱 4단계에서 progress ≥ required → facility_built
  idleAll(m, []);
  const evs = tick(m, []);
  assert.ok(evs.some((e) => e.type === 'facility_built'), '백필 즉시 완공');
  assert.equal(m.project, null);
});

test('S-17. §17.13 생활 리듬: 가중 야근·연속 오프셋·교대·수면 정규화·월간 자녀·연 노화', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  assert.ok(w.map.facilities.some((f) => f.id === 'police_station'), '경찰서');
  assert.ok(w.map.facilities.some((f) => f.id === 'fire_station'), '소방서');
  // 야근 의사확률: J(JP=0)가 P(JP=100)보다 확실히 잦다 + 길이는 그라데이션 (이분 컷 금지)
  const s = w.sims[0];
  const base = L.occupations.office_worker;
  let jDays = 0; let pDays = 0;
  for (let d = 0; d < 60; d++) {
    if (d % 7 >= 5) continue; // §17.17 주말 휴무 — 근무 창 없음
    s.traits = { ...s.traits, age: 30, occupation: 'office_worker', mbti: { ...s.traits.mbti, EI: 50, JP: 0 } };
    const wwJ = workWindowForRef(s, L, d);
    const offJ = Math.floor((chronoValueRef(s.traits) - 50) * L.chrono.maxShiftMin / 50);
    if (wwJ.to - (base.workEnd + offJ) > 0) {
      jDays++;
      assert.equal(wwJ.to - (base.workEnd + offJ), L.chrono.overtimeMinBase + L.chrono.overtimeMinSpan, 'JP=0 야근 길이');
    }
    s.traits.mbti.JP = 100;
    const wwP = workWindowForRef(s, L, d);
    const offP = Math.floor((chronoValueRef(s.traits) - 50) * L.chrono.maxShiftMin / 50);
    if (wwP.to - (base.workEnd + offP) > 0) pDays++;
  }
  assert.ok(jDays >= 18, `J형 야근 일수 (${jDays}/주중42일)`);
  assert.equal(pDays, 0, 'JP=100은 야근 확률 0');
  // 교대 랩 + 야간조 주간 수면 + 수면 창 자정 정규화 (from < 1440 항상)
  const p = w.sims[1];
  p.traits = { ...p.traits, age: 30, occupation: 'police' };
  const nw = workWindowForRef(p, L, 0);
  assert.equal(nw.from, L.chrono.nightShiftStart);
  assert.ok(nw.to > 1440, '자정 랩');
  assert.ok(slotMatchesRef(nw, 1400) && slotMatchesRef(nw, 100) && !slotMatchesRef(nw, 600), '랩 매칭');
  assert.equal(sleepWindowForRef(p, L).from, L.chrono.daySleepStart, '야간조 주간 수면');
  for (const sim2 of w.sims) {
    const sw = sleepWindowForRef({ ...sim2, traits: { ...sim2.traits, occupation: 'office_worker' } }, L);
    assert.ok(sw.from >= 0 && sw.from < 1440, '수면 창 정규화');
  }
  // 여가 의도가 EI 가중 의사확률로 날마다 변주 (이분 고정 금지)
  const intents = new Set();
  for (let d = 0; d < 30; d++) {
    const s3 = { ...w.sims[2], traits: { ...w.sims[2].traits, mbti: { ...w.sims[2].traits.mbti, EI: 50 } } };
    const plan = buildDailyPlanRef(s3, L, d);
    intents.add(plan.find((sl) => sl.intent === 'socialize' || sl.intent === 'play').intent);
  }
  assert.equal(intents.size, 2, 'EI=50이면 사교/혼자 놀기가 섞여 나온다');
  // 월간 자녀 + 연 단위 노화 회귀 (Codex 34차 major): day 30엔 나이 불변
  const w2 = createWorld(SEED);
  w2.logic = JSON.parse(JSON.stringify(w2.logic));
  w2.logic.family.childPermille = 1000;
  const [a2, b2] = w2.sims;
  b2.homeId = a2.homeId;
  w2.partners[0] = 1; w2.partners[1] = 0;
  w2.partnerStage[0] = 'married'; w2.partnerStage[1] = 'married';
  const agesBefore = w2.sims.map((x) => x.traits.age);
  idleAll(w2, []);
  w2.worldTick = 30 * 1440 - 1;
  w2.weather.day = 30; w2.lastDailyDay = 29; w2.lastPlanDay = 30;
  const evs = tick(w2, []);
  assert.ok(evs.some((e) => e.type === 'child_settled'), '월간 자녀 평가');
  assert.ok(!evs.some((e) => e.type === 'new_year'), 'day 30엔 새해 아님');
  w2.sims.slice(0, agesBefore.length).forEach((x, i) => assert.equal(x.traits.age, agesBefore[i], '노화는 연 단위'));
});


test('S-18. §17.15 경제 순환: 소득세 → 국고 → 복지·수당', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  // 근무 정산: 원천징수
  const s = w.sims.find((x) => x.traits.occupation !== 'retired' && x.traits.occupation !== 'student') ?? w.sims[0];
  idleAll(w, []);
  s.state = { kind: 'performing', action: 'work', facilityId: 'office', resourceId: 'desk0', path: [], ticksLeft: 1, pairedTicks: 0 };
  const before = s.money;
  const wage = Math.floor(L.actions.work.wageBase * L.occupations[s.traits.occupation].wagePct / 100);
  const net = Math.floor(wage * (100 - L.economy.taxPct) / 100);
  const evs = tick(w, []);
  const mc = evs.find((e) => e.type === 'money_changed' && e.simId === s.id);
  assert.ok(mc, '정산 발생');
  assert.equal(mc.payload.delta, net, '실수령 = 세후');
  assert.equal(mc.payload.tax, wage - net, '세금 필드');
  assert.equal(w.treasury, wage - net, '국고 적립');
  assert.equal(s.money, before + net);
  // 복지: 가난한 심 id asc, 캡·국고 한도
  const w2 = createWorld(SEED);
  w2.treasury = w2.logic.economy.welfareAmount * 2; // 2명분만
  for (const x of w2.sims) x.money = 0;
  idleAll(w2, []);
  w2.worldTick = 1440 - 1; w2.weather.day = 1; w2.lastDailyDay = 0; w2.lastPlanDay = 1;
  const evs2 = tick(w2, []);
  const wp = evs2.filter((e) => e.type === 'welfare_paid');
  assert.equal(wp.length, 2, '국고 한도만큼만');
  assert.deepEqual(wp.map((e) => e.simId), [0, 1], 'id asc');
  assert.equal(w2.treasury, 0);
  assert.equal(w2.sims[0].money, w2.logic.economy.welfareAmount);
});

test('S-19. §17.16 서카디언: 밤에 수면 압력↑, 야간조는 위상 반전, 감쇠 가중 적용', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  const s = { ...w.sims[0], traits: { ...w.sims[0].traits, occupation: 'office_worker', mbti: { ...w.sims[0].traits.mbti } } };
  // 위상 보정 전 원칙: 새벽(03시)이 정오(12시)보다 감쇠가 크다 — 개인 위상은 chronoValue에 따라 이동하므로
  // 같은 심에서 두 시각을 비교(오프셋 동일 소거)
  const pct3 = circadianEnergyPctRef(s, L, 3 * 60);
  const pct12 = circadianEnergyPctRef(s, L, 12 * 60);
  assert.ok(pct3 > pct12, `새벽 압력 > 정오 (${pct3} vs ${pct12})`);
  // 야간조(홀수 id 교대 직업): 12시간 위상 반전 — 정오 압력이 자정 압력보다 크다
  const n = { ...w.sims[1], id: 1, traits: { ...w.sims[1].traits, occupation: 'police' } };
  assert.ok(circadianEnergyPctRef(n, L, 12 * 60) > circadianEnergyPctRef(n, L, 0), '야간조 위상 반전');
});

test('S-20. §17.17 주중/주말: 주말 휴무·교대 유지·여가 확장', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  const s = { ...w.sims[0], traits: { ...w.sims[0].traits, age: 30, occupation: 'office_worker' } };
  assert.equal(workWindowForRef(s, L, 5), null, '토요일 휴무');
  assert.ok(workWindowForRef(s, L, 4) !== null, '금요일 근무');
  const p = { ...w.sims[1], id: 1, traits: { ...w.sims[1].traits, occupation: 'police' } };
  assert.ok(workWindowForRef(p, L, 6) !== null, '교대는 일요일도 근무');
  const b = { ...w.sims[2], traits: { ...w.sims[2].traits, age: 30, occupation: 'barista' } };
  assert.ok(workWindowForRef(b, L, 5) !== null, '카페는 주말도 연다');
  const planSat = buildDailyPlanRef(s, L, 5);
  assert.ok(!planSat.some((sl) => sl.intent === 'work'), '주말 계획에 근무 없음');
  const leisure = planSat.find((sl) => sl.intent === 'socialize' || sl.intent === 'play');
  assert.equal(leisure.from, L.plan.mealSlot1End, '주말 여가 확장');
});

test('S-21. §17.18 삼각 폐쇄: 공통 친구 수 비례 페어 보너스 (캡)', () => {
  const w = createWorld(SEED);
  const [a, b] = w.sims;
  const base = pairDeltaBonusRef(w, a, b);
  a.relTiers[5] = 'friend'; b.relTiers[5] = 'friend';
  assert.equal(pairDeltaBonusRef(w, a, b), base + w.logic.triad.perFriendBonus, '공통 친구 1');
  a.relTiers[6] = 'friend'; b.relTiers[6] = 'friend';
  a.relTiers[7] = 'friend'; b.relTiers[7] = 'friend';
  a.relTiers[8] = 'friend'; b.relTiers[8] = 'friend';
  assert.equal(pairDeltaBonusRef(w, a, b), base + w.logic.triad.perFriendBonus * w.logic.triad.maxCommon, '캡');
  b.relTiers[5] = 'acquaintance';
  assert.equal(pairDeltaBonusRef(w, a, b), base + w.logic.triad.perFriendBonus * 3, '양방 friend만 계수'); // 6,7,8
});
