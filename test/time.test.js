// 시간 모델 테스트 (PLAN §7 6)
import { test } from 'node:test';
import { MAX_SPEED } from '../server/engine.js';
import { DEFAULT_LOGIC } from '../sim/logic.js';
import { TICK_DURATION_MS } from '../sim/constants.js';
import assert from 'node:assert/strict';
import { computeTarget } from '../sim/time.js';
import { createWorld, advance, hashWorld } from '../sim/index.js';
import { Engine } from '../server/engine.js';
import { Storage } from '../db/storage.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TICK = TICK_DURATION_MS; // §23.42 상수에서 — 하루 길이를 바꿔도 안 깨진다
const MAX = 240 * 1440; // §22.1 따라잡기 클램프 (게임 2년치)

test('6a. 기본: 경과 실시간 → 틱', () => {
  const r = computeTarget({ nowUtcMs: 100 * TICK, epochUtcMs: 0, lastSimulatedTick: 50 });
  assert.equal(r.target, 100);
  assert.equal(r.clamped, false);
  assert.equal(r.newEpochUtcMs, 0);
});

test('6b. 시계 역행: target이 lastSimulatedTick 아래로 내려가지 않음', () => {
  const r = computeTarget({ nowUtcMs: 10 * TICK, epochUtcMs: 0, lastSimulatedTick: 500 });
  assert.equal(r.target, 500);
});

test('6c. 30일 클램프 + 앵커 재고정: 재계산 시 target 불변', () => {
  const now = (MAX + 99999) * TICK;
  const r1 = computeTarget({ nowUtcMs: now, epochUtcMs: 0, lastSimulatedTick: 0 });
  assert.equal(r1.target, MAX);
  assert.equal(r1.clamped, true);
  // 재고정된 epoch로 같은 now에서 재계산 → 같은 target (초과분 영구 폐기 검증, PLAN §1)
  const r2 = computeTarget({ nowUtcMs: now, epochUtcMs: r1.newEpochUtcMs, lastSimulatedTick: 0 });
  assert.equal(r2.target, MAX);
  assert.equal(r2.clamped, false, '폐기된 시간이 재등장하지 않음');
});

test('6d. 전진 점프 = 오프라인 경과와 동일 취급', () => {
  const r = computeTarget({ nowUtcMs: 5000 * TICK, epochUtcMs: 0, lastSimulatedTick: 100 });
  assert.equal(r.target, 5000);
});

test('T-8. §20 배속: 목표 틱만 배율, 시뮬 결과는 불변', () => {
  // §23.42 60틱이 걸리는 실시간을 상수에서 구한다 — 배율만 검사하고 값은 안 박는다.
  const base = { nowUtcMs: 60 * TICK_DURATION_MS, epochUtcMs: 0, lastSimulatedTick: 0 };
  assert.equal(computeTarget({ ...base }).target, 60, 'x1 = 60틱');
  assert.equal(computeTarget({ ...base, speed: 2 }).target, 120, 'x2 = 2배');
  assert.equal(computeTarget({ ...base, speed: 3 }).target, 180, 'x3 = 3배');
  // 같은 틱 수를 진행하면 배속과 무관하게 세계가 동일하다 (결정성 계약)
  const a = createWorld(4242);
  const b = createWorld(4242);
  advance(a, {}, 500);
  advance(b, {}, 500);
  assert.equal(hashWorld(a), hashWorld(b), '틱 수가 같으면 결과 동일');
  // 배속 변경 시 epoch 재기준화가 시간축을 연속으로 유지한다
  const t1 = computeTarget({ nowUtcMs: 100_000, epochUtcMs: 0, lastSimulatedTick: 100, speed: 1 });
  const rebased = 100_000 - Math.floor((100 * TICK_DURATION_MS) / 2); // setSpeed(2)의 재기준화 공식
  const t2 = computeTarget({ nowUtcMs: 100_000, epochUtcMs: rebased, lastSimulatedTick: 100, speed: 2 });
  assert.equal(t2.target, 100, '재기준화 직후 목표는 현재 틱 (시간축 점프 없음)');
  assert.ok(t1.target >= 100);
});

