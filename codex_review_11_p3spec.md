- **D1 — Objection:** Deterministic and performant, but relevance cannot affect admission to top-8, so a highly relevant memory may be excluded by unrelated important memories. Prefer a candidate-independent shortlist larger than 8 (e.g. 32), then candidate-specific relevance selects top-8. Benchmark that compromise.

- **D2 — OK**, provided migration occurs before pending-input reconciliation, the merged v2 logic is canonicalized/serialized, and all new ranges preserve integer bounds. Rejecting pending v1 updates is consistent.

- **D3 — OK.** Serialize the symmetric matrix, increment with a saturating safe-integer cap, and emit `relationship_changed` only when crossing a tier boundary—not every paired tick.

The recorded clamp, fact-site, tag, reflection-cursor, and wake-time `pendingMood` contracts look consistent.