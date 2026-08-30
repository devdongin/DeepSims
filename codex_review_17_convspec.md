- **D8 — OK with two clarifications:** `party_invite` should consume **zero** topic RNG draws; otherwise exactly one. Define `memory_share` tie-break as importance desc → memorySeq asc, and gossip affinity as `abs(affinity[speaker][third])`.

- **D9 — OK.** Clamp affinity/social to existing bounds. Explicitly place greeting effects before transfer, so same-tick transfer uses post-greeting affinity. Note that sims becoming `performing` during 2a are intentionally excluded.

- **D10 — OK.** For `gathering`, anchor 🎉 to the facility because no sim owns the event; conversation bubbles attach to both participants.

Schema, migration, validation, event-registry additions, and fixed ordering are consistent.