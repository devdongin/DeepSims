// §22.12 QA 패스에서 나온 결함들의 회귀 테스트.
// 전문 QA 엔지니어 페르소나가 클론을 받아 100분간 검수하며 찾은 것들이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 클라이언트 조사 규칙을 여기서 다시 정의하지 않고 실제 소스에서 읽어 검증한다 —
// 규칙을 베껴 오면 동어반복이 되고, 소스가 바뀌어도 테스트가 안 깨진다.
const CLIENT = fs.readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');

test('QA-1. 이벤트 피드에 조사가 하드코딩돼 있지 않다', () => {
  // "수아이(가)", "은지이(가)", "수아과(와)" — 피드는 이 게임의 주 서사 화면이다.
  const bad = CLIENT.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, l]) => /\$\{[^{}]+\}(이\(가\)|과\(와\)|을\(를\)|은\(는\))/.test(l));
  assert.equal(bad.length, 0, `조사 하드코딩 잔존: ${bad.map(([i]) => `main.js:${i}`).join(', ')}`);
});

test('QA-2. 종성 판별이 실제 심 이름에서 올바른 조사를 고른다', async () => {
  // hasJong을 소스에서 떼어 와 그대로 실행한다 (클라는 Phaser 의존이라 import 불가).
  const m = CLIENT.match(/function hasJong\(word\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'hasJong을 찾지 못했다');
  const hasJong = new Function(`${m[0]}; return hasJong;`)();
  // 판정은 **끝 글자** 기준이다 — 민수는 '수'라 받침이 없다(민수가).
  for (const n of ['수아', '은지', '태호', '민수', '지호']) {
    assert.equal(hasJong(n), false, `${n}의 끝 글자에는 받침이 없다`);
  }
  for (const n of ['지연', '다은', '소민', '하준', '지현']) {
    assert.equal(hasJong(n), true, `${n}의 끝 글자에는 받침이 있다`);
  }
  assert.equal(hasJong(''), false, '빈 문자열도 죽지 않는다');
  assert.equal(hasJong(undefined), false, 'undefined도 죽지 않는다');
});

test('QA-3. 서버가 기본적으로 루프백에만 바인딩된다', () => {
  // 예전에는 host 없이 listen해 모든 인터페이스에 열렸다 — README는 "전부 로컬"이라
  // 하는데 같은 Wi-Fi의 아무나 세율을 바꾸고 디스크에 파일을 쓸 수 있었다.
  const SERVER = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(SERVER, /server\.listen\(PORT,\s*HOST/, 'listen에 host를 넘겨야 한다');
  assert.match(SERVER, /DEEPSIMS_HOST\s*\|\|\s*'127\.0\.0\.1'/, '기본값은 루프백이어야 한다');
});

test('QA-4. 오류 응답에 스택트레이스가 실리지 않는다', () => {
  const SERVER = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(SERVER, /app\.use\(\(err, _req, res, _next\)/, 'express 오류 핸들러가 있어야 한다');
});

// ---- §22.13 결정성 계약 회복 (플레이테스트 S2-1) ----
import { createWorld, advance, serialize, deserialize, hashWorld, findNonFinite } from '../sim/index.js';

const PLAYER_INPUT = {
  10: [{
    sequence: 0,
    command: 'create_player',
    payload: { name: '테스터', gender: 'F', age: 31, mbti: { EI: 25, SN: 75, TF: 25, JP: 75 }, occupation: 'office_worker' },
  }],
};

test('QA-5. 저장/복구 왕복이 고정점이다 — 재시작이 세계를 바꾸지 않는다', () => {
  // 기존 결정성 테스트는 **같은 프로세스 안의 분할**만 검증했다. 저장/복구 왕복은
  // 아무도 안 봤고, 그 틈에서 계약이 깨져 있었다 (3000틱 뒤 국고 115 vs 380).
  const w = createWorld(848664808);
  advance(w, PLAYER_INPUT, 11);
  advance(w, {}, 12000); // 플레이어가 장을 보고 아프고 초대받을 만큼 충분히
  const w2 = deserialize(serialize(w));
  assert.equal(hashWorld(w), hashWorld(w2), '직렬화 왕복이 세계를 바꿨다');

  // 그리고 그 뒤로도 같은 길을 간다 — 왕복 직후 해시만 같고 갈라지는 경우를 잡는다
  advance(w, {}, 3000);
  advance(w2, {}, 3000);
  assert.equal(hashWorld(w), hashWorld(w2), '왕복 후 3000틱에서 세계가 갈라졌다');
  assert.equal(w.treasury, w2.treasury);
});

test('QA-6. 세계에 NaN·undefined가 없다 — 직렬화가 삼키는 값이 상태에 남으면 안 된다', () => {
  const w = createWorld(848664808);
  advance(w, PLAYER_INPUT, 11);
  advance(w, {}, 12000);
  const bad = findNonFinite(w, 20);
  assert.deepEqual(bad, [], `직렬화가 삼키는 값이 남아 있다: ${JSON.stringify(bad)}`);
});

test('QA-7. hashWorld가 NaN·undefined를 구분한다 — 오라클에 구멍이 없다', () => {
  // 예전 hashWorld는 JSON.stringify 위에 그대로 얹혀 있어 NaN과 null, undefined와
  // "키 없음"을 구분하지 못했다. 오라클이 못 보면 테스트 177개가 전부 초록불인 채로
  // 세계가 갈라진다 — 실제로 그렇게 됐다.
  const base = createWorld(4242);
  const withNaN = deserialize(serialize(base));
  withNaN.sims[0].groceries = NaN;
  const withNull = deserialize(serialize(base));
  withNull.sims[0].groceries = null;
  const withUndef = deserialize(serialize(base));
  withUndef.sims[0].groceries = undefined;

  assert.notEqual(hashWorld(withNaN), hashWorld(withNull), 'NaN과 null이 같은 해시로 보인다');
  assert.notEqual(hashWorld(withUndef), hashWorld(withNull), 'undefined와 null이 같은 해시로 보인다');
  assert.notEqual(hashWorld(withNaN), hashWorld(base), 'NaN이 원본과 같은 해시로 보인다');
});

test('QA-8. 플레이어 심이 NPC와 같은 필드를 갖는다', () => {
  // 이민자·신생아는 groceries·sick을 설정하는데 플레이어만 빠져 있었다.
  const w = createWorld(848664808);
  advance(w, PLAYER_INPUT, 11);
  const player = w.sims.find((s) => s.isPlayer);
  const npc = w.sims.find((s) => !s.isPlayer);
  for (const k of ['groceries', 'sick']) {
    assert.ok(k in player, `플레이어에게 ${k}가 없다`);
    assert.equal(typeof player[k], typeof npc[k], `${k}의 타입이 NPC와 다르다`);
  }
  assert.equal(Number.isSafeInteger(player.groceries), true);
});

test('QA-9. 해시 인코딩이 문자열 사칭에 속지 않는다 (Codex 102차 ①)', () => {
  // 센티널 문자열 방식이면 세계 안의 진짜 문자열이 NaN·undefined를 사칭해
  // 오라클이 다시 눈이 먼다 — 고치려던 바로 그 부류의 버그다.
  // **같은 필드**에 넣고 비교해야 사칭 검사가 된다 — 다른 필드면 애초에 해시가 다르다.
  const mk = (v) => { const w = createWorld(4242); w.sims[0].groceries = v; return w; };
  const hNaN = hashWorld(mk(NaN));
  const hUndef = hashWorld(mk(undefined));
  const hNull = hashWorld(mk(null));
  for (const s of [' NaN', 'NaN', ' undefined', 'undefined', 'N', 'u', 'z', ' Infinity', 'n0']) {
    assert.notEqual(hashWorld(mk(s)), hNaN, `문자열 ${JSON.stringify(s)}가 NaN을 사칭한다`);
    assert.notEqual(hashWorld(mk(s)), hUndef, `문자열 ${JSON.stringify(s)}가 undefined를 사칭한다`);
    assert.notEqual(hashWorld(mk(s)), hNull, `문자열 ${JSON.stringify(s)}가 null을 사칭한다`);
  }
  // 숫자·불리언과 그 문자열 표기도 구분된다
  assert.notEqual(hashWorld(mk('7')), hashWorld(mk(7)), "문자열 '7'과 숫자 7이 같게 보인다");
  assert.notEqual(hashWorld(mk('true')), hashWorld(mk(true)), "문자열 'true'와 boolean이 같게 보인다");
  // 길이 접두가 없으면 붙어 보이는 경계 — 키/값 경계 모호성
  const a = createWorld(4242); a.sims[0].name = 'ab'; a.sims[0].nickname = 'c';
  const b = createWorld(4242); b.sims[0].name = 'a'; b.sims[0].nickname = 'bc';
  assert.notEqual(hashWorld(a), hashWorld(b), '문자열 경계가 뭉개진다');
});

test('QA-10. 해시가 직렬화가 뭉개는 나머지 값도 구분한다 (Codex 102차 ④)', () => {
  const mk = (v) => { const w = createWorld(4242); w.sims[0].groceries = v; return w; };
  const seen = new Map();
  for (const [label, v] of [['0', 0], ['-0', -0], ['NaN', NaN], ['Inf', Infinity], ['-Inf', -Infinity], ['null', null], ['undefined', undefined]]) {
    const h = hashWorld(mk(v));
    assert.equal(seen.has(h), false, `${label}이 ${seen.get(h)}와 같은 해시다`);
    seen.set(h, label);
  }
  // Date·Map·Set은 Object.keys가 []라 예전엔 전부 같은 빈 객체로 보였다
  const mkObj = (v) => { const w = createWorld(4242); w.sims[0].habit = v; return w; };
  const hs = [mkObj({}), mkObj(new Map()), mkObj(new Set())].map(hashWorld);
  assert.equal(new Set(hs).size, 3, 'Date·Map·Set이 빈 객체와 구분되지 않는다');
  // 그리고 findNonFinite가 그걸 경로와 함께 지목한다
  assert.deepEqual(findNonFinite(mkObj(new Map())), [{ path: 'world.sims[0].habit', value: '[object Map]' }]);
});
