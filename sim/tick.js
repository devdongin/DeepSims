// 틱 파이프라인 — PLAN §2. state[t] = simulate(state[t-1], inputs[t]).
// tick() 내부의 "오늘"은 반드시 transitionDay = floorDiv(t, 1440) (PLAN 틱 내부 날짜 규약).
import {
  ACTIONS, ACTION_DEFS, DECAY, NEED_MAX, NEED_CRITICAL,
  SCORE_SCALE, WORK_START, WORK_END, ARGUMENT_THRESHOLD, AFFINITY_MIN, AFFINITY_MAX,
} from './constants.js';
import { bfsPath, manhattan } from './pathfind.js';
import { rngInt } from './prng.js';

const NEED_OF_ACTION = { eat: 'hunger', sleep: 'energy', socialize: 'social', play: 'fun' };

function floorDiv(a, b) { return Math.floor(a / b); }
function resKey(facilityId, resourceId) { return `${facilityId}:${resourceId}`; }

// "욕구값" 규약: 낮을수록 급함 (deficit = 10000 - 값). work는 잔액 자체가 욕구값 —
// 돈 0 → deficit 최대 → work 점수 최대.
function needValueFor(sim, action) {
  if (action === 'work') return Math.min(sim.money, NEED_MAX);
  return sim.needs[NEED_OF_ACTION[action]];
}

// 점수: base = floorDiv(num × 1e5, den), den = manhattan + 16 ≥ 16.
// num = (10000-need)² × 16 ≤ 1.6e9 → num×1e5 = 1.6e14 < 2^53 (PLAN §2.5.G 경계 증명)
function scoreCandidate(sim, action, res) {
  const need = needValueFor(sim, action);
  const deficit = NEED_MAX - need;
  const num = deficit * deficit * 16;
  if (num === 0) return 0;
  const den = manhattan(sim.x, sim.y, res.x, res.y) + 16;
  return floorDiv(num * SCORE_SCALE, den);
}

function facilityTypesOf(action) {
  const f = ACTION_DEFS[action].facility;
  return Array.isArray(f) ? f : f === null ? [] : [f];
}

// 하드 제약 (assign·자율 결정 공통). t = 전이 틱 (틱 내부 날짜 규약).
function actionAllowed(world, sim, action, t) {
  if (action === 'eat' && sim.money < -ACTION_DEFS.eat.moneyDelta) return false;
  if (action === 'work') {
    const tod = t % 1440;
    if (tod < WORK_START || tod >= WORK_END) return false;
  }
  return true;
}

// 후보 = (actionType, facilityId, resourceId) 삼중쌍. 자기 예약은 가용 취급 (PLAN §2).
// includeZeroScore: assign은 효용을 무시하고 하드 제약만 검증하므로 0점 후보도 유효 (PLAN §2).
function collectCandidates(world, sim, actions, t, includeZeroScore = false) {
  const out = [];
  for (const action of actions) {
    if (action === 'idle') continue;
    if (!actionAllowed(world, sim, action, t)) continue;
    for (const ftype of facilityTypesOf(action)) {
      for (const fac of world.map.facilities) {
        if (fac.type !== ftype) continue;
        for (const res of fac.resources) {
          const holder = world.reservations[resKey(fac.id, res.id)];
          if (holder !== undefined && holder !== sim.id) continue;
          const score = scoreCandidate(sim, action, res);
          if (score <= 0 && !includeZeroScore) continue;
          out.push({ action, facilityId: fac.id, resourceId: res.id, res, score });
        }
      }
    }
  }
  return out;
}

// argmax + 타이브레이크: score desc → action enum 순 → facilityId → resourceId (PLAN §2)
function pickBest(cands) {
  let best = null;
  for (const c of cands) {
    if (best === null) { best = c; continue; }
    if (c.score !== best.score) { if (c.score > best.score) best = c; continue; }
    const ae = ACTIONS.indexOf(c.action) - ACTIONS.indexOf(best.action);
    if (ae !== 0) { if (ae < 0) best = c; continue; }
    if (c.facilityId !== best.facilityId) { if (c.facilityId < best.facilityId) best = c; continue; }
    if (c.resourceId < best.resourceId) best = c;
  }
  return best;
}

