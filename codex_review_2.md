Overall: substantially improved, but not implementation-ready yet. Two core contracts still contain correctness ambiguities: tick/input indexing and the 30-day clock clamp. Verdict: **NO-GO until those are corrected**.

1. Real-time clock — **partially resolved**

UTC anchoring, clock-derived live ticks, backward clamping, and captured boot target are good.

Remaining contradiction: the 30-day clamp is not durable. If catch-up advances only `lastSimulatedTick + 30 days` while `epochUtcMs` remains unchanged, the next target calculation still points to the original wall-clock target. The supposedly discarded excess time will be simulated on the next live-loop iteration or reconnect.

Action: define a persisted wall-clock cursor or re-anchor the epoch when truncation occurs. For example:

```text
rawTarget = floor((now - epoch) / tickDuration)
target = min(rawTarget, lastSimulatedTick + maxCatchupTicks)

if rawTarget > target:
    epoch = now - target * tickDuration
```

Also specify whether forward clock jumps are treated exactly like offline elapsed time.

2. `advance`, mutation, and PRNG contract — **resolved**

The plan explicitly makes `advance` repeated `tick`, declares mutation, preserves PRNG state, and adds partition and serialization tests.

One correction: `hashWorld` using FNV-1a must specify the exact variant, integer width, overflow behavior, string encoding, and output format. “FNV-1a” alone is not cross-runtime precise.

3. Player input/intervention model — **partially resolved**

The separate append-only input log, server ordering, idempotency key, application-time validation, and no-history-rewrite rule address the original concern.

There is a likely off-by-one contradiction:

```text
state[t+1] = simulate(state[t], inputs[t])
```

But an input received at `lastSimulatedTick = t` gets `targetTick = t + 1`. Under the stated equation, the next transition consumes `inputs[t]`, not `inputs[t+1]`.

Choose one convention and use it everywhere:

```text
Option A: state[t+1] = simulate(state[t], inputs[t])
next input target = worldTick

Option B: state[t] = simulate(state[t-1], inputs[t])
next input target = worldTick + 1
```

I recommend Option B because event ticks, input target ticks, and resulting state ticks then share the destination tick.

Also add `UNIQUE(target_tick, sequence)` and define sequence allocation as transactional. On duplicate `clientInputId`, return the originally assigned target and sequence.

4. Snapshot/event transaction consistency — **partially resolved**

Atomic batch commits are correct and prevent normal snapshot/event divergence.

The recovery description is internally weak: if snapshot, events, input flags, and meta are committed in one transaction, a process crash cannot normally leave only `snapshot.tick != meta.lastSimulatedTick`. That condition indicates corruption or an old schema, not routine crash recovery.

More importantly, resimulation from the only snapshot cannot regenerate events after that same snapshot unless the snapshot predates the affected interval. With a single latest snapshot, there may be no earlier checkpoint to replay from.

Action:

- Treat transaction rollback as normal crash recovery: load the last committed state and continue.
- Treat snapshot/meta mismatch as corruption and fail safely or restore from a retained previous checkpoint.
- If resimulation recovery is required, retain at least current and previous snapshots.
- Never mark input rows backward from `applied=1` without restoring a matching older snapshot.

5. Simultaneous agent interactions and reservations — **partially resolved**

Sequential decisions in sim-ID order and immediate reservation resolve ordinary bed/seat/work contention deterministically.

The phrase “read-only state” conflicts slightly with immediate reservations. Define a tick-local mutable reservation ledger: gameplay state remains read-only during scoring, but each accepted decision updates the ledger seen by later sims.

Reservation lifecycle remains unspecified:

- When is a reservation released?
- Does it remain held while the sim walks?
- Can a walking sim monopolize a work slot indefinitely?
- What happens if an action is interrupted?
- Are reservations serialized in snapshots?
- Does a forced assignment replace and release an existing reservation atomically?

These rules affect both determinism and gameplay.

6. Action semantics — **partially resolved**

Movement, execution, decay, completion, replanning, bounds, affordability, and failure are much clearer.

Remaining gaps:

- `assign` interruption semantics are undefined.
- The plan tests “action interruption” but defines no interruption triggers or state transition.
- It is unclear whether a forced action bypasses utility checks, schedules, money checks, or availability.
- `socialize` requires another sim, but pairing is not defined. Does the partner also enter a social action? Can one sim satisfy multiple simultaneous social actions?
- It is unclear whether failure immediately replans in pipeline step 5 of the same tick or waits until the next tick.
- “Facility becomes full before execution” should normally be impossible with durable reservations; explain what condition can invalidate a reservation.

These need explicit state-machine rules before implementing the core.

7. Pathfinding determinism — **resolved**

Fixed BFS neighbor ordering, uniform movement, no dynamic sim blocking, no diagonals, and explicit no-path handling adequately resolve this concern.

