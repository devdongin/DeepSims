Phase 2 implementation verdict: NO-GO until two ordering blockers are resolved. Arithmetic and asymmetric affinity are otherwise safe.

## Issues

1. blocker: `clientInputId = logic:<hash>` prevents reverting to previously used parameters.  
   [PLAN.md:334](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:334)

   Sequence A→B→A에서 마지막 A는 첫 A와 같은 ID를 갖습니다. 입력 테이블의 전역 UNIQUE 때문에 새 업데이트가 아니라 과거 입력의 원래 target을 반환합니다.

   콘텐츠 해시와 별도로 단조 증가하는 `logicRevision`이 필요합니다. 예:

   ```text
   clientInputId = logic:<revision>:<hash>
   ```

   동일 `fs.watch` 알림의 중복 억제는 “현재 등록 대기 중인 revision+hash”로 처리해야 하며, 콘텐츠 해시 자체를 영구 idempotency key로 사용하면 안 됩니다.

2. blocker: 부팅 비교가 snapshot의 `world.logic`만 보면 pending update 뒤의 최종 로직을 보장하지 못합니다.  
   [PLAN.md:332](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:332), [PLAN.md:340](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:340)

   예를 들어 snapshot=A, pending=B, 현재 파일=A이면 단순 비교는 “같음”으로 판단해 새 입력을 만들지 않습니다. catch-up은 B를 적용하고 끝나므로 파일 A와 실제 world B가 달라집니다.

   부팅 시 다음 순서가 필요합니다.

   1. pending `logic_update`를 target/sequence 순으로 읽어 effective queued logic 계산
   2. 파일과 effective queued logic 비교
   3. 다르면 현재 파일을 pending updates 뒤에 추가
   4. catch-up 후 world.logic hash가 파일 hash와 같은지 단정

3. blocker: 첫 catch-up 틱에서 logic_update가 기존 입력보다 먼저 적용된다는 보장이 없습니다.  
   [PLAN.md:337](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:337), [PLAN.md:340](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:340)

   이미 `target=L+1, sequence=0`인 assign/create_player가 있고 logic_update가 sequence 1로 추가되면, 첫 입력은 구 로직으로 검증됩니다. 이는 “catch-up 전체가 새 로직”이라는 계약을 깹니다.

   내부 시스템 입력 우선순위를 명시해야 합니다. 가장 단순한 계약은 다음입니다.

   ```text
   step 1 ordering:
   logic_update first by sequence
   then create_player/assign by sequence
   ```

   이 순서를 이벤트 ordinal 계약에도 반영해야 합니다. 또는 부팅 시 기존 L+1 입력의 sequence를 원자적으로 밀고 logic_update를 sequence 0에 삽입할 수 있습니다.

4. major: params의 스키마·정수 범위·해시 검증 계약이 부족합니다.  
   [PLAN.md:329](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:329), [PLAN.md:338](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:338)

   입력과 snapshot 양쪽에 전문을 저장하는 것 자체는 결정성 문제가 아닙니다. 적용 tick의 batch transaction이 snapshot·applied flag·event를 함께 커밋하므로 일관됩니다.

   다만 적용 전 다음을 검증해야 합니다.

   - 허용 키와 필수 키
   - 모든 수치가 safe integer인지
   - 범위, enum, 배열 길이
   - 알 수 없는 키 거부 여부
   - canonical params hash가 input에 명시된 hash와 일치하는지
   - params 전문의 최대 UTF-8 크기
   - `logicSchemaVersion`

   잘못된 파일은 입력으로 등록하지 말고 ops_log에 기록해야 합니다. durable input이 이미 손상됐다면 결정적 `input_rejected` 또는 안전 정지 중 하나를 계약으로 선택해야 합니다.

5. major: schema migration에서 최초 `world.logic` 값이 정의되지 않았습니다.  
   [PLAN.md:420](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:420)

   v1 snapshot에는 `world.logic`이 없습니다. 그런데 Phase 2 `tick()`은 상수가 아니라 `world.logic`만 읽습니다. 첫 logic_update보다 앞선 입력이 하나라도 실행되면 undefined 상태가 됩니다.

   마이그레이션은 입력 처리 전에 다음을 완료해야 합니다.

   - traits/mood 기본값 추가
   - `world.logic`에 내장된 v1-equivalent 기본 파라미터 설치
   - schemaVersion=2
   - 그 뒤 파일 params를 logic_update 입력으로 등록

   마이그레이션 자체는 결정적이고 RNG 상태를 소비하지 않아야 합니다. `mulberry32((seed ^ simId) >>> 0)`처럼 별도 임시 RNG를 사용한다는 점도 명시하는 편이 안전합니다.

