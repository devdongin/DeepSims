**GO for Phase 3 commit.**

Verified:

- `logic/params.json` is canonical schema v2 with `memory` and `social`.
- Boot upgrade preserves existing values and merges new defaults before reconciliation.
- Reflection restricts cursor-window memories to `transitionDay` while advancing the cursor.
- The missed-sleep regression passes.
- Full suite: **55/55 passed**.

No remaining blocker or major finding after final review.