- **D4 — Objection:** Define overlapping-slot precedence. Work windows overlap both meal and evening windows. Recommend `meal > work > evening`, or represent multiple intents explicitly. Formula and urgency behavior are otherwise OK.

- **D5 — Objection:** Specify affinity direction in transfer probability. Recommend sender’s affinity toward receiver: `affinity[senderId][receiverId]`, captured before either directional mutation. Also confirm generation occurs after expiry processing or define exact stage-4 suborder. Everything else is deterministic.

- **D6 — Objection:** Define composition with ordinary slot intent. Recommend party pull overrides normal slot matching with `planFactor=150`; urgency still forces 100. For multiple active tokens, candidate matching any token at that facility receives 150.

- **D7 — OK**, provided same-tick announces apply in input sequence order, allocate token IDs monotonically, and are eligible for stage-2 transfer that same tick. Validation/rejection must remain deterministic.