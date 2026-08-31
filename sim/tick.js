// 틱 파이프라인 — PLAN §2, §12.1, §14.1. state[t] = simulate(state[t-1], inputs[t]).
// tick() 내부의 "오늘"은 transitionDay = floorDiv(t, 1440). 수치 튜너블은 전부 world.logic.
import {
  ACTIONS, ACTION_FACILITY, NEED_OF_ACTION, NEED_MAX,
  SCORE_SCALE, AFFINITY_MIN, AFFINITY_MAX,
  COPING_ACTIONS, HOME_ONLY_ACTIONS, OUTDOOR_FACILITIES,
} from './constants.js';
import { TILE, addBuilding } from './map.js';
import { bfsPath, manhattan } from './pathfind.js';
import { rngInt } from './prng.js';
import { workWindowFor, slotMatches } from './chrono.js';
import { validateLogic, logicHash } from './logic.js';
import { validateTraits } from './traits.js';
import { recordFact, shortlistMemories, memoryModFor, stateModFor, runReflection } from './cognition.js';
import { buildDailyPlan, planFactorFor, maybeGenerateToken, transferTokens, expireAndMeasureTokens, learnToken } from './planning.js';
import { maybeConverse, processGreetings } from './interaction.js';
import {
  dailyDiseaseDraws, contagionDraw, naturalRecovery, maybeElection, mayorStipend,
  maybeImmigration, checkClubJoin, clubMeetingTokens, pairDeltaBonus, applyRomance,
  updateCampaigners, maybeNewYear, maybeFestival, maybeChildren,
} from './society.js';
import { bindSocietyHooks } from './cognition.js';
bindSocietyHooks(applyRomance, checkClubJoin); // §17: 회고 훅 (모든 진입 경로에서 보장)

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function resKey(facilityId, resourceId) { return `${facilityId}:${resourceId}`; }

function needValueFor(sim, action, L) {
  if (action === 'work') return Math.min(sim.money, NEED_MAX); // 돈 0 → deficit 최대
  // coping: 기분이 나쁠수록 급함 — deficit = -mood (게이트로 mood < 0 보장, §15.1.A)
  if (COPING_ACTIONS.includes(action)) return NEED_MAX + sim.mood;
  if (action === 'build') return NEED_MAX - L.build.deficit; // 고정 중간 급함 (§15.1.B)
  if (action === 'shop') return sim.needs.hunger; // 배고픈데 장이 비면 급함 (§16.B, Codex 22차 항목 5)
  if (action === 'construct') return NEED_MAX - L.construct.deficit; // §16.5 고정 급함
  if (action === 'see_doctor') return NEED_MAX - L.disease.doctorDeficit; // 아플 때 최우선급 (§17.3)
  return sim.needs[NEED_OF_ACTION[action]];
}

