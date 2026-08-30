The plan is directionally sound, but several important rules are still ambiguous. The biggest risks are intervention timing, real-time anchoring, persistence consistency, and nondeterministic agent interactions.

## Critical logic issues

### 1. The real-time clock is underspecified

The plan stores `epoch` and `last_simulated_tick`, then computes elapsed time on boot. It does not define:

- Whether tick 0 corresponds to `epoch` exactly.
- Which clock is authoritative: wall clock, monotonic time, or persisted logical time.
- What happens if the system clock moves backward or forward.
- Whether paused time, sleep, DST, timezone changes, or clock correction matter.
- Whether the world can advance beyond “now” due to live-loop drift.

Use UTC Unix milliseconds for persistence and define:

```text
targetTick = floor((currentUtcMs - epochUtcMs) / tickDurationMs)
```

Clamp backward clock movement so `targetTick >= last_simulated_tick`. For an MVP, document that manual clock changes may be detected and treated as a pause or anomaly.

The live loop should also derive the current target tick from the clock rather than blindly incrementing once per `setInterval`, otherwise timer delays create divergence between live play and offline catch-up.

### 2. Interventions cannot simply be “queued at the next tick”

“Applied at next tick boundary” conflicts with “recorded as timestamped inputs ... replayed at their recorded ticks.”

Questions the plan must answer:

- If a client sends an intervention while the server is catching up, what tick does it target?
- If two clients intervene before the same boundary, what is their deterministic order?
- What if the requested sim is already busy?
- What if the intervention targets a sim that has died, moved, lost money, or changed state during catch-up?
- Can an intervention alter the past, or only affect the current/future logical tick?
- What happens to an intervention submitted while the server is offline? There is no server to queue it unless client-side input persistence exists.

Define an append-only command/input log, separate from the event log:

```text
inputs(id, target_tick, sequence, client_id, command, payload)
```

Assign ordering on the authoritative server, validate commands against the state at `target_tick`, and apply inputs before simulation for that tick. Inputs targeting a tick already simulated must be rejected or scheduled for the next valid tick; never silently rewrite history.

If local single-player is the MVP, simplify this to one authoritative command queue and explicitly exclude offline client-authored commands.

### 3. Snapshot persistence can lose or duplicate events

The bootstrap flow says “run advance ... Persist snapshot + events,” but does not specify transaction boundaries.

A crash between writing the snapshot and appending events, or vice versa, can cause:

- Events reported but state not reflected.
- State advanced but events missing.
- Events duplicated after restart.

Persist each catch-up batch in one SQLite transaction:

1. Read snapshot and input position.
2. Simulate a batch.
3. Write the new snapshot.
4. Insert events with a uniqueness key.
5. Record the consumed input range / last tick.
6. Commit atomically.

The event table needs a stable event ID or uniqueness constraint, such as `(tick, ordinal)`. `tick, sim_id, type, payload` is not necessarily unique because a sim can emit multiple identical events in one tick.

Also define whether snapshots are immutable historical snapshots or only “latest snapshot.” For an MVP, retain one current snapshot plus events, or use a clear pruning policy.

### 4. `advance(world, nTicks) -> events` and PRNG state need a precise contract

The catch-up equivalence test is only valid if `advance` literally performs the same ordered tick transitions as repeated `tick` calls. The implementation must not use a separate batch algorithm, random-seed derivation, or aggregate decay formula.

Define:

```text
advance(world, n) {
  for (i = 0; i < n; i++) {
    events.push(...tick(world))
  }
  return events
}
```

If the function mutates `world`, say so explicitly. If it returns a new world, enforce immutability consistently. Also test:

- `advance(world, 0)` does nothing.
- Repeated calls with arbitrary partitions produce the same result.
- Empty event batches do not alter state.
- Serialization preserves the exact PRNG state.
- Hashing the same state is stable across JSON key order and runtime versions.

Do not rely on ordinary `JSON.stringify` unless object insertion order is fully controlled. Use canonical serialization with explicit field ordering.

### 5. Multiple sims acting in the same tick are not defined

The plan says “each tick, idle sims score ... pick argmax,” but not whether decisions are simultaneous or sequential.

That choice changes outcomes. For example, two sims may both select the only bed, workplace slot, or food item.

Specify a deterministic tick pipeline, for example:

1. Apply validated player inputs.
2. Advance all active actions.
3. Resolve completed actions.
4. Recompute needs.
5. Process arrivals/departures.
6. Decide new actions in sorted sim-ID order.
7. Reserve resources.
8. Emit events.
9. Update world tick and PRNG.

If decisions are intended to be simultaneous, calculate all decisions from a read-only state and resolve conflicts with deterministic priority. Resource reservation must be explicit.

### 6. Action semantics are underspecified

Actions occupying `N` ticks need definitions for:

- Whether needs decay during the action.
- What happens if the sim is displaced or the object becomes unavailable.
- Whether the action starts immediately or after walking.
- Whether movement and action consume the same tick.
- Whether a sim can replan every tick or only on action completion/interruption.
- Whether needs can exceed bounds or become negative.
- How money is earned or spent.
- Whether work requires a schedule.
- Whether failed actions emit events.

Without these rules, live and catch-up behavior may appear inconsistent even if technically deterministic.

### 7. Pathfinding determinism is not guaranteed by saying “A*”

A* can produce different paths unless tie-breaking is fixed. Define:

- Neighbor visitation order.
- Priority queue tie-breaking.
- Whether diagonal movement is allowed.
- How equal-cost paths are selected.
- Whether dynamic occupants block tiles.
- What happens when no path exists.
- Whether distance penalty uses Manhattan distance, path length, or estimated travel time.

