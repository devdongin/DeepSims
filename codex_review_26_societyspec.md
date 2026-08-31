1. **Major — disease RNG order:** §17 gives daily disease draws as sim-id ordered and contagion draws inside pairing, but does not fix their order relative to weather, token/item consumers, transfer, conversation, affinity/club deltas, or immigration. Specify the full suborder and whether same-day immigrants receive a risk draw.

2. **Major — romance double execution:** Define the exact asymmetric mutual-affinity predicates, partner candidate ordering, and a single executor (e.g. lower sim ID). Also specify deterministic ordering for simultaneous dating, marriage, and breakup transitions.

3. **Major — election edge cases:** Define behavior with zero or one positive-popularity candidate, whether the existing mayor remains when there are no candidates, and exact vote ties. “Top two” is undefined when fewer than two exist.

4. **Major — 30-tick reporting boundary:** Require report `upto` and cursors to clamp to the last committed tick, and ensure the in-memory world cannot expose uncommitted events/state through report APIs. The replay contract remains valid only if each 30-tick commit atomically includes snapshot, inputs, events, and meta.

5. **Major — immigration/election/planning ordering:** Immigration, daily planning, disease checks, elections, mayor salary, and project completion can all occur on the same daily-evaluation tick; define their exact stage/suborder and whether newly added sims participate immediately.

6. **Minor — sparse wear canonical form:** Specify numeric-string key normalization and ordering (`"2"` vs `"10"`), omission of zero entries, integer/range validation, and dense↔sparse migration invariants.

7. **Minor — new modifiers/effects:** Define integer rounding and clamping for disease’s 50% decay increase, partner ×2 state bonus, club/sweet-talk/gossip affinity deltas, and mayor’s 90% labor multiplier. All should preserve needs, affinity, score-slot, and safe-integer bounds.

**NO-GO until items 1–5 are fixed.**