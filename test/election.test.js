// §22.20 회고 투표 테스트 (사용자 지시: 성과가 표에 들어가야 한다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, hashWorld } from '../sim/index.js';
import { retrospectiveScore, maybeElection } from '../sim/society.js';

// 기억을 직접 심는 헬퍼 — recordFact 형식과 동일한 최소 필드
function plant(sim, tick, kind, tags = []) {
  sim.memories.push({ memorySeq: sim.memorySeq++, tick, kind, subjectSimId: null, placeId: null, importance: 5, tags });
}

test('E-1. 회고는 재임자에게만 적용된다 — 심판할 대상이 없는 후보는 0', () => {
  const w = createWorld(4242);
  w.mayorId = 3;
  const voter = w.sims[0];
  plant(voter, 100, 'starving');
  assert.ok(retrospectiveScore(w, voter, 3, 0, w.logic) < 0, '재임자는 심판받는다');
  assert.equal(retrospectiveScore(w, voter, 5, 0, w.logic), 0, '비재임 후보는 회고가 없다');
});

test('E-2. 굶주림·궁핍은 감점, 복지 수혜는 가점 — 창 밖 기억은 무시', () => {
  const w = createWorld(4242);
  w.mayorId = 3;
  const E = w.logic.election;
  const voter = w.sims[0];
  plant(voter, 50, 'starving');                    // 창 밖 (sinceTick=100)
  plant(voter, 150, 'starving');                   // 창 안
  plant(voter, 160, 'unmet', ['eat', 'no_money']); // 창 안
  plant(voter, 170, 'unmet', ['eat', 'no_facility']); // no_money 아님 → 무시
  plant(voter, 180, 'welfare', ['politics', 'welfare']);
  // 국고를 시민 현금보다 적게 둬서 사재기 배수를 끈다
  w.treasury = 0;
  const got = retrospectiveScore(w, voter, 3, 100, w.logic);
  assert.equal(got, E.judgeWelfare - E.judgeStarving - E.judgeNoMoney);
});

test('E-3. 나라에 돈이 있는데 굶었다면 원망이 커진다 (사재기 배수)', () => {
  const w = createWorld(4242);
  w.mayorId = 3;
  const E = w.logic.election;
  const voter = w.sims[0];
  plant(voter, 150, 'starving');
  // 배수는 (국고>시민총현금) AND (대응 안 함=false)에만 걸린다. 기준선 없이는
  // 판정 불가(null)라 배수가 없으므로, '아무것도 안 바꾼 임기'를 명시해 둔다.
  w.termStartPolicy = { taxPct: 25, welfareAmount: 550, welfareThreshold: 300 };
  w.policy = { taxPct: 25, welfareAmount: 550, welfareThreshold: 300 };
  const cash = w.sims.reduce((n, s) => n + s.money, 0);
  w.treasury = 0;
  const poorGov = retrospectiveScore(w, voter, 3, 100, w.logic);
  w.treasury = cash * 2; // 국고가 시민 총현금의 2배
  const richGov = retrospectiveScore(w, voter, 3, 100, w.logic);
  assert.ok(richGov < poorGov, `국고가 쌓였는데 감점이 같다: ${poorGov} vs ${richGov}`);
  assert.equal(richGov, -Math.floor(E.judgeStarving * E.hoardMultPct / 100));
  // 좋은 기억만 있으면 배수가 안 걸린다 (bad > 0 조건)
  const voter2 = w.sims[1];
  plant(voter2, 150, 'welfare');
  assert.equal(retrospectiveScore(w, voter2, 3, 100, w.logic), E.judgeWelfare);
});

test('E-4. 회고 점수는 상한이 있다 — 인기를 완전히 지우지 않는다', () => {
  const w = createWorld(4242);
  w.mayorId = 3;
  const voter = w.sims[0];
  for (let i = 0; i < 100; i++) plant(voter, 150 + i, 'starving');
  w.treasury = 10 ** 9;
  assert.equal(retrospectiveScore(w, voter, 3, 100, w.logic), -w.logic.election.retroCap);
});

test('E-5. 현직은 재선에 나선다 — 후보에 자동 포함', () => {
  // 예전에는 후보가 인기 상위 2인뿐이라 재임자가 후보에 못 드는 일이 잦았고
  // (실측 3회 중 2회), 그러면 회고 투표가 발동할 자리가 없었다.
  const w = createWorld(4242);
  advance(w, {}, 10 * 1440); // 호감이 쌓여 인기 순위가 생기게
  // 인기 최하위쯤의 심을 시장으로 앉힌다
  const pops = w.sims.map((s) => ({
    id: s.id,
    pop: w.sims.reduce((sum, o) => o.id === s.id ? sum : sum + Math.max(0, w.affinity[o.id][s.id]), 0),
  })).sort((a, b) => a.pop - b.pop);
  w.mayorId = pops[0].id; // 가장 인기 없는 심
  let electionEv = null;
  maybeElection(w, 15 * 1440, 15, (type, simId, payload) => {
    if (type === 'election') electionEv = { simId, payload };
  });
  assert.ok(electionEv, '선거가 열려야 한다');
  assert.ok(electionEv.payload.candidates.includes(pops[0].id),
    `현직(${pops[0].id})이 후보에 없다: ${electionEv.payload.candidates}`);
  assert.equal(electionEv.payload.incumbent, pops[0].id);
});

