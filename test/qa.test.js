// §22.12 QA 패스에서 나온 결함들의 회귀 테스트.
// 전문 QA 엔지니어 페르소나가 클론을 받아 100분간 검수하며 찾은 것들이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 클라이언트 조사 규칙을 여기서 다시 정의하지 않고 실제 소스에서 읽어 검증한다 —
// 규칙을 베껴 오면 동어반복이 되고, 소스가 바뀌어도 테스트가 안 깨진다.
const CLIENT = fs.readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');

test('#112 employer changes appear in the default story feed', () => {
  const source = CLIENT.match(/const FEED_STORY = new Set\(\[[\s\S]*?\]\);/);
  assert.ok(source, 'story filter must exist');
  const story = new Function(`${source[0]}; return FEED_STORY;`)();
  for (const type of ['employment_started', 'employment_ended']) {
    assert.ok(story.has(type), `${type} must not be hidden by the default filter`);
  }
});

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

test('QA-11. 고립 서로게이트가 대체문자를 사칭하지 못한다 (Codex 103차 ①)', () => {
  // TextEncoder는 고립 서로게이트를 U+FFFD로 치환한다. 길이 접두만으로는
  // "\uD800"과 "�"가 같은 바이트열이 됐다. 플레이어 이름은 사용자 입력이라
  // 실제로 도달 가능한 경로다.
  const mk = (v) => { const w = createWorld(4242); w.sims[0].name = v; return w; };
  assert.notEqual(hashWorld(mk('\uD800')), hashWorld(mk('�')), '고립 서로게이트가 U+FFFD를 사칭한다');
  assert.notEqual(hashWorld(mk('\uDC00')), hashWorld(mk('�')), '후행 서로게이트가 U+FFFD를 사칭한다');
  assert.notEqual(hashWorld(mk('𐀀')), hashWorld(mk('\uD800')), '유효 페어와 고립이 같게 보인다');
  // 키에 구분자가 들어가도 안전하다
  const a = createWorld(4242); a.sims[0].habit = { 'x":1,"y': 1 };
  const b = createWorld(4242); b.sims[0].habit = { x: 1, y: 1 };
  assert.notEqual(hashWorld(a), hashWorld(b), '키 안의 구분자가 구조를 사칭한다');
});

test('QA-12. 순환 참조에서 오라클이 죽지 않는다 (Codex 103차 ④)', () => {
  // 오라클이 스택 오버플로로 죽으면 그것도 눈이 먼 것이다.
  const w = createWorld(4242);
  w.sims[0].self = w.sims[0];
  assert.doesNotThrow(() => hashWorld(w), 'hashWorld가 순환에서 죽는다');
  const bad = findNonFinite(w);
  assert.ok(bad.some((f) => f.value === 'circular'), `순환을 보고하지 않는다: ${JSON.stringify(bad)}`);

  // 형제가 같은 객체를 두 번 참조하는 건 순환이 아니다 — 오탐하면 안 된다
  const shared = { a: 1 };
  const w2 = createWorld(4242);
  w2.sims[0].habit = shared; w2.sims[1].habit = shared;
  assert.deepEqual(findNonFinite(w2), [], '공유 참조를 순환으로 오인한다');
});

// §22.28 배선 누락 방지 — 세계가 기록하는 기억 종류에 클라가 할 말이 있어야 한다.
//
// 이 테스트가 없어서 생긴 일: sim이 38종의 기억을 남기는데 대사 테이블은 13종만
// 알고 있었고, 그중 5종(drank·workout·argument·found_item·built_bed)은 실제로는
// 거의 발생하지 않는 종류였다. 결과적으로 라이브 자기 공개 대사의 **59%**가
// "오늘 ○○에서 별일이 다 있었어" 하나로 뭉개졌다. 가장 자주 기억되는 일
// (sick 138건·unmet 85건·was_helped 32건)일수록 할 말이 없었다.
//
// 배선 없는 새 키는 조용히 죽는다 — car·smoke가 PROP_KEYS 누락으로 안 보이던
// §22.10과 같은 부류다. 기억 종류를 늘리면 이 테스트가 먼저 깨지게 둔다.
test('QA-13. §22.28 모든 기억 종류에 memory_share 대사가 있다', async () => {
  const params = JSON.parse(
    fs.readFileSync(new URL('../logic/params.json', import.meta.url), 'utf8'),
  );
  const kinds = Object.keys(params.memory.importance);
  assert.ok(kinds.length > 30, `기억 종류를 못 읽었다 (${kinds.length}종)`);

  // conversationLine의 memory_share switch 본문만 떼어내 case 라벨을 모은다.
  const start = CLIENT.indexOf("case 'memory_share': {");
  assert.ok(start > 0, 'memory_share 분기를 찾지 못했다');
  const end = CLIENT.indexOf("case 'work_gripe': {", start);
  assert.ok(end > start, 'memory_share 분기의 끝을 찾지 못했다');
  const body = CLIENT.slice(start, end);
  const handled = new Set([...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));

  const missing = kinds.filter((k) => !handled.has(k));
  assert.deepEqual(missing, [],
    `대사 없는 기억 종류(기본 문장으로 뭉개진다): ${missing.join(', ')}`);
});

