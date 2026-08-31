// 대화·인사 상호작용 (D8/D9). 구조화 payload만 — 문장화는 클라이언트 (PLAN §14.1 스타일).
// payload 계약(확정): 코드베이스 관례를 따른다 — 이벤트 simId = 화자/발신자, payload.withSimId = 상대.
// (argument·relationship_changed와 동일 형태. D8 초안의 aSimId/bSimId 표기는 이 관례로 대체.)
import { rngInt } from './prng.js';
import { AFFINITY_MIN, AFFINITY_MAX, CLUBS } from './constants.js';
import { applyGossipInfluence } from './society.js';

function floorDiv(a, b) { return Math.floor(a / b); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function scaleDelta(delta, factor) {
  const s = Math.sign(delta);
  return s * floorDiv(Math.abs(delta) * factor, 100);
}

// D8: socialize 페어의 대화 주제 결정 — 발화 간격마다 1회, rngSim 최대 1드로우.
// transferHappened: 이 틱 이 페어에서 토큰 전파 성공 여부 (party_invite 우선).
export function maybeConverse(world, a, b, facId, t, transferHappened, emit) {
  const L = world.logic;
  // 두 심의 pairedTicks는 페어링 직후라 동일 — a 기준으로 간격 판정
  if (a.state.pairedTicks % L.conversation.lineInterval !== 1) return;
  const speaker = floorDiv(a.state.pairedTicks, L.conversation.lineInterval) % 2 === 0 ? a : b;
  const listener = speaker === a ? b : a;

  let topic = null;
  let aboutSimId = null;
  let detail = null; // 발화의 구체 내용 (구조화 — 문장화는 클라이언트)
  if (transferHappened) {
    topic = 'party_invite';
    // 방금 전파된 토큰의 구체 정보: 수신자가 새로 알게 된 것 중 tokenId 최대
    const known = [...a.knownTokens, ...b.knownTokens];
    const tok = world.tokens.filter((tk) => known.includes(tk.tokenId)).sort((x, y) => y.tokenId - x.tokenId)[0];
    if (tok) detail = { placeId: tok.placeId, scheduledTick: tok.scheduledTick };
  } else {
    // 문맥 필터링된 가중 테이블 (키 사전순 고정 순회, 1드로우)
    const day = floorDiv(t, 1440);
    const candidates = [];
    for (const key of Object.keys(L.conversation.topicWeights).sort()) {
      const w = L.conversation.topicWeights[key];
      if (w <= 0) continue;
      if (key === 'food' && world.map.facilities.find((f) => f.id === facId)?.type !== 'cafe') continue;
      if (key === 'work_gripe' && speaker.traits.occupation === 'retired') continue;
      if (key === 'gossip') {
        const third = pickGossipTarget(world, speaker, listener);
        if (third === null) continue;
        candidates.push({
          key, w, about: third,
          detail: { // 관계·감정의 구체 (§16 대화 내용 강화)
            tier: speaker.relTiers[third] ?? 'stranger',
            sentiment: Math.sign(world.affinity[speaker.id][third]),
          },
        });
        continue;
      }
      if (key === 'memory_share') {
        const mem = topMemoryOfDay(speaker, day);
        if (!mem) continue;
        candidates.push({
          key, w, about: mem.subjectSimId ?? null,
          detail: { kind: mem.kind, placeId: mem.placeId }, // 무슨 일이 있었는지
        });
        continue;
      }
      if (key === 'work_gripe') {
        candidates.push({ key, w, about: null, detail: { occupation: speaker.traits.occupation } });
        continue;
      }
      if (key === 'weather') {
        candidates.push({ key, w, about: null, detail: { kind: world.weather?.kind ?? 'sunny' } });
        continue;
      }
      if (key === 'food') {
        candidates.push({ key, w, about: null, detail: { hungry: speaker.needs.hunger < 4000 } });
        continue;
      }
      candidates.push({ key, w, about: null });
    }
    // §17.5/§17.6: 관계 문맥 주제 (가중치는 기존 weather 가중 재사용 — 구조 변경 없이 문맥 추가)
    if (world.partners[speaker.id] === listener.id) {
      candidates.push({ key: 'sweet_talk', w: 60, about: null, detail: { stage: world.partnerStage[speaker.id] } });
    }
    for (const club of CLUBS) {
      const mem = world.clubs[club.id];
      if (mem.includes(speaker.id) && mem.includes(listener.id)) {
        candidates.push({ key: 'club_talk', w: 30, about: null, detail: { clubId: club.id } });
        break;
      }
    }
    if (candidates.length === 0) {
      topic = 'weather'; // 폴백 보장 — 문맥 필터로 전부 제외돼도 발화는 나간다 (드로우 없음)
      detail = { kind: world.weather?.kind ?? 'sunny' };
    } else {
      const total = candidates.reduce((s, c) => s + c.w, 0);
      let roll = rngInt(world.rngSim, total);
      for (const c of candidates) {
        if (roll < c.w) { topic = c.key; aboutSimId = c.about; detail = c.detail ?? null; break; }
        roll -= c.w;
      }
    }
  }
  // §17.7: 험담은 청자의 대상 인식을 실제로 바꾼다 (말 → 관계 → 선택)
  if (topic === 'gossip' && detail) {
    applyGossipInfluence(world, listener, aboutSimId, detail.sentiment, emit);
  }
  emit('conversation', speaker.id, {
    withSimId: listener.id, topic, aboutSimId, placeId: facId, detail,
    // 청자 반응의 구체: 청자→화자 호감도 부호 (클라가 반응 온도를 정함)
    listenerWarmth: Math.sign(world.affinity[listener.id][speaker.id]),
  });
}

// 험담/칭찬 대상: 화자의 관계 티어가 stranger가 아닌 제3자 중 |호감도| 최대 (동점 id 낮은 쪽)
function pickGossipTarget(world, speaker, listener) {
  let best = null, bestAbs = -1; // -1: 호감도 0인 non-stranger도 유효 대상 (Codex 19차)
  for (const other of world.sims) {
    if (other.id === speaker.id || other.id === listener.id) continue;
    if (!speaker.relTiers[other.id]) continue; // stranger 제외 (D8 계약)
    const abs = Math.abs(world.affinity[speaker.id][other.id]);
    if (abs > bestAbs) { bestAbs = abs; best = other.id; }
  }
  return best;
}

function topMemoryOfDay(sim, day) {
  let best = null;
  for (const m of sim.memories) {
    if (floorDiv(m.tick, 1440) !== day) continue;
    if (!best || m.importance > best.importance
      || (m.importance === best.importance && m.memorySeq < best.memorySeq)) best = m;
  }
  return best;
}

// D9: 스쳐 지나가는 인사 — 둘 다 walking이고 근접, 하루 1회/페어, rng 미사용
export function processGreetings(world, t, emit) {
  const L = world.logic;
  const day = floorDiv(t, 1440);
  // 할당 없는 스캔 (성능): walking 심만 이중 루프
  const sims = world.sims;
  for (let i = 0; i < sims.length; i++) {
    if (sims[i].state.kind !== 'walking') continue;
    for (let j = i + 1; j < sims.length; j++) {
      if (sims[j].state.kind !== 'walking') continue;
      const a = sims[i], b = sims[j];
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (dist > L.conversation.greetingRange) continue;
      if (world.lastGreetDay[a.id][b.id] === day) continue;
      world.lastGreetDay[a.id][b.id] = day;
      world.lastGreetDay[b.id][a.id] = day;
      const fA = world.logic.affinity.tfScaleBase + a.traits.mbti.TF;
      const fB = world.logic.affinity.tfScaleBase + b.traits.mbti.TF;
      world.affinity[a.id][b.id] = clamp(
        world.affinity[a.id][b.id] + scaleDelta(L.conversation.greetingAffinity, fA), AFFINITY_MIN, AFFINITY_MAX);
      world.affinity[b.id][a.id] = clamp(
        world.affinity[b.id][a.id] + scaleDelta(L.conversation.greetingAffinity, fB), AFFINITY_MIN, AFFINITY_MAX);
      a.needs.social = Math.min(10000, a.needs.social + L.conversation.greetingSocial);
      b.needs.social = Math.min(10000, b.needs.social + L.conversation.greetingSocial);
      emit('greeting', a.id, { withSimId: b.id });
    }
  }
}