function releaseReservation(world, sim) {
  const s = sim.state;
  if (s.facilityId !== null && s.resourceId !== null) {
    const key = resKey(s.facilityId, s.resourceId);
    if (world.reservations[key] === sim.id) delete world.reservations[key];
  }
}

// 예약 + walking/performing 전이 (원자적). emit은 이벤트 수집기.
function startAction(world, sim, cand, emit) {
  releaseReservation(world, sim);
  world.reservations[resKey(cand.facilityId, cand.resourceId)] = sim.id;
  const path = bfsPath(world.map, sim.x, sim.y, cand.res.x, cand.res.y);
  if (path === null) {
    // 정상 경로에선 불가능(맵 도달성 검증) — 방어적 처리
    delete world.reservations[resKey(cand.facilityId, cand.resourceId)];
    sim.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
    emit('action_failed', sim.id, { action: cand.action, reason: 'no_path' });
    return false;
  }
  sim.state = {
    kind: path.length === 0 ? 'performing' : 'walking',
    action: cand.action,
    facilityId: cand.facilityId,
    resourceId: cand.resourceId,
    path,
    ticksLeft: ACTION_DEFS[cand.action].duration,
    pairedTicks: 0,
  };
  emit('action_started', sim.id, { action: cand.action, facilityId: cand.facilityId, resourceId: cand.resourceId });
  return true;
}

function startIdle(sim, emit) {
  sim.state = { kind: 'performing', action: 'idle', facilityId: null, resourceId: null, path: [], ticksLeft: ACTION_DEFS.idle.duration, pairedTicks: 0 };
  emit('action_started', sim.id, { action: 'idle' });
}

