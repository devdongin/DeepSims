# #182 cache invalidation audit (no production cache installed)

Audited a04a89e; sim/map.js is unchanged through main55455b4. Search covered
tile writes, tile-array replacement, reachVersion, and builder call sites in
sim/ and server/. This is a source audit plus counterexamples, not a claim that
arbitrary external mutation can be detected without a contract.

| Writer / boundary | Graph effect | Existing identity/revision behavior |
|---|---|---|
| map.js addBuilding (all rotations) | Adds walls/doors; may split paths | Increments reachVersion after completed stamp |
| roads.js route-work completion | Can open river/bridge route | Increments reachVersion after changes |
| tick.js zone road demolition | ROAD/SIDEWALK → GRASS | No revision; all remain walkable, so unweighted BFS graph unchanged |
| tick.js pedestrian wear | GRASS → SIDEWALK | No revision; graph unchanged |
| society.js public paving | GRASS → ROAD | No revision; graph unchanged |
| map.js expandMapTo | Changes dimensions, indexing, boundary | Replaces tiles array; key must include dimensions/identity |
| map.js authored venue builders | Walls/floors/doors written into passed tiles | No map/revision parameter; initial and legacy migration use |
| map.js generateTerrain | Blocks terrain and opens bridges in-place | Does not increment reachVersion; construction/load phase call sites |
| migrate.js repairOverlaps | Removes/repaints footprints | In-place without revision increment |
| rail.js corridor | Temporarily blocks buildings/parcels | Copies tiles, keeping other map metadata; never share base-map field |
| deserialize / snapshot replay | Replaces object graph | New tile identity must mean cache miss; no cache in serialized world |
| Tests/callers directly editing tiles | Any graph change | Not revision-tracked; current bfsPath intentionally sees edits immediately |

Construction and migration phases currently precede normal ticks, but exported
builders can be called independently. A cache must not be enabled merely because
a map has a reachVersion field. Existing sameRegion cache assumptions do not
prove a stronger exact-path cache contract.

New executable counterexamples keep tiles identity and reachVersion unchanged
while a wall edit changes the exact path; change dimensions with the same tiles
and revision; and show a copied rail corridor with the same revision differs
from ground. These would reject naïve revision-only or metadata-only reuse.

## Required implementation agreement

1. Define a supported, audited mutation boundary and explicit invalidation for
   every topology-changing builder/load path. Preserve the generic bfsPath API
   by falling back for untracked maps/callers rather than silently ignoring edits.
2. Key fields by tile identity, dimensions, topology revision, target index, and
   routing semantics. Do not serialize performance cache state.
3. Prove cache hit and eviction change neither chosen coordinates nor RNG/events.
   A lower exploration count is expected, not proof of correct behavior.
4. Count field memory, construction, invalidation and cold misses in the same
   performance comparison. A full-grid fingerprint per query would add O(map)
   work and cannot be called a free correctness check.

No production changes were made during this audit. Pending Claude review of the
proof and mutation contract remains separate from benchmark/adoption approval.