6. major: mood 이벤트 적용과 4단계 감쇠의 세부 순서가 모호합니다.  
   [PLAN.md:403](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:403)

   argument는 2단계, completion/lonely/money는 3단계, starving은 4단계에서 발생합니다. 특히 starving과 “4단계 mood 5 수렴” 중 어느 것이 먼저인지에 따라 같은 틱의 5단계 결정 점수가 달라집니다.

   권장 계약:

   ```text
   사실 발생 지점에서 mood delta 즉시 적용 및 clamp
   stage 4:
     need decay
     starving delta 적용
     mood를 0 방향으로 5 감쇠
   stage 5는 감쇠 후 mood를 읽음
   ```

   다른 순서도 가능하지만 하나를 고정해야 분할·리플레이 테스트가 명확해집니다.

7. minor: 음수 affinity delta에 `floorDiv`를 쓰면 0에서 멀어지는 편향이 생깁니다.  
   [PLAN.md:379](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:379)

   예를 들어 `delta=-1`, T factor 50%면 `floorDiv(-50,100)=-1`이지만 `delta=+1`은 0입니다. 결정성이나 범위는 깨지지 않지만 “변동 폭 0.5배”와는 미묘하게 다릅니다.

   대칭적인 크기 조절이 의도라면 부호 보존 truncation을 정의해야 합니다.

   ```text
   scaled = sign(delta) * floorDiv(abs(delta) * factor, 100)
   ```

8. minor: create_player의 “고정분만” 초기 자금이 정확한 숫자로 명시되지 않았습니다.  
   [PLAN.md:414](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:414)

   office/barista/freelancer는 1000, student는 500, retired는 3000인지 명시해야 합니다. 이름 1~12자도 UTF-16 code unit, Unicode code point, grapheme 중 무엇인지 정하면 플랫폼별 검증 차이를 피할 수 있습니다.

9. minor: LLM issue workflow는 생성된 patch를 비신뢰 출력으로 취급해야 합니다.  
   [PLAN.md:348](/Users/sundongin/WorkSpace/DeepSims/PLAN.md:348)

   이슈 본문은 prompt injection 입력입니다. 워크플로 권한을 `issues: write`, `contents: read` 정도로 제한하고, LLM 출력이 직접 commit·workflow dispatch·secret 접근을 하지 못하도록 해야 합니다. 현재 “코멘트 게시 후 사람이 PR 반영” 경계는 적절합니다.

## Arithmetic and state verdict

다음은 안전합니다.

- persFactor 범위: 각 공식 50–150, 기존 [50,200] 안
- 최대 score 곱셈 중간값: 약 `2.25e15`, `2^53` 미만
- affinity 배율 중간값: 현재 delta 범위에서 매우 작음
- mood 계산 최대 절댓값: `2.5e11`, §G moodMod 슬롯과 일치
- age decay, wage 계산, starting money 모두 정수
- 비대칭 affinity 행렬은 canonical 직렬화와 snapshot 저장에 문제 없음
- params 전문을 입력 로그와 snapshot 양쪽에 저장하는 것은 중복일 뿐, 원자 커밋과 검증이 있다면 일관성 문제 없음

필수 회귀 테스트는 A→B→A, snapshot A+pending B+file A 부팅, 같은 틱 logic_update+assign, migration 직후 첫 틱, logic_update 적용 배치 중 강제 롤백입니다.

셀프 리뷰에서 `fs.watch`의 관측 순서 자체는 외부 입력이므로 로그에 순서가 내구 저장되면 결정성 위반이 아니라고 판단했습니다. 최종 NO-GO의 이유는 watcher 순서가 아니라, hash ID 재사용과 pending/sequence 처리로 인해 기록된 최종 파일이 실제 catch-up 로직이 되지 않을 수 있다는 점입니다.

::inbox-item{title="Phase 2 spec ordering blocked" summary="Fix logic revision, pending reconciliation, and first-tick priority"}