// MBTI → 행동별 persFactor (PLAN §12.1). floorDiv 곱 후 [50,200] 클램프 1회.
function persFactorFor(sim, action, L) {
  const m = sim.traits.mbti;
  let f = 100;
  if (action === 'socialize') f = L.persFactor.socializeBase - m.EI;
  else if (action === 'play') f = L.persFactor.playBase + (m.EI - 50);
  else if (action === 'work') f = L.persFactor.workBase - m.JP;
  // 대처 성향 (§15.1.A): E→음주, F→폭식, I→은둔, T→운동
  else if (action === 'drink') f = L.coping.persDrinkBase - floorDiv(m.EI, 2);
  else if (action === 'binge_eat') f = 100 + (m.TF - 50);
  else if (action === 'hole_up') f = 100 + (m.EI - 50);
  else if (action === 'exercise') f = 100 + (50 - m.TF);
  // §16.B: N·I는 독서, I는 낚시 선호
  else if (action === 'read') f = 100 + (m.SN - 50) + floorDiv(m.EI - 50, 2);
  else if (action === 'fish') f = 100 + (m.EI - 50);
  else if (action === 'construct') f = 100 + floorDiv(100 - m.JP, L.construct.persJDiv); // J형이 부지런 (§16.5)
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

// 점수 코어: base=floorDiv(num×1e5, den) × persFactor — planFactor·보정 합산은 collectCandidates에서
// (§G 순서: base × pers → × plan → + mods). 경계 증명은 PLAN §2.5.G.
function scoreCandidate(sim, action, res, L) {
  const deficit = NEED_MAX - needValueFor(sim, action, L);
  const num = deficit * deficit * 16;
  // 대처 행동은 거리 무시 (den 고정 16) — 대처 방식 선택은 성격이 지배해야 한다 (§15.1.A).
  // 아니면 "집이 가까워서 은둔"이 항상 이겨 성격 변조가 무력화된다.
  const den = COPING_ACTIONS.includes(action) ? 16 : manhattan(sim.x, sim.y, res.x, res.y) + 16;
  const base = floorDiv(num * SCORE_SCALE, den);
  const pf = persFactorFor(sim, action, L);
  const mm = moodModFor(sim, action, L);
  return { core: floorDiv(base * pf, 100), deficit, persFactor: pf, moodMod: mm };
}

// 하드 제약 (assign·자율 결정 공통). t = 전이 틱.
// 사유 반환 변형 — reason chain(§15.1.C)과 공유. null = 허용.
// blockedBy 우선순위: no_money → off_hours → not_coping → not_needed (Codex 20차 항목 2)
function actionBlockReason(world, sim, action, t) {
  const L = world.logic;
  const cost = L.actions[action]?.cost ?? 0;
  if (cost > 0 && sim.money < cost) return 'no_money';
  if (action === 'work') {
    const ww = workWindowFor(sim, L); // §17.13 크로노타입·야근·교대 반영 (단일 권위)
    if (!ww) return 'off_hours';
    if (!slotMatches(ww, t % 1440)) return 'off_hours';
  }
  if (COPING_ACTIONS.includes(action) && sim.mood >= L.coping.threshold) return 'not_coping';
  if (action === 'shop' && (sim.groceries > 0 || sim.money < L.actions.shop.cost)) {
    return sim.money < L.actions.shop.cost ? 'no_money' : 'not_needed'; // 장바구니 차 있으면 불필요 (§16.B)
  }
  if (action === 'cook_eat' && sim.groceries < 1) return 'no_groceries';
  if (action === 'construct' && !world.project) return 'no_project';
  if (action === 'see_doctor' && !sim.sick) return 'healthy';
  if (action === 'build') {
    const home = world.map.facilities.find((f) => f.id === sim.homeId);
    const residents = world.sims.reduce((n, x) => n + (x.homeId === sim.homeId ? 1 : 0), 0);
    const extraBuilt = home.resources.length - 2;
    if (residents <= home.resources.length || extraBuilt >= L.build.maxExtraBeds) return 'not_needed';
  }
  return null;
}

function actionAllowed(world, sim, action, t) {
  return actionBlockReason(world, sim, action, t) === null;
}

// ctx: { shortlist, urgency } — Phase 3 인지 보정. urgency 시 습관 보정 배제 (PLAN §2.5.D).
function collectCandidates(world, sim, actions, t, includeZeroScore = false, ctx = null) {
  const L = world.logic;
  const out = [];
  for (const action of actions) {
    if (action === 'idle') continue;
    if (!actionAllowed(world, sim, action, t)) continue;
    // §16.5.B: construct는 가상 현장(site) — 활성 프로젝트 plot 모서리 4 작업 스팟
    if (action === 'construct') {
      const pr = world.project;
      const plot = world.plots.find((p) => p.plotId === pr.plotId);
      const spots = [
        { id: `p${pr.plotId}:spot0`, x: plot.x + 1, y: plot.y + 1 },
        { id: `p${pr.plotId}:spot1`, x: plot.x + 5, y: plot.y + 1 },
        { id: `p${pr.plotId}:spot2`, x: plot.x + 1, y: plot.y + 3 },
        { id: `p${pr.plotId}:spot3`, x: plot.x + 5, y: plot.y + 3 },
      ];
      for (const res of spots) {
        const holder = world.reservations[resKey('site', res.id)];
        if (holder !== undefined && holder !== sim.id) continue;
        const sc = scoreCandidate(sim, action, res, L);
        const cand = {
          action, facilityId: 'site', resourceId: res.id, res,
          ...sc, planFactor: 100, partyPull: false, weatherFactor: 100,
          score: floorDiv(sc.core * 100, 100) + sc.moodMod,
          memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
        };
        if (cand.score <= 0 && !includeZeroScore) continue;
        out.push(cand);
      }
      continue;
    }
    // §17.2: work는 자기 직업의 근무 시설에서만
    const ftypes = action === 'work'
      ? [L.workplace[sim.traits.occupation]]
      : ACTION_FACILITY[action];
    for (const ftype of ftypes) {
      for (const fac of world.map.facilities) {
        if (fac.type !== ftype) continue;
        if (HOME_ONLY_ACTIONS.includes(action) && fac.id !== sim.homeId) continue; // 자기 집만 (§15.1)
        for (const res of fac.resources) {
          const holder = world.reservations[resKey(fac.id, res.id)];
          if (holder !== undefined && holder !== sim.id) continue;
          const sc = scoreCandidate(sim, action, res, L);
          // planFactor (D4/D6): 위급 시 100 강제 (구조적 배제, PLAN §2.5.D)
          const pl = (ctx && ctx.urgency)
            ? { factor: 100, partyPull: false }
            : planFactorFor(world, sim, action, fac.id, t, L);
          // §16.D: 우천 야외 축소 계수 — §G 곱셈 체인 확장 (base×pers×plan×weather, 축소만이라 경계 보존)
          const weatherFactor = (world.weather?.kind === 'rain' && OUTDOOR_FACILITIES.includes(ftype))
            ? L.weather.outdoorRainFactor : 100;
          const cand = {
            action, facilityId: fac.id, resourceId: res.id, res, ...sc,
            planFactor: pl.factor, partyPull: pl.partyPull, weatherFactor,
            score: floorDiv(floorDiv(sc.core * pl.factor, 100) * weatherFactor, 100) + sc.moodMod,
            memoryMod: 0, stateMod: 0, habitMod: 0, cited: [],
          };
          if (ctx) {
            const mm = memoryModFor(ctx.shortlist, [action, `facility:${fac.id}`], t, L);
            cand.memoryMod = mm.mod;
            cand.cited = mm.cited;
            cand.stateMod = stateModFor(world, sim, fac.id, L);
            if (!ctx.urgency) cand.habitMod = Math.min(sim.habit[`${action}:${fac.id}`] ?? 0, L.social.habitCap);
            cand.score += cand.memoryMod + cand.stateMod + cand.habitMod;
          }
          if (cand.score <= 0 && !includeZeroScore) continue;
          out.push(cand);
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
  // onEnterPerforming(sleep) 훅 — 경로 0으로 즉시 수행 진입하는 경우 (PLAN §2 전이 훅)
  if (sim.state.kind === 'performing' && cand.action === 'sleep') {
    runReflection(world, sim, world.worldTick + 1, emit);
  }
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
    memories: [], memorySeq: 0, habit: {}, relTiers: {},
    lastReflectedDay: -1, reflectionMemoryCursor: 0, pendingMood: null,
    knownTokens: [], plan: null, lastPlannedDay: -1,
    hangoverUntil: -1,
  };
  world.sims.push(sim);
  for (const row of world.affinity) row.push(0);
  world.affinity.push(new Array(world.sims.length).fill(0));
  for (const row of world.interactions) row.push(0);
  world.interactions.push(new Array(world.sims.length).fill(0));
  for (const row of world.lastGreetDay) row.push(-1);
  world.lastGreetDay.push(new Array(world.sims.length).fill(-1));
  emit('player_created', id, { name, occupation: traits.occupation, homeId: home.id });
}

// announce (D7): 플레이어가 모임 공지 토큰을 주입 — 초기엔 플레이어만 알고 확산으로 퍼진다
function applyAnnounce(world, inp, t, emit) {
  const p = inp.payload;
  const reject = (reason) => emit('input_rejected', null, { reason, inputId: inp.id ?? null });
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return reject('malformed_payload');
  const player = world.sims.find((s) => s.isPlayer);
  if (!player) return reject('no_player');
  if (!['cafe', 'park'].includes(p.placeId)) return reject('invalid_place');
  const L = world.logic;
  if (!Number.isSafeInteger(p.hoursFromNow) || p.hoursFromNow < 1 || p.hoursFromNow > L.diffusion.announceMaxHours) {
    return reject('invalid_hours');
  }
  const token = {
    tokenId: world.tokenCounter++,
    topic: 'announce',
    originTick: t,
    scheduledTick: t + p.hoursFromNow * 60,
    placeId: p.placeId,
    expiresTick: t + p.hoursFromNow * 60 + L.diffusion.expireAfter,
  };
  world.tokens.push(token);
  learnToken(player, token, t, L);
  emit('token_created', player.id, { tokenId: token.tokenId, placeId: p.placeId, scheduledTick: token.scheduledTick, announced: true });
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
    else if (inp.command === 'announce') applyAnnounce(world, inp, t, emit);
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
    // §15.1.B 도로화: GRASS 밟힘 마모 누적 → 임계 도달 시 ROAD 전환 (rng 미사용)
    const ti = sim.y * world.map.w + sim.x;
    if (world.map.tiles[ti] === TILE.GRASS) {
      world.wear[ti] = (world.wear[ti] ?? 0) + 1; // 희소 객체 (§17.0)
      if (world.wear[ti] >= world.logic.build.wearThreshold) {
        world.map.tiles[ti] = TILE.ROAD;
        delete world.wear[ti]; // 0 엔트리 금지 규칙의 연장 — 도로화된 칸은 제거
        emit('road_formed', sim.id, { x: sim.x, y: sim.y });
      }
    }
    // §16.C: 분실물 습득 — 현재 좌표의 아이템(itemId 오름차순 첫 번째)
    if (world.lostItems.length > 0) {
      // 인접(맨해튼 ≤1)까지 습득 — 정확히 밟을 확률만으론 죽은 콘텐츠 (itemId asc 첫 번째)
      const idx = world.lostItems.findIndex((it) => Math.abs(it.x - sim.x) + Math.abs(it.y - sim.y) <= 1);
      if (idx !== -1) {
        const it = world.lostItems[idx];
        world.lostItems.splice(idx, 1);
        sim.money += it.amount;
        applyMood(sim, world.logic.items.pickupMood);
        emit('item_found', sim.id, { itemId: it.itemId, amount: it.amount, x: it.x, y: it.y });
        emit('money_changed', sim.id, { delta: it.amount, balance: sim.money, action: 'found' });
        recordFact(sim, t, world.logic, 'found_item', { tags: ['luck'] });
      }
    }
    if (s.path.length === 0) {
      s.kind = 'performing';
      // onEnterPerforming(sleep) — 도착 전이 지점 (PLAN §2 전이 훅)
      if (s.action === 'sleep') runReflection(world, sim, t, emit);
    }
  }

  // 2a-2) 스쳐 지나가는 인사 (D9) — 전파(2b)보다 먼저: 같은 틱 전파는 인사 후 호감도를 본다
  processGreetings(world, t, emit);

  // 2b) socialize 페어링: 시설별, id 오름차순 2명씩. 호감도는 비대칭(각자 TF 계수) (PLAN §12.1)
  const pairedThisTick = new Set();
  const pairedWith = new Map(); // §17.5 파트너 회복 보너스용
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
        pairedWith.set(a.id, b.id); pairedWith.set(b.id, a.id);
        a.state.pairedTicks++; b.state.pairedTicks++;
        // §17.8 페어링 서브순서: ① 전파 → ② 전염 → ③ 대화(험담 영향 포함) → ④ 델타
        const transferred = transferTokens(world, a, b, t, emit);
        contagionDraw(world, a, b, t, emit);
        maybeConverse(world, a, b, facId, t, transferred > 0, emit);
        // D3: 상호작용 카운트 (대칭, 포화 캡)
        const IC = 1000000;
        world.interactions[a.id][b.id] = Math.min(IC, world.interactions[a.id][b.id] + 1);
        world.interactions[b.id][a.id] = Math.min(IC, world.interactions[b.id][a.id] + 1);
        const delta = rngInt(world.rngSim, L.affinity.deltaSpan) + L.affinity.deltaMin // [-20, 40]
          + pairDeltaBonus(world, a, b); // §17: 연인·동아리 동료 보너스
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
          recordFact(a, t, L, 'argument', { subjectSimId: b.id, placeId: facId, tags: ['argument', `facility:${facId}`, `sim:${b.id}`] });
          recordFact(b, t, L, 'argument', { subjectSimId: a.id, placeId: facId, tags: ['argument', `facility:${facId}`, `sim:${a.id}`] });
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
      if (recovers) {
        let amt = def.recoverPerTick;
        // §17.5: 연인과의 수다는 더 달콤하다
        if (s.action === 'socialize' && pairedWith.get(sim.id) === world.partners[sim.id]) {
          amt = floorDiv(amt * L.romance.partnerSocialPct, 100);
        }
        sim.needs[need] = Math.min(NEED_MAX, sim.needs[need] + amt);
      }
    }
    // §16.5: 건설 노동 — 현재 프로젝트와 같은 plot의 현장 수행만 기여
    if (s.action === 'construct' && world.project
      && s.resourceId.startsWith(`p${world.project.plotId}:`)) {
      world.project.progress++;
    }
    // 대처 행동의 틱당 효과 (§15.1.A): 기분 직접 회복 + 부수 욕구
    if (def.moodPerTick) applyMood(sim, def.moodPerTick);
    if (def.funPerTick) sim.needs.fun = Math.min(NEED_MAX, sim.needs.fun + def.funPerTick);
    if (def.energyPerTick) sim.needs.energy = Math.min(NEED_MAX, sim.needs.energy + def.energyPerTick);
    if (def.hungerPerTick) sim.needs.hunger = Math.min(NEED_MAX, sim.needs.hunger + def.hungerPerTick);
  }

  // 3) 완료 정산 (id 오름차순) — 기분 델타는 사실 발생 지점에서 즉시 (PLAN §12.1)
  for (const sim of world.sims) {
    const s = sim.state;
    if (s.kind !== 'performing' || s.ticksLeft > 0) continue;
    if (s.action === 'eat' || s.action === 'drink' || s.action === 'binge_eat') {
      const cost = L.actions[s.action].cost;
      sim.money -= cost;
      emit('money_changed', sim.id, { delta: -cost, balance: sim.money, action: s.action });
      if (s.action === 'drink') {
        // 숙취 (§15.1.A): t < hangoverUntil 동안 energy(수면 욕구) 감쇠 가산
        sim.hangoverUntil = t + L.coping.hangoverTicks;
        emit('hangover', sim.id, { untilTick: sim.hangoverUntil });
      }
      if (s.action === 'binge_eat') applyMood(sim, -L.actions.binge_eat.regretMood); // 후회
    } else if (s.action === 'exercise') {
      applyMood(sim, L.actions.exercise.completeMoodBonus);
    } else if (s.action === 'fish') {
      // §16.B: 완료 시 단 1드로우 (중단 시 정산 미도달 → 드로우 없음). 서브순서:
      // 드로우 → (성공 시) money+이벤트 / (허탕) mood 감점 → 이후 공통 완료 경로 (Codex 22차 항목 4)
      const catchAmt = rngInt(world.rngSim, L.actions.fish.catchSpan);
      if (catchAmt > 0) {
        sim.money += catchAmt;
        emit('fish_caught', sim.id, { amount: catchAmt });
        emit('money_changed', sim.id, { delta: catchAmt, balance: sim.money, action: 'fish' });
      } else {
        applyMood(sim, -L.actions.fish.missMood);
      }
    } else if (s.action === 'see_doctor') {
      sim.money -= L.actions.see_doctor.cost;
      emit('money_changed', sim.id, { delta: -L.actions.see_doctor.cost, balance: sim.money, action: 'see_doctor' });
      if (sim.sick) {
        sim.sick = null;
        emit('recovered', sim.id, { how: 'doctor' });
      }
    } else if (s.action === 'shop') {
      sim.money -= L.actions.shop.cost;
      emit('money_changed', sim.id, { delta: -L.actions.shop.cost, balance: sim.money, action: 'shop' });
      sim.groceries = Math.min(L.market.maxGroceries, sim.groceries + L.actions.shop.groceriesGain);
    } else if (s.action === 'cook_eat') {
      sim.groceries = Math.max(0, sim.groceries - 1);
    } else if (s.action === 'build') {
      // 완료 시 게이트 재검증 (같은 집 동시 건설 초과 방지, Codex 20차 항목 3)
      const home = world.map.facilities.find((f) => f.id === s.facilityId);
      const extraBuilt = home.resources.length - 2;
      if (extraBuilt >= L.build.maxExtraBeds || sim.money < L.actions.build.cost) {
        emit('action_failed', sim.id, { action: 'build', reason: extraBuilt >= L.build.maxExtraBeds ? 'already_built' : 'no_money' });
        releaseReservation(world, sim);
        sim.state = emptyState();
        continue;
      }
      sim.money -= L.actions.build.cost;
      emit('money_changed', sim.id, { delta: -L.actions.build.cost, balance: sim.money, action: 'build' });
      const slot = home.extraBedSlots[extraBuilt]; // 슬롯 순서 고정 (§15.1.B)
      const newRes = { id: `bed${home.resources.length}`, kind: 'bed', x: slot.x, y: slot.y };
      home.resources.push(newRes);
      emit('bed_built', sim.id, { facilityId: home.id, resourceId: newRes.id, x: slot.x, y: slot.y });
    } else if (s.action === 'work') {
      const wage = floorDiv(L.actions.work.wageBase * L.occupations[sim.traits.occupation].wagePct, 100);
      sim.money += wage;
      emit('money_changed', sim.id, { delta: wage, balance: sim.money, action: 'work' });
      applyMood(sim, L.mood.moneyGain);
    }
    if (s.action === 'socialize' && s.pairedTicks === 0) {
      emit('lonely', sim.id, { facilityId: s.facilityId });
      applyMood(sim, L.mood.lonely);
      recordFact(sim, t, L, 'lonely', { placeId: s.facilityId, tags: ['socialize', `facility:${s.facilityId}`] });
    } else if (s.action !== 'idle') {
      emit('action_completed', sim.id, { action: s.action, facilityId: s.facilityId });
      applyMood(sim, L.mood.actionCompleted);
      const kind = {
        eat: 'meal', work: 'work_done', socialize: 'small_talk', play: 'play_time',
        drink: 'drank', binge_eat: 'binge', hole_up: 'hole_up', exercise: 'workout', build: 'built_bed',
        read: 'read_time', shop: 'shopping', fish: 'fishing', cook_eat: 'home_meal', construct: 'construct_work',
        see_doctor: 'healed',
      }[s.action];
      if (kind) {
        recordFact(sim, t, L, kind, { placeId: s.facilityId, tags: [s.action, `facility:${s.facilityId}`] });
      }
      // 기상: 회고가 기록해둔 pendingMood 적용 + 하루 계획 생성 (PLAN §2.5.D/E)
      if (s.action === 'sleep') {
        if (sim.pendingMood !== null) {
          sim.mood = sim.pendingMood;
          sim.pendingMood = null;
        }
        const day = floorDiv(t, 1440); // 틱 내부 날짜 규약
        if (sim.lastPlannedDay === undefined || sim.lastPlannedDay < day) {
          sim.plan = buildDailyPlan(sim, L);
          sim.lastPlannedDay = day;
        }
      }
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
      if (need === 'energy' && sim.hangoverUntil > t) d += L.coping.hangoverEnergyDecay; // 숙취 (§15.1.A)
      if (sim.sick && (need === 'energy' || need === 'fun')) d += floorDiv(d * L.disease.decayFactorNum, L.disease.decayFactorDen); // 병 (§17.3)
      const before = sim.needs[need];
      sim.needs[need] = Math.max(0, before - d);
      if (need === 'hunger' && before > 0 && sim.needs[need] === 0) {
        emit('starving', sim.id, {});
        applyMood(sim, L.mood.starving);
        recordFact(sim, t, L, 'starving', { tags: ['eat'] });
      }
    }
    naturalRecovery(world, sim, t, emit); // §17.3 자연 치유 (무드로우)
    // 기분 감쇠: 0 방향으로 decayPerTick 수렴 — 5단계는 감쇠 후 기분을 읽는다
    const dm = L.mood.decayPerTick;
    if (sim.mood > 0) sim.mood = Math.max(0, sim.mood - dm);
    else if (sim.mood < 0) sim.mood = Math.min(0, sim.mood + dm);
  }

  // 4b) 고정 서브순서 (§16.D): 날씨 → 모임 판정 → 토큰 만료 → 토큰 생성 → 아이템 만료/스폰
  {
    const day = floorDiv(t, 1440);
    if (world.weather.day !== day) {
      const W = L.weather;
      const total = W.sunnyW + W.cloudyW + W.rainW;
      const roll = rngInt(world.rngSim, total);
      const kind = roll < W.sunnyW ? 'sunny' : roll < W.sunnyW + W.cloudyW ? 'cloudy' : 'rain';
      world.weather = { day, kind };
      emit('weather_changed', null, { kind, day });
    }
  }
  expireAndMeasureTokens(world, t, emit);
  maybeGenerateToken(world, t, emit);
  clubMeetingTokens(world, t, emit, learnToken); // §17.6 주간 모임 (멤버 즉시 인지)
  {
    // §16.C: 만료 → 스폰. 수락 기준: ROAD 타일 && 같은 좌표에 기존 아이템 없음.
    // 드로우 순서: (x,y) 시도들(성공 시 조기 중단) → amount → itemId 부여 (Codex 22차 항목 2)
    world.lostItems = world.lostItems.filter((it) => t <= it.expiresTick);
    const I = L.items;
    if (t % I.spawnInterval === 0) {
      for (let attempt = 0; attempt < I.spawnTries; attempt++) {
        const x = rngInt(world.rngSim, Math.min(I.spawnAreaW, world.map.w));
        const y = rngInt(world.rngSim, Math.min(I.spawnAreaH, world.map.h));
        const tile = world.map.tiles[y * world.map.w + x];
        // ROAD에만 스폰 — 사람이 다니는 곳에 떨어지고, 다니는 사람이 줍는다 (§16.C 개정)
        if (tile === TILE.ROAD
          && !world.lostItems.some((it) => it.x === x && it.y === y)) {
          const amount = I.amountMin + rngInt(world.rngSim, I.amountSpan);
          const item = { itemId: world.itemCounter++, x, y, amount, expiresTick: t + I.expireTicks };
          world.lostItems.push(item);
          emit('item_spawned', null, { itemId: item.itemId, x, y });
          break;
        }
      }
    }
  }

  // 4c) §16.5: 완공 판정(매 틱) → 일일 도시계획 트리거 (서브순서 맨 끝).
  // 의도된 순서: 완공 틱의 facility_built/moved_home은 잔여 노동자들의 action_completed보다
  // 먼저 나온다 (완공은 4단계, 노동 정산은 각자 스틴트가 끝나는 틱의 3단계 — Codex 24차 항목 2 문서화)
  {
    const pr = world.project;
    // required는 프로젝트 시작 시점에 스냅샷 — 진행 중 logic_update가 완공 시점을 흔들지 못함 (PLAN §16.5)
    if (pr && pr.progress >= pr.required) {
      const plot = world.plots.find((p) => p.plotId === pr.plotId);
      const fac = addBuilding(world.map, pr.type, plot);
      plot.used = true;
      world.project = null;
      emit('facility_built', null, { facilityId: fac.id, type: fac.type, x: plot.x, y: plot.y });
      if (fac.type === 'house') {
        // 이주: 가장 과밀한 집(거주-침대 최대, 동률 facilityId asc)의 최고 id 거주자
        let worst = null, worstOver = 0;
        for (const h of world.map.facilities) {
          if (h.type !== 'house' || h.id === fac.id) continue;
          const res = world.sims.filter((x) => x.homeId === h.id).length;
          const over = res - h.resources.length;
          if (over > worstOver || (over === worstOver && worst && h.id < worst.id)) {
            if (over > 0) { worst = h; worstOver = over; }
          }
        }
        if (worst) {
          const mover = world.sims.filter((x) => x.homeId === worst.id).sort((a, b) => b.id - a.id)[0];
          mover.homeId = fac.id;
          emit('moved_home', mover.id, { from: worst.id, to: fac.id });
          recordFact(mover, t, L, 'built_bed', { placeId: fac.id, tags: ['home'] });
        }
      }
    }
    // §17.8 일일 평가: 질병 → 선거 → 시장 수당 → 이민 (도시계획 트리거보다 앞)
    {
      const day = floorDiv(t, 1440);
      if (world.lastDailyDay !== day) {
        world.lastDailyDay = day;
        dailyDiseaseDraws(world, t, emit);
        updateCampaigners(world, day); // §17.9 (선거일엔 클리어 후 선거)
        maybeElection(world, t, day, emit);
        mayorStipend(world, t, emit);
        maybeImmigration(world, t, day, emit);
        maybeNewYear(world, t, day, emit); // 당일 이민자 포함 (§17.9 확정 규칙)
        maybeChildren(world, t, day, emit); // §17.11 자녀 정착
        maybeFestival(world, t, day, emit); // §17.10
      }
    }
    const day = floorDiv(t, 1440);
    if (!world.project && world.lastPlanDay !== day) {
      world.lastPlanDay = day;
      const freePlot = world.plots.find((p) => !p.used);
      if (freePlot) {
        const beds = world.map.facilities.filter((f) => f.type === 'house')
          .reduce((n, f) => n + f.resources.length, 0);
        const cafeSeats = world.map.facilities.filter((f) => f.type === 'cafe')
          .reduce((n, f) => n + f.resources.length, 0);
        const parkSpots = world.map.facilities.filter((f) => f.type === 'park')
          .reduce((n, f) => n + f.resources.length, 0);
        const pop = world.sims.length;
        // §17.11: 별거 부부는 신혼집 수요 — 부부당 침대 1개 추가 필요분으로 계산
        let separated = 0;
        for (const [aStr, b] of Object.entries(world.partners)) {
          const a = Number(aStr);
          if (a < b && world.partnerStage[a] === 'married') {
            const pa = world.sims.find((s2) => s2.id === a);
            const pb = world.sims.find((s2) => s2.id === b);
            if (pa.homeId !== pb.homeId) separated++;
          }
        }
        let type = null;
        if (pop + separated > beds) type = 'house';
        else if (pop > cafeSeats * L.construct.cafeRatio) type = 'cafe';
        else if (pop > parkSpots * L.construct.parkRatio) type = 'park';
        if (type) {
          // §17.4: 시장 재임 중엔 행정력으로 공사가 빨라진다 (시작 시점 스냅샷)
          const required = world.mayorId !== null
            ? floorDiv(L.construct.laborRequired * L.election.mayorLaborPct, 100)
            : L.construct.laborRequired;
          world.project = { plotId: freePlot.plotId, type, progress: 0, required };
          emit('project_started', null, { plotId: freePlot.plotId, type, x: freePlot.x, y: freePlot.y, required });
        }
      }
    }
  }

  // 5) idle 심 결정 (id 오름차순, world.reservations = 틱-로컬 원장)
  for (const sim of world.sims) {
    if (sim.state.kind !== 'idle') continue;
    const shortlist = shortlistMemories(sim, t, L); // D1: 심당 1회 계산
    const critical = Object.entries(NEED_OF_ACTION)
      .filter(([, need]) => sim.needs[need] < L.needCritical)
      .map(([action]) => action);
    let cands = [];
    let urgency = false;
    if (critical.length > 0) {
      cands = collectCandidates(world, sim, critical, t, false, { shortlist, urgency: true });
      urgency = cands.length > 0;
    }
    if (cands.length === 0) cands = collectCandidates(world, sim, ACTIONS, t, false, { shortlist, urgency: false });
    const best = pickBest(cands);
    if (best) {
      // §15.1.C 사고 흐름: 막힌 대안 수집 (rng 미사용, ACTIONS 순, 최대 4개)
      const chain = [];
      for (const action of ACTIONS) {
        if (action === 'idle' || action === best.action || chain.length >= 4) continue;
        const blocked = actionBlockReason(world, sim, action, t);
        if (blocked) { chain.push({ a: action, b: blocked }); continue; }
        if (!cands.some((c) => c.action === action)) {
          const deficit = NEED_MAX - needValueFor(sim, action, L);
          chain.push({ a: action, b: deficit <= 0 ? 'sated' : 'full' });
        }
      }
      // 사유 필드는 §14.1 계약대로 + Phase 3 citedMemorySeqs
      startAction(world, sim, best, emit, {
        chain,
        need: NEED_OF_ACTION[best.action]
          ?? (COPING_ACTIONS.includes(best.action) ? 'mood' : best.action === 'build' ? 'space' : 'money'),
        deficit: best.deficit,
        persFactor: best.persFactor,
        planFactor: best.planFactor,
        partyPull: best.partyPull,
        moodMod: best.moodMod,
        memoryMod: best.memoryMod,
        stateMod: best.stateMod,
        habitMod: best.habitMod,
        citedMemorySeqs: best.cited,
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
