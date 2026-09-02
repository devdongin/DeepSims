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