test('T-9. §20 따라잡기 중 배속 변경: 완료 후 재기준화되어 시간이 멈추지 않는다', async () => {
  // 회귀 방지 (Codex 74차 ①): catchUp은 시작 시 캡처한 target까지 계속 전진하므로,
  // 중간 worldTick 기준으로 epoch를 잡으면 따라잡기가 그 지점을 지나친 뒤
  // 라이브 목표가 현재 틱에 묶여 세계 시간이 멈춘다.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-speed-'));
  const st = new Storage(path.join(dir, 't.db'));
  let nowMs = 10_000_000;
  const engine = new Engine(st, { seed: 4242, now: () => nowMs });
  engine.setSpeed(1); // This scenario deliberately changes x1 to x3 mid-catch-up.
  // BATCH_TICKS(1440)보다 훨씬 많이 밀려 있어야 배치가 여러 번 돌고, 배속 변경 시점과
  // 따라잡기 종료 시점의 worldTick이 갈라진다 — 그 간극이 바로 이 회귀가 사는 곳이다.
  engine.epochUtcMs = nowMs - 5000 * TICK;

  // 첫 진행 보고 시점 = 따라잡기 한복판에서 배속을 바꾼다
  engine.onBatch((msg) => {
    if (msg.type === 'catchingUp' && engine.speed === 1) engine.setSpeed(3);
  });
  const target = await engine.catchUp();
  assert.equal(engine.speedChangedDuringCatchup ?? false, false, '완료 시 플래그가 소진된다');

  assert.ok(target >= 5000, '따라잡기는 캡처한 목표까지 완주한다');
  assert.equal(engine.speed, 3);
  const t0 = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: engine.epochUtcMs,
    lastSimulatedTick: engine.world.worldTick, speed: engine.speed,
  });
  assert.equal(t0.target, engine.world.worldTick, '재기준화 직후 목표 = 현재 틱 (점프 없음)');

  nowMs += 10 * TICK; // §23.42 배속 1 기준 10틱분 실시간 (틱 길이에서 유도)
  const t1 = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: engine.epochUtcMs,
    lastSimulatedTick: engine.world.worldTick, speed: engine.speed,
  });
  assert.equal(t1.target, engine.world.worldTick + 30, 'x3에서 30틱분 실시간 = 30틱 — 정지하지 않는다');
  st.close();
});

test('T-10. §20 배속은 벽시계를 틱으로 옮기는 배율이다 (달력은 안 건드린다)', () => {
  // §23.42 예전에는 "×48이면 1시간 = 1년"을 값으로 박아 뒀다. 하루 길이(TICK_DURATION_MS)나
  // 한 해 길이(yearDays)를 조정할 때마다 깨지는 테스트는 **규칙이 아니라 값**을 검사한다.
  // 검사하려는 규칙은 하나다: 목표 틱 = 경과 실시간 × 배속 ÷ 틱 길이.
  const YEAR_TICKS = DEFAULT_LOGIC.society.yearDays * 1440;
  const speed = 4;
  const elapsed = YEAR_TICKS * TICK_DURATION_MS / speed; // 1년치를 이 배속으로 지나는 실시간
  const r = computeTarget({ nowUtcMs: elapsed, epochUtcMs: 0, lastSimulatedTick: 0, speed });
  assert.equal(r.target, YEAR_TICKS, '경과 실시간 × 배속 ÷ 틱 길이 = 목표 틱');
  assert.equal(r.clamped, false, '클램프 안에 들어온다');
  assert.equal(YEAR_TICKS / 1440, DEFAULT_LOGIC.society.yearDays, '배속은 달력을 안 바꾼다');
});

