# #182 exact-coordinate proof proposal — not a production cache

This branch changes no sim code. Baseline a04a89e retains the original ground
FIFO BFS neighbor order N/E/S/W. The executable prototype rebuilds a complete
reverse distance field for every query; it claims no speed improvement.

## Domain and argument

Assume a finite static rectangular grid, unit-cost orthogonal edges, symmetric
walkability, and in-bounds integer endpoints. Agent occupancy is not a blocker.

1. FIFO BFS with N/E/S/W neighbor expansion discovers the lexicographically
   earliest direction sequence among shortest paths to each vertex. Induction
   on BFS depth: parents and their children enter the queue in that order; a
   later duplicate prefix cannot improve an earlier prefix to the same vertex.
2. Reverse BFS from the goal computes exact remaining distances in this
   undirected graph. Every shortest path must decrease the remaining distance
   by one at every step.
3. Taking the first N/E/S/W neighbor that decreases that distance therefore
   selects the lexicographically earliest shortest direction sequence, matching
   the forward BFS coordinate array (start excluded, goal included).
4. Historical BFS permits a blocked starting cell. For that special case use
   one plus the minimum reachable neighbor distance and the same first-neighbor
   rule. The positive-cost shortest path never needs to revisit its start.
   Equal start/goal returns [] even when blocked; other blocked goals return null.

This argument does not authorize replacing weighted, directed, rail, air, or
time-dependent routing. Invalid/out-of-bounds endpoints are deliberately rejected
by the proof prototype; a production wrapper must preserve existing behavior or
fall back to the original BFS for inputs outside the proved domain.

## Executable checks

`node --test test/distance-field-proof.test.js`: 6/6 passed. All41472 start/goal
pairs over all512 three-by-three obstacle masks matched actual BFS exactly,
including blocked starts. All7 frozen pre-optimization coordinate SHA fixtures
were parsed as literal data from the existing regression file and matched. Wall
edits followed by full rebuilding also matched. This is finite counterexample
search supporting the argument, not a proof of an unimplemented cache.
All declared tile kinds and two unknown values were additionally compared at
every3x3 endpoint pair. Independent Codex review found no counterexample in the
stated domain; this is not Claude agreement or production-cache approval.
The added invalidation counterexamples and source audit are documented in
`distance-field-invalidation-audit.md`; unchanged reachVersion is not sufficient.

## Gates still open before production

- Review/agree on this exact-coordinate argument and domain.
- Audit every walkability mutation, map replacement, save reload and direct tile
  write. A stale distance field is unacceptable; reachVersion alone must not be
  assumed authoritative without that audit. Rebuild-on-query tests do not prove
  invalidation correctness.
- Bound cache memory and cold-miss work. At512², one Int32 field is1MiB before
  queue/storage overhead; many resource-specific goals can erase any benefit.
- Preserve original fallback semantics, RNG, complete world/event replay and
  endpoint tie order. Do not equate fewer BFS calls with a performance win.
- Measure cold/warm/population200 ABBA wall-clock and BFS cost, including field
  construction and invalidation. Adopt only if improvement reproduces.

No production PR or speedup claim is made. Claude review requested on #182.
