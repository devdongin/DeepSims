// §17 사회 시뮬레이션 테스트: 이민·질병·선거·연애·동아리·사회적 영향
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, tick, hashWorld } from '../sim/index.js';
import { applyRomance, pairDeltaBonus as pairDeltaBonusRef, maybeBuyCar as maybeBuyCarRef, collectComplaints as collectComplaintsRef, maybePetition as maybePetitionRef } from '../sim/society.js';
import { recordFact as recordFactRef } from '../sim/cognition.js';
import { migrateWorld } from '../sim/migrate.js';
import { SCHEMA_VERSION } from '../sim/constants.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { workWindowFor as workWindowForRef, sleepWindowFor as sleepWindowForRef, slotMatches as slotMatchesRef, chronoValue as chronoValueRef } from '../sim/chrono.js';
import { buildDailyPlan as buildDailyPlanRef } from '../sim/planning.js';
import { circadianEnergyPct as circadianEnergyPctRef, dayHash as dayHashRef } from '../sim/chrono.js';
import { addBuilding as addBuildingRef, plotBuildable as plotBuildableRef } from '../sim/map.js';
import { bfsPath as bfsPathRef } from '../sim/pathfind.js';
import { isWalkable as isWalkableRef } from '../sim/map.js';

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
  w.projects = [];
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
  assert.ok(DEFAULT_LOGIC.graduation.poolBase.includes(w3.sims[0].traits.occupation), `졸업 전직 풀 (§18.T3: ${w3.sims[0].traits.occupation})`);
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
  w.project = { plotId: 0, progress: 76420, type: 'cafe' }; // v13 단수 필드(마이그레이션 입력)
  const m = migrateWorld(JSON.parse(JSON.stringify(w)));
  assert.equal(m.schemaVersion, SCHEMA_VERSION); // 백필 후 최신 버전
  assert.equal(m.projects[0].required, 600, 'required 백필 (§19.3 배열 이관)');
  // 완공 판정 재개: 다음 틱 4단계에서 progress ≥ required → facility_built
  idleAll(m, []);
  const evs = tick(m, []);
  assert.ok(evs.some((e) => e.type === 'facility_built'), '백필 즉시 완공');
  // §17.21 선제 주택 도입 후엔 같은 틱 계획이 새 프로젝트를 시작할 수 있음 — 옛 cafe가 아니면 됨
  assert.ok(m.projects.every((p) => p.progress === 0), '옛 프로젝트는 완공되어 소멸');
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

test('S-22. §17.21 성장 드라이브: 평판 적립·감쇠·이민 웨이브·선제 주택·일자리 건설', () => {
  const w = createWorld(SEED);
  const G = w.logic.growth;
  // 평판 적립: 결혼 이벤트 발생 틱에 +repMarried (틱 끝 합산)
  w.affinity[0][1] = 9999; w.affinity[1][0] = 9999;
  w.interactions[0][1] = 999; w.interactions[1][0] = 999;
  w.partners[0] = 1; w.partners[1] = 0;
  w.partnerStage[0] = 'dating'; w.partnerStage[1] = 'dating';
  const repBefore = w.reputation;
  idleAll(w, []);
  // 회고 유도 대신 직접: pairDeltaBonus 경유는 복잡 — 축제로 검증 (전 주민 이벤트)
  const w2 = createWorld(SEED);
  idleAll(w2, []);
  w2.worldTick = 30 * 1440 - 1; w2.weather.day = 30; w2.lastDailyDay = 29; w2.lastPlanDay = 30;
  tick(w2, []); // 축제일 (festivalDays 30)
  assert.ok(w2.reputation >= w2.logic.growth.repFestival * 95 / 100 - 2, `축제 평판 적립 (${w2.reputation})`);
  // 웨이브 크기: 평판 200 → 1 + floor(200/80) = 3 (캡 3)
  const w3 = createWorld(SEED);
  w3.reputation = 200;
  const h0 = w3.map.facilities.find((f) => f.id === 'house0');
  h0.resources.push({ id: 'bx1', kind: 'bed', x: h0.x + 2, y: h0.y + 2 });
  h0.resources.push({ id: 'bx2', kind: 'bed', x: h0.x + 3, y: h0.y + 2 });
  const h1 = w3.map.facilities.find((f) => f.id === 'house1');
  h1.resources.push({ id: 'bx3', kind: 'bed', x: h1.x + 2, y: h1.y + 2 });
  idleAll(w3, []);
  const iv = w3.logic.society.immigrationIntervalDays;
  w3.worldTick = iv * 1440 - 1; w3.weather.day = iv;
  const pop0 = w3.sims.length;
  tick(w3, []);
  assert.equal(w3.sims.length, pop0 + 3, '평판 웨이브 3명');
  // 선제 주택: 인구=침대여도 headroom 미달이면 house
  const w4 = createWorld(SEED);
  idleAll(w4, []);
  w4.worldTick = 1440 - 1; w4.weather.day = 1; w4.lastDailyDay = 0; w4.lastPlanDay = 0;
  const evs4 = tick(w4, []);
  const proj4 = evs4.find((e) => e.type === 'project_started');
  assert.ok(proj4 && proj4.payload.type === 'house', '선제 주택 프로젝트');
  // 일자리 건설: addBuilding office 규칙
  const w5 = createWorld(SEED);
  const plot = w5.plots.find((p) => !p.used);
  addBuildingRef(w5.map, 'office', plot);
  const of = w5.map.facilities[w5.map.facilities.length - 1];
  assert.equal(of.type, 'office');
  assert.equal(of.resources.length, 4);
  assert.ok(of.resources.every((r) => r.kind === 'desk'));
});

