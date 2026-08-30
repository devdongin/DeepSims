// 틱 파이프라인 — PLAN §2, §12.1, §14.1. state[t] = simulate(state[t-1], inputs[t]).
// tick() 내부의 "오늘"은 transitionDay = floorDiv(t, 1440). 수치 튜너블은 전부 world.logic.
import {
  ACTIONS, ACTION_FACILITY, NEED_OF_ACTION, NEED_MAX,
  SCORE_SCALE, AFFINITY_MIN, AFFINITY_MAX,
} from './constants.js';
import { bfsPath, manhattan } from './pathfind.js';
import { rngInt } from './prng.js';
import { validateLogic, logicHash } from './logic.js';
import { validateTraits } from './traits.js';

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function resKey(facilityId, resourceId) { return `${facilityId}:${resourceId}`; }

function needValueFor(sim, action) {
  if (action === 'work') return Math.min(sim.money, NEED_MAX); // 돈 0 → deficit 최대
  return sim.needs[NEED_OF_ACTION[action]];
}

// MBTI → 행동별 persFactor (PLAN §12.1). floorDiv 곱 후 [50,200] 클램프 1회.
function persFactorFor(sim, action, L) {
  const m = sim.traits.mbti;
  let f = 100;
  if (action === 'socialize') f = L.persFactor.socializeBase - m.EI;
  else if (action === 'play') f = L.persFactor.playBase + (m.EI - 50);
  else if (action === 'work') f = L.persFactor.workBase - m.JP;
  return clamp(f, 50, 200);
}

// 기분 보정 (PLAN §12.1): 기분 전환 욕구 + 무기력. §G moodMod 슬롯, ±2.5e11 클램프.
function moodModFor(sim, action, L) {
  let mod = 0;
  if ((action === 'play' || action === 'socialize') && sim.mood < 0) {
    mod += Math.min(-sim.mood, NEED_MAX) * L.mood.reliefScale;
  }
  if (sim.mood < L.mood.lethargyThreshold) {
    mod += (sim.mood - L.mood.lethargyThreshold) * L.mood.lethargyScale;
  }
  return clamp(mod, -250000000000, 250000000000);
}

// 점수: base=floorDiv(num×1e5, den), den=manhattan+16 — 경계 증명은 PLAN §2.5.G
function scoreCandidate(sim, action, res, L) {
  const deficit = NEED_MAX - needValueFor(sim, action);
  const num = deficit * deficit * 16;
  const den = manhattan(sim.x, sim.y, res.x, res.y) + 16;
  const base = floorDiv(num * SCORE_SCALE, den);
  const pf = persFactorFor(sim, action, L);
  const mm = moodModFor(sim, action, L);
  return { score: floorDiv(base * pf, 100) + mm, deficit, persFactor: pf, moodMod: mm };
}

// 하드 제약 (assign·자율 결정 공통). t = 전이 틱.
function actionAllowed(world, sim, action, t) {
  const L = world.logic;
  if (action === 'eat' && sim.money < L.actions.eat.cost) return false;
  if (action === 'work') {
    const occ = L.occupations[sim.traits.occupation];
    if (occ.wagePct === 0) return false; // retired
    const tod = t % 1440;
    if (tod < occ.workStart || tod >= occ.workEnd) return false;
  }
  return true;
}

