# Codex 31차 리뷰 — 주거 평형 교착 해소 (v0.9.0 게이트)

**검토 대상**: ① §B 건설 트리거(별거 부부 수요 계상), ② applyRomance ①.5 합가 재시도(ⓐ 상대 이주 / ⓑ 신혼집 동반 이사), ③ 자녀 술어(빈 침대 OR 증축 여력, maxExtraBeds 캡)

**판정**:

> GO — the revised housing, cohabitation, child-capacity predicates, event ordering, and RNG behavior are consistent; 107/107 tests and the improved 400-day soak support release.

- (a) 이민 게이트(침대>인구) 유지와 계획 트리거의 별거 수요 계상은 정합 — 이민은 실침대, 건설은 잠재 수요라는 역할 분리 인정
- (b) moved_home ×2 (lo 먼저) 이벤트 계약 이상 없음
- (c) 자녀 일시 과밀 → §15.1 build 창발 경로에서 수면 예약/이민 게이트 충돌 없음
- (d) 신규 코드 드로우 소비 변화 없음 — 결정성 유지 확인