test('T-11. §22.1 따라잡기 클램프는 한도까지 버티고, 넘으면 재기준화한다', () => {
  // §23.42 한도(MAX_CATCHUP_TICKS)에 **정확히 닿는** 부재 시간을 상수에서 계산한다.
  const speed = 20;
  const twoHours = MAX * TICK_DURATION_MS / speed;
  const ok = computeTarget({ nowUtcMs: twoHours, epochUtcMs: 0, lastSimulatedTick: 0, speed });
  assert.equal(ok.clamped, false, '한도까지는 버리지 않는다');
  assert.equal(ok.target, MAX);

  // 그 이상은 클램프되고 epoch가 재기준화된다 (세계가 멈추지 않게)
  const over = computeTarget({ nowUtcMs: twoHours * 2, epochUtcMs: 0, lastSimulatedTick: 0, speed });
  assert.equal(over.clamped, true, '한도를 넘으면 클램프');
  assert.equal(over.target, MAX, '한도까지만 진행');
  assert.ok(over.newEpochUtcMs > 0, 'epoch 재기준화 — 다음 목표가 현재 틱 아래로 내려가지 않는다');
  const next = computeTarget({
    nowUtcMs: twoHours * 2, epochUtcMs: over.newEpochUtcMs, lastSimulatedTick: MAX, speed,
  });
  assert.equal(next.target, MAX, '재기준화 직후 목표 = 현재 틱');
});

test('T-12. §22.11 배속 epoch 불일치 → 세계 영구 정지 (플레이테스트 블로커 A)', () => {
  // 가상 플레이어 2인이 독립적으로 밟은 블로커. 최고 배속으로 돌던 세계를 재시작하면
  // speed는 1로 리셋되는데 epoch는 최고 배속 기준으로 DB에 박혀 있다. rawTarget이
  // worldTick 한참 아래로 나오고 역행 클램프가 전진량을 0으로 만드는데,
  // clamped가 **전진** 클램프에서만 켜져 epoch 재고정이 안 일어난다 → 스스로 회복 못 함.
  const tick = 32092;
  const now = 10_000_000_000;
  const epoch48 = now - Math.ceil((tick * TICK) / MAX_SPEED); // rebaseEpoch의 최고 배속 결과
  const r = computeTarget({ nowUtcMs: now, epochUtcMs: epoch48, lastSimulatedTick: tick, speed: 1 });
  assert.equal(r.target, tick, '전진량 0 — 여기까지는 올바른 클램프');
  assert.equal(r.clamped, true, 'epoch가 현재 틱보다 뒤 → 재고정이 필요함을 알려야 한다');

  // 재고정된 epoch로 20초 뒤 → 20틱 전진해야 한다. 고치기 전에는 영원히 0이다.
  const later = now + 20 * TICK;
  const r2 = computeTarget({
    nowUtcMs: later, epochUtcMs: r.newEpochUtcMs, lastSimulatedTick: tick, speed: 1,
  });
  assert.equal(r2.target, tick + 20, '재고정 후에는 실시간만큼 흐른다');
});

test('T-13. §22.11 배속은 재시작 후에도 유지된다 — epoch와 짝이 맞아야 한다', () => {
  // 근본 원인: epoch는 저장되는데 speed는 안 됐다. 둘은 한 쌍이라 따로 두면 어긋난다.
  // 저장돼야 "접속하지 않아도 세계가 흘러간다"는 약속이 배속을 만진 사람에게도 지켜진다.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-speed-persist-'));
  const dbPath = path.join(dir, 't.db');
  let nowMs = 10_000_000;

  const st1 = new Storage(dbPath);
  const e1 = new Engine(st1, { seed: 4242, now: () => nowMs });
  e1.setSpeed(MAX_SPEED);
  assert.equal(e1.speed, MAX_SPEED);
  st1.close();

  // 재시작 — 같은 DB를 다시 연다
  const st2 = new Storage(dbPath);
  const e2 = new Engine(st2, { seed: 4242, now: () => nowMs });
  assert.equal(e2.speed, MAX_SPEED, '배속이 재시작을 넘어 유지된다');

  // 그리고 세계가 실제로 흐른다 (블로커 A의 최종 증상)
  nowMs += 20 * TICK;
  const t = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: e2.epochUtcMs,
    lastSimulatedTick: e2.world.worldTick, speed: e2.speed,
  });
  assert.ok(t.target > e2.world.worldTick, '재시작 후에도 시간이 흐른다');
  st2.close();
});

