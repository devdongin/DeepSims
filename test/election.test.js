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

test('E-7. 나쁜 정치는 표를 잃는다 — 쌓아두고 안 쓰는 정부 vs 푸는 정부', () => {
  // §22.23(공공 임금 보장) 이후 "복지를 끊으면 굶는다"는 전제가 무너졌다 — 임금
  // 보장이 적자 재정으로 노동자 주머니를 채워서, 복지 없이도 굶주림이 늘지 않는다
  // (실측 33 vs 23). 그래서 이 테스트는 새 경제에서의 심판 축을 잰다:
  // **국고가 두둑한데 복지를 끊은 정부**는, 같은 국고로 복지를 푸는 정부보다
  // 회고 점수가 나빠야 한다 (사재기 배수 + welfare 가점의 부재).
  const run = (policy) => {
    const w = createWorld(4242);
    // 시장이 나쁜 정책을 스스로 고쳐버리지 않게 재정 행동을 끄고 유권자 축만 잰다.
    w.logic.fiscal.stepTaxPct = 0; w.logic.fiscal.stepWelfare = 0;
    w.treasury = 1000000; // 두둑한 국고 — 사재기 조건이 성립할 무대
    if (policy) w.policy = policy;
    const evs = advance(w, {}, 60 * 1440);
    const els = evs.filter((e) => e.type === 'election' && e.payload.incumbent !== null);
    return els.reduce((n, e) => n + e.payload.retroTotal, 0);
  };
  const spends = run(null); // 기본 복지가 국고를 푼다
  const hoards = run({ taxPct: 30, welfareAmount: 0, welfareThreshold: 0 });
  assert.ok(hoards < spends,
    `국고를 쌓아두고 복지를 끊은 정부(${hoards})가 푸는 정부(${spends})보다 나쁘게 심판받지 않았다`);
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

// ---- §22.22 시장의 재정 행동 ----
import { maybeFiscalReview } from '../sim/society.js';

function fiscalStage(w, { treasury, mayor = 3 }) {
  w.mayorId = mayor;
  w.treasury = treasury;
  w.lastFiscalDay = -1;
  w.playerPolicyDay = -1;
  return w;
}

test('F-1. 국고가 쌓였고 굶는 사람이 있으면 복지를 늘린다 (사용자 지시의 핵심)', async () => {
  const w = createWorld(4242);
  const cash = w.sims.reduce((n, s) => n + s.money, 0);
  fiscalStage(w, { treasury: cash * 3 }); // 사재기 상태
  w.sims[0].hungerZeroTicks = 100;        // 굶은 사람이 있다
  const evs = [];
  maybeFiscalReview(w, 5 * 1440, 5, (t2, s2, p2) => evs.push({ type: t2, simId: s2, payload: p2 }));
  const pol = evs.find((e) => e.type === 'policy_changed');
  assert.ok(pol, '시장이 아무것도 안 했다');
  assert.equal(pol.payload.source, 'mayor');
  assert.equal(pol.payload.reason, 'hoard_welfare');
  assert.equal(w.policy.welfareAmount, (w.logic.economy.welfareAmount) + w.logic.fiscal.stepWelfare);
  // §22.20 통합 — 시장이 움직였으니 다음 선거에서 '대응함'이 된다 (루프가 닫힌다)
  w.termStartPolicy = { taxPct: w.logic.economy.taxPct, welfareAmount: w.logic.economy.welfareAmount, welfareThreshold: w.logic.economy.welfareThreshold };
  const { policyResponded } = await import('../sim/society.js');
  assert.equal(policyResponded(w), true, '시장의 조정이 회고 투표의 대응으로 안 잡힌다');
});

test('F-2. 국고가 마르면 긴축한다 — 지출 먼저, 세율은 최후 (Helm & Stuhler 2024)', () => {
  // 처음엔 세율부터 올리게 짰다가, 문헌 조사에서 지자체 실증(지출은 수년 내 적응,
  // 세율은 10년 이상 최후순위)과 반대임을 확인하고 순서를 뒤집었다.
  const w = createWorld(4242);
  fiscalStage(w, { treasury: 0 });
  const evs = [];
  maybeFiscalReview(w, 5 * 1440, 5, (t2, s2, p2) => evs.push({ type: t2, payload: p2 }));
  const pol = evs.find((e) => e.type === 'policy_changed');
  assert.ok(pol);
  assert.equal(pol.payload.reason, 'runway_welfarecut', '지출 조정이 먼저여야 한다');
  assert.ok(w.policy.welfareAmount >= w.logic.fiscal.stepWelfare, '복지를 0까지 깎았다 — 안전망 한 칸은 남긴다');
  // 복지가 이미 바닥이면 그제야 세율을 올린다
  const w2 = createWorld(4242);
  fiscalStage(w2, { treasury: 0 });
  w2.policy = { welfareAmount: w2.logic.fiscal.stepWelfare }; // 바닥
  const evs2 = [];
  maybeFiscalReview(w2, 5 * 1440, 5, (t2, s2, p2) => evs2.push({ type: t2, payload: p2 }));
  assert.equal(evs2[0].payload.reason, 'runway_taxraise');
  assert.ok(w2.policy.taxPct <= 30, '세율 상한 초과');
});

test('F-3. 선거일에는 쉬고, 하루 1회이며, 리뷰 주기 밖에서는 움직이지 않는다', () => {
  const w = createWorld(4242);
  const cash = w.sims.reduce((n, s) => n + s.money, 0);
  fiscalStage(w, { treasury: cash * 3 });
  w.sims[0].hungerZeroTicks = 100;
  const fire = (day) => {
    const evs = [];
    maybeFiscalReview(w, day * 1440, day, (t2, s2, p2) => evs.push(p2));
    return evs.length;
  };
  assert.equal(fire(15), 0, '선거일(15의 배수)에 움직였다');
  assert.equal(fire(4), 0, '리뷰 주기(5)도 유세 시작일도 아닌데 움직였다');
  assert.equal(fire(5), 1, '리뷰 주기에 안 움직였다');
  assert.equal(fire(5), 0, '같은 날 두 번 움직였다');
  // 유세 시작일(15-3=12일)에도 발화한다 (Rogoff 정치적 예산 순환)
  w.lastFiscalDay = -1;
  assert.equal(fire(12), 1, '유세 시작일에 안 움직였다');
});

test('F-4. 플레이어를 존중한다 — 플레이어 시장이거나 방금 정책을 만졌으면 쉰다', () => {
  const w = createWorld(4242);
  const cash = w.sims.reduce((n, s) => n + s.money, 0);
  fiscalStage(w, { treasury: cash * 3 });
  w.sims[0].hungerZeroTicks = 100;
  // 플레이어 시장
  w.sims.find((s) => s.id === 3).isPlayer = true;
  const evs = [];
  maybeFiscalReview(w, 5 * 1440, 5, (t2, s2, p2) => evs.push(p2));
  assert.equal(evs.length, 0, '플레이어 시장인데 NPC 로직이 통치했다');
  // 플레이어가 정책을 방금 만졌다
  const w2 = createWorld(4242);
  fiscalStage(w2, { treasury: cash * 3 });
  w2.sims[0].hungerZeroTicks = 100;
  w2.playerPolicyDay = 3; // 5 - 3 < reviewIntervalDays(5)
  const evs2 = [];
  maybeFiscalReview(w2, 5 * 1440, 5, (t2, s2, p2) => evs2.push(p2));
  assert.equal(evs2.length, 0, '플레이어의 내구 입력을 시장이 곧바로 되돌렸다');
});

test('F-5. 재정 행동이 결정적이고 왕복을 견딘다', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 30 * 1440); advance(b, {}, 30 * 1440);
  assert.equal(hashWorld(a), hashWorld(b));
  const w2 = deserialize(serialize(a));
  assert.equal(hashWorld(a), hashWorld(w2));
  advance(a, {}, 3000); advance(w2, {}, 3000);
  assert.equal(hashWorld(a), hashWorld(w2), '왕복 뒤 세계가 갈라졌다');
});

test('H-5. 챙김은 곁다리 수다 스위치와 독립이다 (117차 A)', () => {
  // 예전에는 도움 분기가 sideTalkFactorPct > 0 게이트 안에 있어서 수다를 끄면
  // 챙김까지 조용히 죽었다.
  const w = createWorld(4242);
  w.logic.social.sideTalkFactorPct = 0; // 수다를 꺼도
  const giver = w.sims[0]; const target = w.sims[1];
  const fac = w.map.facilities.find((f) => f.type === 'cafe');
  giver.state = { ...giver.state, kind: 'performing', action: 'socialize', facilityId: fac.id, pairedTicks: 0, sideTalkTicks: 0 };
  target.state = { ...target.state, kind: 'performing', action: 'eat', facilityId: fac.id, pairedTicks: 0, sideTalkTicks: 0 };
  target.sick = { kind: 'cold', untilTick: 99999 };
  w.logic.social.approachBasePct = 100;
  const evs = [];
  maybeApproach(w, 1000, 0, (t2, s2, p2) => evs.push({ type: t2 }), new Set());
  assert.ok(evs.some((e) => e.type === 'helped'), '수다를 끄니 챙김까지 죽었다');
  assert.equal(evs.some((e) => e.type === 'side_talk'), false);
});
