// 시뮬레이션 엔진: 따라잡기 + 라이브 루프 (PLAN §5).
// 라이브 루프도 매 반복 computeTarget으로 목표를 재계산한다 (PLAN §1).
import fs from 'node:fs';
import { advance } from '../sim/tick.js';
import { computeTarget, TICK_DURATION_MS } from '../sim/time.js';
import { TICKS_PER_DAY } from '../sim/constants.js';
import { simVolatile, staticKey, railView } from './view.js'; // 전송 투영·정적 변경 감지
import { validateLogic, logicHash, POLICY_FIELDS } from '../sim/logic.js';
import { publicBalance } from '../sim/government.js';

const BATCH_TICKS = TICKS_PER_DAY; // 따라잡기 배치 = 게임 1일
// §22.1 관람 배속 상한. ×48이면 실시간 1시간 = 게임 1년이다
// (1년 = yearDays 120 × 1440틱 = 172,800틱, ÷48 = 3,600초).
// 달력(1년=120일, 1일=1440분)은 건드리지 않는다 — 바뀌는 건 관람 속도뿐이다 (89차 ①).
// §23.42 하루가 10분이 되면서 ×1이 2.4 tick/s다. 예전 ×48(48 tick/s)은 이제 ×20에
// 해당하고, 그 위는 **엔진이 못 낸다** — 인구 249 세계 실측 상한이 47.6 tick/s다.
// 낼 수 없는 배속을 버튼에 두면 사용자는 ×48을 누르고 ×24를 받는다(성능 리뷰가 잡은 결함).
export const MAX_SPEED = 20;
const LIVE_COMMIT_TICKS = 30;      // §17.0: 라이브 커밋 주기 (미커밋 유실은 스냅샷+입력 재생으로 복구)

