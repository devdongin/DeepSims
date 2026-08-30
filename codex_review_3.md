The four original blockers are mostly repaired, but one core action-target ambiguity remains, and §2.5 is not yet precise enough to implement deterministically beyond Phase 1. Final verdict: **NO-GO for the full v2.2 plan; GO for Phase 1 after one small core clarification.**

## Previous blockers

1. Tick/input convention — **resolved**

`state[t] = simulate(state[t-1], inputs[t])`, `target_tick = worldTick + 1`, and destination-tick event labeling are internally consistent.

The atomic committed-tick visibility rule also makes the report cursor semantics valid.

2. Durable 30-day clamp — **resolved**

The re-anchoring formula permanently discards excess elapsed time, and committing `epochUtcMs` with simulation metadata prevents the backlog from reappearing.

One implementation detail: persist the new epoch in the first successful catch-up batch transaction. If that transaction rolls back, both simulation progress and re-anchoring must roll back together.

3. Reservation/interruption/social semantics — **partially resolved**

The reservation lifecycle, serialized reservations, tick-local ledger, interruption trigger, and deterministic social pairing are now clear.

One remaining core ambiguity: decisions and `assign` identify only an `actionType`, while several actions have multiple possible targets:

- `sleep`: ten beds across five houses
- `socialize`: café or park
- Potentially multiple eligible slots at one facility

The utility model scores an “action,” but reservations require a concrete resource and path. Define candidates as `(actionType, facilityId, resourceId)` and specify deterministic target tie-breaking, for example:

```text
score candidate action-target pairs
tie-break by action enum, facility ID, then resource ID
```

For `assign(simId, actionType)`, either:

- Have the server deterministically choose the best valid target using the same ordering, or
- Extend the command with an optional `targetFacilityId`.

Also define validation when replacing the sim’s own reservation. If the sim owns the last slot, validation should consider that slot reusable; otherwise assigning the same action could be incorrectly rejected.

Multiple `assign` commands for one sim in the same tick are deterministic due to sequence ordering, but state explicitly that each accepted command replaces the result of the previous one.

4. Crash recovery model — **resolved**

Normal recovery now correctly relies on SQLite rollback. No event truncation, replay from an unavailable historical state, or input unmarking remains.

Dual snapshots are reasonable as a manual corruption aid. Manual restoration will need instructions for reconciling `meta`, events, and applied inputs with snapshot 2, but that is an operational tool concern rather than an implementation blocker.

## Section 2.5 critique

### 5. Phase separation is good, but “MVP” is contradictory

Section 3 says the MVP has one input command, `assign`, while §2.5 adds `announce` “in v2.2.” Phase 4 then places `announce` later.

Choose one statement:

```text
MVP / Phase 1 input: assign only
Phase 4 input: announce added
```

Likewise, §1 still states a 50k ticks/s budget while §2.5 replaces it with 20k. Label these explicitly:

- Phase 1 budget: 50k ticks/s
- Phase 3–4 budget: 20k ticks/s

### 6. Cognition pipeline placement is inconsistent

The plan says reflection occurs when sleep performance starts, but integration places it in step 3, “completion/failure settlement.” Sleep begins when:

- An already-walking sim arrives during step 2, or
- Potentially an input changes state during step 1 if no walking is required.

Step 3 is not generally the start point.

Add an explicit transition hook:

```text
onEnterPerforming(sleep) → runReflection()
```

Run it immediately after the transition, wherever that transition occurs. Event ordinals can still be assigned later in step 6.

Daily planning has the inverse problem: it runs on waking/sleep completion, but §2.5.G does not place it. Put it in step 3 immediately after sleep completion settlement.

### 7. Reflection needs idempotency and day boundaries

A sim can sleep more than once in one game day. As written, each sleep start could:

- Reprocess the same memories
- Generate duplicate derived memories
- Reapply habit increments
- Emit repeated relationship-tier changes

Store fields such as:

```text
lastReflectedDay
lastPlannedDay
reflectionMemoryCursor
```

Define the game-day boundary from world tick, not wall-clock time. Reflection should process a precise interval or only memories after its cursor.

Also clarify “mood recomputed at sleep start, applied on waking.” This needs separate `pendingMood` and `currentMood`, or mood should update immediately. Otherwise serialization and mid-sleep behavior are ambiguous.

### 8. Memory is bounded, but deterministic eviction is incomplete

“Append-only” contradicts deletion at 256 entries. Call it an insertion-ordered bounded stream.

Eviction needs a complete comparison key. For example:

```text
lowest retention score
then lowest importance
then oldest tick
then lowest insertion sequence
```

Also define:

- Canonical tag ordering and duplicate removal
- Retrieval top-k tie-breaking
- Whether derived reflection memories can evict the source memories being processed
- Whether each memory has a stable per-sim sequence or ID

A stable `memorySeq` is the simplest final tie-breaker.

### 9. Retrieval arithmetic needs exact integer definitions

This expression is not yet compliant with the no-division rule:

```text
(now - tick) / 1440
```

Specify integer floor division and clamp negative age defensively:

```text
ageDays = min(floorDiv(max(0, worldTick - memory.tick), 1440), 15)
```

