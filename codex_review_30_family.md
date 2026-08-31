1. **Major — parent home/free-bed predicate:** Define whether reproduction requires both spouses to share the same `homeId`; existing marriage can leave spouses in separate homes. Also define “free bed” against reservations, not only resident count.

2. **Major — child creation ordering:** Fix the exact order for child ID/name-counter allocation, matrix expansion, `parents` insertion, affinity initialization, `new_neighbor` memories, parent memories, and `child_settled` emission when multiple couples succeed in one new-year evaluation.

3. **Minor — same-day participation:** State whether a newly settled child participates in that day’s remaining daily systems (disease, election, stipend, etc.); recommended: next tick/day after the new-year block.

4. **Minor — family conversation target:** If a sim has multiple parents/children, define deterministic target selection and payload ordering for `family_talk`/named lines.

Generating full traits and overriding age/occupation is deterministic and acceptable; explicitly document that both discarded draws are intentional. Affinity, family bonus, and §G bounds remain safe. **NO-GO until items 1–2 are specified.**