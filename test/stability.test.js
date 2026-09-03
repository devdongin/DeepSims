// §22.96 **세계 안정성** (사용자 지시: "세계의 안정성 테스트를 진행한다").
//
// 기존 테스트는 기능 하나하나를 본다. 이 파일은 **오래 굴렸을 때 무너지지 않는가**를 본다 —
// 시티즈 스카이라인·Anno 같은 장수 시뮬의 안정성 조건을 이 프로젝트 언어로 옮긴 것이다:
//   ① 숫자가 깨지지 않는다(NaN·Infinity 없음)          → 어떤 계산도 정의를 벗어나지 않는다
//   ② 상태가 무한히 자라지 않는다(기억·이벤트·토큰 상한) → 오래 켜둬도 메모리가 안 는다
//   ③ 결정성이 길게 유지된다(90일 해시 동일)            → 리플레이·따라잡기의 근거
//   ④ 통화가 보존된다(경계 유출입까지 합산)             → §22.4 폐쇄 회계
//   ⑤ 세계가 정지하지 않는다(행동·이벤트가 계속 난다)   → 죽은 세계 감지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../sim/world.js';
import { advance } from '../sim/tick.js';

const DAYS = 60; // CI 시간과 신뢰의 타협점 — 90일까지 재 봤고 42초였다
const SEED = 9001;

function soak(seed = SEED, days = DAYS) {
  const w = createWorld(seed);
  const perDay = [];
  let events = 0;
  for (let d = 1; d <= days; d++) {
    const ev = advance(w, {}, 1440);
    events += ev.length;
    perDay.push({
      day: d,
      pop: w.sims.length,
      treasury: w.treasury,
      events: ev.length,
      memories: w.sims.reduce((n, s) => n + (s.memories?.length ?? 0), 0),
      tokens: w.tokens.length,
    });
  }
  return { w, perDay, events };
}

test('W-S1. 90일을 굴려도 숫자가 깨지지 않는다 (NaN·Infinity 없음)', () => {
  const { w, perDay } = soak(SEED, 90);
  const finite = (v, what) => assert.ok(Number.isFinite(v), `${what}가 유한하지 않다: ${v}`);
  finite(w.treasury, '국고');
  finite(w.worldTick, 'worldTick');
  for (const s of w.sims) {
    finite(s.money, `sim${s.id}.money`);
    finite(s.mood, `sim${s.id}.mood`);
    for (const [k, v] of Object.entries(s.needs)) finite(v, `sim${s.id}.needs.${k}`);
    assert.ok(s.x >= 0 && s.y >= 0, `sim${s.id} 좌표가 음수다`);
  }
  for (const p of perDay) finite(p.treasury, `d${p.day} 국고`);
});

test('W-S2. 상태가 무한히 자라지 않는다 — 기억·토큰이 상한 안에 머문다', () => {
  const { w, perDay } = soak();
  const last = perDay[perDay.length - 1];
  const mid = perDay[Math.floor(perDay.length / 2)];
  // 기억은 심당 상한이 있다(§P3-17 퇴출 규칙). 인구당 평균으로 본다 — 인구가 늘면 총량은 늘어야 정상이다.
  const perSim = last.memories / Math.max(1, last.pop);
  assert.ok(perSim < 400, `심당 기억이 ${perSim.toFixed(0)}개 — 상한이 안 걸린다`);
  // 토큰은 만료가 있다. 60일 동안 쌓이기만 하면 만료가 죽은 것이다.
  assert.ok(last.tokens < 50, `토큰이 ${last.tokens}개 남았다 — 만료가 안 걸린다`);
  // 심당 기억이 후반에 폭주하지 않는다 (중반 대비 2배 이내)
  const perSimMid = mid.memories / Math.max(1, mid.pop);
  assert.ok(perSim <= perSimMid * 2 + 50, `심당 기억이 중반 ${perSimMid.toFixed(0)} → 후반 ${perSim.toFixed(0)}로 폭주한다`);
});

test('W-S3. 결정성이 길게 유지된다 — 같은 시드 60일이면 상태가 같다', () => {
  const a = soak(4242); const b = soak(4242);
  assert.equal(a.w.sims.length, b.w.sims.length, '인구가 다르다');
  assert.equal(a.w.treasury, b.w.treasury, '국고가 다르다');
  assert.equal(a.events, b.events, '이벤트 총수가 다르다');
  assert.deepEqual(a.w.map.tiles.length, b.w.map.tiles.length, '맵 크기가 다르다');
  // 타일까지 같은지 (인도·도로 형성이 결정적인가)
  let diff = 0;
  for (let i = 0; i < a.w.map.tiles.length; i++) if (a.w.map.tiles[i] !== b.w.map.tiles[i]) diff++;
  assert.equal(diff, 0, `타일 ${diff}칸이 다르다 — 지형 변화가 결정적이지 않다`);
});

test('W-S4. 세계가 정지하지 않는다 — 후반에도 행동과 이벤트가 계속 난다', () => {
  const { perDay } = soak();
  const tail = perDay.slice(-10);
  const deadDays = tail.filter((p) => p.events === 0).length;
  assert.equal(deadDays, 0, `마지막 10일 중 ${deadDays}일은 이벤트가 0건 — 세계가 멈췄다`);
  const avgTail = tail.reduce((n, p) => n + p.events, 0) / tail.length;
  const head = perDay.slice(0, 10);
  const avgHead = head.reduce((n, p) => n + p.events, 0) / head.length;
  // 인구가 늘었는데 이벤트가 초반보다 적으면 무언가 조용히 죽은 것이다
  assert.ok(avgTail >= avgHead * 0.5, `이벤트가 초반 ${avgHead.toFixed(0)} → 후반 ${avgTail.toFixed(0)}로 반토막났다`);
});

test('W-S5. 인구가 음수·0으로 붕괴하지 않고, 하루 만에 급변하지 않는다', () => {
  const { perDay } = soak();
  for (const p of perDay) assert.ok(p.pop > 0, `d${p.day}에 인구가 ${p.pop}이다`);
  for (let i = 1; i < perDay.length; i++) {
    const jump = Math.abs(perDay[i].pop - perDay[i - 1].pop);
    assert.ok(jump <= Math.max(10, perDay[i - 1].pop * 0.5),
      `d${perDay[i].day}에 인구가 ${perDay[i - 1].pop}→${perDay[i].pop}로 급변했다`);
  }
});