test('T-14. §22.11 커밋된 logic/params.json이 자기 검증기를 통과한다 (블로커 B)', async () => {
  // 실제 배포 파일을 검증하는 테스트가 하나도 없어서, DEFAULT_LOGIC에 배열 항목이
  // 추가됐는데 커밋된 params가 갱신되지 않은 것을 168개 테스트가 전부 놓쳤다.
  // (test/phase2.test.js는 임시 디렉터리에 자기가 만든 params.json만 쓴다.)
  // 결과: 새로 clone한 사람은 핫스왑이 처음부터 죽어 있고, 콘솔은 아무 말도 안 한다.
  const { validateLogic } = await import('../sim/logic.js');
  const shipped = JSON.parse(fs.readFileSync(new URL('../logic/params.json', import.meta.url), 'utf8'));
  const r = validateLogic(shipped);
  assert.equal(r.ok, true, `커밋된 logic/params.json 검증 실패: ${JSON.stringify(r.errors)}`);
});

test('T-15. §22.11 setSpeed 직후 커밋 전에 죽어도 (epoch, speed) 짝이 맞는다', async () => {
  // Codex 100차 ②: speed만 즉시 저장하고 epoch는 메모리만 갱신하면, 그 창에서
  // 프로세스가 죽었을 때 **새 speed + 옛 epoch**가 디스크에 남는다. 이는 이 절이
  // 고치려던 정지 버그와 같은 부류이고 방향만 반대다 — ×1 기준 epoch에 최고 배속으로 붙어
  // 잘못된 대량 따라잡기가 일어난다.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-clock-atomic-'));
  const dbPath = path.join(dir, 't.db');
  let nowMs = 10_000_000;

  const st1 = new Storage(dbPath);
  const e1 = new Engine(st1, { seed: 4242, now: () => nowMs });
  // 창이 열리려면 worldTick > 0 이어야 한다 — 재기준화 값이 speed로 나뉘기 때문이다.
  // 먼저 ×1로 600틱 따라잡아 epoch를 커밋시킨 뒤 배속을 바꾼다.
  e1.setSpeed(1);
  e1.epochUtcMs = nowMs - 600 * TICK;
  await e1.catchUp();
  assert.equal(e1.world.worldTick, 600);

  e1.setSpeed(MAX_SPEED);          // ← 여기서 epoch가 최고 배속 기준으로 옮겨간다
  const memEpoch = e1.epochUtcMs;
  st1.close(); // ← 배치 커밋 없이 종료 (크래시 흉내)

  const st2 = new Storage(dbPath);
  const e2 = new Engine(st2, { seed: 4242, now: () => nowMs });
  assert.equal(e2.speed, MAX_SPEED, '배속이 저장돼 있다');
  assert.equal(e2.epochUtcMs, memEpoch, 'epoch도 같은 트랜잭션에 함께 저장됐다');

  // 짝이 맞으므로 목표는 현재 틱 — 유령 따라잡기가 없다.
  // 어긋나 있으면 ×1 기준 epoch에 ×48이 곱해져 28,800틱(게임 20일)으로 튄다.
  const t = computeTarget({
    nowUtcMs: nowMs, epochUtcMs: e2.epochUtcMs,
    lastSimulatedTick: e2.world.worldTick, speed: e2.speed,
  });
  assert.equal(t.target, e2.world.worldTick, '재기준화 직후 목표 = 현재 틱 (시간 점프 없음)');
  st2.close();
});

test('T-16. §22.11 새로 clone한 사람은 부팅 즉시 로직 갱신이 걸리지 않는다', async () => {
  // Codex 100차 ⑤: 커밋된 params가 **유효하기만** 해서는 부족하다. 새 세계가 시작하는
  // 로직과 다르면 부팅하자마자 logic_update가 등록돼 아무도 의도하지 않은 거동 변경이
  // 걸린다. DEFAULT가 바뀌었는데 params를 안 고친 경우(블로커 B)와 그 반대를 모두 잡는다.
  const { DEFAULT_LOGIC, logicHash } = await import('../sim/logic.js');
  const shipped = JSON.parse(fs.readFileSync(new URL('../logic/params.json', import.meta.url), 'utf8'));
  assert.equal(
    logicHash(shipped), logicHash(DEFAULT_LOGIC),
    '커밋된 logic/params.json이 새 세계의 시작 로직과 달라 부팅 즉시 갱신이 등록된다',
  );
});