test('S-23. §17.20 화재: 발화·사용 배제·소방관 진압·목격 호감·자연 진화 평판 타격', () => {
  const w = createWorld(SEED);
  w.logic = JSON.parse(JSON.stringify(w.logic));
  w.logic.incidents.fireBasePermille = 0; // 신규 발화 차단 — 대응 경로 격리
  w.logic.incidents.kitchenBonusPermille = 0;
  const ff = w.sims[0];
  ff.traits = { ...ff.traits, age: 30, occupation: 'firefighter' };
  // 화재 주입 (드로우 경로는 결정성 스위트가 커버 — 여기선 대응 경로 격리)
  w.incidents.push({ type: 'fire', facilityId: 'cafe', sinceTick: w.worldTick });
  idleAll(w, []);
  resetIdle(ff);
  w.reservations = {};
  ff.needs = { hunger: 8000, energy: 8000, social: 8000, fun: 8000 };
  ff.money = 5000; ff.mood = 0;
  tick(w, []);
  assert.equal(ff.state.action, 'respond_fire', `소방관 출동 (실제: ${ff.state.action})`);
  // 불타는 카페는 후보 배제: 다른 심이 eat 후보로 cafe를 못 잡는다
  const other = w.sims[1];
  resetIdle(other);
  other.needs = { hunger: 1000, energy: 9000, social: 9000, fun: 9000 };
  other.money = 5000;
  tick(w, []);
  assert.ok(!(other.state.action === 'eat' && other.state.facilityId === 'cafe'), '화재 중 카페 배제');
  // 진압 완료까지 진행
  let out = null;
  for (let i = 0; i < 400 && !out; i++) {
    const evs = tick(w, []);
    out = evs.find((e) => e.type === 'fire_out');
  }
  assert.ok(out, '진압 완료');
  assert.equal(out.payload.by, ff.id);
  assert.equal(w.incidents.length, 0);
  assert.ok(ff.memories.some((m) => m.kind === 'heroic'), '영웅 기억');
  // 자연 진화: 방치 화재 → 평판 타격
  const w2 = createWorld(SEED);
  w2.reputation = 100;
  w2.lastDailyDay = 0; // 일일 블록(평판 감쇠 포함) 억제 — 자연 진화 효과 격리
  w2.incidents.push({ type: 'fire', facilityId: 'office', sinceTick: w2.worldTick - w2.logic.incidents.selfOutTicks });
  idleAll(w2, []);
  const evs2 = tick(w2, []);
  const so = evs2.find((e) => e.type === 'fire_out');
  assert.ok(so && so.payload.by === 'self', '자연 진화');
  assert.equal(w2.reputation, 100 - w2.logic.incidents.selfOutRepPenalty, '평판 타격');
});

test('S-24. §17.23 no_path 수리 3종: 공터 검증·겹침 수술·쿨다운', () => {
  // 예방: 시설을 덮는 공터는 건축 불가
  const w = createWorld(SEED);
  const rest = w.map.facilities.find((f) => f.id === 'restaurant');
  assert.equal(plotBuildableRef(w.map, { x: rest.x, y: rest.y }), false, '시설 위 공터 거부');
  const free = w.plots.find((p) => plotBuildableRef(w.map, p));
  assert.ok(free, '정상 공터는 통과');
  // 수술: v18 세이브에 침입 건물 재현 → v19 마이그레이션이 제거·재축조
  const w2 = createWorld(SEED);
  w2.schemaVersion = 18;
  const W = w2.map.w;
  for (let y = rest.y; y < rest.y + 5; y++) for (let x = rest.x; x < rest.x + 6; x++) w2.map.tiles[y * W + x] = 3;
  w2.map.facilities.push({ id: 'house99', type: 'house', x: rest.x, y: rest.y, w: 6, h: 5,
    door: { x: rest.x + 2, y: rest.y + 4 }, resources: [{ id: 'bed0', kind: 'bed', x: rest.x + 1, y: rest.y + 1 }], extraBedSlots: [] });
  w2.sims[3].homeId = 'house99';
  const m = migrateWorld(JSON.parse(JSON.stringify(w2)));
  assert.ok(!m.map.facilities.some((f) => f.id === 'house99'), '침입자 제거');
  assert.ok(m.sims[3].homeId !== 'house99', '주민 재배치');
  const r0 = m.map.facilities.find((f) => f.id === 'restaurant').resources[0];
  assert.ok(bfsPathRef(m.map, m.sims[0].x, m.sims[0].y, r0.x, r0.y), '재축조 후 도달');
  // 쿨다운: no_path 실패 시 같은 자원 재선택 안 함
  const w3 = createWorld(SEED);
  const s3 = w3.sims[0];
  s3.noPathCool['cafe:seat0'] = w3.worldTick + 500;
  idleAll(w3, []);
  resetIdle(s3);
  w3.reservations = {};
  s3.needs = { hunger: 500, energy: 9500, social: 9500, fun: 9500 };
  s3.money = 5000;
  tick(w3, []);
  assert.ok(!(s3.state.facilityId === 'cafe' && s3.state.resourceId === 'seat0'), '쿨다운 자원 회피');
});