// ---- 메인: 틱 t로의 전이. world를 mutate, 이벤트 배열 반환 ----
export function tick(world, inputsForThisTick = []) {
  const t = world.worldTick + 1;
  const events = [];
  const emit = (type, simId, payload) => events.push({ tick: t, type, simId, payload });

  // 1) 입력 적용 (sequence 순) — 검증→중단→예약→전이 원자적
  const inputs = [...inputsForThisTick].sort((a, b) => a.sequence - b.sequence);
  for (const inp of inputs) {
    if (inp.command !== 'assign') { emit('input_rejected', null, { reason: 'unknown_command', inputId: inp.id ?? null }); continue; }
    // 잘못된 내구 입력도 크래시 없이 결정적으로 거부 (payload null/비객체 포함)
    if (inp.payload === null || typeof inp.payload !== 'object' || Array.isArray(inp.payload)) {
      emit('input_rejected', null, { reason: 'malformed_payload', inputId: inp.id ?? null });
      continue;
    }
    const { simId, actionType } = inp.payload;
    const sim = world.sims.find((s) => s.id === simId);
    if (!sim || !ACTIONS.includes(actionType) || actionType === 'idle') {
      emit('input_rejected', typeof simId === 'number' ? simId : null, { reason: 'invalid', inputId: inp.id ?? null });
      continue;
    }
    const cands = collectCandidates(world, sim, [actionType], t, true);
    const best = pickBest(cands);
    if (!best) {
      emit('input_rejected', simId, { reason: 'no_valid_target', action: actionType, inputId: inp.id ?? null });
      continue;
    }
    startAction(world, sim, best, emit); // 나중 수락이 이전 결과를 대체 (PLAN §2)
  }

  // 2a) walking 전진 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'walking') continue;
    const next = s.path.shift();
    sim.x = next.x; sim.y = next.y;
    if (s.path.length === 0) s.kind = 'performing'; // 도착 → 수행 시작
  }

  // 2b) socialize 페어링: 시설별, id 오름차순 2명씩 (PLAN §2)
  const pairedThisTick = new Set();
  {
    const byFacility = new Map();
    for (const sim of world.sims) {
      const s = sim.state;
      if (s.kind === 'performing' && s.action === 'socialize') {
        if (!byFacility.has(s.facilityId)) byFacility.set(s.facilityId, []);
        byFacility.get(s.facilityId).push(sim);
      }
    }
    const facIds = [...byFacility.keys()].sort();
    for (const facId of facIds) {
      const group = byFacility.get(facId); // sims 배열이 id 오름차순이므로 그룹도 오름차순
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i], b = group[i + 1];
        pairedThisTick.add(a.id); pairedThisTick.add(b.id);
        a.state.pairedTicks++; b.state.pairedTicks++;
        const before = world.affinity[a.id][b.id];
        const delta = rngInt(world.rngSim, 61) - 20; // [-20, 40]
        const after = Math.max(AFFINITY_MIN, Math.min(AFFINITY_MAX, before + delta));
        world.affinity[a.id][b.id] = after;
        world.affinity[b.id][a.id] = after;
        if (before >= ARGUMENT_THRESHOLD && after < ARGUMENT_THRESHOLD) {
          emit('argument', a.id, { withSimId: b.id, affinity: after });
        }
      }
    }
  }

  // 2c) performing 전진 + 회복 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing') continue;
    s.ticksLeft--;
    const def = ACTION_DEFS[s.action];
    if (def.recovers) {
      const recovers = s.action !== 'socialize' || pairedThisTick.has(sim.id);
      if (recovers) {
        sim.needs[def.recovers] = Math.min(NEED_MAX, sim.needs[def.recovers] + def.recoverPerTick);
      }
    }
  }

  // 3) 완료 정산 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing' || s.ticksLeft > 0) continue;
    const def = ACTION_DEFS[s.action];
    if (def.moneyDelta !== 0) {
      sim.money += def.moneyDelta;
      emit('money_changed', sim.id, { delta: def.moneyDelta, balance: sim.money, action: s.action });
    }
    if (s.action === 'socialize' && s.pairedTicks === 0) {
      emit('lonely', sim.id, { facilityId: s.facilityId });
    } else if (s.action !== 'idle') {
      emit('action_completed', sim.id, { action: s.action, facilityId: s.facilityId });
    }
    releaseReservation(world, sim);
    sim.state = { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
  }

  // 4) 욕구 감쇠 (id 오름차순) + starving 하강 교차 시 이벤트
  for (const sim of world.sims) {
    for (const need of Object.keys(DECAY)) {
      const before = sim.needs[need];
      sim.needs[need] = Math.max(0, before - DECAY[need]);
      if (need === 'hunger' && before > 0 && sim.needs[need] === 0) {
        emit('starving', sim.id, {});
      }
    }
  }

  // 5) idle 심 결정 (id 오름차순, world.reservations가 곧 틱-로컬 원장 역할 —
  //    앞선 심의 예약이 즉시 반영되어 뒤 심에게 보인다. PLAN §2)
  for (const sim of world.sims) {
    if (sim.state.kind !== 'idle') continue;
    // 위급 오버라이드 (PLAN §2.5.D): 위급 욕구 회복 후보만, 없으면 전체로 폴백
    const critical = Object.entries(NEED_OF_ACTION)
      .filter(([, need]) => sim.needs[need] < NEED_CRITICAL)
      .map(([action]) => action);
    let cands = [];
    if (critical.length > 0) cands = collectCandidates(world, sim, critical, t);
    if (cands.length === 0) cands = collectCandidates(world, sim, ACTIONS, t);
    const best = pickBest(cands);
    if (best) startAction(world, sim, best, emit);
    else startIdle(sim, emit);
  }

  // 6) ordinal 부여 — events는 파이프라인 순 + 단계 내 id 오름차순으로 push됨
  events.forEach((e, i) => { e.ordinal = i; });

  // 7) 틱 갱신
  world.worldTick = t;
  return events;
}

// advance = tick() n회 루프, 그 이상 아무것도 아님 (PLAN §0)
export function advance(world, inputsByTick, n) {
  const events = [];
  for (let i = 0; i < n; i++) {
    const forTick = inputsByTick?.[world.worldTick + 1] ?? [];
    events.push(...tick(world, forTick));
  }
  return events;
}