test('E-6. 회고 투표가 결정적이다 — 같은 세계, 같은 결과', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 32 * 1440); advance(b, {}, 32 * 1440);
  assert.equal(hashWorld(a), hashWorld(b));
  assert.equal(a.mayorId, b.mayorId);
});

test('E-7. 나쁜 정치는 표를 잃는다 (A/B 방향성)', () => {
  // Codex 113차 검증 설계: 정책 경로만 바꾼 A/B. 국고를 쌓아두고 복지를 끊은
  // 재임자는 회고 감점을 받아야 한다.
  const run = (policy) => {
    const w = createWorld(4242);
    if (policy) w.policy = policy;
    const evs = advance(w, {}, 60 * 1440);
    const els = evs.filter((e) => e.type === 'election' && e.payload.incumbent !== null);
    return els.reduce((n, e) => n + e.payload.retroTotal, 0);
  };
  const base = run(null);
  const hoard = run({ taxPct: 30, welfareAmount: 0, welfareThreshold: 0 });
  assert.ok(hoard < base,
    `복지를 끊고 국고를 쌓은 정부의 회고합(${hoard})이 기본(${base})보다 나쁘지 않다`);
});

test('E-8. 국고가 쌓여도 정책을 움직인 정부는 배수를 면한다 (114차 ⑥)', async () => {
  // 사용자 지시의 정확한 형태: "국고에 돈이 많은데 **세율을 조정하지 않거나 하면**".
  // 돈이 쌓인 것 자체가 아니라 쌓였는데 아무것도 안 한 것이 원망의 대상이다.
  const { policyResponded } = await import('../sim/society.js');
  const w = createWorld(4242);
  w.mayorId = 3;
  const E = w.logic.election;
  const voter = w.sims[0];
  plant(voter, 150, 'starving');
  const cash = w.sims.reduce((n, s) => n + s.money, 0);
  w.treasury = cash * 2; // 국고가 시민 총현금의 2배 — 사재기 조건 성립

  // 기준선: 임기 시작 때 세율 25
  w.termStartPolicy = { taxPct: 25, welfareAmount: 550, welfareThreshold: 300 };

  // ① 아무것도 안 바꿨다 → 배수
  w.policy = { taxPct: 25, welfareAmount: 550, welfareThreshold: 300 };
  assert.equal(policyResponded(w), false);
  assert.equal(retrospectiveScore(w, voter, 3, 100, w.logic),
    -Math.floor(E.judgeStarving * E.hoardMultPct / 100));

  // ② 세율을 내렸다 → 배수 면제 (굶은 감점 자체는 남는다)
  w.policy = { taxPct: 20, welfareAmount: 550, welfareThreshold: 300 };
  assert.equal(policyResponded(w), true);
  assert.equal(retrospectiveScore(w, voter, 3, 100, w.logic), -E.judgeStarving);

  // ③ 복지를 늘려도 대응이다
  w.policy = { taxPct: 25, welfareAmount: 800, welfareThreshold: 300 };
  assert.equal(policyResponded(w), true);

  // ④ 세율을 **올린** 것은 대응이 아니다 — 방향이 시민 반대쪽이다
  w.policy = { taxPct: 30, welfareAmount: 550, welfareThreshold: 300 };
  assert.equal(policyResponded(w), false);
  assert.equal(retrospectiveScore(w, voter, 3, 100, w.logic),
    -Math.floor(E.judgeStarving * E.hoardMultPct / 100));

  // ⑤ 기준선이 없으면 **판정 불가(null)** — 무대응(false)과 다르다. 배수를 걸지 않는다.
  // 첫 시장은 기준선이 없다는 이유로 억울하게 2배 감점을 받으면 안 된다 (115차 ②).
  w.termStartPolicy = null;
  w.policy = { taxPct: 5, welfareAmount: 900, welfareThreshold: 1500 };
  assert.equal(policyResponded(w), null);
  assert.equal(retrospectiveScore(w, voter, 3, 100, w.logic), -E.judgeStarving,
    '기준선이 없는데 배수가 걸렸다');
});

