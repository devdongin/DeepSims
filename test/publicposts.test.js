// §23.13 공공 정원 계약. 사용자 지적: "공무원이 너무 많은거지 / 인구수에 맞게
// 공무원수도 설계되어야지." 여기서 못 박는 것은 **정원이 인구를 따라가는가**다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, hashWorld, serialize, deserialize } from '../sim/index.js';
import { publicQuota, publicHeadcount, publicPostAvailable, fillPublicPosts, trimOverQuotaPosts } from '../sim/publicposts.js';
import { DEFAULT_LOGIC, validateLogic } from '../sim/logic.js';

const PUB = DEFAULT_LOGIC.economy.publicWageOccupations;

test('P-1. 정원표의 모든 자리가 공공 임금 직군이다', () => {
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(PUB.includes(occ), `${occ}는 공공 임금 직군이 아닌데 정원표에 있다`);
  }
});

test('P-2. 인구가 문턱 미만이면 그런 자리는 아예 없다', () => {
  const w = createWorld(4242);
  assert.equal(w.sims.length, 10, '초기 인구 가정이 바뀌었다');
  // 열 명 마을에 파출소도 소방서도 병원도 없다 — 그게 정상이다.
  for (const occ of ['police', 'firefighter', 'doctor', 'nurse', 'teacher', 'politician']) {
    assert.equal(publicQuota(w, occ), 0, `인구 10명에 ${occ} 자리가 있다`);
    assert.equal(publicHeadcount(w, occ), 0, `인구 10명인데 ${occ}가 있다`);
  }
  assert.equal(publicQuota(w, 'civil_servant'), 1, '공무원 한 자리는 있어야 한다');
});

test('P-3. 인구가 늘면 자리도 는다', () => {
  const w = createWorld(4242);
  const at = (pop, occ) => { const saved = w.sims.length; w.sims.length = 0; w.sims.length = pop; const q = publicQuota(w, occ); w.sims.length = saved; return q; };
  assert.equal(at(10, 'police'), 0);
  assert.ok(at(60, 'police') >= 1, '예순 명 마을에는 경찰이 있어야 한다');
  assert.ok(at(300, 'police') > at(60, 'police'), '인구가 다섯 배인데 경찰이 안 늘었다');
});

test('P-4. 시작하는 마을이 스스로를 감당한다 — 국고가 첫 주에 무너지지 않는다', () => {
  // 정원제 이전 실측: 인구 10명 중 공공직 6명 → 1일차 국고 −10,766, 14일차 −76,248.
  // 공공 임금은 국고가 전액 보장하므로(§22.23) 태어나자마자 파산하는 마을이었다.
  const w = createWorld(1521715934);
  assert.ok(w.treasury > 0, '시작 국고가 0 이하다');
  const pub = w.sims.filter((s) => PUB.includes(s.traits.occupation)).length;
  assert.ok(pub * 4 <= w.sims.length, `열 명 마을에 공공직이 ${pub}명이다 (4분의 1을 넘겼다)`);
  advance(w, {}, 7 * 1440);
  assert.ok(w.treasury > -20000, `첫 주에 국고가 ${w.treasury}까지 내려갔다`);
});

test('P-5. 자리를 채우되 넘기지 않는다', () => {
  const w = createWorld(9001);
  fillPublicPosts(w); // 멱등이어야 한다 — 이미 채워진 자리를 또 채우지 않는다
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(publicHeadcount(w, occ) <= publicQuota(w, occ),
      `${occ}가 정원(${publicQuota(w, occ)})을 넘었다`);
  }
  assert.equal(fillPublicPosts(w), 0, '두 번째 호출에서 또 뽑았다 — 멱등이 아니다');
});

test('P-6. 90일을 굴려도 공공 비중이 인구를 따라간다', () => {
  const w = createWorld(9001);
  advance(w, {}, 90 * 1440);
  const pub = w.sims.filter((s) => PUB.includes(s.traits.occupation)).length;
  assert.ok(pub > 0, '공공직이 하나도 없다 — 경찰도 의사도 없는 마을이다');
  assert.ok(pub * 3 <= w.sims.length, `공공 비중이 3분의 1을 넘었다 (${pub}/${w.sims.length})`);
  for (const occ of Object.keys(DEFAULT_LOGIC.economy.publicPosts)) {
    assert.ok(publicHeadcount(w, occ) <= publicQuota(w, occ),
      `90일 뒤 ${occ}가 정원을 넘었다 (${publicHeadcount(w, occ)}/${publicQuota(w, occ)})`);
  }
});

test('P-7. 정원 판정은 rng를 쓰지 않는다 — 결정성·직렬화 왕복 유지', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 3 * 1440); advance(b, {}, 3 * 1440);
  assert.equal(hashWorld(a), hashWorld(b));
  assert.equal(hashWorld(a), hashWorld(deserialize(serialize(a))));
});

