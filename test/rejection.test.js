// §23.47 거절이 호감도·기억·접촉에 닿는다.
//
// 이 세계에서 호감도는 사실상 내려갈 수 없었다 — 20시드 × 100일에서 121명 마을의
// 가장 나쁜 사이가 −59.5 ± 16.1이었고 앙숙 문턱은 −2000이다. 그래서 말다툼·앙숙·
// 이별·moodBaseline.perRival·험담의 부정 분기가 전부 도달 불가 코드였다.
// 세계는 그 사건을 이미 매일 만들고 있었는데(초대 거절 100일에 1,941건) emit 한 줄뿐이었다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, serialize, deserialize, hashWorld } from '../sim/index.js';
import { computeTier } from '../sim/cognition.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';

const L = DEFAULT_LOGIC;

// Codex 리뷰(§23.47 1차)가 재현한 사고의 회귀 테스트다:
//
//     상호작용 39 → 40, 호감 5000/5000 → 4700  →  started_dating
//
// 거절을 `interactions`에 함께 세면 그 카운터가 연애·결혼 문턱까지 연다.
// 이미 서로 좋아하는 두 사람이 문턱 직전이면 **거절 한 번이 연애를 시작시킨다.**
// 호감 하한(datingMin·marryMin)은 그 자리에서 아무것도 막지 못한다 — 호감이 이미
// 충분히 높기 때문이다. 그래서 접촉(contacts)과 대화(interactions)를 나눴다.
test('§23.47 거절은 접촉만 올리고 대화 카운터는 건드리지 않는다 — 거절이 연애를 시작시키면 안 된다', () => {
  const w = createWorld(1000);
  const events = advance(w, {}, 40 * 1440);
  const declines = events.filter((e) => e.type === 'invite_declined').length;
  assert.ok(declines > 100, `표본이 성립하지 않는다 — 거절 ${declines}건`);

  // 대화가 오간 쌍은 두 카운터가 함께 오르고, 거절만 오간 쌍은 contacts만 오른다.
  // 따라서 contacts >= interactions가 모든 쌍에서 성립해야 한다.
  let contactsOnly = 0;
  for (let a = 0; a < w.interactions.length; a++) {
    for (let b = 0; b < w.interactions[a].length; b++) {
      assert.ok(w.contacts[a][b] >= w.interactions[a][b],
        `접촉(${w.contacts[a][b]})이 대화(${w.interactions[a][b]})보다 적다 — ${a}↔${b}`);
      if (w.contacts[a][b] > w.interactions[a][b]) contactsOnly++;
    }
  }
  assert.ok(contactsOnly > 0,
    '거절이 접촉에 전혀 안 잡혔다 — contacts가 interactions와 같으면 앙숙은 다시 태어날 수 없다');
});

test('§23.47 앙숙만 접촉 수를 쓰고, 친구·아는 사이·연애 문턱은 대화 수 그대로다', () => {
  const rivalAff = L.social.rivalAffinity - 1;
  const friendAff = L.social.friendAffinity + 1;
  const enough = L.social.rivalInteractions;

  // 대화는 한 번도 없고 거절만 쌓인 사이 — 접촉으로는 앙숙이 된다.
  assert.equal(computeTier(rivalAff, 0, L, enough), 'rival');
  // 접촉까지 모자라면 아직 앙숙이 아니다 — 한 번 마주친 사람은 원수가 아니다.
  assert.equal(computeTier(rivalAff, 0, L, enough - 1), 'stranger');
  // 친구는 접촉이 아무리 많아도 **대화**가 모자라면 안 된다.
  assert.equal(computeTier(friendAff, L.social.friendInteractions - 1, L, 100000), 'acquaintance');
  assert.equal(computeTier(friendAff, L.social.friendInteractions, L, 0), 'friend');
  // 인자를 안 주면 접촉 = 대화 (구버전 호출부 호환)
  assert.equal(computeTier(rivalAff, enough, L), 'rival');
});

test('§23.47 거절이 실제로 말다툼과 앙숙을 만든다 — 그리고 저장을 왕복해도 같다', () => {
  const w = createWorld(1000);
  const events = advance(w, {}, 60 * 1440);
  const args = events.filter((e) => e.type === 'argument').length;
  let rivals = 0; let worst = 0;
  for (const s of w.sims) {
    for (const id of Object.keys(s.relTiers ?? {})) if (s.relTiers[id] === 'rival') rivals++;
    const row = w.affinity[s.id] ?? [];
    for (const v of row) if (v < worst) worst = v;
  }
  // 여기서 잠그는 것은 **호감이 앙숙 문턱까지 실제로 내려간다**는 것과 **말다툼이 난다**는
  // 것이다. 앙숙 티어 자체는 접촉 30까지 요구해서 마을 규모로 100일쯤 걸리므로
  // (실측: 4시드 100일에 2.3 ± 0.5쌍) 60일 테스트에서 세지 않는다 — 티어 판정 자체는
  // 바로 위 computeTier 단위 테스트가 직접 검사한다.
  assert.ok(worst <= L.social.rivalAffinity,
    `가장 나쁜 사이가 ${worst}로 앙숙 문턱(${L.social.rivalAffinity})에 못 닿는다 — 갈등이 다시 죽었다`);
  assert.ok(args > 0, `말다툼이 한 건도 없다 (앙숙 ${rivals}명, 최저 호감 ${worst})`);
  assert.equal(hashWorld(deserialize(serialize(w))), hashWorld(w), '접촉 행렬이 직렬화를 왕복하지 못한다');
});
