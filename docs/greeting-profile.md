# #99 remaining greeting cost: measurement before implementation

Baseline: main `abeae2509a870ce24a807aedc1bdddbab06ecd7d`, including
`39358df` performing-index and walkability-table improvements. No simulation
code, parameters, population in the player world, or player database changed.

Reproduce from this branch (Node's profiler writes only the specified /tmp files):

```sh
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=deepsims-greeting-main.cpuprofile bench/popscale.js --profile 200 --days 2
node bench/profile-summary.js /tmp/deepsims-greeting-main.cpuprofile
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=deepsims-greeting-main400.cpuprofile bench/popscale.js --profile 400 --days 2
node bench/profile-summary.js /tmp/deepsims-greeting-main400.cpuprofile
```

Seed20260831, synthetic load fixture, one warmup day and two measured days.
The full regression suite had finished before profiling. Other host activity
cannot be excluded; these are single-run hotspot observations, not speedup claims.

| Population | Greeting sampled self time | Memory sampled self time | Measured ms/day | BFS measured ms/day |
|---|---|---|---|---|
| 200→202 | 80.209ms / 0.81% | 1112.699ms / 11.25% | 2394 | 369 |
| 400→402 | 415.042ms / 1.32% | 3699.802ms / 11.75% | 6661 | 936 |

CPU percentages include world setup and warmup (total9891.875ms/31482.041ms).
The benchmark table excludes those phases. Do not combine these denominators
or present this synthetic fixture as a representative live growth world.
Measured BFS calls/day1897/3486; visited cells/call6213/9228 respectively.

Decision: defer greeting changes. Even eliminating its entire sampled cost
would recover only a small fraction in these fixtures. Memory scoring is the
larger next bounded investigation; #98's long-distance flood remains subject
to exact-coordinate contracts. No optimization was adopted and #99 is not
resolved. Claude completion review requested through the issue.
