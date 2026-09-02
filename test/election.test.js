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

  // ⑤ 기준선이 없으면(첫 임기 이전) 대응 판정 불가 → 배수 유지
  w.termStartPolicy = null;
  w.policy = { taxPct: 5, welfareAmount: 900, welfareThreshold: 1500 };
  assert.equal(policyResponded(w), false);
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