For a 64×64 map, deterministic BFS/A* with fixed neighbor order is adequate. Cache static paths only if invalidation rules are clear.

### 8. World generation is too vague

“Procedurally generated from seed” needs deterministic generation rules, especially if generated structures affect gameplay.

Specify:

- PRNG stream separation for terrain, buildings, sim creation, and runtime events.
- Exact map boundaries and walkable tiles.
- Guaranteed placement of required locations.
- Collision and spawn validation.
- Stable sim IDs and initial ordering.
- Whether generated data is stored in snapshots or regenerated from seed.

It is safer to store generated world data in the snapshot, even if it can theoretically be regenerated.

## Catch-up and reporting gaps

### 9. Catch-up caps are not defined

“Capped batch size” could mean a batch size per transaction, a maximum catch-up duration, or a maximum offline duration. These have different behavior.

Define:

- Maximum ticks per simulation batch.
- Whether the server continues catching up asynchronously.
- Whether clients may connect before catch-up completes.
- Whether live simulation can start before catch-up finishes.
- What happens if catch-up takes longer than the elapsed time and the target keeps moving.
- A maximum supported offline duration or a fast-forward policy.

The safest sequence is: catch up to a captured target tick, persist, then start live simulation. If progress is exposed over WebSocket, specify the state shown to clients during catch-up.

### 10. “While you were away” report boundaries are ambiguous

`sinceTick` alone is insufficient unless the server defines:

- Inclusive versus exclusive bounds.
- Maximum report size.
- Whether events are raw or aggregated.
- Whether reports are based on events only or also state deltas.
- What happens when old events have been pruned.
- Whether repeated requests are idempotent.

Use a server-returned `last_seen_tick` or report cursor. Aggregate by categories and include the covered interval. The report should not depend on mutable current state alone.

### 11. Event payloads need versioning and size limits

Events are persisted as JSON, but there is no schema/version strategy. Add:

```text
event_id, tick, ordinal, type, schema_version, sim_id, payload_json
```

Define payload limits and whether event text is generated client-side or server-side. Avoid storing derived prose as the canonical event; store structured facts and render text in the client.

## Architecture concerns

### 12. The single process has a manageable but important failure mode

A synchronous `better-sqlite3` database plus synchronous simulation is reasonable for a local MVP. However:

- Long catch-up blocks HTTP and WebSocket handling.
- Writing every live tick can cause unnecessary disk churn.
- Shutdown hooks are not guaranteed on crashes or forced termination.
- Two server processes could open the same world unless explicitly prevented.

Add a single-instance lock, transactional writes, and periodic checkpoints. Do not rely on shutdown persistence as the primary durability mechanism.

### 13. The server/client state contract is incomplete

“Full world snapshot” and “changed sim states (delta)” need a schema and versioning rules:

- Does the client receive the authoritative tick?
- How are missed deltas recovered?
- What happens after reconnect?
- How does the client detect a gap?
- Is the full snapshot compressed or bounded?
- Are map and static data sent once or every connection?

Every message should include at least `worldTick`, protocol version, and possibly a sequence number. On a gap, the client should request a fresh snapshot.

### 14. The PRNG should not be exposed as casually mutable world state

Keeping PRNG state in the world is deterministic, but all random calls must be centralized. A future feature that calls randomness while rendering, reporting, or validating commands could accidentally consume the shared stream.

Use a simulation-only RNG interface and forbid random calls outside deterministic state transitions. Consider separate named streams for world generation and runtime events so adding a cosmetic random event does not change all future gameplay.

## Missing edge cases

At minimum, specify behavior for:

- Zero or negative `nTicks`.
- Invalid seeds.
- Duplicate commands.
- Stale commands after reconnect.
- Sim IDs removed or added.
- No available path.
- A sim becoming unable to afford food.
- All sims being asleep or idle.
- Resource contention.
- Events generated at the same tick.
- Integer overflow after very long worlds.
- Database corruption or malformed snapshot JSON.
- Schema migration.
- Client reconnect during catch-up.
- Browser tab sleep and multiple open tabs.
- Server restart while a live tick is being persisted.
- System clock rollback.
- Extremely large offline durations.

## MVP scope recommendations

The plan is slightly overbuilt in some areas and underdefined in the core loop.

For a safer first version, reduce scope to:

- One local player and one world.
- One server process and one browser client.
- Fixed map authored or minimally generated.
- 5–10 sims rather than 20.
- 3–4 needs and 5–6 actions.
- Deterministic movement with fixed tie-breaking.
- One command type, such as “assign sim to location.”
- One current snapshot plus append-only events.
- No multiplayer ordering, no client-offline commands, no complex relationship matrix, and no elaborate event aggregation initially.

Add tests beyond the current three:

1. Partition invariance across many arbitrary batch sizes.
2. Determinism with identical inputs, not just identical seeds.
3. Input ordering and duplicate-input behavior.
4. Clock anchoring and restart behavior.
5. Transaction/crash recovery.
6. Resource contention.
7. No-path and interrupted-action behavior.
8. Canonical hash stability.
9. Event uniqueness and report cursor semantics.
10. Long-run bounds: needs, money, affinity, and tick counters.

The key architectural correction is to model the world as a deterministic state transition driven by two ordered streams:

```text
state[t + 1] = simulate(state[t], inputs[t])
```

Persist the state checkpoint, the input stream position, and the emitted event stream atomically. Once that contract is explicit, live play and offline catch-up become two execution modes of the same mechanism rather than separate behaviors that can drift apart.