// §22.33 직업별 대사 배선 누락 방지 — QA-13(기억 종류)의 직업판이다.
//
// 이 테스트가 없어서 생긴 일: 세계에는 16개 직업이 있는데 대사 테이블은 10개만
// 알았다. 라이브 358건 중 106건(30%)이 분기 없는 직업(worker 34·child 22·nurse 20·
// civil_servant 15·politician 15)이라 전부 "일이 너무 많아…" 세 줄로 나왔다.
// 간호사도 공장 노동자도 시장도 아이도 똑같은 말을 하고 있었다.
//
// 직업을 하나 늘리면 이 테스트가 먼저 깨지게 둔다.
test('QA-14. §22.33 모든 직업에 work_gripe 대사가 있다', async () => {
  const { OCCUPATIONS } = await import('../sim/traits.js');
  assert.ok(OCCUPATIONS.length >= 15, `직업 목록을 못 읽었다 (${OCCUPATIONS.length}종)`);

  // work_gripe 분기의 객체 리터럴만 떼어 키를 모은다.
  const start = CLIENT.indexOf("case 'work_gripe': {");
  assert.ok(start > 0, 'work_gripe 분기를 찾지 못했다');
  const end = CLIENT.indexOf("case 'food': {", start);
  assert.ok(end > start, 'work_gripe 분기의 끝을 찾지 못했다');
  const body = CLIENT.slice(start, end);
  const handled = new Set([...body.matchAll(/^\s{8}([a-z_]+):\s*\[/gm)].map((m) => m[1]));

  const missing = OCCUPATIONS.filter((o) => !handled.has(o));
  assert.deepEqual(missing, [],
    `대사 없는 직업(기본 문장 세 줄로 뭉개진다): ${missing.join(', ')}`);
});

// §22.35 가족 대화 짝 표가 온전한지 — 발화와 응답이 어긋날 자리를 구조로 없앴는지 확인.
//
// 예전에는 발화 배열과 응답 배열이 따로 있었고, pick()이 tick으로 각각 뽑았다.
// 그래서 "또 언성이 높아졌어"에 "가족이 최고지"가 돌아갈 수 있었고, 한쪽 배열에만
// 줄을 더하면 조용히 어긋났다. 지금은 [발화, 응답] 한 줄이 최소 단위다.
test('QA-15. §22.35·§22.38 대화 짝 표가 [발화, 응답] 구조를 지킨다', () => {
  const m = CLIENT.match(/const FAMILY_TALK = \{[\s\S]*?\n\};/);
  assert.ok(m, 'FAMILY_TALK 표를 찾지 못했다');
  const helpers = "const ga=(w)=>w+'이',wa=(w)=>w+'와',eul=(w)=>w+'을',"
    + "eun=(w)=>w+'는',rang=(w)=>w+'랑',ne=(w)=>w+'네';";
  const FAMILY_TALK = new Function(`${helpers}${m[0]}; return FAMILY_TALK;`)();

  for (const rel of ['child', 'parent']) {
    const rows = FAMILY_TALK[rel];
    assert.ok(Array.isArray(rows) && rows.length >= 8, `${rel} 표가 비었다`);
    rows.forEach((row, i) => {
      assert.equal(row.length, 2, `${rel}[${i}]는 [발화, 응답] 두 칸이어야 한다`);
      assert.equal(typeof row[0], 'function', `${rel}[${i}] 발화는 이름을 받는 함수여야 한다`);
      assert.equal(typeof row[1], 'string', `${rel}[${i}] 응답은 문자열이어야 한다`);
      assert.ok(row[0]('아무개').length > 0, `${rel}[${i}] 발화가 빈 문자열이다`);
      assert.ok(row[1].length > 0, `${rel}[${i}] 응답이 빈 문자열이다`);
    });
  }

  // §22.38 날씨도 같은 짝 구조다. 여기선 실제로 어긋나 있었다 —
  // §22.29에서 공용 응답 풀에 넣은 '우산은 챙겼어?'가 맑은 날 대사에 돌아갔다.
  const wm = CLIENT.match(/const WEATHER_TALK = \{[\s\S]*?\n\};/);
  assert.ok(wm, 'WEATHER_TALK 표를 찾지 못했다');
  const WEATHER_TALK = new Function(`${wm[0]}; return WEATHER_TALK;`)();
  for (const kind of ['sunny', 'cloudy', 'rain']) {
    const rows = WEATHER_TALK[kind];
    assert.ok(Array.isArray(rows) && rows.length >= 6, `${kind} 표가 비었다`);
    rows.forEach((row, i) => {
      assert.equal(row.length, 2, `${kind}[${i}]는 [발화, 응답] 두 칸이어야 한다`);
      assert.equal(typeof row[0], 'string', `${kind}[${i}] 발화는 문자열이어야 한다`);
      assert.equal(typeof row[1], 'string', `${kind}[${i}] 응답은 문자열이어야 한다`);
      assert.ok(row[0].length > 0 && row[1].length > 0, `${kind}[${i}]에 빈 칸이 있다`);
    });
    // 맑은 날에 우산 얘기가 섞이면 안 된다 (그 반대도)
    if (kind === 'sunny') {
      const bad = rows.filter((r) => r.join(' ').includes('우산'));
      assert.deepEqual(bad, [], '맑은 날 짝에 우산이 들어 있다');
    }
  }
});

// §22.36 스프라이트가 심의 성별·나이와 모순되지 않는다 (사용자 지적).
//
// 예전 archOf는 직업만 보고 traits.gender·traits.age를 아예 읽지 않았다. 서버는
// 그 둘을 이미 보내고 있었는데(server/view.js) 클라가 안 쓴 것이다. 제복 스프라이트는
// 성별이 하나씩뿐이라(경찰·의사·교사·요리사 여성, 소방관·점원·노동자 남성) 직업만
// 보면 반드시 절반이 어긋난다 — 라이브 104명 중 39명(36%)이 반대 성별이었고,
// 87세가 청년으로 그려졌다.
//
// 여기서 고정하는 것은 **영구 불변식**이다: 나이대는 언제나 맞아야 하고, 성인은
// 성별이 모순되면 안 된다. (노년 여성·여아 스프라이트는 아직 없어서 그 둘만 예외이고,
// 에셋이 생기면 이 테스트를 건드리지 않고도 저절로 만족된다.)
test('QA-16. §22.36 스프라이트가 성별·나이와 모순되지 않는다', async () => {
  const { OCCUPATIONS } = await import('../sim/traits.js');
  const grabConst = (n) => {
    const i = CLIENT.indexOf(`const ${n} = {`);
    assert.ok(i > 0, `${n}을 찾지 못했다`);
    let d = 0;
    for (let k = CLIENT.indexOf('{', i); k < CLIENT.length; k++) {
      if (CLIENT[k] === '{') d++;
      else if (CLIENT[k] === '}') { d--; if (d === 0) return CLIENT.slice(i, k + 2); }
    }
    return null;
  };
  const m = CLIENT.match(/function archOf\(sim\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'archOf를 찾지 못했다');
  const src = grabConst('ARCH_OF_OCCUPATION') + grabConst('ARCH_LOOK') + grabConst('GENERIC_ARCH')
    + 'const GENERIC_ARCH_ANY=[...GENERIC_ARCH.M,...GENERIC_ARCH.F];'
    + 'const CHILD_MAX_AGE=15,OLD_MIN_AGE=65;';
  const { archOf, ARCH_LOOK } = new Function(`${src}${m[0]}; return {archOf, ARCH_LOOK};`)();

  const band = (age) => (age < 15 ? 'child' : age >= 65 ? 'old' : 'adult');
  const ageBad = [];
  const genderBad = [];
  for (const occupation of OCCUPATIONS) {
    for (const gender of ['F', 'M', 'X']) {
      for (const age of [3, 10, 16, 30, 45, 64, 66, 80]) {
        for (const id of [0, 1, 2, 7]) {
          const look = ARCH_LOOK[archOf({ id, traits: { gender, age, occupation } })];
          assert.ok(look, `원형에 ARCH_LOOK 항목이 없다 (${occupation}/${gender}/${age})`);
          if (look.band !== band(age)) ageBad.push(`${occupation}/${gender}/${age}세→${look.band}`);
          // 성인 구간에서 성별이 정면으로 모순되면 안 된다 (X는 모순 대상이 아니다)
          const contradicts = (gender === 'F' && look.g === 'M') || (gender === 'M' && look.g === 'F');
          if (band(age) === 'adult' && contradicts) {
            genderBad.push(`${occupation}/${gender}/${age}세`);
          }
        }
      }
    }
  }
  assert.deepEqual(ageBad.slice(0, 5), [], `나이대가 어긋난다 (${ageBad.length}건)`);
  assert.deepEqual(genderBad.slice(0, 5), [], `성인의 성별이 모순된다 (${genderBad.length}건)`);
});

// §22.39 가중 선택과 질문-응답 사슬.
//
// 두 가지를 고정한다:
//  ① pickW가 무게대로 뽑는가 — 무게가 곧 그 말이 나오는 빈도다.
//  ② QA_CHAINS의 키가 **실제로 나올 수 있는 문장인가.** 오타나 옛 문장이 키로 남으면
//     그 사슬은 영원히 안 걸린다 — §22.28(기억 종류)·§22.33(직업)·§22.30(프롭)에서
//     세 번 반복된 "등록은 됐는데 도달 불가" 결함과 같은 부류다. 사이클이 매 회차
//     이 표를 늘리므로 여기서 막지 않으면 조용히 죽은 줄이 쌓인다.
test('QA-17. §22.39 pickW가 무게대로 뽑고, QA_CHAINS 키가 전부 도달 가능하다', async () => {
  const occModule = await import('../sim/traits.js');
  const { ACTIONS } = await import('../sim/constants.js');
  const MEMORY_KINDS = Object.keys(JSON.parse(
    fs.readFileSync(new URL('../logic/params.json', import.meta.url), 'utf8'),
  ).memory.importance);
  const grabConst = (n, open = '{') => {
    const close = open === '{' ? '}' : ']';
    const i = CLIENT.indexOf(`const ${n} = `);
    assert.ok(i > 0, `${n}을 찾지 못했다`);
    let d = 0;
    for (let k = CLIENT.indexOf(open, i); k < CLIENT.length; k++) {
      if (CLIENT[k] === open) d++;
      else if (CLIENT[k] === close) { d--; if (d === 0) return CLIENT.slice(i, k + 2); }
    }
    return null;
  };
  const grabFn = (n) => {
    const i = CLIENT.indexOf(`function ${n}(`);
    assert.ok(i > 0, `${n}을 찾지 못했다`);
    let d = 0;
    for (let k = CLIENT.indexOf('{', i); k < CLIENT.length; k++) {
      if (CLIENT[k] === '{') d++;
      else if (CLIENT[k] === '}') { d--; if (d === 0) return CLIENT.slice(i, k + 1); }
    }
    return null;
  };
  const helpers = "const PLACE_KO={park:'공원',cafe:'카페',restaurant:'식당',hospital:'병원',site:'공사장',library:'도서관'};"
    + "function hasJong(w){const c=String(w??'').trim().slice(-1);if(!c)return false;"
    + "const x=c.charCodeAt(0);if(x>=0xAC00&&x<=0xD7A3)return (x-0xAC00)%28!==0;return false;}"
    + "const ga=(w)=>w+(hasJong(w)?'이':'가'),wa=(w)=>w+(hasJong(w)?'과':'와'),"
    + "eul=(w)=>w+(hasJong(w)?'을':'를'),eun=(w)=>w+(hasJong(w)?'은':'는'),"
    + "rang=(w)=>w+(hasJong(w)?'이랑':'랑'),ne=(w)=>w+(hasJong(w)?'이네':'네');"
    + "const simName=(id)=>'아무개';const fmtClock=()=>'3시';";
  const src = helpers + grabConst('WEATHER_TALK') + grabConst('WEATHER_FALLBACK', '[')
    + grabConst('ACTION_TRY_KO') + grabConst('FAMILY_TALK') + grabConst('QA_CHAINS')
    + grabFn('hash32') + grabFn('pick') + grabFn('pickW') + grabFn('weatherPair') + grabFn('actKo')
    + grabFn('placeKo') + grabFn('conversationLine');
  // §22.89 placeKo가 시설 ID를 world에서 조회하게 바뀌면서(내부 키 노출 수정) 하네스에
  // world가 필요해졌다. 빈 세계를 준다 — 이 검사는 **문장 공간**을 훑는 것이지 특정
  // 시설을 보는 게 아니므로, 조회가 비어도 폴백 경로로 정상 동작해야 맞다.
  const { pickW, QA_CHAINS, conversationLine } = new Function(
    `var world = { map: { facilities: [] }, sims: [] };\n${src}; return {pickW, QA_CHAINS, conversationLine};`)();

  // ① 무게 **비율대로** 뽑히는가 (§22.67: tick을 그대로 인덱스로 쓰지 않고 해시로 섞는다.
  //    예전에는 t를 직접 나눠 정확히 500/300/200이 나왔지만, 실제 대화는 30틱 간격으로만
  //    일어나므로 그 규칙에서는 **한 줄로 고정**됐다. 이제 분모는 전체 무게이고 빈도는 근사한다.)
  const rows = [[5, 'a'], [3, 'b'], [2, 'c']];
  const near = (got, exp, tol, what) => assert.ok(Math.abs(got - exp) <= exp * tol,
    `${what}: ${got}회는 기대 ${exp}회에서 ${(100 * tol).toFixed(0)}% 넘게 벗어났다`);
  const cnt = { a: 0, b: 0, c: 0 };
  for (let t = 0; t < 2000; t++) cnt[pickW(rows, t)[1]]++;
  near(cnt.a, 1000, 0.12, '연속 tick a(무게 5)');
  near(cnt.b, 600, 0.15, '연속 tick b(무게 3)');
  near(cnt.c, 400, 0.18, '연속 tick c(무게 2)');

  // ② **실제 대화 간격(30틱)** 에서도 비율이 나오는가 — 이 회귀가 §22.67의 본론이다.
  const strideCnt = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 1000; i++) strideCnt[pickW(rows, 1000 + i * 30, '7>9')[1]]++;
  for (const k of ['a', 'b', 'c']) assert.ok(strideCnt[k] > 0, `30틱 간격에서 ${k}가 한 번도 안 나온다`);
  near(strideCnt.a, 500, 0.2, '30틱 간격 a');
  near(strideCnt.c, 200, 0.25, '30틱 간격 c');

  // ③ 쌍이 다르면 같은 tick이라도 답이 갈릴 수 있다 (시드가 실제로 쓰이는가)
  const samePair = new Set(); const otherPair = new Set();
  for (let i = 0; i < 40; i++) { samePair.add(pickW(rows, 500 + i * 30, '1>2')[1]); otherPair.add(pickW(rows, 500 + i * 30, '3>4')[1]); }
  assert.ok(samePair.size >= 2 && otherPair.size >= 2, '한 쌍 안에서도 답이 여러 개 나와야 한다');

  // 음수 tick도 유효한 행을 준다
  assert.ok(rows.includes(pickW(rows, -3)), '음수 tick에서 유효한 행이 안 나온다');
  for (const t of [-1, -7, -100]) {
    assert.ok(rows.includes(pickW(rows, t)), `tick ${t}에서 유효한 행이 안 나온다`);
  }

  // 행 모양
  for (const [q, answers] of Object.entries(QA_CHAINS)) {
    assert.ok(Array.isArray(answers) && answers.length >= 2, `"${q}" 응답이 2개 미만이다`);
    answers.forEach((r, i) => {
      assert.equal(r.length, 2, `"${q}"[${i}]는 [무게, 문장]이어야 한다`);
      assert.ok(Number.isInteger(r[0]) && r[0] > 0, `"${q}"[${i}] 무게가 양의 정수가 아니다`);
      assert.ok(typeof r[1] === 'string' && r[1].length > 0, `"${q}"[${i}] 문장이 비었다`);
    });
  }

  // ② 모든 키가 실제로 나올 수 있는 문장인가 — 발화 공간을 훑어 모은다
  const said = new Set();
  const topics = ['weather', 'family_talk', 'gossip', 'couple_news', 'work_gripe',
    'memory_share', 'politics', 'food', 'party_invite', 'sweet_talk'];
  const details = [{}, { kind: 'sunny' }, { kind: 'cloudy' }, { kind: 'rain' },
    { relation: 'child' }, { relation: 'parent' }, { tier: 'friend', sentiment: 1 },
    { tier: 'acquaintance', sentiment: 1 }, { kind: 'dating', otherId: 2 },
    { kind: 'married', otherId: 2 }, { phase: 'campaign', mayorId: 1 }, { mayorId: 1 },
    { hungry: true }, { hungry: false }, { stage: 'dating' }, { stage: 'married' },
    { placeId: 'park', scheduledTick: 100 }];
  // work_gripe는 occupation으로, memory_share는 kind로 갈린다 — 훑지 않으면
  // 멀쩡한 키를 '도달 불가'로 오판한다(실제로 처음에 그렇게 잘못 잡았다).
  const { OCCUPATIONS } = occModule;
  for (const occupation of OCCUPATIONS) details.push({ occupation });
  for (const kind of MEMORY_KINDS) details.push({ kind, placeId: 'park' }, { kind, placeId: null });
  // unmet의 placeId는 장소가 아니라 **행동 이름**이다(§22.28 — 라이브 값 'eat').
  // 행동을 안 훑으면 '밥 먹으려 …' 계열 키를 도달 불가로 오판한다(3회차에서 그래서 미뤘다).
  for (const action of ACTIONS) details.push({ kind: 'unmet', placeId: action });
  // 정치는 유세(campaign)와 임기 중(그 외 phase) 두 갈래다 — 임기 중이 라이브 2위였다.
  details.push({ phase: 'aftermath', mayorId: 1 });
  for (const topic of topics) {
    for (const detail of details) {
      // §22.67 이후 선택이 tick 해시라 40틱 표본으로는 긴 표의 일부 줄이 안 나온다.
      // 표본을 늘려 "정말 도달 불가"와 "표본이 모자람"을 가른다.
      for (let t = 0; t < 400; t++) {
        said.add(conversationLine({ tick: t, payload: { topic, aboutSimId: 1, placeId: 'park', detail } }));
      }
    }
  }
  const dead = Object.keys(QA_CHAINS).filter((q) => !said.has(q));
  assert.deepEqual(dead, [],
    `아무도 하지 않는 말에 답을 달아 뒀다(영원히 안 걸린다): ${dead.join(' | ')}`);
});

// §22.62 성격(MBTI)이 응답 선택에 곱해진다 (사용자 지시: "대화가 가중치를 그대로
// 따라가려고 하니 성격 +mbti와 같이 가중치를 곱한 값으로 계산한다").
// 표의 무게 = 이 답이 얼마나 흔한가, 성격 = 이 사람이 그런 답을 하는가. 둘을 곱한다.
test('QA-18. §22.62 성격이 응답 분포를 바꾸되, 어떤 답도 죽지 않는다', () => {
  const a = CLIENT.indexOf('function hash32');
  const b = CLIENT.indexOf('\n}', CLIENT.indexOf('function pickWP')) + 2;
  assert.ok(a > 0 && b > a, 'pickW~pickWP 구간을 찾지 못했다');
  const api = new Function(`${CLIENT.slice(a, b)}\nreturn { toneOf, personalityMult, pickWP, pickW };`)();

  // 1) 어조 판정 — 되묻기·반대·공감·담담함
  assert.equal(api.toneOf('뭐 먹을까?'), 'ask');
  assert.equal(api.toneOf('난 별로'), 'deny');
  assert.equal(api.toneOf('고생 많다'), 'warm');
  assert.equal(api.toneOf('아직'), 'flat');

  const ENFP = { EI: 20, SN: 80, TF: 80, JP: 80 }; // 외향·직관·감정·인식
  const ISTJ = { EI: 80, SN: 20, TF: 20, JP: 20 }; // 내향·감각·사고·판단

  // 2) 배수는 정수이고 [40, 220] 안에 있다 — 극단 성격도 답을 죽이지 못한다
  for (const mbti of [ENFP, ISTJ, { EI: 0, SN: 0, TF: 0, JP: 0 }, { EI: 100, SN: 100, TF: 100, JP: 100 }]) {
    for (const line of ['뭐 먹을까?', '난 별로', '고생 많다', '아직']) {
      const m = api.personalityMult(line, mbti);
      assert.ok(Number.isInteger(m), `배수가 정수가 아니다: ${m}`);
      assert.ok(m >= 40 && m <= 220, `배수가 범위를 벗어났다: ${m}`);
    }
  }
  assert.equal(api.personalityMult('아무 말', null), 100, '성격을 모르면 표 무게 그대로여야 한다');

  // 3) 결정성 — 같은 (표, tick, 성격)이면 늘 같은 답
  const rows = [[4, '그건 진짜 힘들지'], [3, '어떻게 참아'], [2, '고생이 많다'], [1, '그래도 할 말은 해야지']];
  for (const t of [0, 7, 41, 1439, 99991]) {
    const first = api.pickWP(rows, t, ENFP)[1];
    for (let i = 0; i < 5; i++) assert.equal(api.pickWP(rows, t, ENFP)[1], first, '같은 입력에 다른 답이 나왔다');
  }

  // 4) 성격이 다르면 분포가 다르다 (같은 표, 같은 tick 범위)
  const dist = (mbti) => {
    const c = {};
    for (let t = 0; t < 400; t++) { const x = api.pickWP(rows, t, mbti)[1]; c[x] = (c[x] ?? 0) + 1; }
    return c;
  };
  const dE = dist(ENFP); const dI = dist(ISTJ);
  assert.notDeepEqual(dE, dI, '성격이 반대인데 분포가 같다 — 곱셈이 작동하지 않는다');
  // 감정형이 공감 답을 더 자주 한다
  assert.ok((dE['그건 진짜 힘들지'] ?? 0) > (dI['그건 진짜 힘들지'] ?? 0), '감정형이 공감 답을 더 자주 해야 한다');

  // 5) 어떤 답도 0회가 되지 않는다 (무게 하한 1)
  for (const mbti of [ENFP, ISTJ]) {
    const d = dist(mbti);
    for (const r of rows) assert.ok((d[r[1]] ?? 0) > 0, `${r[1]}가 ${JSON.stringify(mbti)}에게 영원히 안 나온다`);
  }

  // 6) 표 자체가 한 어조로만 채워져 있으면 성격이 무의미하다 — 다수는 섞여 있어야 한다
  const src = CLIENT.slice(CLIENT.indexOf('const QA_CHAINS'));
  const chains = new Function(`return ${src.slice(src.indexOf('{'), src.indexOf('\n};') + 2)};`)();
  const keys = Object.keys(chains);
  const mixed = keys.filter((k) => new Set(chains[k].map((r) => api.toneOf(r[1]))).size >= 2).length;
  assert.ok(mixed / keys.length >= 0.8, `어조가 섞인 표가 ${mixed}/${keys.length}뿐이다 — 성격 곱셈이 대부분의 대화에서 무의미해진다`);
});

// #107·#110 UI 번역표 배선 누락 방지 — QA-13/14(대사표)의 **라벨판**이다.
//
// 이 테스트가 없어서 생긴 일: 세계에는 직업 16종·행동 18종이 있는데 클라이언트
// 라벨 표는 직업 5종·행동 17종만 알았다. 라이브 주민 173명 중 137명(79%)의 주민
// 패널 직업 칸이 'undefined'였고(child만 71명), 이민 피드는 폴백이 원시 키라
// '(worker)'처럼 영문이 그대로 나갔다. 소방관이 출동할 때마다 피드는
// 'undefined 시작'이었다. enum을 늘리면 이 테스트가 먼저 깨지게 둔다.

// 클라이언트는 Phaser 의존이라 import할 수 없다 — 소스에서 선언을 떼어 실행한다.
function grabDecl(header, open = '{') {
  const close = open === '{' ? '}' : ']';
  const i = CLIENT.indexOf(header);
  assert.ok(i >= 0, `${header}를 찾지 못했다`);
  let d = 0;
  for (let k = CLIENT.indexOf(open, i); k < CLIENT.length; k++) {
    if (CLIENT[k] === open) d++;
    else if (CLIENT[k] === close) { d--; if (d === 0) return CLIENT.slice(i, k + 1); }
  }
  throw new Error(`${header}의 끝을 찾지 못했다`);
}
const labelTable = (name) => {
  const src = grabDecl(`const ${name} = {`);
  return new Function(`return ${src.slice(src.indexOf('{'))};`)();
};

test('QA-19. #107 sim의 모든 직업이 클라이언트 직업 라벨 표에 있다', async () => {
  const { OCCUPATIONS } = await import('../sim/traits.js');
  assert.ok(OCCUPATIONS.length >= 16, `직업 목록을 못 읽었다 (${OCCUPATIONS.length}종)`);

  const table = labelTable('OCC_KO');
  const missing = OCCUPATIONS.filter((o) => table[o] === undefined);
  assert.deepEqual(missing, [],
    `OCC_KO에 없는 직업(주민 패널·이민 피드에 undefined나 영문 키로 나간다): ${missing.join(', ')}`);
  for (const o of OCCUPATIONS) {
    assert.match(table[o], /[가-힣]/, `${o}의 라벨이 한국어가 아니다: ${table[o]}`);
  }

  // 라벨은 한 곳에서만 푼다 — 표를 직접 인덱싱하는 자리가 다시 생기면 폴백이 갈린다.
  const direct = [...CLIENT.matchAll(/OCC_KO\[/g)].length;
  assert.equal(direct, 1, `OCC_KO를 직접 인덱싱하는 자리가 ${direct}곳이다 — occKo()만 쓰게 해라`);
});

test('QA-20. #110 sim의 모든 행동이 클라이언트 행동 라벨 표에 있다', async () => {
  const { ACTIONS } = await import('../sim/constants.js');
  assert.ok(ACTIONS.length >= 18, `행동 목록을 못 읽었다 (${ACTIONS.length}종)`);

  const table = labelTable('ACTION_KO');
  const missing = ACTIONS.filter((a) => table[a] === undefined);
  assert.deepEqual(missing, [],
    `ACTION_KO에 없는 행동(피드가 'undefined 시작'으로 뜬다): ${missing.join(', ')}`);
  for (const a of ACTIONS) {
    assert.match(table[a], /[가-힣]/, `${a}의 라벨이 한국어가 아니다: ${table[a]}`);
  }

  const direct = [...CLIENT.matchAll(/ACTION_KO\[/g)].length;
  assert.equal(direct, 1, `ACTION_KO를 직접 인덱싱하는 자리가 ${direct}곳이다 — actionKo()만 쓰게 해라`);
});

// 표에 없는 키가 들어와도 **원시 키나 undefined가 화면에 나가지 않는다**.
// 표를 채우는 것만으로는 부족하다 — 다음에 sim이 enum을 늘렸을 때 화면이
// 깨지는 대신 일반명으로 버텨야 한다.
test('QA-21. #107·#110 라벨 resolver가 미등록 키를 일반명으로 떨어뜨린다', () => {
  const api = new Function(`${grabDecl('const OCC_KO = {')}
${grabDecl('const ACTION_KO = {')}
${grabDecl('function occKo(')}
${grabDecl('function actionKo(')}
return { occKo, actionKo };`)();

  for (const [name, fn] of [['occKo', api.occKo], ['actionKo', api.actionKo]]) {
    for (const bad of ['no_such_key', 'worker_v2', '', undefined, null]) {
      const out = fn(bad);
      assert.equal(typeof out, 'string', `${name}(${String(bad)})가 문자열이 아니다: ${out}`);
      assert.match(out, /[가-힣]/, `${name}(${String(bad)})가 한국어 일반명이 아니다: ${out}`);
      assert.notEqual(out, String(bad), `${name}이 원시 키를 그대로 화면에 내보낸다: ${out}`);
      assert.doesNotMatch(out, /undefined/, `${name}이 'undefined'를 내보낸다`);
    }
    // 등록된 키는 표 그대로다 (폴백이 정상 라벨을 덮어쓰지 않는다)
    assert.equal(fn === api.occKo ? fn('doctor') : fn('respond_fire'),
      fn === api.occKo ? '의사' : '화재 진압', `${name}이 등록된 키를 잘못 푼다`);
  }
  // 호출자가 준 폴백이 우선한다 (주민 패널의 '대기')
  assert.equal(api.actionKo(undefined, '대기'), '대기');
});

// §23.49 이벤트 문장 배선 누락 방지 — QA-13(기억 종류)·QA-14(직업)의 **이벤트판**이다.
//
// 이 테스트가 없어서 생긴 일: 등록된 이벤트 120종 중 17종이 eventText에 분기가 없어
// 피드에서 통째로 사라지고 있었다. 세계는 잃어버린 돈을 신고하고 돌려주고, 세계
// 이벤트가 시작하고 끝나고, 일자리를 못 구한 사람 때문에 사무실을 짓기로 하는데
// **화면은 그 중 어느 것도 말하지 않았다.** 같은 사고를 기억 대사(§22.28)와 직업
// 대사(§22.33)에서 이미 두 번 겪었다 — 배선 없는 키는 조용히 죽는다(§22.10).
//
// 이벤트를 하나 늘리면 이 테스트가 먼저 깨지게 둔다. 정말 말이 없어야 하는 배관은
// 아래 목록에 **이유와 함께** 올린다 — 침묵은 기본값이 아니라 선택이어야 한다.
const SILENT_BY_DESIGN = new Map([
  ['storyteller_decision', '스토리텔러 내부 판단 기록 — 결과 이벤트가 따로 말한다'],
  ['supply_ordered', '공급망 배관 — 하루 수십 건, 결품(stockout)이 대신 말한다'],
  ['supply_capitalized', '공급망 배관 — 위와 같다'],
  ['goods_purchased', '소비 원장 배관 — money_changed가 사람 쪽에서 말한다'],
  ['goods_produced', '생산 원장 배관 — 위와 같다'],
  ['household_intent_created', '가구 이주 의사 기록 — gathering/departed가 말한다'],
  ['household_intent_applied', '가구 이주 의사 반영 — 위와 같다'],
  ['household_intent_failed', '가구 이주 의사 실패 — 위와 같다'],
  ['construction_relocation_deferred', '자리 못 찾아 미룸 — plot_relocated가 성공 쪽을 말한다'],
]);

test('QA-20. §23.49 등록된 모든 이벤트가 피드 문장을 갖거나 침묵이 명시돼 있다', async () => {
  const { EVENT_TYPES } = await import('../sim/constants.js');
  assert.ok(EVENT_TYPES.length > 100, `이벤트 종류를 못 읽었다 (${EVENT_TYPES.length}종)`);

  const start = CLIENT.indexOf('function eventText');
  assert.ok(start > 0, 'eventText를 찾지 못했다');
  const body = CLIENT.slice(start);
  const handled = new Set([...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));

  const missing = EVENT_TYPES.filter((t) => !handled.has(t) && !SILENT_BY_DESIGN.has(t));
  assert.deepEqual(missing, [],
    `피드에서 조용히 사라지는 이벤트: ${missing.join(', ')} — 문장을 주거나 SILENT_BY_DESIGN에 이유를 적어라`);

  // 반대 방향도 잠근다: 배관이라고 올려놓고 실제로는 사라진 타입이 목록에 남지 않게.
  const stale = [...SILENT_BY_DESIGN.keys()].filter((t) => !EVENT_TYPES.includes(t));
  assert.deepEqual(stale, [], `등록되지 않은 타입이 침묵 목록에 남아 있다: ${stale.join(', ')}`);
});

// §23.48 등록표에 같은 타입이 두 번 들어가는 것을 막는다.
//
// 이 테스트가 없어서 생긴 일: 미등록 이벤트 12종을 이쪽과 병렬 작업이 **각자 따로**
// 고쳐서 EVENT_TYPES가 132개(유일 120개)가 됐다. `.includes` 검사라 동작은 멀쩡했고
// 아무 테스트도 깨지지 않았다 — 그래서 붙잡아 두지 않으면 계속 쌓인다.
// append-only 규약은 "끝에 붙인다"이지 "두 번 붙여도 된다"가 아니다.
test('QA-21. §23.48 이벤트 등록표에 중복이 없다', async () => {
  const { EVENT_TYPES } = await import('../sim/constants.js');
  const seen = new Set(); const dup = [];
  for (const t of EVENT_TYPES) { if (seen.has(t)) dup.push(t); seen.add(t); }
  assert.deepEqual(dup, [], `EVENT_TYPES 중복 등록: ${dup.join(', ')}`);
});
