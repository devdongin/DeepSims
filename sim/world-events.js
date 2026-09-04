// R-D: bounded, durable modifiers; no mutation of the saved base logic.
// One active event per channel. A later input replaces that channel only.
export const WORLD_EVENT_TOPICS = Object.freeze(['couple_news', 'family_talk', 'food',
  'gossip', 'memory_share', 'politics', 'weather', 'work_gripe', 'sweet_talk', 'club_talk']);
export const WORLD_EVENT_EFFECTS = Object.freeze(['disease', 'immigration', 'mood',
  ...WORLD_EVENT_TOPICS.map(topic => `topic_${topic}`)]);
export const MAX_WORLD_EVENT_TICKS = 1440 * 30;

export function validateWorldEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'malformed_payload' };
  const valueKey = payload.effect === 'mood' ? 'delta' : 'percent';
  if (Object.keys(payload).some(k => !['effect', valueKey, 'durationTicks'].includes(k)))
    return { ok: false, error: 'unknown_field' };
  if (!WORLD_EVENT_EFFECTS.includes(payload.effect)) return { ok: false, error: 'unknown_effect' };
  if (payload.effect === 'mood') {
    if (!Number.isSafeInteger(payload.delta) || Math.abs(payload.delta) > 3000)
      return { ok: false, error: 'invalid_delta' };
  } else if (!Number.isSafeInteger(payload.percent) || payload.percent < 0 || payload.percent > 300)
    return { ok: false, error: 'invalid_percent' };
  if (!Number.isSafeInteger(payload.durationTicks) || payload.durationTicks < 1
    || payload.durationTicks > MAX_WORLD_EVENT_TICKS)
    return { ok: false, error: 'invalid_duration' };
  return { ok: true };
}

export function applyWorldEvent(world, payload, t, emit) {
  const validation = validateWorldEvent(payload);
  if (!validation.ok) {
    emit('input_rejected', null, { command: 'world_event', reason: validation.error });
    return false;
  }
  if (!Number.isSafeInteger(t) || t < 0 || !Number.isSafeInteger(t + payload.durationTicks)) {
    emit('input_rejected', null, { command: 'world_event', reason: 'invalid_tick' });
    return false;
  }
  const events = world.worldEvents ??= [];
  const old = events.findIndex(e => e.effect === payload.effect);
  const value = payload.effect === 'mood' ? { delta: payload.delta } : { percent: payload.percent };
  const entry = { effect: payload.effect, ...value, startsAt: t,
    expiresAt: t + payload.durationTicks };
  if (payload.effect === 'mood') {
    const previous = activeMoodEvent(world, t);
    entry.applied = {};
    for (const sim of world.sims) {
      const receipt = previous?.applied?.[sim.id];
      const next = entry.applied[sim.id] = {};
      for (const field of ['mood', 'pendingMood']) {
        if (sim[field] == null) continue;
        if (receipt && previous.delta === payload.delta) {
          next[field] = receipt[field] ?? 0;
          continue; // Renewing a saturated event must not apply another shock.
        }
        const base = sim[field] - (receipt?.[field] ?? 0);
        sim[field] = clampMood(base + payload.delta);
        next[field] = sim[field] - base;
      }
    }
  }
  if (old >= 0) events.splice(old, 1);
  events.push(entry);
  events.sort((a, b) => WORLD_EVENT_EFFECTS.indexOf(a.effect) - WORLD_EVENT_EFFECTS.indexOf(b.effect));
  emit('world_event_started', null, { effect:entry.effect,...value,startsAt:entry.startsAt,
    expiresAt:entry.expiresAt,replaced:old>=0 });
  return true;
}

export function expireWorldEvents(world, t, emit) {
  if (!world.worldEvents) return;
  const active = [];
  for (const event of world.worldEvents) {
    if (t >= event.expiresAt) emit('world_event_expired', null, { ...event });
    else active.push(event);
  }
  world.worldEvents = active;
}

export function worldEventPercent(world, effect, t) {
  const entry = world.worldEvents?.find(e => e.effect === effect && e.startsAt <= t && t < e.expiresAt);
  return entry?.percent ?? 100;
}

export function worldEventMood(world, t) {
  return activeMoodEvent(world,t)?.delta ?? 0;
}

const clampMood = v => Math.max(-10000, Math.min(10000, v));
const activeMoodEvent = (world,t) => world.worldEvents?.find(e => e.effect === 'mood' && e.startsAt <= t && t < e.expiresAt);

export function reflectedEventMood(world,sim,t,moodSum) {
  const base=clampMood(moodSum),event=activeMoodEvent(world,t);
  if(!event)return base;
  const result=clampMood(base+event.delta);
  event.applied ??= {};
  const receipt=event.applied[sim.id] ??= {};
  receipt.pendingMood=result-base;
  return result;
}

export function wakeEventMood(world,sim,t) {
  const receipt=activeMoodEvent(world,t)?.applied?.[sim.id];
  if(receipt){receipt.mood=receipt.pendingMood??0;delete receipt.pendingMood;}
}