Define the actual LUT values and integer constants `w_r`, `w_i`, and `w_v` before implementing retrieval tests.

“Friendly sim at facility” also appears to depend on current world state, not just memory tags. Separate:

- Memory-derived modifiers
- Current-state social modifiers

Otherwise two implementations could interpret retrieval relevance differently.

### 10. Composite score mathematics is under-specified

This is the largest §2.5 determinism risk:

```text
base × personality × plan + memory modifier + mood modifier
```

The additive terms need a common scale and denominator. “Use BigInt if a combination may overflow” leaves implementation-dependent branching and makes accidental `number`/`bigint` mixing likely.

Choose one representation now:

- Prefer a fixed integer score scale with saturating/clamped modifiers, or
- Represent every final score as a rational and compare with `BigInt` cross-products.

For ten sims, always using `BigInt` during decisions is likely simpler and insignificant compared with memory scanning.

Every weight also needs bounds. Habit bonuses currently accumulate without a cap and can eventually dominate needs or overflow. Define caps for:

- Habit weights
- Plan bonuses
- Memory modifiers
- Mood modifiers
- Personality-adjusted decay
- Final score numerator/denominator

The urgency-override rule should be structural, not merely “utility dominates.” For example, when any critical need is below its threshold, exclude plan and habit modifiers for unrelated actions.

### 11. Memory/event integration can create ordering ambiguity

Completed actions create memories in step 3, while all events receive ordinals only in step 6. Do not derive memory insertion order from final event ordinals unless those ordinals already exist.

Use fixed pipeline generation order plus `memorySeq`. Similarly, specify when these are recorded:

- `argument`
- `party_info`
- `starving`
- `input_rejected`
- `lonely`

Some occur in different pipeline stages and are not “completed actions.” A single deterministic `recordFact()` hook invoked when the fact occurs would be clearer.

### 12. Socialize pairing is deterministic, but information transfer is not fully specified

Pair ordering is sound. Token processing is not yet complete:

- If A knows three tokens and B knows none, in what token order are transmission attempts made?
- Does each token consume one RNG draw?
- Can both directions transmit different tokens in one paired tick?
- Can the same token be retransmitted every tick?
- How is duplicate knowledge detected?
- Do tokens expire?
- What is a token’s stable identity?
- Is affinity sampled before or after that tick’s relationship mutation?

Use a stable token ID and sort candidate transfers by token ID, then direction/sim ID. Define exactly one RNG draw per eligible transfer attempt—or use a hash-derived deterministic roll if you want unrelated RNG consumption not to alter diffusion.

### 13. Party tokens lack the information required for planning

The token schema is:

```text
{topic, originTick, placeId, tick}
```

It does not contain the planned event time. Yet agents are supposed to bias the corresponding time slot and later gather for the event.

Add at least:

```text
tokenId
topic
originTick
scheduledTick or scheduledDayAndSlot
placeId
expiresTick
```

The two tick fields currently shown are ambiguous. Presumably one is token creation time and the other acquisition time; acquisition belongs on the recipient’s memory record, not necessarily on the shared token.

The world-event generation rule also cannot remain “for example, every three game days.” Fix the cadence, eligibility, RNG draw order, and scheduling window before Phase 4.

### 14. Plans, habits, and mood need serialization and validity rules

These are world state and should be explicitly listed as serialized:

- Current daily plan and plan day
- Current/pending mood
- Habit weights
- Relationship tiers
- Reflection/planning cursors
- Known token IDs
- Memory insertion sequence

Define what happens when a planned action is impossible—closed workplace, no money, no slot, or unreachable target. It should fall back through normal candidate selection without repeated failure loops.

### 15. Complexity is controlled operationally, but testing is incomplete

Phasing is the right way to contain scope, but “rerun determinism and partition tests” is not enough. Add cognition-specific tests per phase:

- Memory capacity and deterministic eviction
- Retrieval ranking and tie-breaking
- Reflection idempotency across repeated sleep
- Serialize/deserialize during sleep with pending mood
- Daily-plan generation once per day
- Habit caps and long-run score bounds
- Diffusion with fixed token ordering and RNG state
- Party attendance reproducibility
- Catch-up/live equivalence with cognition enabled
- Performance per phase, including worst-case all-idle decisions

The 20k target should include a worst-case benchmark with ten sims idle and all memory streams at 256 entries, not only typical behavior.

## Additional correctness issue

The FNV-1a implementation wording is wrong for JavaScript:

```text
multiply, then >>> 0
```

Ordinary JavaScript multiplication can produce an intermediate near `2^56`, beyond exact integer precision. Use:

```js
hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
```

The fixed-vector test should catch this, but the specification should explicitly require `Math.imul`.

## Final verdict

**NO-GO for implementing the complete v2.2 cognition system as currently written.**

**Phase 1 is effectively GO** once deterministic action-target selection and self-owned reservation replacement are specified. The original clock, tick, and crash-recovery blockers are resolved. Before Phase 2–4, tighten the cognition transition hooks, score representation, memory ordering, reflection idempotency, and information-token schema. These are localized specification fixes; the underlying architecture does not need another redesign.