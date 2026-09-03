// #89 Pace new ambient hazards; never heal residents or alter response behavior.
import { fnv1a } from './serialize.js';
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function makeStoryteller() {
  return { lastEvent: null, recent: [], history: [] };
}

function recovering(world, event) {
  if (!event) return false;
  if (event.kind === 'illness') return !!world.sims.find(s => s.id === event.targetId)?.sick;
  return world.incidents.some(i => i.type === 'fire' && i.facilityId === event.targetId);
}

export function resolveStoryCandidates(world, t, candidates, emit) {
  const day = Math.floor(t / 1440), S = world.logic.storyteller, state = world.storyteller;
  state.recent = state.recent.filter(e => day - e.day < S.windowDays);
  const row = { day, candidateCount: candidates.length,
    candidatesByKind: { illness: 0, fire: 0 }, reason: 'empty_pool', chosen: null };
  for (const c of candidates) row.candidatesByKind[c.kind]++;
  if (candidates.length) {
    if (state.lastEvent && day - state.lastEvent.day < S.minGapDays) row.reason = 'minimum_gap';
    else if (recovering(world, state.lastEvent)) row.reason = 'recovering';
    else if (state.recent.length >= S.maxEventsPerWindow) row.reason = 'recent_density';
    else {
      const ranked = candidates.map(c => ({ candidate: c, key: `${c.kind}:${c.targetId}`,
        rank: fnv1a(`${world.seed}:${day}:${c.kind}:${c.targetId}`) }));
      ranked.sort((a, b) => compare(a.rank, b.rank) || compare(a.key, b.key));
      const chosen = ranked[0].candidate;
      chosen.apply();
      row.reason = 'applied'; row.chosen = { kind: chosen.kind, targetId: chosen.targetId };
      state.lastEvent = { day, ...row.chosen };
      state.recent.push({ ...state.lastEvent });
    }
  }
  state.history.push(row);
  while (state.history.length > 14) state.history.shift();
  emit('storyteller_decision', null, row);
  return row;
}