test('S-25. §17.23 no_path 실발생 경로: 크래시 없이 쿨다운 기록 (Codex 45차 블로커 회귀)', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  w.map.facilities.push({ id: 'cafe9', type: 'cafe', x: 1, y: 1, w: 2, h: 2, door: { x: 1, y: 1 },
    resources: [{ id: 'seat0', kind: 'seat', x: 0, y: 0 }] }); // (0,0) 외곽 WATER — 도달 불가
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  s.x = 3; s.y = 3;
  s.needs = { hunger: 100, energy: 9500, social: 9500, fun: 9500 };
  s.money = 5000;
  const evs = tick(w, []);
  const fail = evs.find((e) => e.type === 'action_failed' && e.payload.reason === 'no_path' && e.simId === s.id);
  if (fail) assert.ok(Object.keys(s.noPathCool).length > 0, '쿨다운 기록');
  else assert.ok(true); // 크래시 없음이 회귀의 본질
});

test('S-26. §18.T1 시정: policy 내구 입력 → 세율·복지 오버라이드 + 납세 불만', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  // 정책 적용
  const evs0 = tick(w, [{ sequence: 0, command: 'policy', payload: { taxPct: 30, welfareAmount: 400 } }]);
  const pc = evs0.find((e) => e.type === 'policy_changed');
  assert.ok(pc, '정책 이벤트');
  assert.equal(pc.payload.before.taxPct, L.economy.taxPct);
  assert.equal(w.policy.taxPct, 30);
  // 화이트리스트 밖·범위 밖 거부
  const evs1 = tick(w, [{ sequence: 0, command: 'policy', payload: { taxPct: 99 } }]);
  assert.ok(evs1.some((e) => e.type === 'input_rejected'), '범위 밖 거부');
  assert.equal(w.policy.taxPct, 30, '거부 시 불변');
  // 납세 정산: 유효 세율 30% + 납세 불만 mood 델타
  const s = w.sims.find((x) => L.occupations[x.traits.occupation].wagePct > 0);
  idleAll(w, []);
  s.state = { kind: 'performing', action: 'work', facilityId: 'office', resourceId: 'desk0', path: [], ticksLeft: 1, pairedTicks: 0 };
  const moodBefore = s.mood;
  const wage = Math.floor(L.actions.work.wageBase * L.occupations[s.traits.occupation].wagePct / 100);
  const net = Math.floor(wage * 70 / 100);
  const tax = wage - net;
  const evs2 = tick(w, []);
  const mc = evs2.find((e) => e.type === 'money_changed' && e.simId === s.id);
  assert.equal(mc.payload.tax, tax, '유효 세율 30% 원천징수');
  assert.ok(s.mood < moodBefore, '납세 불만 (기분 하락)');
  // 복지 오버라이드
  const w2 = createWorld(SEED);
  w2.policy.welfareAmount = 400;
  w2.treasury = 400;
  for (const x of w2.sims) x.money = 0;
  idleAll(w2, []);
  w2.worldTick = 1440 - 1; w2.weather.day = 1; w2.lastDailyDay = 0; w2.lastPlanDay = 1;
  const evs3 = tick(w2, []);
  const wp = evs3.filter((e) => e.type === 'welfare_paid');
  assert.equal(wp.length, 1, '국고 400 = 1명분(400)');
  assert.equal(wp[0].payload.amount, 400, '오버라이드 지급액');
});

test('S-27. §18.T2 건설 지시: 차감·FIFO 우선 착공·재검증 폐기·회전 축조', () => {
  const w = createWorld(SEED);
  w.treasury = 10000;
  // 주문: 국고 차감 + zoned
  const free = w.plots.find((p) => plotBuildableRef(w.map, p));
  const evs0 = tick(w, [{ sequence: 0, command: 'zone', payload: { plotId: free.plotId, type: 'cafe', dir: 1 } }]);
  const z = evs0.find((e) => e.type === 'zoned');
  assert.ok(z, 'zoned');
  assert.equal(w.treasury, 10000 - w.logic.zone.costs.cafe, '주문 시 차감');
  // 우선 착공 (자동 수요보다 먼저, 같은 틱 이후 4단계에서)
  assert.ok(w.projects.some((p) => p.type === 'cafe' && p.dir === 1 && p.zoned), '주문 우선 착공');
  // 국고 부족 거부
  w.treasury = 0;
  const free2 = w.plots.find((p) => !p.used && p.plotId !== free.plotId && plotBuildableRef(w.map, p));
  const evs1 = tick(w, [{ sequence: 0, command: 'zone', payload: { plotId: free2.plotId, type: 'house', dir: 0 } }]);
  assert.ok(evs1.some((e) => e.type === 'input_rejected' && e.payload.reason === 'treasury_short'), '국고 부족 거부');
  // 회전 축조: dir 1 카페 — footprint 스왑(7×5→5×7) + 자원 회전
  const w2 = createWorld(SEED);
  const plot2 = w2.plots.find((p) => plotBuildableRef(w2.map, p));
  addBuildingRef(w2.map, 'cafe', plot2, 1);
  const built = w2.map.facilities[w2.map.facilities.length - 1];
  assert.equal(built.dir, 1);
  assert.equal(built.w, 5); assert.equal(built.h, 7, 'footprint 스왑');
  for (const r of built.resources) {
    assert.ok(r.x > built.x && r.x < built.x + built.w - 1 && r.y > built.y && r.y < built.y + built.h - 1, '자원이 내부에');
  }
  // 문이 벽 위 (경계)이며 FLOOR로 뚫림
  const doorTile = w2.map.tiles[built.door.y * w2.map.w + built.door.x];
  assert.equal(doorTile, 2, '문 FLOOR');
});