Minor improvement: use BFS path length rather than Manhattan distance for the utility distance term if obstacles matter. Manhattan distance is deterministic but may strongly prefer a physically close facility requiring a long detour. This is a design choice, not a blocker.

8. World generation — **resolved**

A fixed authored map, snapshot-stored world data, stable sim ordering, and separated generation/runtime RNG are appropriate for the MVP.

Add a map validation test ensuring every required facility is reachable from every valid spawn. That converts an authored-data assumption into an enforceable invariant.

9. Catch-up limits and client behavior — **partially resolved**

Captured targets, bounded batches, progress state, and “finish catch-up before snapshot/live mode” are good.

Remaining issues:

- The 30-day clamp bug from item 1 is blocking.
- Catch-up on a new connection after the server remained running with zero clients is only mentioned parenthetically, not in the server flow. Define the connection transition as:

```text
0 clients → capture target → catch up → send snapshot → start live loop
```

- Define whether incoming `/api/input` requests are accepted during catch-up. If accepted using the current in-memory tick, they may target a tick inside the already captured catch-up interval. Simplest MVP rule: queue input assignment until catch-up completes, then assign the next tick.
- A hard performance assertion of 50k ticks/s may be flaky across machines and CI. Keep it as a benchmark or use a generous regression threshold on a named reference environment.

10. Absence-report boundaries — **partially resolved**

Exclusive start, inclusive end, `nextCursor`, bounded highlights, and repeated-request idempotency are specified.

Two gaps remain:

- A plain tick cursor cannot distinguish two reports when new events are later inserted for the cursor’s ending tick. Atomic completed-tick persistence may make that impossible, but state this invariant. Otherwise use `(tick, ordinal)`.
- “Daily aggregate rows” do not fit the declared `events` schema or event primary-key semantics. Add a separate table such as:

```sql
event_daily_aggregates(
  day_start_tick INTEGER,
  category TEXT,
  sim_id INTEGER,
  count INTEGER,
  payload TEXT,
  PRIMARY KEY(day_start_tick, category, sim_id)
)
```

Define how “balance change” is derived and retained after raw events are pruned.

11. Event identity, schemas, and retention — **partially resolved**

`(tick, ordinal)`, `schema_version`, structured payloads, and client-side prose generation address most of the concern.

Still specify:

- Maximum payload size.
- Allowed event types and payload schema per version.
- Deterministic event ordering before ordinal assignment.
- Whether clock-anomaly and input-rejection events belong to simulation events.

A clock anomaly originates outside `simulate` and should probably be an operational event, not inserted into the deterministic world-event sequence. Otherwise replay will not reproduce it.

12. Single-process persistence and failure behavior — **partially resolved**

WAL, atomic batches, latest snapshots, and avoiding reliance on shutdown hooks are sound for a local MVP.

Remaining points:

- PID lock files need stale-lock recovery and PID-reuse handling. Prefer an OS-backed exclusive lock if practical.
- Live persistence cadence is unclear. State whether every clock-derived live batch is committed, or whether several ticks may remain only in memory.
- Inputs received through REST must be durably inserted before acknowledging success.
- If uncommitted live ticks are lost, restart must safely regenerate them from the prior snapshot and durable input log. Add this specific test; it differs from “crash during transaction.”

13. WebSocket state contract — **resolved**

Protocol version, authoritative tick, sequence number, gap detection, snapshot resync, and reconnect behavior adequately resolve the concern.

Clarify that `seq` resets on each WS connection or include a connection/session ID. Otherwise clients cannot interpret a sequence reset after reconnect.

14. RNG isolation — **resolved**

Named generation/runtime streams and prohibition of RNG access outside simulation transitions address the concern well.

However, the utility formulas currently contradict “all numbers are integers”:

```text
(10000 - need) / 10000
1 / (1 + distance / 16)
```

Those are floating-point calculations. JavaScript floating-point is generally deterministic on one runtime, but this violates the stated fixed-point contract and complicates score tie-breaking.

Use integer/rational score comparison, ideally without division. For example, compare cross-multiplied integer numerators and denominators, using `BigInt` if overflow is possible.

## Remaining blockers

Before implementation, fix these four items:

1. Resolve the input tick off-by-one convention.
2. Make the 30-day truncation durable by updating the clock anchor/cursor.
3. Define reservation, interruption, forced-assignment, and social-pairing semantics.
4. Replace the invalid single-snapshot “truncate and resimulate” recovery story with either normal transactional rollback or retained previous checkpoints.

The aggregate-report table and integer utility scoring should also be corrected in the plan before coding because both affect core schemas or simulation results.

**Final verdict: NO-GO.** The architecture is now strong enough that this should become a GO after a focused v2.1 clarification pass; no broad redesign is needed.