// §23.14 Codex 합의 검토(−1)에서 재현까지 붙여 온 결함들. 각각을 회귀로 못 박는다.
test('P-8. 굴러가는 마을에서 공공 충원이 민간 인력을 빼 오지 않는다', () => {
  // Codex 재현: 인구 30명 전원을 office_worker로 만든 뒤 충원을 부르면, 무직자가
  // 0명인데도 7명이 공공직으로 옮겨 갔다. "무직 우선 정렬"은 보호가 아니다 —
  // 무직자가 모자라면 그냥 일하던 사람을 데려간다.
  const w = createWorld(4242);
  for (const s of w.sims) s.traits.occupation = 'office_worker';
  const before = w.sims.filter((s) => s.traits.occupation === 'office_worker').length;
  const hired = fillPublicPosts(w); // genesis 아님
  assert.equal(hired, 0, '무직자가 없는데 공공직을 채웠다');
  assert.equal(w.sims.filter((s) => s.traits.occupation === 'office_worker').length, before,
    '일하던 사람의 직업이 바뀌었다');
});

test('P-9. 창세 때는 채우고, 그 뒤로는 무직자만 뽑는다', () => {
  const w = createWorld(9001);
  const PUBSET = new Set(Object.keys(DEFAULT_LOGIC.economy.publicPosts));
  assert.ok(w.sims.some((s) => PUBSET.has(s.traits.occupation)),
    '창세 마을에 공공직이 하나도 없다 — 경찰도 의사도 없는 마을이다');
  // 무직자를 하나 만들면 그 사람이 뽑힌다
  const idle = w.sims.find((s) => !PUBSET.has(s.traits.occupation) && s.traits.occupation !== 'retired');
  idle.traits.occupation = 'jobless';
  w.logic.economy.publicPosts.civil_servant.per = 5; // 자리를 늘려 빈 자리를 만든다
  const hired = fillPublicPosts(w);
  assert.ok(hired >= 1, '무직자가 있는데 아무도 안 뽑혔다');
  assert.notEqual(idle.traits.occupation, 'jobless', '무직자가 아닌 사람을 뽑았다');
  assert.equal(idle.unpaidDays, 0, '새 자리에 밀린 임금이 따라왔다');
});

test('P-10. 초과 공공직은 해마다 비율로 줄어든다 (기존 세이브 연착륙)', () => {
  // 직군당 한 명씩이면 초과 50명은 50년이 걸린다 — 연착륙이 아니라 사실상 방치다
  // (Codex 지적). 비율 감축이라 초과가 클수록 빨리 줄고 마지막 몇 명도 반드시 정리된다.
  const w = createWorld(4242);
  for (const s of w.sims) if (s.traits.age >= 20 && s.traits.age < 60) s.traits.occupation = 'police';
  const before = publicHeadcount(w, 'police');
  assert.ok(before >= 4, `표본이 너무 작다 (${before}명)`);
  const rate = DEFAULT_LOGIC.economy.publicTrimRatePct;
  const expected = Math.min(before, Math.max(1, Math.ceil(before * rate / 100)));
  assert.equal(trimOverQuotaPosts(w), expected, '감축 인원이 비율과 다르다');
  // 끝까지 줄어드는가 — 남은 몇 명이 영원히 남으면 안 된다
  let years = 1;
  while (publicHeadcount(w, 'police') > 0 && years < 40) { trimOverQuotaPosts(w); years++; }
  assert.equal(publicHeadcount(w, 'police'), 0, '초과 인원이 끝내 정리되지 않았다');
  // 25%면 8 → 6 → 4 → 3 → 2 → 1 → 0, 정확히 6번이다 (Codex: 상한만 보면 느려져도 모른다).
  const expectedYears = (() => { let n = before, y = 0; while (n > 0) { n -= Math.min(n, Math.max(1, Math.ceil(n * rate / 100))); y++; } return y; })();
  assert.equal(years, expectedYears, `정리에 ${years}년이 걸렸다 (식대로면 ${expectedYears}년)`);
});

