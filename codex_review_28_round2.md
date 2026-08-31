1. **Major — wedding-token ordering:** Specify whether the token is created immediately during the reflection that emits `married` or in stage 4, and its `tokenCounter` order relative to normal and club tokens. “Reuses diffusion” does not settle this.

2. **Major — campaigner eligibility/cache:** Define whether `campaigners` contains the same positive-popularity candidates as the election or top two including zero-popularity sims, and exact lifecycle: compute once on D-3, retain through D-1, clear on D0 even for an uncontested/no-candidate election.

3. **Major — aging boundary:** Fix ordering relative to immigration and stage-5 decisions. State whether a same-day immigrant ages immediately and whether student→office-worker/retirement affects decisions only from the next tick (recommended).

4. **Major — `recentCouples` ring semantics:** Define insertion sequence, “recent” selection when multiple entries qualify, eviction tie-breaks, and whether duplicate started_dating→married entries are retained independently.

5. **Minor — conversation window:** Specify politics/couple_news eligibility at exact day boundaries, especially election day and the `+3`/`+7` endpoints, plus deterministic name selection when multiple couples/candidates qualify.

The existing romance single-executor rule, election tie rules, appended enum compatibility, and §G bounds remain sound. **NO-GO until items 1–3 are fixed.**