Phase 1은 현재 NO-GO입니다. 결정성의 기본 골격은 좋지만, 2개 blocker와 5개 major가 실제 재현됩니다.

## Findings

1. blocker: 단일 인스턴스 락이 원자적이지 않습니다.  
   [server/index.js:22](/Users/sundongin/WorkSpace/DeepSims/server/index.js:22)에서 존재 여부를 검사한 뒤 [server/index.js:32](/Users/sundongin/WorkSpace/DeepSims/server/index.js:32)에서 일반 덮어쓰기로 생성합니다. 두 프로세스가 동시에 시작하면 둘 다 검사를 통과할 수 있습니다. 같은 SQLite 월드를 서로 다른 메모리 상태로 진행해 충돌·손상시킬 수 있습니다. `openSync(..., 'wx')` 같은 배타적 생성과 실패 시 기존 PID 검증이 필요합니다.

2. blocker: 수동 `assign`이 효용을 무시하지 않습니다.  
   [sim/tick.js:58](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:58)의 점수를 계산한 뒤 [sim/tick.js:59](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:59)에서 0점 후보를 제거합니다. 욕구가 10000인 심에게 유효한 `assign(eat)`을 보내면 `no_valid_target`으로 거부됩니다. PLAN은 assign이 효용과 무관하게 하드 제약만 검증하도록 요구합니다. 자율 후보와 assign 후보 수집을 분리해야 합니다.

3. major: work urgency가 의도와 정반대로 계산됩니다.  
   [sim/tick.js:16](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:16)은 돈이 적을수록 큰 `moneyNeed`를 반환하지만, [sim/tick.js:24](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:24)에서 다시 `10000 - need`를 적용합니다. 결과적으로 돈 0이면 work 점수가 0이고, 돈 10000이면 최대입니다. 재현에서도 돈 0인 심은 sleep, 돈 10000인 심은 work를 선택했습니다. `min(money, 10000)`을 need 값으로 쓰거나 `moneyNeed`를 deficit으로 직접 사용해야 합니다.

4. major: catch-up 중 연결이 끊기면 클라이언트가 누수되고 0-client 상태에서도 라이브 루프가 시작됩니다.  
   소켓을 [server/index.js:94](/Users/sundongin/WorkSpace/DeepSims/server/index.js:94)에서 집합에 넣은 뒤 catch-up을 기다리지만, close 핸들러는 그 이후인 [server/index.js:113](/Users/sundongin/WorkSpace/DeepSims/server/index.js:113)에 등록됩니다. 대기 중 연결이 종료되면 close 이벤트를 놓치고, [server/index.js:105](/Users/sundongin/WorkSpace/DeepSims/server/index.js:105)가 라이브 루프를 시작합니다. close/message 핸들러를 첫 `await` 전에 등록하고, catch-up 후 `readyState`와 `clients.size`를 다시 확인해야 합니다.

5. major: 프루닝 이후 tick cursor 리포트가 이벤트를 잃습니다.  
   집계 조회가 [db/storage.js:164](/Users/sundongin/WorkSpace/DeepSims/db/storage.js:164)에서 `day_start_tick > cursor`를 사용합니다. cursor가 하루 중간이면 해당 날짜 집계 전체가 제외됩니다. 실제로 `(100,1000]`에 이벤트 126개가 있었지만 프루닝 후 빈 결과가 반환됐습니다. 또한 클라이언트는 [client/main.js:181](/Users/sundongin/WorkSpace/DeepSims/client/main.js:181) 이하에서 `prunedAggregates`를 전혀 소비하지 않습니다. 일 집계와 임의 tick cursor를 함께 지원할 명확한 경계·응답 병합 방식이 필요합니다.

6. major: `payload: null` 입력이 저장된 뒤 시뮬레이션을 크래시시킵니다.  
   [server/index.js:57](/Users/sundongin/WorkSpace/DeepSims/server/index.js:57)의 `typeof payload === 'object'` 검사는 null을 허용합니다. 이후 [sim/tick.js:130](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:130)의 구조 분해에서 TypeError가 발생합니다. `payload !== null`, plain-object 여부와 최소 스키마를 REST 경계에서 검사해야 하며, 코어도 잘못된 내구 입력을 결정적인 `input_rejected`로 처리해야 합니다.

7. major: 테스트 26개가 주요 수용 계약을 실제로 검증하지 않습니다.  
   특히 “타이브레이크” 테스트는 [test/sim.test.js:65](/Users/sundongin/WorkSpace/DeepSims/test/sim.test.js:65)에서 동점 후보를 만들지 않고 동일 실행 결과만 비교합니다. 서버/Engine/WS/락 테스트는 없으며, crash recovery 테스트도 commit 도중 실패를 주입하지 않습니다. 위의 assign 0점, work 역전, null payload, 프루닝 cursor, catch-up disconnect가 모두 통과한 이유입니다.

8. minor: 1단계 입력 이벤트 ordinal이 심 ID 순서를 따르지 않습니다.  
   [sim/tick.js:127](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:127)에서 sequence 순으로 즉시 이벤트를 추가하고 [sim/tick.js:244](/Users/sundongin/WorkSpace/DeepSims/sim/tick.js:244)에서 그대로 ordinal을 부여합니다. sequence 0이 sim 1, sequence 1이 sim 0이면 ordinal도 1→0 순서였습니다. 결정적이기는 하지만 PLAN의 “단계 내 sim id 오름차순”과 다릅니다.

9. minor: 이벤트 크기와 타입 레지스트리가 영속화 경계에서 강제되지 않습니다.  
   [db/storage.js:69](/Users/sundongin/WorkSpace/DeepSims/db/storage.js:69)은 타입과 직렬화 payload를 그대로 삽입합니다. PLAN의 payload ≤1KB 및 이벤트 타입 레지스트리 제한이 검증되지 않습니다.

## 확인된 정상 항목

- `tick()` 파이프라인, triple argmax와 코드상의 타이브레이크, 예약 유지·해제, 자기 예약 재사용, later-assign-wins
- `manhattanDistance + 16` 정수 점수와 안전한 수치 범위
- canonical 객체 키 정렬, FNV-1a `Math.imul`, PRNG 상태 직렬화
- snapshot 회전, events/input/meta의 단일 SQLite 트랜잭션, sequence 할당 트랜잭션, 중복 ID 반환, 손상 감지
- `computeTarget` 역행·30일 clamp·epoch 재고정
- 라이브 루프의 시계 재계산과 반복당 1440틱 제한
- WS 연결별 seq와 snapshot resync 기본 경로
- 공원 16개 spot과 BFS `Int32Array`는 설명된 범위에서 허용 가능한 편차

`npm test`는 26/26 통과했습니다. 제 환경의 벤치는 165,526 tick/s로 50k 예산을 충분히 넘었습니다.

셀프 리뷰에서는 Phase 4 전용 urgency fallback과 `lonely`의 completion 이벤트 의미는 Phase 1 판정에서 제외했습니다. 반면 위 1~6번은 Phase 1 핵심 경로에서 직접 재현되므로 심각도를 낮출 근거가 없었습니다.

::inbox-item{title="DeepSims Phase 1 수정 필요" summary="2 blockers and 5 majors found before release"}