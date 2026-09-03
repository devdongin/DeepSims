import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateContract } from '../bench/candidate-contract.js';
import { createWorld } from '../sim/world.js';
import { collectCandidates } from '../sim/tick.js';

// 원래는 최적화 이전 328458d에서 뜬 벡터였다. #71(진료 자기부담)까지는 관측만 늘어난
// 변화라 정규화로 옛 벡터를 지킬 수 있었다.
//
// §23.8은 다르다. 여가 5종을 **후보 집합에 넣는 변경**이라, 산책을 택한 사람은 그 뒤로
// 다른 삶을 산다. 이건 정규화로 지울 수 있는 관측 차이가 아니라 세계 자체의 차이다.
// 그래서 여기서만은 벡터를 다시 뜬다 — 옛 값을 억지로 지키려면 새 행동을 후보에서
// 빼야 하는데, 그러면 지키는 대상이 더 이상 이 게임이 아니다.
//
// 이 오라클이 계속 지키는 것: 이 커밋 이후의 리팩터링·최적화가 후보 순서·선택·이벤트·
// 세계 해시를 **한 비트도** 바꾸지 않는가. 벡터를 다시 뜨는 것은 행동 집합이 의도적으로
// 바뀔 때뿐이고, 그때는 이유를 여기 남긴다.
//   328458d (최적화 이전): 7e987d33 / 5c93dd7d / ce050617
//   §23.8   (여가 5종)   : 8aa9fa43 / 23d3d592 / 6e5c98db
//   §23.13  (공공 정원)  : 월드젠 직업 구성이 바뀌므로 첫 후보부터 달라졌다.
//   #93     (일일 임대 정산): 첫 tick 잔액과 이후 선택이 실제로 바뀌므로 다시 고정한다.
//   §23.14  (Codex −1 반영) : 창세 충원 규칙이 바뀌어 월드젠 직업 구성이 또 달라졌다.
//   #89     (사건 페이싱): 실제 발병/화재 배치 변경으로 이후 행동도 바뀐다. 새 전체 상태로 재고정.
//   §23.17  (Codex 재검토)  : world 해시만 움직인다 — 강등의 unpaidDays 초기화와 플레이어
//     초기 자금의 경계 유입 기록은 세계 상태에만 닿는다 (240틱 지평에서 결정 불변).
//   #76     (실물 공급): 유한 재고·재배·운반 행동이 구매와 선택을 실제로 바꿔 재고정한다.
//   #92     (계절·비축): 달력/비축 상태와 구매 이벤트 action을 추가한다. 240틱의 후보·선택은 불변,
//     가을 이후에는 비축·겨울 수확으로 실제 행동이 달라지므로 전체 상태를 새 기준으로 고정한다.
//   #91     (생활 단계): 충족 시간/문화 수요 상태 추가. 첫240틱 후보·선택·이벤트 불변,
//     이후 승급에 따른 새 행동은 의도된 변화다.
//   #32     (마을 저장): 스키마/소속 메타데이터만 추가해 world 해시를 갱신한다.
//     4320틱 원본 대조에서 이벤트·메타데이터 제외 전체 상태가 동일함을 별도 검증했다.
//   §23.24  (회복 후 면역) : 감염 판정이 달라져 발병 시점이 옮겨 간다 — 아픈 사람은
//     욕구 감쇠가 다르므로 그 뒤의 선택도 전부 달라진다. 240틱 지평에서는 아직 발병이
//     갈리지 않아 candidates·choices·events는 그대로이고 world 해시만 움직였다.
//   §23.25  (기분 바닥선) : 인구 200에서는 240틱 안에도 선택이 갈린다 — 바닥선이 높으면
//     mood < 0 조건의 play·socialize 보정이 덜 걸리기 때문이다. 10·50은 world만 움직인다.
//   #32 개척/행정 저장은 mood.baseline 위에 schema70/logic69로 통합했다. main 대비
//     후보·선택·이벤트는 동일하며 개척 관측/저장 필드 때문에 world 해시만 갱신한다.
for (const [pop, expected] of [
  [10, ['0ab9198a', '32b2391b', 'ddff0557', '9d0c4b81']],
  [50, ['5786ecd1', '9a3cd25b', '7885fc6a', '002eb539']],
  [200, ['5dad1750', '0928031a', 'e157d46b', '5d9cd7c0']],
]) {
  test(`#97 pre-optimization ordered candidates, choices, events and world: population ${pop}`, () => {
    assert.deepEqual(Object.values(candidateContract(pop)), expected);
  });
}

test('#97 full facilities never prepare irrelevant memories; self-held seats remain usable', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  for (const f of w.map.facilities) for (const r of f.resources) w.reservations[`${f.id}:${r.id}`] = 99999;
  const ctx = { urgency: true, get prep() { throw new Error('full facility prepared memories'); } };
  assert.deepEqual(collectCandidates(w, sim, ['eat'], 1, true, ctx), []);
  const cafe = w.map.facilities.find(f => f.type === 'cafe');
  const res = cafe.resources[0], key = `${cafe.id}:${res.id}`;
  w.reservations[key] = sim.id;
  assert.equal(collectCandidates(w, sim, ['eat'], 1, true).length, 1);
  sim.noPathCool[key] = 2;
  assert.equal(collectCandidates(w, sim, ['eat'], 1, true).length, 0);
  assert.equal(collectCandidates(w, sim, ['eat'], 2, true).length, 1);
  w.reservations[key] = 99999;
  assert.equal(collectCandidates(w, sim, ['eat'], 2, true).length, 0);
});

test('#97 mall resource-kind filters are not shared between actions', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  const source = w.map.facilities.find(f => f.type === 'cafe');
  w.map.facilities.push({ ...source, id: 'test-mall', type: 'mall', groceryStock: 12, resources: [
    { id: 'till', kind: 'till', x: sim.x, y: sim.y },
    { id: 'seat', kind: 'seat', x: sim.x, y: sim.y },
  ] });
  for (const actions of [['shop', 'play'], ['play', 'shop']]) {
    const c = collectCandidates(w, sim, actions, 1, true).filter(c => c.facilityId === 'test-mall');
    assert.deepEqual(c.map(c => [c.action, c.resourceId]), actions.map(a => [a, a === 'shop' ? 'till' : 'seat']));
  }
});

test('#97 each real resource reservation is read once per decision, not once per action', () => {
  const w = createWorld(20260831), sim = w.sims[0];
  sim.money = 10000;
  const once = collectCandidates(w, sim, ['eat'], 1, true);
  const reads = new Map();
  w.reservations = new Proxy({}, { get(target, key) {
    reads.set(key, (reads.get(key) ?? 0) + 1);
    return target[key];
  } });
  const twice = collectCandidates(w, sim, ['eat', 'eat'], 1, true);
  assert.deepEqual(twice, [...once, ...once]);
  assert.ok(reads.size > 0);
  assert.ok([...reads.values()].every(n => n === 1));
});