test('P-11. 플레이어도 정원을 지키고, 들고 온 돈은 경계 유입으로 잡힌다', () => {
  // Codex 재현: 인구 11명 마을에 플레이어가 police로 태어났고 경찰 정원은 0이었다.
  // 예전 P-11은 mbti를 문자열 'ENFP'로 넣어 **생성 자체가 거부됐고**, 그래서 아무것도
  // 검증하지 않는 테스트였다 (Codex 지적). 실제 클라이언트와 같은 축 객체로 보낸다.
  const w = createWorld(1);
  const mbti = { EI: 70, SN: 40, TF: 30, JP: 60 };
  const inflowBefore = w.externalInflow ?? 0;
  const inputs = { 5: [{ id: 1, command: 'create_player', payload: { name: '테스트', gender: 'F', mbti } }] };
  const ev = advance(w, inputs, 10);
  const player = w.sims.find((s) => s.isPlayer);
  assert.ok(player, `플레이어가 생성되지 않았다: ${JSON.stringify(ev.filter((e) => e.type === 'input_rejected'))}`);
  const posts = DEFAULT_LOGIC.economy.publicPosts;
  if (posts[player.traits.occupation]) {
    assert.ok(publicHeadcount(w, player.traits.occupation) <= publicQuota(w, player.traits.occupation),
      `플레이어가 정원 ${publicQuota(w, player.traits.occupation)}인 ${player.traits.occupation}으로 태어났다`);
  }
  // G1 폐쇄 회계: 플레이어가 들고 온 돈은 마을 밖에서 들어온 돈이다. 예전에는 이민자
  // 경로에만 있어서 플레이어를 만들 때마다 장부에 구멍이 났다.
  // 생성 순간의 유입액을 정확히 고정한다 (Codex: >= 비교는 10틱 뒤 다른 유입과 섞인다).
  // player_created 시점까지의 이민 유입을 빼면 남는 것이 플레이어 몫이어야 한다.
  const createdTick = ev.find((e) => e.type === 'player_created').tick;
  const immigrantMoney = w.sims.filter((s) => !s.isPlayer && ev.some(
    (e) => e.type === 'immigrated' && e.simId === s.id && e.tick <= createdTick)).length;
  assert.ok((w.externalInflow ?? 0) >= inflowBefore + player.money,
    `플레이어 초기 자금이 경계 유입에 안 잡혔다 (${inflowBefore} → ${w.externalInflow})`);
  // 같은 세계를 플레이어 없이 굴린 대조군과의 차이가 정확히 플레이어의 초기 자금이어야 한다.
  const ctrl = createWorld(1);
  advance(ctrl, {}, 10);
  assert.equal((w.externalInflow ?? 0) - (ctrl.externalInflow ?? 0), player.money,
    `플레이어가 들여온 금액이 장부와 다르다 (이민자 ${immigrantMoney}명 포함 비교)`);
  const created = ev.find((e) => e.type === 'player_created');
  assert.equal(created.payload.occupation, player.traits.occupation, '이벤트의 직업이 실제와 다르다');
});

test('P-12. 공공 임금 직군인데 정원표에 없으면 검증이 막는다', () => {
  const bad = structuredClone(DEFAULT_LOGIC);
  delete bad.economy.publicPosts.police;
  const res = validateLogic(bad);
  assert.equal(res.ok, false, '정원 없는 공공직을 통과시켰다');
  assert.ok(res.errors.some((e) => e.includes('police')), `police 정원 누락을 안 짚었다: ${JSON.stringify(res.errors)}`);
});

// §23.24 회복 후 면역. 감염 모델에 '회복' 칸이 없으면(SIS) 유병률이 구조적으로 높은
// 값에 고정된다 — 실측 46~47%, 90일에 1인당 19번. 이건 수치 문제가 아니라 모델 문제다.
test('D-1. 앓고 나면 한동안 다시 걸리지 않는다', () => {
  const w = createWorld(4242);
  const s = w.sims[0];
  s.sick = { kind: 'cold', untilTick: 10 };
  advance(w, {}, 12);
  assert.equal(s.sick, null, '기간이 지났는데 낫지 않았다');
  assert.ok(s.immuneUntil > w.worldTick, '나은 뒤 면역이 안 생겼다');
  // 면역 동안에는 감염 판정이 통과하지 않는다
  s.needs.hunger = 0; s.needs.energy = 0; // 감염 확률을 최대로 올려도
  const before = s.immuneUntil;
  advance(w, {}, 1440);
  assert.equal(s.sick, null, '면역 기간인데 다시 앓았다');
  assert.equal(s.immuneUntil, before, '면역 기간이 임의로 늘었다');
});

test('D-2. 면역은 rng 소비 순서를 바꾸지 않는다', () => {
  // 드로우는 면역 검사보다 **먼저** 소비한다 — 그래야 해시 계약이 유지된다.
  const a = createWorld(777); const b = createWorld(777);
  a.logic.disease.immuneTicks = 0;   // 면역 없음
  b.logic.disease.immuneTicks = 2880;
  advance(a, {}, 1440); advance(b, {}, 1440);
  assert.equal(JSON.stringify(a.rngSim), JSON.stringify(b.rngSim),
    '면역 유무로 rng 상태가 갈렸다 — 드로우 순서가 어긋났다');
});

test('D-3. 병이 사라지지도, 마을을 뒤덮지도 않는다', () => {
  // 3일 이상 면역은 전염이 스스로 꺼져 병원·의사·see_doctor가 죽은 콘텐츠가 된다.
  // 0일은 절반이 앓는다. 채택값(2일)이 그 사이에 있는지 본다.
  const w = createWorld(9001);
  const ev = advance(w, {}, 60 * 1440);
  const fell = ev.filter((e) => e.type === 'fell_sick').length;
  const sick = w.sims.filter((s) => s.sick).length;
  assert.ok(fell > 0, '60일 동안 아무도 안 아팠다 — 병이 죽은 콘텐츠가 됐다');
  assert.ok(sick * 3 < w.sims.length, `유병률이 3분의 1을 넘었다 (${sick}/${w.sims.length})`);
});