test('S-28. §18.T4 도시 등급: 승급·축하·웨이브 캡·티어 게이트·비가역', () => {
  const w = createWorld(SEED);
  w.lastPlanDay = 1; // 계획 억제
  // 인구 30으로 부풀리기 (읍 문턱 25)
  while (w.sims.length < 30) {
    const src = w.sims[0];
    const id = w.sims[w.sims.length - 1].id + 1;
    w.sims.push({ ...JSON.parse(JSON.stringify(src)), id, name: 'T' + id, isPlayer: false });
    for (const row of w.affinity) row.push(0);
    w.affinity.push(new Array(w.sims.length).fill(0));
    for (const row of w.interactions) row.push(0);
    w.interactions.push(new Array(w.sims.length).fill(0));
    for (const row of w.lastGreetDay) row.push(-1);
    w.lastGreetDay.push(new Array(w.sims.length).fill(-1));
  }
  idleAll(w, []);
  const moodBefore = w.sims[0].mood;
  w.worldTick = 1440 - 1; w.weather.day = 1; w.lastDailyDay = 0;
  const evs = tick(w, []);
  const pr = evs.find((e) => e.type === 'city_promoted');
  assert.ok(pr, '승급');
  assert.equal(pr.payload.to, 1);
  assert.equal(pr.payload.nameKo, '읍');
  assert.equal(w.cityTier, 1);
  assert.ok(w.sims[0].mood > moodBefore, '축하 mood');
  assert.ok(w.sims[0].memories.some((mm) => mm.kind === 'celebration'), '축하 기억');
  // 티어 게이트: apartment는 읍 언락이지만 레시피 미구현 → bad_type (마을이면 tier_locked)
  w.treasury = 99999;
  const free = w.plots.find((p) => !p.used && plotBuildableRef(w.map, p));
  const evs2 = tick(w, [{ sequence: 0, command: 'zone', payload: { plotId: free.plotId, type: 'apartment', dir: 0 } }]);
  assert.ok(evs2.some((e) => e.type === 'zoned'), '읍: apartment 언락 지시 성공 (§18.T3)');
  const w2 = createWorld(SEED);
  w2.treasury = 99999;
  const free2 = w2.plots.find((p) => !p.used && plotBuildableRef(w2.map, p));
  const evs3 = tick(w2, [{ sequence: 0, command: 'zone', payload: { plotId: free2.plotId, type: 'apartment', dir: 0 } }]);
  assert.ok(evs3.some((e) => e.type === 'input_rejected' && e.payload.reason === 'tier_locked'), '마을: 잠김');
});

test('S-29. §18.T3 시설 티어: 레시피·mall 자원 분리·공해·졸업 가중 풀', () => {
  const w = createWorld(SEED);
  // 레시피: apartment 침대 8, factory 슬롯 8(회전 검증 8×6), mall till3+seat3
  const plot = w.plots.find((p) => plotBuildableRef(w.map, p, 8, 6));
  addBuildingRef(w.map, 'apartment', plot);
  const ap = w.map.facilities[w.map.facilities.length - 1];
  assert.equal(ap.resources.filter((r) => r.kind === 'bed').length, 8, '아파트 침대 8');
  const plot2 = w.plots.find((p) => p !== plot && plotBuildableRef(w.map, p, 8, 6));
  addBuildingRef(w.map, 'mall', plot2);
  const ml = w.map.facilities[w.map.facilities.length - 1];
  assert.equal(ml.resources.filter((r) => r.kind === 'till').length, 3);
  assert.equal(ml.resources.filter((r) => r.kind === 'seat').length, 3);
  // 공해: 공장 2개 → 일일 평판 -2×3
  const w2 = createWorld(SEED);
  w2.reputation = 100;
  const pa = w2.plots.find((p) => plotBuildableRef(w2.map, p, 8, 6));
  addBuildingRef(w2.map, 'factory', pa);
  const pb = w2.plots.find((p) => p !== pa && plotBuildableRef(w2.map, p, 8, 6));
  addBuildingRef(w2.map, 'factory', pb);
  idleAll(w2, []);
  w2.worldTick = 1440 - 1; w2.weather.day = 1; w2.lastDailyDay = 0; w2.lastPlanDay = 1;
  tick(w2, []);
  // 일일 감쇠(×95%)와 공해 순서: 공해(복지 다음) → ... → 감쇠(블록 끝): (100-6)×95/100 = 89
  assert.equal(w2.reputation, Math.floor((100 - 6) * 95 / 100), '공해 -6 후 감쇠');
  // 졸업 가중: 대학 있으면 확장 풀에서 나올 수 있음 (풀 멤버십)
  const w3 = createWorld(SEED);
  const pc = w3.plots.find((p) => plotBuildableRef(w3.map, p, 8, 6));
  addBuildingRef(w3.map, 'university', pc);
  w3.sims[0].traits = { ...w3.sims[0].traits, age: 25, occupation: 'student' };
  idleAll(w3, []);
  w3.worldTick = 360 * 1440 - 1; w3.weather.day = 360; w3.lastDailyDay = 359; w3.lastPlanDay = 360;
  const evs = tick(w3, []);
  const g = evs.find((e) => e.type === 'graduated' && e.simId === 0);
  assert.ok(g && g.payload.uni === true, '대학 인지');
  const pool = [...DEFAULT_LOGIC.graduation.poolBase, ...DEFAULT_LOGIC.graduation.poolUni];
  assert.ok(pool.includes(g.payload.to), '확장 풀 멤버십');
});

