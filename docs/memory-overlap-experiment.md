# #99 bounded memory overlap experiment — not adopted

Reference main `abeae2509a870ce24a807aedc1bdddbab06ecd7d`; candidate changes
only the maximum scanned bucket from relevanceCap to min(cap, candidate tags).
This branch is an experiment, not a production optimization.

Regression: `node --test test/memory-overlap-bound.test.js test/candidate-contract.test.js`
passed8/8, including all legal relevance caps0..16, topK1/8/32, empty and
duplicate candidate tags, changing scratch sizes, retrieval ties and exact
score/citation comparison with the full-sort reference. Candidate/choice/event/
world golden vectors were unchanged.

Reproduce with an unchanged main checkout at the reference commit:

```sh
node bench/memory-overlap-cost.js /absolute/path/to/reference-checkout
```

ABBA, synthetic200, seed20260831, one warmup day and two measured days in fresh
processes. Base4894.668/4909.566ms; candidate4979.082/4889.986ms. No convincing
whole-simulation improvement; do not adopt on the strength of fewer loop steps.
All four runs matched end population202, world hashb9237383, complete event SHA
`e860740982f0281ae7ebb350df23e00bf759d44664874febb735f81f7a57be1e`, BFS3794calls
and23572848visited cells. Profiling/review or other host activity cannot be
excluded, so absolute timings are not a production throughput claim.

No logic version changes, no player save writes, no full suite or production PR
for this rejected candidate. Keep this branch for reproducibility. Memory
scoring remains a measured hotspot; this experiment does not resolve #99.
