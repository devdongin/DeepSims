Phase 1 release verdict: GO, with one non-blocking minor fix recommended.

## Fix verification

1. Atomic lock: PASS  
   `openSync(..., 'wx')`, stale PID 제거, 단일 재시도가 올바르게 구현됐습니다.

2. assign utility bypass: PASS  
   `includeZeroScore=true`가 assign 경로에만 적용되고 R1이 실제 0점 수락을 검증합니다.

3. work urgency: PASS  
   잔액 자체가 need 값이 되어 가난할수록 deficit과 work 점수가 커집니다. R2 통과.

4. WS catch-up disconnect race: PASS  
   핸들러가 첫 `await` 전에 등록되고, 연결 상태 및 `clients.size` 재검사가 추가됐습니다.

5. Pruned aggregate cursor: PASS, documented approximation  
   날짜와 `(cursor, upto]`의 교집합 조건이 정확합니다. 부분일 근사는 문서화됐고 클라이언트에도 표시됩니다.

6. Malformed payload: PASS  
   REST와 결정적 코어 양쪽에서 방어합니다. R3 통과.

7. Regression tests: PASS for R1–R5  
   R4는 실제 등거리 후보를 구성해 resource ID 타이브레이크를 검증합니다. 서버·WS·락 통합 테스트 부재는 인정된 기술부채입니다.

8. Step-1 ordinal contract: PASS  
   PLAN v2.4가 sequence 인과 순서를 명시해 구현과 일치합니다.

9. Event storage boundary: PARTIAL, minor  
   타입 레지스트리는 정상입니다. 다만 [storage.js:75](/Users/sundongin/WorkSpace/DeepSims/db/storage.js:75)의 `payloadJson.length`는 UTF-16 코드 단위이지 UTF-8 바이트가 아닙니다. 600자 한글 payload는 문자열 길이 611이지만 실제 1,811바이트인데도 통과함을 재현했습니다. 정확한 1KB 제한은 다음이어야 합니다.

```js
if (Buffer.byteLength(payloadJson, 'utf8') > 1024) ...
```

Phase 1의 현재 내부 이벤트 payload는 작고 대부분 ASCII라 릴리스 blocker로 보지는 않습니다.

검증 결과:

- 테스트: 31/31 통과
- 벤치: 176,986 tick/s
- 예산 대비: 약 3.5배
- 검토 중 저장소 파일 변경 없음

## PLAN v2.4 §12–14 sanity check

향후 Phase 2 시작 전에 다음을 정리하면 됩니다. 현재 Phase 1 릴리스에는 영향이 없습니다.

- §12가 Big Five를 대체한다고 선언했지만 §2.5.A는 여전히 Big Five 본문입니다. 단일 권위 섹션으로 합치거나 §2.5.A를 §12 참조로 교체해야 합니다. MBTI·나이·직업 계수도 구현 전 정수 테이블과 반올림 순서를 확정해야 합니다.
- §13의 `create_player`는 Phase 2에서 도입되므로 당시에는 assign 다음 두 번째 명령입니다. Phase 4의 announce가 세 번째입니다. “명령 레지스트리 3종째” 표현을 수정하고 이름·trait 범위·직업 enum·spawn/home 선택 규칙을 명시해야 합니다.
- §14의 schemaVersion 증가는 상태 구조 변경과 행동 규칙 변경을 구분하는 편이 안전합니다. 기존 세이브를 계속 사용하려면 새 필드의 결정적 기본값 또는 명시적 호환 정책이 필요합니다. 재현 이슈에는 seed와 tick뿐 아니라 schema/behavior version, snapshot hash 및 필요한 전체 입력 범위를 기록해야 합니다.

셀프 리뷰 후, 서버 통합 테스트 부재는 실제 수정 코드가 명확하고 Phase 1 테스트 목록의 필수 게이트는 통과했으므로 release blocker에서 기술부채로 낮췄습니다. 반면 UTF-8 크기 검사는 실제 재현되는 잔여 편차라 minor로 유지했습니다.

::inbox-item{title="DeepSims Phase 1 release GO" summary="31 tests pass; fix UTF-8 payload cap as follow-up"}