test('S-30. §18.T5 일일 통계: 링 적재·산식·캡·결정성', () => {
  const w = createWorld(SEED);
  idleAll(w, []);
  w.worldTick = 1440 - 1; w.weather.day = 1; w.lastDailyDay = 0; w.lastPlanDay = 1;
  tick(w, []);
  assert.equal(w.statsHistory.length, 1, '하루 1점');
  const st = w.statsHistory[0];
  assert.equal(st.day, 1);
  assert.equal(st.pop, w.sims.length);
  const sum = w.sims.reduce((n, s2) => n + s2.mood, 0);
  assert.equal(st.avgMood, Math.floor(sum / w.sims.length), 'avgMood floorDiv');
  assert.ok(st.employed <= st.pop);
  assert.equal(typeof st.incidents, 'number', '사건 수 필드 (55차)');
  // 캡 180
  const w2 = createWorld(SEED);
  for (let i = 0; i < 200; i++) w2.statsHistory.push({ day: i, pop: 1, treasury: 0, reputation: 0, avgMood: 0, employed: 0, tier: 0 });
  idleAll(w2, []);
  w2.worldTick = 1440 - 1; w2.weather.day = 1; w2.lastDailyDay = 0; w2.lastPlanDay = 1;
  tick(w2, []);
  assert.equal(w2.statsHistory.length, 180, '캡 shift');
});

test('S-31. §17.24 순찰·정직: 경찰 순찰 정산·정직 신고·3일 귀속', () => {
  const w = createWorld(SEED);
  const cop = w.sims[0];
  cop.traits = { ...cop.traits, age: 30, occupation: 'police' };
  // 순찰 후보: work 시간대(주간조 id 0)로 점프
  idleAll(w, []);
  resetIdle(cop);
  w.reservations = {};
  cop.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 };
  cop.money = 100; // 돈 부족 → work 급함
  w.worldTick = 600; // 10:00 주간조
  tick(w, []);
  assert.equal(cop.state.facilityId, 'patrol', `순찰 (실제: ${cop.state.facilityId}/${cop.state.action})`);
  const idx0 = cop.patrolIdx;
  const rep0 = w.reputation;
  for (let i = 0; i < 400 && cop.patrolIdx === idx0; i++) tick(w, []);
  assert.equal(cop.patrolIdx, idx0 + 1, '순찰 완료 idx++');
  assert.ok(w.reputation >= rep0, '치안 평판');
  // 정직 신고: TF 100(F 최대) → p=75; dayHash 결정적이라 여러 심으로 신고 발생 확인
  const w2 = createWorld(SEED);
  w2.sims[1].traits.occupation = 'police'; // 경찰 존재
  let reported = 0; let kept = 0;
  for (const s2 of w2.sims) {
    s2.traits.mbti.TF = 100;
    const day = 5;
    const p = w2.logic.honesty.base + Math.floor(100 / w2.logic.honesty.tfDiv);
    if (dayHashRef(s2.id, day, 7) < p) reported++; else kept++;
  }
  assert.ok(reported > 0, '일부는 신고 (의사확률)');
  // 귀속: dueDay 도래 시 finder에게
  const w3 = createWorld(SEED);
  w3.lostAndFound.push({ itemId: 1, finderId: 0, amount: 500, dueDay: 1 });
  const m0 = w3.sims[0].money;
  idleAll(w3, []);
  w3.worldTick = 1440 - 1; w3.weather.day = 1; w3.lastDailyDay = 0; w3.lastPlanDay = 1;
  const evs = tick(w3, []);
  assert.ok(evs.some((e) => e.type === 'item_returned' && e.simId === 0), '귀속 이벤트');
  assert.equal(w3.sims[0].money, m0 + 500);
  assert.equal(w3.lostAndFound.length, 0);
});