test('E-9. 선거가 다음 임기의 정책 기준선을 스냅샷한다', () => {
  const w = createWorld(4242);
  advance(w, {}, 10 * 1440);
  w.policy = { taxPct: 18, welfareAmount: 700, welfareThreshold: 400 };
  maybeElection(w, 15 * 1440, 15, () => {});
  assert.deepEqual(w.termStartPolicy,
    { taxPct: 18, welfareAmount: 700, welfareThreshold: 400 },
    '임기 시작 정책이 스냅샷되지 않았다');
});

// ---- §22.21 먼저 돕기 (이슈 #69, KIND RCT) ----
import { maybeApproach } from '../sim/society.js';
import { serialize, deserialize, findNonFinite } from '../sim/index.js';

// 곤경에 빠진 심 옆에 외로운 심을 앉히는 헬퍼
function stageHelp(w, { distress }) {
  const giver = w.sims[0];
  const target = w.sims[1];
  const fac = w.map.facilities.find((f) => f.type === 'cafe');
  giver.state = { ...giver.state, kind: 'performing', action: 'socialize', facilityId: fac.id, pairedTicks: 0, sideTalkTicks: 0 };
  target.state = { ...target.state, kind: 'performing', action: 'eat', facilityId: fac.id, pairedTicks: 0, sideTalkTicks: 0 };
  target.sick = null; target.needs.hunger = 8000; target.money = 99999;
  if (distress === 'sick') target.sick = { kind: 'cold', untilTick: 99999 };
  else if (distress === 'hungry') target.needs.hunger = 100;
  else if (distress === 'broke') target.money = 0;
  // 승낙이 확실히 나게 (판정식은 그대로 두고 파라미터만 올린다 — 이분 컷 아님)
  w.logic.social.approachBasePct = 100;
  return { giver, target };
}

test('H-1. 곤경인 상대에게는 수다가 아니라 챙김이 된다', () => {
  const w = createWorld(4242);
  const { giver, target } = stageHelp(w, { distress: 'sick' });
  const before = {
    giverSocial: giver.needs.social,
    gratitude: w.affinity[target.id][giver.id],
    reverse: w.affinity[giver.id][target.id],
    giverMood: giver.mood, targetMood: target.mood,
  };
  const evs = [];
  maybeApproach(w, 1000, 0, (type, simId, payload) => evs.push({ type, simId, payload }), new Set());
  const helped = evs.find((e) => e.type === 'helped');
  assert.ok(helped, `helped가 없다: ${evs.map((e) => e.type).join(',')}`);
  assert.equal(helped.payload.why, 'sick');
  assert.equal(evs.some((e) => e.type === 'side_talk'), false, '챙김과 수다가 같이 나왔다');
  // KIND의 핵심 — 주는 쪽의 회복이 크다 (정면 100% > 곁다리 30%)
  assert.ok(giver.needs.social > before.giverSocial, '주는 쪽 사교가 안 올랐다');
  // 고마움은 받는 쪽 → 주는 쪽 한 방향
  assert.equal(w.affinity[target.id][giver.id], before.gratitude + w.logic.social.helpGratitudeAffinity);
  assert.equal(w.affinity[giver.id][target.id], before.reverse, '주는 쪽 호감까지 올랐다 — 아무나 붙잡기 유인이 생긴다');
  assert.ok(giver.mood > before.giverMood && target.mood > before.targetMood);
  // 기억이 양쪽에 남는다
  assert.ok(giver.memories.some((m) => m.kind === 'helped'));
  assert.ok(target.memories.some((m) => m.kind === 'was_helped'));
});

test('H-2. 곤경이 아니면 예전 그대로 곁다리 수다다', () => {
  const w = createWorld(4242);
  stageHelp(w, { distress: null });
  const evs = [];
  maybeApproach(w, 1000, 0, (type, simId, payload) => evs.push({ type, simId, payload }), new Set());
  assert.ok(evs.some((e) => e.type === 'side_talk'), '수다가 사라졌다');
  assert.equal(evs.some((e) => e.type === 'helped'), false, '멀쩡한 사람을 챙겼다');
});

test('H-3. 곤경 종류가 why에 정확히 실린다 (sick > hungry > broke 우선)', () => {
  for (const [distress, why] of [['sick', 'sick'], ['hungry', 'hungry'], ['broke', 'broke']]) {
    const w = createWorld(4242);
    stageHelp(w, { distress });
    const evs = [];
    maybeApproach(w, 1000, 0, (t2, s2, p2) => evs.push({ type: t2, payload: p2 }), new Set());
    const h = evs.find((e) => e.type === 'helped');
    assert.ok(h, `${distress}: helped 미발생`);
    assert.equal(h.payload.why, why);
  }
});

test('H-4. 챙김이 결정적이고 왕복을 견딘다', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 25 * 1440); advance(b, {}, 25 * 1440);
  assert.equal(hashWorld(a), hashWorld(b));
  const w2 = deserialize(serialize(a));
  assert.equal(hashWorld(a), hashWorld(w2));
  assert.deepEqual(findNonFinite(a, 5), []);
});