function collectCandidates(world, sim, actions, t, includeZeroScore = false) {
  const L = world.logic;
  const out = [];
  for (const action of actions) {
    if (action === 'idle') continue;
    if (!actionAllowed(world, sim, action, t)) continue;
    for (const ftype of ACTION_FACILITY[action]) {
      for (const fac of world.map.facilities) {
        if (fac.type !== ftype) continue;
        for (const res of fac.resources) {
          const holder = world.reservations[resKey(fac.id, res.id)];
          if (holder !== undefined && holder !== sim.id) continue;
          const sc = scoreCandidate(sim, action, res, L);
          if (sc.score <= 0 && !includeZeroScore) continue;
          out.push({ action, facilityId: fac.id, resourceId: res.id, res, ...sc });
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

function actionDuration(action, L) { return L.actions[action].duration; }

// 예약 + walking/performing 전이 (원자적). reason은 판단 사유 (PLAN §14.1).
function startAction(world, sim, cand, emit, reason) {
  releaseReservation(world, sim);
  world.reservations[resKey(cand.facilityId, cand.resourceId)] = sim.id;
  const path = bfsPath(world.map, sim.x, sim.y, cand.res.x, cand.res.y);
  if (path === null) {
    delete world.reservations[resKey(cand.facilityId, cand.resourceId)];
    sim.state = emptyState();
    emit('action_failed', sim.id, { action: cand.action, reason: 'no_path' });
    return false;
  }
  sim.state = {
    kind: path.length === 0 ? 'performing' : 'walking',
    action: cand.action,
    facilityId: cand.facilityId,
    resourceId: cand.resourceId,
    path,
    ticksLeft: actionDuration(cand.action, world.logic),
    pairedTicks: 0,
  };
  emit('action_started', sim.id, {
    action: cand.action, facilityId: cand.facilityId, resourceId: cand.resourceId, reason,
  });
  return true;
}

function emptyState() {
  return { kind: 'idle', action: null, facilityId: null, resourceId: null, path: [], ticksLeft: 0, pairedTicks: 0 };
}

function startIdle(sim, L, emit) {
  sim.state = { ...emptyState(), kind: 'performing', action: 'idle', ticksLeft: actionDuration('idle', L) };
  emit('action_started', sim.id, { action: 'idle', reason: { noCandidates: true } });
}

function applyMood(sim, delta) {
  sim.mood = clamp(sim.mood + delta, -10000, 10000);
}

// 부호 보존 스케일 (PLAN §12.1): sign(d) × floorDiv(|d| × factor, 100)
function scaleDelta(delta, factor) {
  const s = Math.sign(delta);
  return s * floorDiv(Math.abs(delta) * factor, 100);
}

function argumentThreshold(sim, L) {
  return clamp(
    L.affinity.argumentBase - (sim.traits.mbti.TF - 50) * L.affinity.argumentTfCoef,
    L.affinity.argClampMin, L.affinity.argClampMax);
}

// ---- 입력 명령 핸들러 (1단계) ----

function applyLogicUpdate(world, inp, emit) {
  const p = inp.payload;
  // 페이로드 형태 엄격 검증: params 객체 + hash 문자열 + revision 정수 필수, 해시 일치 무조건 검사
  if (p === null || typeof p !== 'object' || Array.isArray(p)
    || typeof p.hash !== 'string' || !Number.isSafeInteger(p.revision)) {
    emit('input_rejected', null, { reason: 'malformed_payload', inputId: inp.id ?? null });
    return;
  }
  const v = validateLogic(p.params);
  if (!v.ok || logicHash(p.params) !== p.hash) {
    emit('input_rejected', null, { reason: 'invalid_logic', errors: (v.errors ?? []).slice(0, 5), inputId: inp.id ?? null });
    return;
  }
  world.logic = p.params;
  emit('logic_changed', null, { hash: p.hash, revision: p.revision });
}

function applyCreatePlayer(world, inp, t, emit) {
  const p = inp.payload;
  const reject = (reason) => emit('input_rejected', null, { reason, inputId: inp.id ?? null });
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return reject('malformed_payload');
  if (world.sims.some((s) => s.isPlayer)) return reject('player_exists');
  const name = typeof p.name === 'string' ? p.name : '';
  const nameLen = [...name].length; // 유니코드 코드포인트
  if (nameLen < 1 || nameLen > 12) return reject('invalid_name');
  const traits = { gender: p.gender, age: p.age, mbti: p.mbti, occupation: p.occupation };
  const traitErr = validateTraits(traits);
  if (traitErr) return reject(`invalid_traits: ${traitErr}`);

  // 홈: 거주자 최소 집, 동수면 facilityId 오름차순 (결정적)
  const houses = world.map.facilities.filter((f) => f.type === 'house');
  const counts = new Map(houses.map((h) => [h.id, 0]));
  for (const s of world.sims) if (counts.has(s.homeId)) counts.set(s.homeId, counts.get(s.homeId) + 1);
  const home = [...houses].sort((a, b) => (counts.get(a.id) - counts.get(b.id)) || (a.id < b.id ? -1 : 1))[0];

  const id = world.sims[world.sims.length - 1].id + 1;
  const sim = {
    id, name, homeId: home.id, isPlayer: true, traits, mood: 0,
    x: home.door.x, y: home.door.y + 1,
    needs: { hunger: 7000, energy: 7000, social: 7000, fun: 7000 }, // 고정, rng 미소비
    money: world.logic.occupations[traits.occupation].startMoney,   // 고정분만
    state: emptyState(),
  };
  world.sims.push(sim);
  for (const row of world.affinity) row.push(0);
  world.affinity.push(new Array(world.sims.length).fill(0));
  emit('player_created', id, { name, occupation: traits.occupation, homeId: home.id });
}

function applyAssign(world, inp, t, emit) {
  const p = inp.payload;
  if (p === null || typeof p !== 'object' || Array.isArray(p)) {
    emit('input_rejected', null, { reason: 'malformed_payload', inputId: inp.id ?? null });
    return;
  }
  const { simId, actionType } = p;
  const sim = world.sims.find((s) => s.id === simId);
  if (!sim || !ACTIONS.includes(actionType) || actionType === 'idle') {
    emit('input_rejected', typeof simId === 'number' ? simId : null, { reason: 'invalid', inputId: inp.id ?? null });
    return;
  }
  const cands = collectCandidates(world, sim, [actionType], t, true); // assign은 효용 무시 (PLAN §2)
  const best = pickBest(cands);
  if (!best) {
    emit('input_rejected', simId, { reason: 'no_valid_target', action: actionType, inputId: inp.id ?? null });
    return;
  }
  startAction(world, sim, best, emit, { assigned: true });
}

// ---- 메인: 틱 t로의 전이. world를 mutate, 이벤트 배열 반환 ----
export function tick(world, inputsForThisTick = []) {
  const t = world.worldTick + 1;
  const events = [];
  const emit = (type, simId, payload) => events.push({ tick: t, type, simId, payload });

  // 1) 입력 적용 — logic_update 먼저(sequence 순), 그 다음 나머지(sequence 순) (PLAN §14.1)
  const sorted = [...inputsForThisTick].sort((a, b) => a.sequence - b.sequence);
  for (const inp of sorted.filter((i) => i.command === 'logic_update')) applyLogicUpdate(world, inp, emit);
  for (const inp of sorted.filter((i) => i.command !== 'logic_update')) {
    if (inp.command === 'assign') applyAssign(world, inp, t, emit);
    else if (inp.command === 'create_player') applyCreatePlayer(world, inp, t, emit);
    else emit('input_rejected', null, { reason: 'unknown_command', inputId: inp.id ?? null });
  }

  // L은 logic_update 적용 **이후**에 캡처 — "같은 틱부터 새 로직" 계약 (PLAN §14.1)
  const L = world.logic;

  // 2a) walking 전진 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'walking') continue;
    const next = s.path.shift();
    sim.x = next.x; sim.y = next.y;
    if (s.path.length === 0) s.kind = 'performing';
  }

  // 2b) socialize 페어링: 시설별, id 오름차순 2명씩. 호감도는 비대칭(각자 TF 계수) (PLAN §12.1)
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
      const group = byFacility.get(facId);
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i], b = group[i + 1];
        pairedThisTick.add(a.id); pairedThisTick.add(b.id);
        a.state.pairedTicks++; b.state.pairedTicks++;
        const delta = rngInt(world.rngSim, L.affinity.deltaSpan) + L.affinity.deltaMin; // [-20, 40]
        const fA = L.affinity.tfScaleBase + a.traits.mbti.TF;
        const fB = L.affinity.tfScaleBase + b.traits.mbti.TF;
        const beforeAB = world.affinity[a.id][b.id];
        const beforeBA = world.affinity[b.id][a.id];
        const afterAB = clamp(beforeAB + scaleDelta(delta, fA), AFFINITY_MIN, AFFINITY_MAX);
        const afterBA = clamp(beforeBA + scaleDelta(delta, fB), AFFINITY_MIN, AFFINITY_MAX);
        world.affinity[a.id][b.id] = afterAB;
        world.affinity[b.id][a.id] = afterBA;
        // 페어 임계 = 두 심 중 더 얕은(높은) 값 (PLAN §12.1)
        const thr = Math.max(argumentThreshold(a, L), argumentThreshold(b, L));
        const crossed = (beforeAB >= thr && afterAB < thr) || (beforeBA >= thr && afterBA < thr);
        if (crossed) {
          emit('argument', a.id, { withSimId: b.id });
          applyMood(a, L.mood.argument); applyMood(b, L.mood.argument); // 사실 발생 지점 (PLAN §12.1)
        }
      }
    }
  }

  // 2c) performing 전진 + 회복 (id 오름차순)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing') continue;
    s.ticksLeft--;
    const def = L.actions[s.action];
    const need = NEED_OF_ACTION[s.action];
    if (need && def.recoverPerTick) {
      const recovers = s.action !== 'socialize' || pairedThisTick.has(sim.id);
      if (recovers) sim.needs[need] = Math.min(NEED_MAX, sim.needs[need] + def.recoverPerTick);
    }
  }

  // 3) 완료 정산 (id 오름차순) — 기분 델타는 사실 발생 지점에서 즉시 (PLAN §12.1)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing' || s.ticksLeft > 0) continue;
    if (s.action === 'eat') {
      sim.money -= L.actions.eat.cost;
      emit('money_changed', sim.id, { delta: -L.actions.eat.cost, balance: sim.money, action: 'eat' });
    } else if (s.action === 'work') {
      const wage = floorDiv(L.actions.work.wageBase * L.occupations[sim.traits.occupation].wagePct, 100);
      sim.money += wage;
      emit('money_changed', sim.id, { delta: wage, balance: sim.money, action: 'work' });
      applyMood(sim, L.mood.moneyGain);
    }
    if (s.action === 'socialize' && s.pairedTicks === 0) {
      emit('lonely', sim.id, { facilityId: s.facilityId });
      applyMood(sim, L.mood.lonely);
    } else if (s.action !== 'idle') {
      emit('action_completed', sim.id, { action: s.action, facilityId: s.facilityId });
      applyMood(sim, L.mood.actionCompleted);
    }
    releaseReservation(world, sim);
    sim.state = emptyState();
  }

  // 4) 욕구 감쇠(나이 보정 포함) → starving 판정·기분 델타 → 기분 감쇠 (순서 고정, PLAN §12.1)
  for (const sim of world.sims) {
    const age = sim.traits.age;
    for (const need of Object.keys(L.decay)) {
      let d = L.decay[need];
      if (need === 'fun' && age <= L.ageDecay.youngMax) d += L.ageDecay.youngFunAdd;
      if (need === 'energy' && age >= L.ageDecay.oldMin) d += L.ageDecay.oldEnergyAdd;
      const before = sim.needs[need];
      sim.needs[need] = Math.max(0, before - d);
      if (need === 'hunger' && before > 0 && sim.needs[need] === 0) {
        emit('starving', sim.id, {});
        applyMood(sim, L.mood.starving);
      }
    }
    // 기분 감쇠: 0 방향으로 decayPerTick 수렴 — 5단계는 감쇠 후 기분을 읽는다
    const dm = L.mood.decayPerTick;
    if (sim.mood > 0) sim.mood = Math.max(0, sim.mood - dm);
    else if (sim.mood < 0) sim.mood = Math.min(0, sim.mood + dm);
  }

  // 5) idle 심 결정 (id 오름차순, world.reservations = 틱-로컬 원장)
  for (const sim of world.sims) {
    if (sim.state.kind !== 'idle') continue;
    const critical = Object.entries(NEED_OF_ACTION)
      .filter(([, need]) => sim.needs[need] < L.needCritical)
      .map(([action]) => action);
    let cands = [];
    let urgency = false;
    if (critical.length > 0) { cands = collectCandidates(world, sim, critical, t); urgency = cands.length > 0; }
    if (cands.length === 0) cands = collectCandidates(world, sim, ACTIONS, t);
    const best = pickBest(cands);
    if (best) {
      // 사유 필드는 §14.1 계약대로: need, deficit, persFactor, planFactor, moodMod(원값), urgencyOverride
      startAction(world, sim, best, emit, {
        need: NEED_OF_ACTION[best.action] ?? 'money',
        deficit: best.deficit,
        persFactor: best.persFactor,
        planFactor: 100, // Phase 4에서 하루 계획 도입 전까지 중립
        moodMod: best.moodMod,
        urgencyOverride: urgency,
      });
    } else startIdle(sim, L, emit);
  }

  // 6) ordinal 부여 — 단계 순 + 단계 내 적용 순서 (1단계는 sequence 순)
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
