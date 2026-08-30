## Findings

1. **Major — `expiresTick` inclusive boundary is violated.**  
   [sim/planning.js:87](/Users/sundongin/WorkSpace/DeepSims/sim/planning.js:87) skips transfer at `t == expiresTick`, and [sim/planning.js:114](/Users/sundongin/WorkSpace/DeepSims/sim/planning.js:114) removes the token during that tick’s stage 4. Consequently stage-5 party pull cannot apply at `expiresTick`, despite D6 specifying the inclusive interval `[scheduledTick-120, expiresTick]`. The skipped transfer also changes RNG consumption.

   Use `t > expiresTick` for transfer rejection and expiry removal. Add a boundary test covering transfer draw, stage-5 factor 150, and cleanup at `expiresTick + 1`.

**NO-GO** until this boundary is fixed.

Otherwise the reviewed implementation matches D4–D7. Validation passed: **61/61 tests**, production build, **51.5k normal / 53.6k worst-case** benchmarks. No other findings remained after self-review.