1. **Major — migration underspecified:** Define the bar’s facility ID, tile footprint/types, door, four resource IDs/coordinates, insertion order, and collision assertion. Otherwise v5→v6 snapshots may migrate differently from fresh v6 worlds.

2. **Major — reason-chain ordering:** Specify one `blockedBy` precedence when several causes apply, candidate-to-action aggregation rules, and include `unreachable`/`wrong_home` or explicitly map them to existing reasons. Collection must not alter RNG consumption.

3. **Major — build completion:** Define deterministic new-bed `resourceId`, exact slot-selection order, behavior if the work-bed reservation becomes invalid, and whether construction may reserve an occupied/reserved bed.

4. **Minor — hangover timing:** Define the interval precisely, preferably `t < hangoverUntil`, and clarify that “energy” means the existing sleep/energy need.

5. **Minor — habit integration:** Explicitly map the new completion memories to habit keys, particularly `drank → drink:bar`; otherwise “existing habit loop” is not fully specified.

The coping score preserves §G: with mood clamped to `[-10000,10000]` and the `< -2000` gate, deficit is `-mood ∈ [2001,10000]`, so existing bounds hold. Appending `drink`, `binge_eat`, `hole_up`, `exercise`, then `build` preserves prior enum tie ordering. **NO-GO until items 1–3 are specified.**