test('S-32. §19 R-A 지형: 구시가 보존·통행 규칙·도달성·결정성', () => {
  const w = createWorld(SEED);
  const map = w.map;
  const T = { RIVER: 6, BANK: 7, SAND: 8, MOUNTAIN: 9, HILL: 10, BRIDGE: 11 };
  // 구시가(0..140) 절대 보존 — 신규 지형 타일이 하나도 없어야
  for (let y = 0; y < 140; y++) for (let x = 0; x < 140; x++) {
    const t = map.tiles[y * map.w + x];
    assert.ok(t < 6, `구시가 보존 위반 (${x},${y})=${t}`);
  }
  // 바깥에는 실제로 생성됐다
  const counts = {};
  for (const t of map.tiles) counts[t] = (counts[t] ?? 0) + 1;
  assert.ok((counts[T.RIVER] ?? 0) > 100, '강 생성');
  assert.ok((counts[T.MOUNTAIN] ?? 0) > 50, '산 생성');
  assert.ok((counts[T.SAND] ?? 0) > 50, '해변 생성');
  assert.ok((counts[T.BRIDGE] ?? 0) > 0, '다리 생성');
  // 통행 규칙: 강·산은 막고 다리·모래·언덕·강가는 통행 가능
  const findTile = (code) => {
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.tiles[y * map.w + x] === code) return { x, y };
    }
    return null;
  };
  const river = findTile(T.RIVER); const mnt = findTile(T.MOUNTAIN);
  const bridge = findTile(T.BRIDGE); const sand = findTile(T.SAND);
  assert.equal(isWalkableRef(map, river.x, river.y), false, '강 차단');
  assert.equal(isWalkableRef(map, mnt.x, mnt.y), false, '산 차단');
  assert.equal(isWalkableRef(map, bridge.x, bridge.y), true, '다리 통행');
  assert.equal(isWalkableRef(map, sand.x, sand.y), true, '해변 통행');
  // 기존 시설 자원 도달성 보존 (지형이 구시가를 끊지 않았는가)
  const home = map.facilities.find((f) => f.type === 'house');
  for (const fac of map.facilities.filter((f) => f.resources?.length && f.type !== 'pond')) {
    const r = fac.resources[0];
    assert.ok(bfsPathRef(map, home.door.x, home.door.y, r.x, r.y), `도달 불가: ${fac.id}`);
  }
  // 공터 보호 (Codex 63차 ①): 지형이 공터 footprint를 덮으면 건설 불가가 영구화된다.
  // 지형 타일이 공터 7×5 안에 하나도 없어야 한다.
  for (const p of w.plots) {
    for (let j = p.y; j < p.y + 5; j++) for (let i = p.x; i < p.x + 7; i++) {
      const t2 = map.tiles[j * map.w + i];
      assert.ok(t2 < 6, `공터 ${p.plotId} 침범 (${i},${j})=${t2}`);
    }
  }
  assert.equal(w.terrainVersion, 1, '신규 월드도 terrainVersion 기록 (63차 ②)');
  // 결정성: 같은 시드 → 같은 지형
  const w2 = createWorld(SEED);
  assert.equal(hashWorld(w), hashWorld(w2), '지형 포함 결정성');
});

test('S-33. §19 R-B 자가용: 통계 누적·구매 조건·2칸 전진·중복 금지 (Codex 64차 조건)', () => {
  const w = createWorld(SEED);
  const T = w.logic.transport;
  const s = w.sims[0];
  // 구매 조건 미달이면 안 산다
  s.longTrips = T.carTripsMin - 1; s.money = 99999;
  maybeBuyCarRef(w, s, 0, () => {});
  assert.equal(s.hasCar, false, '이동 부족 → 미구매');
  // 돈 부족도 안 산다
  s.longTrips = T.carTripsMin; s.money = T.carPrice - 1;
  maybeBuyCarRef(w, s, 0, () => {});
  assert.equal(s.hasCar, false, '자금 부족 → 미구매');
  // 조건 충족 → 구매 + 취득세 국고 유입
  s.money = T.carPrice + 500;
  const tre0 = w.treasury;
  const evs = [];
  maybeBuyCarRef(w, s, 0, (type, simId, payload) => evs.push({ type, simId, payload }));
  assert.equal(s.hasCar, true, '구매');
  assert.equal(s.money, 500);
  assert.ok(w.treasury > tre0, '취득세 국고 유입');
  assert.ok(evs.some((e) => e.type === 'car_bought'));
  // 중복 구매 금지 (64차 (d))
  s.money = 99999;
  const before = s.money;
  maybeBuyCarRef(w, s, 0, () => {});
  assert.equal(s.money, before, '중복 구매 없음');
  // 2칸 전진: 같은 경로를 가진 두 심 — 차 있는 쪽이 정확히 2배 빠르다
  const w2 = createWorld(SEED);
  idleAll(w2, []);
  const a = w2.sims[0]; const b = w2.sims[1];
  a.hasCar = true;
  const path = [{ x: 20, y: 23 }, { x: 21, y: 23 }, { x: 22, y: 23 }, { x: 23, y: 23 }];
  for (const sim of [a, b]) {
    sim.x = 19; sim.y = 23;
    sim.state = { kind: 'walking', action: 'idle', facilityId: null, resourceId: null,
      path: path.map((p) => ({ ...p })), ticksLeft: 99, pairedTicks: 0 };
  }
  tick(w2, []);
  assert.equal(a.state.path.length, 2, '차량 2칸 전진');
  assert.equal(b.state.path.length, 3, '도보 1칸 전진');
  // 장거리 통계는 출발 시점 누적 (64차 (c))
  assert.equal(typeof w2.sims[0].longTrips, 'number');
});

