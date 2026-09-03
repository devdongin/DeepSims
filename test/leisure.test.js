// §23.8 여가 5종(산책·텃밭·악기·봉사·보드게임) 계약 테스트.
// Codex 합의 검토에서 나온 두 지적을 여기서 못 박는다:
//   ① 재실 인원을 심마다 세면 **id 순서가 세계의 의미를 바꾼다**
//   ② 집이 없어서 못 한 집안일을 산업 수요로 세면 원장이 거짓말을 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, advance, hashWorld, serialize, deserialize } from '../sim/index.js';
import { ACTIONS, ACTION_FACILITY, NEED_OF_ACTION, HOME_ONLY_ACTIONS } from '../sim/constants.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { facilityShortfallKind, occupancyAt, tick } from '../sim/tick.js';

const NEW = ['stroll', 'garden', 'music', 'volunteer', 'board_game'];

test('L-1. 새 여가 5종이 표 세 곳에 빠짐없이 등록돼 있다', () => {
  for (const a of NEW) {
    assert.ok(ACTIONS.includes(a), `${a}가 ACTIONS에 없다`);
    assert.ok(DEFAULT_LOGIC.actions[a], `${a}가 logic.actions에 없다`);
    assert.ok(DEFAULT_LOGIC.actions[a].duration >= 1, `${a}의 duration이 없다`);
    const needs = NEED_OF_ACTION[a];
    assert.ok(needs === 'fun' || needs === 'social', `${a}의 회복 욕구가 없다`);
    assert.ok((ACTION_FACILITY[a] ?? []).length > 0, `${a}가 갈 곳이 없다`);
  }
  // 순서는 pickBest의 동점 처리 순서다 — 끝에 붙어야 기존 우선순위가 안 흔들린다.
  assert.deepEqual(ACTIONS.slice(ACTIONS.indexOf(NEW[0]), ACTIONS.indexOf(NEW[0]) + 5), NEW, '기존 여가 행동의 연속 순서는 보존한다 (이후 행동은 append-only)');
});

test('L-2. 텃밭·악기는 자기 집에서만 한다', () => {
  for (const a of ['garden', 'music']) assert.ok(HOME_ONLY_ACTIONS.includes(a), `${a}가 집 전용이 아니다`);
});

test('L-3. 30일을 굴리면 다섯 가지가 실제로 일어난다 (배선 확인)', () => {
  const w = createWorld(4242);
  const ev = advance(w, {}, 30 * 1440);
  const done = {};
  for (const e of ev) if (e.type === 'action_completed') done[e.payload.action] = (done[e.payload.action] ?? 0) + 1;
  for (const a of NEW) assert.ok((done[a] ?? 0) > 0, `${a}가 한 번도 일어나지 않았다 — 배선이 끊겼다`);
});

test('L-4. 한 가지가 여가를 독식하지 않는다', () => {
  // §0.1 수치를 예쁘게 만들려는 게 아니라 **선택지가 죽지 않았는지** 본다.
  // 게이트가 없을 때 보드게임이 480건으로 놀이(71)·독서(72)를 밀어냈다.
  const w = createWorld(4242);
  const ev = advance(w, {}, 30 * 1440);
  const done = {};
  for (const e of ev) if (e.type === 'action_completed') done[e.payload.action] = (done[e.payload.action] ?? 0) + 1;
  const fun = ['board_game', 'stroll', 'play', 'garden', 'music', 'read', 'fish'];
  const total = fun.reduce((a, k) => a + (done[k] ?? 0), 0);
  const top = Math.max(...fun.map((k) => done[k] ?? 0));
  assert.ok(total > 200, `여가 표본이 너무 작다 (${total}건)`);
  assert.ok(top * 2 < total, `한 가지가 여가의 절반을 넘겼다 (${top}/${total})`);
});

test('L-5. 보드게임은 혼자 못 한다 — 그리고 같은 틱의 앞 순번이 동반자가 되지 않는다', () => {
  // Codex 지적: collectCandidates가 심마다 재실을 세면, 앞 순번이 방금 카페에 앉은 것이
  // 뒷 순번에게 보인다. 재현은 되지만 **id 순서가 세계의 의미를 바꾼다.**
  const w = createWorld(4242);
  const cafe = w.map.facilities.find((f) => f.type === 'cafe');
  assert.ok(cafe, '카페가 없다');
  // 카페를 비운다 — 아무도 그 안에 없다.
  for (const s of w.sims) s.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedWith: null, pairedTicks: 0 };
  const before = occupancyAt(w, null).get(cafe.id) ?? 0;
  assert.equal(before, 0, '카페를 비우지 못했다');
  // 두 사람을 카페 문 앞에 세우고 사교·재미를 동시에 비운다.
  const [a, b] = w.sims;
  for (const s of [a, b]) {
    s.x = cafe.door.x; s.y = cafe.door.y;
    s.needs = { hunger: 10000, energy: 10000, social: 100, fun: 100 };
  }
  tick(w, []);
  const chose = [a.state.action, b.state.action];
  assert.ok(!chose.includes('board_game'),
    `빈 카페에서 보드게임이 열렸다 (${chose.join(', ')}) — 앞 순번을 동반자로 셌다`);
});

test('L-6. 집이 없어서 못 한 집안일은 어떤 원장에도 안 들어간다', () => {
  // 집이 없는 것은 **주거 부족**이지 '가구내 자가소비 생산활동 수요'가 아니다.
  const w = createWorld(4242);
  const homeless = w.sims[0];
  homeless.homeId = null;
  for (const a of HOME_ONLY_ACTIONS) {
    assert.equal(facilityShortfallKind(w, homeless, a, 0), null,
      `집 없는 사람의 ${a} 실패가 시설 부족으로 잡혔다`);
  }
  // 집이 있으면 판정을 한다 — 예외가 판정 자체를 삼키면 안 된다.
  // ② 집도 있고 자리도 비었다 → 부족 없음(null)
  const housed = w.sims.find((s) => w.map.facilities.some((f) => f.id === s.homeId));
  assert.ok(housed, '집이 있는 사람이 없다 — 표본이 성립하지 않는다');
  const home = w.map.facilities.find((f) => f.id === housed.homeId);
  assert.equal(facilityShortfallKind(w, housed, 'cook_eat', 0), null, '자리가 비었는데 부족으로 봤다');
  // ③ 집은 있는데 자리가 전부 남에게 잡혔다 → 만석(capacity_full). 시설을 더 짓는 게 아니라
  //    있는 시설을 키우라는 신호이므로 no_facility와 반드시 구분돼야 한다.
  for (const res of home.resources) w.reservations[`${home.id}:${res.id}`] = housed.id + 1000;
  assert.equal(facilityShortfallKind(w, housed, 'cook_eat', 0), 'capacity_full',
    '자리가 다 찼는데 만석으로 안 봤다');
});

test('L-7. 여가를 늘려도 결정성·직렬화 왕복은 그대로다', () => {
  const a = createWorld(777); const b = createWorld(777);
  advance(a, {}, 3 * 1440);
  advance(b, {}, 3 * 1440);
  assert.equal(hashWorld(a), hashWorld(b), '같은 시드인데 세계가 갈렸다');
  assert.equal(hashWorld(a), hashWorld(deserialize(serialize(a))), '직렬화 왕복에서 상태가 샜다');
});
