**NO-GO — three major findings.**

1. **Major — event payload contracts differ from D8/D9.**  
   [sim/interaction.js:56](/Users/sundongin/WorkSpace/DeepSims/sim/interaction.js:56) emits conversation as `simId + {withSimId,...}` instead of `{aSimId,bSimId,topic,aboutSimId?,placeId}`. Greeting has the same mismatch at [sim/interaction.js:103](/Users/sundongin/WorkSpace/DeepSims/sim/interaction.js:103).

2. **Major — gossip can target strangers.**  
   [sim/interaction.js:61](/Users/sundongin/WorkSpace/DeepSims/sim/interaction.js:61) accepts any third sim with nonzero affinity; it must require that the speaker’s relationship tier is not `stranger`. Independent reproduction produced gossip about a stranger.

3. **Major — weather is not guaranteed as fallback.**  
   [sim/logic.js:224](/Users/sundongin/WorkSpace/DeepSims/sim/logic.js:224) permits `weather: 0`. If all weighted topics are context-filtered, [sim/interaction.js:48](/Users/sundongin/WorkSpace/DeepSims/sim/interaction.js:48) silently omits the scheduled utterance. Require positive weather weight or force weather fallback.

Tests pass **67/67** and build passes. Performance is borderline: median normal result across three runs was about **49.6k**, slightly below the 50k budget; worst-case remains healthy above 51k.