// R-D: bounded, durable modifiers; no mutation of the saved base logic.
// One active event per channel. A later input replaces that channel only.
export const WORLD_EVENT_TOPICS = Object.freeze(['couple_news', 'family_talk', 'food',
  'gossip', 'memory_share', 'politics', 'weather', 'work_gripe', 'sweet_talk', 'club_talk']);
export const WORLD_EVENT_EFFECTS = Object.freeze(['disease', 'immigration',
  ...WORLD_EVENT_TOPICS.map(topic => `topic_${topic}`)]);
export const MAX_WORLD_EVENT_TICKS = 1440 * 30;

export function validateWorldEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return { ok: false, error: 'malformed_payload' };
  if (Object.keys(payload).some(k => !['effect', 'percent', 'durationTicks'].includes(k)))
    return { ok: false, error: 'unknown_field' };
  if (!WORLD_EVENT_EFFECTS.includes(payload.effect)) return { ok: false, error: 'unknown_effect' };
  if (!Number.isSafeInteger(payload.percent) || payload.percent < 0 || payload.percent > 300)
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
  const entry = { effect: payload.effect, percent: payload.percent, startsAt: t,
    expiresAt: t + payload.durationTicks };
  if (old >= 0) events.splice(old, 1);
  events.push(entry);
  events.sort((a, b) => WORLD_EVENT_EFFECTS.indexOf(a.effect) - WORLD_EVENT_EFFECTS.indexOf(b.effect));
  emit('world_event_started', null, { ...entry, replaced: old >= 0 });
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