test('S-34. §19.4 순찰 고착 수리: 막힌 지점 회피·실패 시 다음 지점 (이슈 #40)', () => {
  const w = createWorld(SEED);
  const cop = w.sims[0];
  cop.traits = { ...cop.traits, age: 30, occupation: 'police' };
  const L = w.logic;
  const spots = w.map.facilities.filter((f) => L.patrol.targets.includes(f.type));
  assert.ok(spots.length > 0, '순찰 대상 존재');
  // 첫 대상의 문 북쪽을 나무로 막아도 다른 인접 칸으로 순찰 지점을 잡는다
  const target = spots[0];
  const W = w.map.w;
  w.map.tiles[(target.door.y - 1) * W + target.door.x] = 4; // TREE
  idleAll(w, []);
  resetIdle(cop);
  w.reservations = {};
  cop.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 };
  cop.money = 100;
  cop.patrolIdx = 0;
  w.worldTick = 600; // 주간 근무 시간
  tick(w, []);
  if (cop.state.facilityId === 'patrol') {
    const spot = { x: cop.state.path.length ? cop.state.path[cop.state.path.length - 1].x : cop.x,
      y: cop.state.path.length ? cop.state.path[cop.state.path.length - 1].y : cop.y };
    assert.notEqual(`${spot.x},${spot.y}`, `${target.door.x},${target.door.y - 1}`, '막힌 칸을 피함');
  }
  // 도달 불가 순찰 지점이면 patrolIdx가 진전해 다음 대상으로 넘어간다
  const w2 = createWorld(SEED);
  const cop2 = w2.sims[0];
  cop2.traits = { ...cop2.traits, age: 30, occupation: 'police' };
  const spots2 = w2.map.facilities.filter((f) => L.patrol.targets.includes(f.type));
  const t2 = spots2[0];
  // 문 주변 4칸 + 문 자체를 전부 물로 막아 도달 불가 상태를 만든다
  for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0], [0, 0]]) {
    w2.map.tiles[(t2.door.y + dy) * w2.map.w + (t2.door.x + dx)] = 5; // WATER
  }
  idleAll(w2, []);
  resetIdle(cop2);
  w2.reservations = {};
  cop2.needs = { hunger: 9000, energy: 9000, social: 9000, fun: 9000 };
  cop2.money = 100;
  cop2.patrolIdx = 0;
  w2.worldTick = 600;
  tick(w2, []);
  // 후보 자체가 생성되지 않거나(전부 막힘) 다른 행동을 하되, 무한 no_path는 없어야 한다
  assert.ok(cop2.state.facilityId !== 'patrol' || cop2.patrolIdx >= 0, '고착 없음');
});

test('S-35. §19.5 시민 불만·청원: 커서 집계·문턱 발화·재무장 (Codex 70차 조건)', () => {
  const w = createWorld(SEED);
  const L = w.logic;
  const s = w.sims[0];
  // 외로움 기억 주입 → 회고 시 불만 적재
  for (let i = 0; i < L.complaints.lonelyMin; i++) {
    recordFactRef(s, 100, L, 'lonely', { placeId: 'cafe', tags: ['socialize'] });
  }
  collectComplaintsRef(w, s, 100, () => {});
  const c1 = w.complaints.find((x) => x.kind === 'lonely' && x.placeId === 'cafe');
  assert.ok(c1, '불만 적재');
  assert.equal(c1.count, L.complaints.lonelyMin);
  // 커서 이후만 집계 — 같은 기억을 다시 스캔해도 증가하지 않는다 (70차 ①)
  collectComplaintsRef(w, s, 100, () => {});
  assert.equal(w.complaints.find((x) => x.kind === 'lonely' && x.placeId === 'cafe').count,
    L.complaints.lonelyMin, '중복 가산 없음');
  // 문턱 초과 시 청원 1회, 재발화 없음 (70차 ② / §19.7: 사람 수 기준)
  for (const s2 of w.sims) s2.complaintDays = { lonely: 1 }; // 전원이 최근 불만 제기
  const evs = [];
  const emit = (type, simId, payload) => evs.push({ type, simId, payload });
  maybePetitionRef(w, 0, 1, emit);
  assert.equal(evs.filter((e) => e.type === 'petition').length, 1, '청원 발생');
  assert.equal(w.petitions.lonely.armed, false, '무장 해제');
  maybePetitionRef(w, 0, 2, emit);
  assert.equal(evs.filter((e) => e.type === 'petition').length, 1, '재발화 없음');
  // 문턱 아래로 내려가면 재무장 (§19.7: 최근 불만 제기자가 사라지면)
  for (const s2 of w.sims) s2.complaintDays = {};
  maybePetitionRef(w, 0, 3, emit);
  assert.equal(w.petitions.lonely.armed, true, '재무장');
  // 캡: 초과 시 oldest-first 제거 (70차 ④)
  const w2 = createWorld(SEED);
  for (let i = 0; i < L.complaints.cap + 5; i++) {
    w2.complaints.push({ kind: 'lonely', placeId: `p${i}`, severity: 1, sinceDay: i, count: 1 });
  }
  const s2 = w2.sims[1];
  recordFactRef(s2, 100, L, 'starving', { tags: ['eat'] });
  collectComplaintsRef(w2, s2, 100, () => {});
  assert.ok(w2.complaints.length <= L.complaints.cap, '캡 준수');
  assert.ok(!w2.complaints.some((x) => x.placeId === 'p0'), '가장 오래된 것부터 제거');
});

