// §22.74 **레버가 실제로 세계를 움직이는가** (사용자 지적: "전체테스트에 정책이나
// 가중치들이 잘 동작하는지에 대한것도 넣어야 겠는데?").
//
// 기존 테스트는 두 층이었다:
//   ① 단위 — 순수 함수 하나 (persFactorFor 클램프, pickW 비례, 회고 점수식)
//   ② 계약 — 결정성·리플레이·직렬화 왕복
// 빠진 층은 ③ **행동**이다: 파라미터를 하나만 바꿔 세계를 두 번 굴리고,
// 결과가 그 방향으로 갈리는지 본다. 단위 테스트로는 "식이 맞다"까지만 알 수 있고
// "그 식이 세계를 움직인다"는 알 수 없다.
//
// 규칙(§0.1): 여기서 검사하는 것은 **레버가 연결돼 있는가**이지 수치가 예쁜가가 아니다.
// 그래서 단조 방향만 본다 — "세율을 올리면 세수가 는다" 같은.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { advance } from '../sim/tick.js';

const DAYS = 12;
const run = (seed, tweak) => {
  const w = createWorld(seed);
  if (tweak) tweak(w);
  const ev = advance(w, {}, DAYS * 1440);
  const count = (t) => ev.filter((e) => e.type === t).length;
  const sum = (t, f) => ev.filter((e) => e.type === t).reduce((a, e) => a + f(e), 0);
  const actions = {};
  for (const e of ev) if (e.type === 'action_completed') actions[e.payload.action] = (actions[e.payload.action] ?? 0) + 1;
  return { world: w, ev, count, sum, actions };
};

test('W-0. 대조군이 유효하다 — 파라미터를 안 바꾸면 두 실행이 완전히 같다', () => {
  const a = run(4242, null); const b = run(4242, null);
  assert.equal(a.ev.length, b.ev.length, '같은 시드인데 이벤트 수가 다르다');
  assert.equal(a.world.treasury, b.world.treasury, '같은 시드인데 국고가 다르다');
  assert.equal(a.world.sims.length, b.world.sims.length, '같은 시드인데 인구가 다르다');
  // 이 테스트가 깨지면 아래 A/B는 전부 의미가 없다 — 차이가 파라미터 때문이 아니게 된다.
});

test('W-1. 세율 레버가 연결돼 있다 — 올리면 세수가 는다', () => {
  const low = run(4242, (w) => { w.logic.economy.taxPct = 5; });
  const high = run(4242, (w) => { w.logic.economy.taxPct = 30; });
  const tax = (r) => r.sum('money_changed', (e) => (e.payload.action === 'work' ? -Math.min(0, e.payload.delta) : 0));
  // 임금 실수령은 세율만큼 깎인다. 같은 노동량이면 실수령 합이 줄어야 한다.
  const netLow = low.sum('money_changed', (e) => (e.payload.action === 'work' ? e.payload.delta : 0));
  const netHigh = high.sum('money_changed', (e) => (e.payload.action === 'work' ? e.payload.delta : 0));
  assert.ok(netLow > 0 && netHigh > 0, '근로 소득 이벤트가 없다 — 표본이 성립하지 않는다');
  assert.ok(netHigh < netLow, `세율 30%의 실수령 합(${netHigh})이 5%(${netLow})보다 크다 — 세율 레버가 안 걸린다`);
});

test('W-2. 복지 레버가 연결돼 있다 — 문턱을 올리면 수혜가 는다', () => {
  // 국고를 양쪽 **똑같이** 채워 둔다. 기본 세계는 12일 내내 적자라(이슈 #105)
  // 복지가 한 번도 안 나가서 레버를 시험할 수 없다 — 수치를 예쁘게 만들려는 게 아니라
  // 레버가 작동하는 조건을 만들어 주는 것이다. 차이는 오직 문턱뿐이다.
  const fund = (w) => { w.treasury = 500000; };
  const tight = run(4242, (w) => { fund(w); w.logic.economy.welfareThreshold = 50; });
  const loose = run(4242, (w) => { fund(w); w.logic.economy.welfareThreshold = 2000; });
  const t = tight.count('welfare_paid'); const l = loose.count('welfare_paid');
  assert.ok(l > t, `문턱 2000의 복지 지급(${l})이 문턱 50(${t})보다 많아야 한다`);
});

test('W-3. 성격 가중치가 행동을 바꾼다 — socializeBase를 올리면 사교가 는다', () => {
  const lowS = run(4242, (w) => { w.logic.persFactor.socializeBase = 50; });
  const highS = run(4242, (w) => { w.logic.persFactor.socializeBase = 290; });
  const a = lowS.actions.socialize ?? 0; const b = highS.actions.socialize ?? 0;
  assert.ok(a + b > 0, 'socialize 행동이 아예 없다 — 표본이 성립하지 않는다');
  assert.ok(b > a, `가중치 290의 사교(${b})가 50(${a})보다 많아야 한다 — persFactor가 안 걸린다`);
});

test('W-4. 행동 지속시간 레버가 연결돼 있다 — 길게 하면 완료 수가 준다', () => {
  const quick = run(4242, (w) => { w.logic.actions.play.duration = 20; });
  const slow = run(4242, (w) => { w.logic.actions.play.duration = 240; });
  const q = quick.actions.play ?? 0; const s = slow.actions.play ?? 0;
  assert.ok(q + s > 0, 'play 행동이 없다 — 표본이 성립하지 않는다');
  assert.ok(s < q, `오래 걸리는 놀이 완료 수(${s})가 짧을 때(${q})보다 많다 — duration이 안 걸린다`);
});

test('W-5. 레버를 바꿔도 결정성은 유지된다 — 같은 파라미터면 같은 세계', () => {
  const t = (w) => { w.logic.economy.taxPct = 25; w.logic.persFactor.socializeBase = 200; };
  const a = run(777, t); const b = run(777, t);
  assert.equal(a.ev.length, b.ev.length, '같은 파라미터인데 이벤트 수가 다르다');
  assert.equal(a.world.treasury, b.world.treasury, '같은 파라미터인데 국고가 다르다');
  assert.deepEqual(a.actions, b.actions, '같은 파라미터인데 행동 분포가 다르다');
});
