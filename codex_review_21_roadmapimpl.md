1. **Major:** [tick.js:266](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:266) — `create_player` does not initialize `hangoverUntil: -1`, violating the v6 sim schema and making fresh player state differ from migrated/world-generated sims.

2. **Minor:** [tick.js:558](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:558) — coping actions report `reason.need: 'money'`; this should be `'mood'` for an accurate reason chain.

The fixed `den=16` coping delta is deterministic, preserves §G bounds, and reasonably keeps personality modulation meaningful. Tests/build pass; bench is ~45–47k tick/s. **NO-GO until finding 1 is fixed; finding 2 should accompany it.**