export class Engine {
  constructor(storage, { seed, now = () => Date.now() }) {
    this.storage = storage;
    this.now = now;
    const loaded = storage.loadOrCreate({ seed, nowUtcMs: now() });
    this.world = loaded.world;
    this.epochUtcMs = loaded.epochUtcMs;
    // §22.11 배속은 epoch와 한 쌍이다 — 저장된 값으로 복원하지 않으면 ×48 기준
    // epoch에 ×1로 붙어 rawTarget이 현재 틱 아래로 떨어지고 세계가 멈춘다.
    this.speed = loaded.speed ?? 1;
    this.createdNow = loaded.created === true; // §22.7 이번 실행에서 새 마을을 만들었는가
    storage.retargetStaleInputs(this.world.worldTick, now());
    storage.pruneEvents(this.world.worldTick);
    const filled = storage.backfillChronicle(); // §23.1 최초 1회: 남아 있는 이벤트에서 일대기 씨앗
    if (filled > 0) console.log(`  연대기 초기화: ${filled}줄`);
    storage.pruneChronicle();
    // §22.12 라이브 프루닝: 부팅에만 걸면 켜 둔 세션에서 events가 무한 증가한다
    // (실측 107게임일 205,092행·53.8MB, 시간당 +31MB). 일 경계를 지난 첫 커밋 뒤에
    // 다시 프루닝한다 — 커밋 트랜잭션과 분리된 후행 트랜잭션이라 커밋 순서와 충돌하지
    // 않고, cutoff(30일 전)는 pendingEvents 범위(최근 ≤30틱)와 절대 겹치지 않는다.
    // DB 정리일 뿐 world를 건드리지 않으므로 결정성 계약과 무관하다.
    this.lastPruneDay = Math.floor(this.world.worldTick / TICKS_PER_DAY);
    this.catchingUp = false;
    this.catchupPromise = null;
    this.liveTimer = null;
    this.pendingEvents = [];
    this.pendingApplied = [];
    this.uncommittedFrom = undefined;
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
        speed: this.speed ?? 1,
      });
      // 두 클램프는 원인이 다르다 — 로그가 둘을 구분해야 진단이 된다 (§22.11).
      // ahead는 초과분을 실제로 폐기한 것이고, behind는 아무것도 안 버리고 epoch만
      // 다시 고정한 것이다. 하나로 뭉뚱그리면 "따라잡기 완료"라는 태연한 로그 뒤에서
      // 세계가 멈춰 있어도 아무도 모른다.
      if (cap.clampedAhead) {
        this.storage.opsLog(this.now(), 'catchup_clamped', {
          discardedToTick: cap.target, epochReanchored: cap.newEpochUtcMs,
        });
      } else if (cap.clampedBehind) {
        this.storage.opsLog(this.now(), 'epoch_reanchored', {
          atTick: cap.target, epochReanchored: cap.newEpochUtcMs, speed: this.speed ?? 1,
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
      // 따라잡는 도중 배속이 바뀌었다면 여기서 재기준화한다 (74차 ①).
      if (this.speedChangedDuringCatchup) {
        this.speedChangedDuringCatchup = false;
        this.rebaseEpoch();
      }
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
    this.pendingEvents = [];
    this.uncommittedFrom = this.world.worldTick;
    this.speed ??= 1; // §20 배속 (서버 런타임 — 시뮬 상태 아님)
    this.pruneAfterCommit(); // §22.12 따라잡기 배치(=1일)에서도 매일 프루닝 — 긴 부재도 상한 유지
    return { fromTick, toTick: this.world.worldTick, events };
  }

  // §22.12 커밋 **후행** 일일 프루닝. 반드시 commitBatch가 끝난 뒤에만 부른다 —
  // 프루닝은 별도 트랜잭션이라 커밋 원자성에 끼어들지 않고, 대상(30일 전 이하)은
  // 이미 커밋된 행뿐이다. runLive의 n이 아무리 커도 flushLive가 pending을 전부
  // 커밋한 **다음**에 여기 오므로, 미커밋 이벤트가 cutoff에 걸릴 경로는 없다.
  // 하루에 한 번만 실제 작업이 생기고, 경계가 아니면 정수 비교 한 번으로 끝난다.
  // lastPruneDay는 **성공 후에** 갱신한다 (Codex 교차 리뷰 ②) — 프루닝이 던지면
  // 미갱신이라 다음 커밋에서 재시도되고, 실패 자체는 커밋 실패와 같은 부류의
  // DB 오류이므로 삼키지 않는다 (PLAN §4: 손상 = 안전 정지).
  pruneAfterCommit() {
    const day = Math.floor(this.world.worldTick / TICKS_PER_DAY);
    if (day <= this.lastPruneDay) return;
    const deleted = this.storage.pruneEvents(this.world.worldTick);
    // §22.97 집계도 접는다 — 안 접으면 events는 30일인데 집계는 영구 누적이다
    const rolled = this.storage.rollupOldAggregates(this.world.worldTick);
    this.storage.pruneChronicle(); // §23.1 일대기 상한 (사람당 120줄 · 마을 600줄)
    if (rolled > 0) console.log(`  집계 롤업: ${rolled}행 접음 (90일 이전, 마을 단위로 합산)`);
    this.lastPruneDay = day;
    if (deleted > 0) this.storage.opsLog(this.now(), 'events_pruned', { deleted, day });
  }

  // §17.0 라이브 전용: 커밋 없이 전진, LIVE_COMMIT_TICKS마다(또는 입력 소비 시) 커밋.
  // 크래시 시 미커밋 구간은 스냅샷+내구 입력 재생으로 결정적 복구 (테스트 8 계약).
  runLive(n) {
    const fromTick = this.world.worldTick;
    const upto = fromTick + n;
    const inputsByTick = this.storage.getPendingInputs(upto);
    const events = advance(this.world, inputsByTick, n);
    const appliedIds = Object.entries(inputsByTick)
      .filter(([t]) => Number(t) <= this.world.worldTick)
      .flatMap(([, arr]) => arr.map((i) => i.id));
    this.pendingEvents.push(...events);
    this.pendingApplied.push(...appliedIds);
    this.uncommittedFrom ??= fromTick;
    const due = this.world.worldTick - this.uncommittedFrom >= LIVE_COMMIT_TICKS
      || this.pendingApplied.length > 0;
    if (due) this.flushLive();
    return { fromTick, toTick: this.world.worldTick, events };
  }

  flushLive() {
    if (this.uncommittedFrom === undefined || this.world.worldTick === this.uncommittedFrom) return;
    this.storage.commitBatch({
      world: this.world, events: this.pendingEvents, appliedInputIds: this.pendingApplied,
      epochUtcMs: this.epochUtcMs,
    });
    this.pendingEvents = [];
    this.pendingApplied = [];
    this.uncommittedFrom = this.world.worldTick;
    this.speed ??= 1; // §20 배속 (서버 런타임 — 시뮬 상태 아님)
    this.pruneAfterCommit(); // §22.12 라이브 일 경계 — 커밋이 실제로 일어난 뒤에만 온다
  }

  // §20 배속: epoch를 "지금이 곧 현재 틱"이 되도록 재기준화한다.
  // ceil을 쓴다: floor면 절삭분만큼 epoch가 늦게 잡혀 재기준화마다 1틱씩 영구히
  // 잃는다 (배속을 자주 바꾸면 누적된다). ceil은 epoch를 아주 조금 이르게 잡아
  // 목표가 현재 틱 아래로 내려가지 않게 한다 — 남는 소수 틱은 floor가 흡수한다.
  rebaseEpoch() {
    this.epochUtcMs = this.now() - Math.ceil((this.world.worldTick * TICK_DURATION_MS) / (this.speed ?? 1));
    // (epoch, speed)를 **한 트랜잭션에** 내린다 (Codex 100차 ②). 재기준화는 시뮬 시간을
    // 버리지 않고 시계만 다시 맞추는 일이라 배치 커밋을 기다릴 이유가 없고, 기다리면
    // 그 창에서 죽었을 때 짝이 어긋난 채로 남는다.
    this.storage.setClock({ epochUtcMs: this.epochUtcMs, speed: this.speed ?? 1 });
  }

  // §20 배속 변경. 재기준화로 시간축이 튀지 않게 한다.
  // 따라잡기 중이라면 즉시 재기준화하지 않는다 — catchUp은 시작 시 캡처한 target까지
  // 계속 전진하므로, 중간 worldTick 기준으로 epoch를 잡으면 따라잡기가 그 지점을
  // 지나친 뒤 라이브 목표가 현재 틱에 묶여 시간이 멈춘다 (74차 ①). 대신 플래그만
  // 세워두고 catchUp이 끝난 직후 재기준화한다.
  setSpeed(speed) {
    const s = Math.max(1, Math.min(MAX_SPEED, Math.floor(Number(speed) || 1)));
    if (s === this.speed) return this.speed;
    this.speed = s;
    // 저장은 rebaseEpoch가 (epoch, speed)를 함께 내리며 처리한다 — 여기서 speed만
    // 따로 쓰면 짝이 어긋난다. 따라잡기 중이면 **아무것도 쓰지 않는다**: 지금 디스크에
    // 있는 쌍은 서로 맞는 상태이고, 여기서 죽으면 배속 변경만 잃을 뿐 세계는 멀쩡하다.
    if (this.catchingUp) this.speedChangedDuringCatchup = true;
    else this.rebaseEpoch();
    return this.speed;
  }

  startLive() {
    if (this.liveTimer) return;
    this.liveTimer = setInterval(() => {
      if (this.catchingUp) return;
      const cap = computeTarget({
        nowUtcMs: this.now(), epochUtcMs: this.epochUtcMs, lastSimulatedTick: this.world.worldTick,
        speed: this.speed ?? 1,
      });
      this.epochUtcMs = cap.newEpochUtcMs;
      // 반복당 최대 1일치 — 긴 슬립 후에도 이벤트 루프를 블록하지 않고 다음 반복에서 이어 따라잡음
      const n = Math.min(cap.target - this.world.worldTick, BATCH_TICKS);
      if (n <= 0) return;
      const batch = this.runLive(n);
      batch.publicTreasury=publicBalance(this.world);
      batch.rail=railView(this.world.rail);
      batch.worldEvents=this.world.worldEvents;
      batch.policyDefaults=Object.fromEntries(Object.keys(POLICY_FIELDS).map(key=>[key,this.world.logic.economy[key]]));
      // §22.8 sims는 **화면이 쓰는 필드만** 투영해 보낸다 (라이브 실측 71배 절감).
      // §23.39 배치에는 **변동분만** 싣는다. 정적 부분(이름·특성·능력치·학력)은 클라이언트마다
      // 마지막으로 보낸 키와 비교해 달라진 사람만 index.js가 골라 붙인다. simRefs는 내부
      // 전달용이라 소켓으로 나가지 않는다 (index.js가 필드를 골라 새 객체를 만든다).
      this.emit({ type: 'tickBatch', ...batch, sims: this.world.sims.map(simVolatile),
        statKeys: this.world.sims.map(staticKey), simRefs: this.world.sims, villages:this.world.villages,
        treasury: this.world.treasury, incidents: this.world.incidents, cityTier: this.world.cityTier, projects: this.world.projects, statsToday: this.world.statsHistory[this.world.statsHistory.length - 1] ?? null, speed: this.speed ?? 1, transit: this.world.transit ?? null, unlockedIndustries:this.world.unlockedIndustries ?? [], housingMarket:this.world.housingMarket, householdDaily:this.world.householdDaily });
    }, 250);
  }

  stopLive() {
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
    this.flushLive(); // 마지막 퇴장·종료 시 미커밋 플러시
  }

  // 입력 접수 — 따라잡기 중엔 target 부여를 완료까지 보류 (PLAN §3)
  async submitInput({ clientInputId, command, payload }) {
    if (this.catchupPromise) await this.catchupPromise;
    return this.storage.addInput({
      clientInputId, command, payload, targetTick: this.world.worldTick + 1,
    });
  }

  // 로직 파일 정합 (PLAN §14.1 부팅 정합 ①~③): 유효 대기 로직 = 마지막 pending logic_update,
  // 없으면 world.logic. 파일과 다르면 새 revision으로 등록. 부팅·fs.watch 공용.
  reconcileLogic(paramsPath) {
    let fileParams;
    try {
      fileParams = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
    } catch (err) {
      this.storage.opsLog(this.now(), 'logic_file_unreadable', { error: String(err).slice(0, 200) });
      return { registered: false, reason: 'unreadable' };
    }
    const v = validateLogic(fileParams);
    if (!v.ok) {
      this.storage.opsLog(this.now(), 'logic_file_invalid', { errors: v.errors.slice(0, 10) });
      return { registered: false, reason: 'invalid', errors: v.errors };
    }
    // 유효 대기 로직 = **검증을 통과한** 마지막 pending (손상 pending은 틱에서 결정적 input_rejected됨)
    const pending = this.storage.getPendingLogicUpdates();
    let effective = this.world.logic;
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i].payload;
      // tick()의 applyLogicUpdate와 동일한 완전 술어 — 하나라도 다르면 무효 pending이 정합을 억제함
      if (p && typeof p === 'object' && !Array.isArray(p)
        && typeof p.hash === 'string' && Number.isSafeInteger(p.revision)
        && validateLogic(p.params).ok && logicHash(p.params) === p.hash) {
        effective = p.params;
        break;
      }
    }
    const fileHash = logicHash(fileParams);
    if (logicHash(effective) === fileHash) return { registered: false, reason: 'unchanged' };
    const revision = this.storage.getMetaInt('logicRevision', 0) + 1;
    this.storage.setMetaInt('logicRevision', revision);
    const result = this.storage.addInput({
      clientInputId: `logic:${revision}:${fileHash}`,
      command: 'logic_update',
      payload: { params: fileParams, hash: fileHash, revision },
      targetTick: this.world.worldTick + 1,
    });
    this.storage.opsLog(this.now(), 'logic_update_registered', { revision, hash: fileHash, targetTick: result.targetTick });
    return { registered: true, revision, hash: fileHash };
  }

  // 부팅 정합 ⑤: 따라잡기 후 파일과 world.logic 일치 단정. 불일치 시 경고 + 재정합 (PLAN §14.1)
  assertLogicSynced(paramsPath) {
    try {
      const fileParams = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
      if (validateLogic(fileParams).ok && logicHash(fileParams) !== logicHash(this.world.logic)) {
        this.storage.opsLog(this.now(), 'logic_sync_mismatch', {
          file: logicHash(fileParams), world: logicHash(this.world.logic),
        });
        this.reconcileLogic(paramsPath); // 다음 틱에 적용되도록 재정합
        return false;
      }
    } catch { /* unreadable — 이미 reconcile에서 기록 */ }
    return true;
  }
}