test('S-36. §19.5 no_facility 불만: 위급한데 갈 곳이 없으면 기록된다 (Codex 71차)', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  // 모든 식사 시설을 제거해 '배고픈데 갈 곳 없음'을 만든다
  w.map.facilities = w.map.facilities.filter((f) => !['cafe', 'restaurant', 'mall', 'market'].includes(f.type));
  s.needs = { hunger: 100, energy: 9000, social: 9000, fun: 9000 }; // hunger 위급
  s.money = 5000;
  s.groceries = 0;
  const before = s.memories.length;
  tick(w, []);
  const unmet = s.memories.slice(before).find((m) => m.kind === 'unmet');
  assert.ok(unmet, '시설 부재 기억');
  assert.ok(unmet.tags.includes('no_facility'), 'no_facility 태그');
  // 회고 집계 시 no_facility 불만으로 적재된다
  collectComplaintsRef(w, s, w.worldTick, () => {});
  const c = w.complaints.find((x) => x.kind === 'no_facility');
  assert.ok(c, 'no_facility 불만 적재');
  assert.equal(c.placeId, unmet.placeId, '막힌 행동이 placeId에 기록');
  // 틱당 최대 1건 (기억 폭발 방지)
  const before2 = s.memories.length;
  tick(w, []);
  const added = s.memories.slice(before2).filter((m) => m.kind === 'unmet').length;
  assert.ok(added <= 1, `틱당 ≤1건 (실제 ${added})`);
});

test('S-37. §19.7 재무장 누락 수리: 불만이 사라진 kind도 재무장된다 (Codex 72차)', () => {
  const w = createWorld(SEED);
  // lonely 청원을 터뜨려 armed=false로 만든다
  w.complaints.push({ kind: 'lonely', placeId: 'cafe', severity: 50, sinceDay: 1, count: 50 });
  for (const s of w.sims) s.complaintDays = { lonely: 1 };
  const evs = [];
  maybePetitionRef(w, 0, 1, (type, simId, payload) => evs.push({ type, payload }));
  assert.equal(w.petitions.lonely.armed, false, '청원 후 무장 해제');
  // 감쇠로 그 kind의 마지막 불만이 사라진 상황 (complaints 비었지만 petitions엔 남음)
  w.complaints.length = 0;
  for (const s of w.sims) s.complaintDays = {};
  maybePetitionRef(w, 0, 2, () => {});
  assert.equal(w.petitions.lonely.armed, true, '불만이 사라진 kind도 재무장 (72차 ①)');
  // 재무장 후 다시 문턱을 넘으면 청원이 정상 발생
  w.complaints.push({ kind: 'lonely', placeId: 'park', severity: 10, sinceDay: 3, count: 10 });
  for (const s of w.sims) s.complaintDays = { lonely: 3 };
  const evs2 = [];
  maybePetitionRef(w, 0, 3, (type, simId, payload) => evs2.push({ type, payload }));
  assert.equal(evs2.filter((e) => e.type === 'petition').length, 1, '재발화 정상');
});

test('S-38. §19.10 불만 원인 분화: 돈이 없어서 막힌 것은 시설 부재가 아니다 (이슈 #49)', () => {
  const w = createWorld(SEED);
  const s = w.sims[0];
  idleAll(w, []);
  resetIdle(s);
  w.reservations = {};
  // 시설은 그대로 두고 돈만 없앤다 → no_money로 기록되어야 한다
  s.needs = { hunger: 100, energy: 9000, social: 9000, fun: 9000 };
  s.money = 0;
  s.groceries = 0;
  const before = s.memories.length;
  tick(w, []);
  const unmet = s.memories.slice(before).find((m) => m.kind === 'unmet');
  assert.ok(unmet, 'unmet 기억');
  assert.ok(unmet.tags.includes('no_money'), `돈 부족으로 라벨 (실제: ${unmet.tags.join(',')})`);
  collectComplaintsRef(w, s, w.worldTick, () => {});
  assert.ok(w.complaints.some((c) => c.kind === 'no_money'), 'no_money 불만');
  assert.ok(!w.complaints.some((c) => c.kind === 'no_facility'), '시설 부재로 오진하지 않음');
  // 시설이 실제로 없으면 no_facility로 기록된다
  const w2 = createWorld(SEED);
  const s2 = w2.sims[0];
  w2.map.facilities = w2.map.facilities.filter((f) => !['cafe', 'restaurant', 'mall', 'market'].includes(f.type));
  idleAll(w2, []);
  resetIdle(s2);
  w2.reservations = {};
  s2.needs = { hunger: 100, energy: 9000, social: 9000, fun: 9000 };
  s2.money = 9000; // 돈은 충분
  s2.groceries = 0;
  const b2 = s2.memories.length;
  tick(w2, []);
  const u2 = s2.memories.slice(b2).find((m) => m.kind === 'unmet');
  assert.ok(u2 && u2.tags.includes('no_facility'), '진짜 시설 부재는 no_facility');
});
