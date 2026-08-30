// 시뮬레이션 엔진: 따라잡기 + 라이브 루프 (PLAN §5).
// 라이브 루프도 매 반복 computeTarget으로 목표를 재계산한다 (PLAN §1).
import { advance } from '../sim/tick.js';
import { computeTarget } from '../sim/time.js';
import { TICKS_PER_DAY } from '../sim/constants.js';

const BATCH_TICKS = TICKS_PER_DAY; // 따라잡기 배치 = 게임 1일

export class Engine {
  constructor(storage, { seed, now = () => Date.now() }) {
    this.storage = storage;
    this.now = now;
    const loaded = storage.loadOrCreate({ seed, nowUtcMs: now() });
    this.world = loaded.world;
    this.epochUtcMs = loaded.epochUtcMs;
    storage.retargetStaleInputs(this.world.worldTick, now());
    storage.pruneEvents(this.world.worldTick);
    this.catchingUp = false;
    this.catchupPromise = null;
    this.liveTimer = null;
    this.listeners = new Set(); // ({type, ...}) => void
  }

  onBatch(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(msg) { for (const fn of this.listeners) fn(msg); }

  // 목표 캡처 → 배치 따라잡기. 이벤트 루프를 막지 않도록 배치 사이 yield.
  async catchUp() {
    if (this.catchupPromise) return this.catchupPromise;
    this.catchingUp = true;
    this.catchupPromise = (async () => {
      const cap = computeTarget({
        nowUtcMs: this.now(), epochUtcMs: this.epochUtcMs, lastSimulatedTick: this.world.worldTick,
      });
      if (cap.clamped) {
        this.storage.opsLog(this.now(), 'catchup_clamped', {
          discardedToTick: cap.target, epochReanchored: cap.newEpochUtcMs,
        });
      }
      this.epochUtcMs = cap.newEpochUtcMs; // 첫 배치 커밋에 포함 (PLAN §1)
      const target = cap.target;
      while (this.world.worldTick < target) {
        const n = Math.min(BATCH_TICKS, target - this.world.worldTick);
        this.runBatch(n);
        this.emit({
          type: 'catchingUp',
          progress: { current: this.world.worldTick, target },
        });
        await new Promise((r) => setImmediate(r));
      }
      this.catchingUp = false;
      this.catchupPromise = null;
      return target;
    })();
    return this.catchupPromise;
  }

  // n틱 전진 + 원자 커밋. 라이브·따라잡기 공용 (같은 메커니즘의 두 실행 모드).
  runBatch(n) {
    const fromTick = this.world.worldTick;
    const upto = fromTick + n;
    const inputsByTick = this.storage.getPendingInputs(upto);
    const events = advance(this.world, inputsByTick, n);
    const appliedInputIds = Object.entries(inputsByTick)
      .filter(([t]) => Number(t) <= this.world.worldTick)
      .flatMap(([, arr]) => arr.map((i) => i.id));
    this.storage.commitBatch({
      world: this.world, events, appliedInputIds, epochUtcMs: this.epochUtcMs,
    });
    return { fromTick, toTick: this.world.worldTick, events };
  }

  startLive() {
    if (this.liveTimer) return;
    this.liveTimer = setInterval(() => {
      if (this.catchingUp) return;
      const cap = computeTarget({
        nowUtcMs: this.now(), epochUtcMs: this.epochUtcMs, lastSimulatedTick: this.world.worldTick,
      });
      this.epochUtcMs = cap.newEpochUtcMs;
      // 반복당 최대 1일치 — 긴 슬립 후에도 이벤트 루프를 블록하지 않고 다음 반복에서 이어 따라잡음
      const n = Math.min(cap.target - this.world.worldTick, BATCH_TICKS);
      if (n <= 0) return;
      const batch = this.runBatch(n);
      this.emit({ type: 'tickBatch', ...batch, sims: this.world.sims });
    }, 250);
  }

  stopLive() {
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
  }

  // 입력 접수 — 따라잡기 중엔 target 부여를 완료까지 보류 (PLAN §3)
  async submitInput({ clientInputId, command, payload }) {
    if (this.catchupPromise) await this.catchupPromise;
    return this.storage.addInput({
      clientInputId, command, payload, targetTick: this.world.worldTick + 1,
    });
  }
}
