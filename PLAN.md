# DeepSims 기획서 v2.4 — 2D 쿼터뷰 심즈라이크 (오프라인 진행 세계)

> **구현 현황 (2026-08-31)**: Phase 1~4 구현 완료·배포됨. 이 문서는 계속 설계의 단일 권위이며,
> 이후 변경은 §14 이슈 루프를 거친다. 구현 중 확정된 델타: D1(후보 독립 32 숏리스트),
> D2~D7, 1단계 ordinal은 sequence 순, 공원 스팟 16개 근사, expiresTick 폐구간.

로컬 전용: Node 서버 + SQLite 파일 + 브라우저 클라이언트(Phaser 3). GitHub(devdongin/DeepSims)로
배포하며, 누구나 집에서 클론 후 실행할 수 있게 한다.
세계는 24시간 프로세스가 아니라 **결정적 따라잡기 시뮬레이션**(시간의 지연 평가)으로 흘러간다.

## 0. 핵심 계약 (모든 설계의 기준)

```
state[t] = simulate(state[t-1], inputs[t])        // 틱 t로의 전이는 틱 t를 target으로 하는 입력을 소비
```

- 관례(Option B): 입력의 target tick, 이벤트의 tick, 결과 상태의 tick은 모두 **도착 틱 t**로 같다.
  새 입력의 target은 항상 `worldTick + 1`.
- 라이브 플레이와 오프라인 따라잡기는 같은 `tick()` 함수의 두 실행 모드다. 별도 배치 알고리즘 없음.
- `advance(world, inputsByTick, n)` = `tick()` n회 호출 루프. world를 **mutate**한다.
- 영속화 단위: (상태 체크포인트, 입력 소비 마킹, 이벤트, meta)를 **하나의 SQLite 트랜잭션**으로 커밋.
  리포트·클라이언트는 커밋된 틱만 관측한다.

## 1. 시간 모델

- 1 tick = 게임 1분. `tickDurationMs = 1000`. 게임 1일 = 1440틱 = 실시간 24분.
  게임 일(day) 경계는 벽시계가 아니라 `day = floorDiv(worldTick, 1440)`으로 정의.
- 앵커: `meta.epochUtcMs` (tick 0의 UTC ms).
- 목표 틱 (클램프는 앵커 재고정으로 영속화):
  ```
  rawTarget = floor((nowUtcMs - epochUtcMs) / tickDurationMs)
  target    = min(rawTarget, lastSimulatedTick + MAX_CATCHUP_TICKS)   // 30일 = 2,592,000틱
  if rawTarget > target: epochUtcMs = nowUtcMs - target * tickDurationMs
  ```
  재고정된 epochUtcMs는 **첫 따라잡기 배치 트랜잭션에 포함**해 커밋한다 — 롤백 시 진행과 재고정이
  함께 롤백된다. 시계 역행: `target = max(target, lastSimulatedTick)`. 전진 점프 = 오프라인 경과와 동일.
- 라이브 루프도 매 반복 위 공식으로 target을 재계산한다 (타이머 드리프트 무관).
- 성능 예산 (별도 벤치 스크립트, CI 단정 아님):
  - Phase 1: ≥ 50k tick/s (심 10명)
  - Phase 3~4: ≥ 20k tick/s, **최악 케이스 벤치 포함** (10심 전원 idle 결정 + 기억 256개 만재)

## 2. 시뮬레이션 코어 (`sim/`) — 순수 로직, I/O 없음

### 상태
- 전부 plain JSON 직렬화 가능. 심은 id 오름차순 배열. 수치는 전부 정수.
- PRNG(mulberry32) 상태는 world 안에. 네임드 스트림 2개: `rngWorldgen`(생성 후 미사용),
  `rngSim`(런타임). 상태 전이 밖에서 rng 호출 금지.
- 스냅샷에 직렬화되는 것 (전부 world 상태): 맵, 심(욕구·돈·성격·기분 current/pending·습관 가중치·
  관계 티어·회고/계획 커서·기억 스트림·memorySeq 카운터·아는 토큰 id 집합), 예약 전체,
  하루 계획(+planDay), 활성 정보 토큰 목록, rng 상태들, worldTick.

### 월드 (MVP)
- 고정 저작 맵 48×48. 시설: 집 5채(침대 2), 직장 1(슬롯 6), 카페 1(좌석 4), 공원 1(무제한).
- 맵 검증 테스트: 모든 스폰에서 모든 시설 BFS 도달 가능.
- 심 10명. 욕구 4종(배고픔/수면/사교/재미, 0~10000, 틱당 감쇠) + 소지금.
- 관계: 호감도 매트릭스(-10000~10000).

### 행동 (6종)과 상태 기계
`eat`(카페, 돈 소모), `sleep`(침대), `work`(직장 09~18시, 돈 획득), `socialize`(카페/공원),
`play`(공원), `idle`.

심 상태: `idle → walking(예약 보유) → performing(고정 N틱) → idle`

- 이동 틱당 1타일. 수행 중에도 욕구 감쇠하되 회복이 상회. 욕구 [0,10000] 클램프.
- 돈 부족 시 eat 후보 제외 → 배고픔 0이면 `starving` 이벤트(사망 없음).
- 재계획은 완료·실패·중단 시에만. 실패·중단 심은 같은 틱 5단계에서 재계획.

**후보 = (actionType, facilityId, resourceId) 삼중쌍** — 행동이 아니라 **구체 타깃**을 점수화한다:
- sleep은 침대 10개, socialize는 카페/공원 각각이 별개 후보. 점수 동점 시 타이브레이크:
  actionType enum 순 → facilityId 오름차순 → resourceId 오름차순.
- `assign(simId, actionType)`은 서버(=simulate 내부)가 **같은 순서 규칙으로 최선의 유효 타깃을
  결정적으로 선택**한다 (명령 확장 없음, MVP).
- **자기 예약 재사용**: 검증 시 해당 심이 이미 보유한 예약 슬롯은 가용으로 계산한다
  (마지막 슬롯을 자기가 쥔 채 같은 행동 assign 시 오거부 방지).
- 같은 틱 내 한 심에 대한 다중 assign: sequence 순 적용, **나중 수락이 이전 결과를 대체**한다.

**예약 수명주기**:
- 5단계 결정(또는 1단계 assign)과 동시에 예약. 걷는 동안 유지(독점 허용, 명시적 트레이드오프).
- 해제: 수행 완료 / 실패(경로 소실) / assign 중단 — 해제·재예약·상태 전이는 원자적.
- 예약이 유지되므로 "도착했더니 만석"은 구조적으로 불가능.

**중단 트리거는 assign뿐** (MVP). assign은 유틸리티를 무시하되 하드 제약(enum·심 존재·돈·근무시간·
슬롯. 자기 예약 재사용 포함)은 검증. 위반 시 `input_rejected` 이벤트.

**socialize 페어링**: 수행 중 매 틱, 같은 시설의 socialize-performing 심을 id 오름차순 2명씩 짝지음.
홀수 1명은 그 틱 회복 없음. 짝지어진 틱만 사교 회복 + 호감도 증감(rngSim). 파트너 없이 N틱 종료 시
`lonely` 이벤트.

### 틱 파이프라인 (틱 t로의 전이)
1. `target_tick == t` 입력을 sequence 순 적용 (검증→중단→예약→전이 원자적)
2. walking 이동 / performing 전진 (socialize 페어링·정보 전파 포함)
3. 완료·실패 정산 (심 id 오름차순): 욕구 회복·돈·관계·예약 해제. **sleep 완료 정산 직후 그 심의
   하루 계획 생성** (lastPlannedDay 가드)
4. 전 심 욕구 감쇠 + 기분 감쇠 + 만료 토큰 제거
5. idle 심 결정: 게임플레이 상태 읽기 전용 + **틱-로컬 예약 원장**, 심 id 오름차순 순차 결정,
   후보 삼중쌍 argmax, 원장 즉시 갱신, 단계 종료 시 world 예약에 병합
6. 이벤트 방출: 발생 단계 순 → 단계 내 **적용 순서**(1단계는 입력 sequence 순, 2~5단계는 심 id
   오름차순) → ordinal 부여. 1단계에서 sequence 순서가 곧 인과 순서이므로 id 재정렬하지 않는다.
7. worldTick = t

**틱 내부 날짜 규약**: `tick(t)` 내부(전 단계·전 훅)에서 "오늘"은 반드시 `transitionDay =
floorDiv(t, 1440)`이다 — 2·3단계 시점엔 world.worldTick이 아직 t-1이므로 worldTick 기반 날짜를
쓰면 자정 경계(t=1440k)에서 회고·계획이 하루 밀린다. `lastReflectedDay`·`lastPlannedDay`·`planDay`·
당일 기억 범위 판정은 전부 transitionDay 기준. `floorDiv(world.worldTick, 1440)`은 틱 밖 조회 전용.

**전이 훅** (파이프라인 단계가 아니라 **전이 발생 지점**에서 실행):
- `onEnterPerforming(sleep)` → 회고 실행 (1단계 assign에 의한 전이든 2단계 도착이든, 전이 직후 즉시)
- 기억 기록은 `recordFact()` 단일 훅: 사실이 발생한 파이프라인 지점에서 즉시 기록, 순서는
  파이프라인 진행 순 + memorySeq. **이벤트 ordinal(6단계)에서 파생하지 않는다.**
- 이벤트 타입별 발생 지점 명세: `input_rejected`(1), `argument`·`party_info`(2),
  `action_completed`·`action_failed`·`starving`·`lonely`·`money_changed`·`relationship_changed`(3),
  `action_started`(1 또는 5).

## 2.5 에이전트 인지 아키텍처 — 사회실험 논문 기반, 결정적으로 이식

근거: Park et al., *Generative Agents* (UIST 2023, Smallville — 기억 스트림/회고/계획/정보 확산),
Wang et al., *Humanoid Agents* (2023, 욕구 기반 조절). 원 논문의 LLM 판단을 **전부 정수 규칙 연산으로
재구현**한다. LLM은 시뮬레이션 루프에 개입하지 않는다.

### A. 성격 → **§12로 대체됨** (인구통계 + MBTI)
- 원안(Big Five)은 사용자 결정으로 §12의 성별·나이·MBTI·직업 모델로 대체. 유틸리티 변조
  아키텍처(백분율 계수, [50,200] 클램프)와 아래 B~H의 성격 참조는 §12 매핑으로 읽는다
  (예: "외향성" → MBTI E축).

### B. 기억 스트림 — **삽입 순서 유지 유한 스트림** (append-only 아님: 상한 초과 시 퇴출)
- 레코드: `{memorySeq, tick, kind, subjectSimId?, placeId?, importance(1~10), tags[]}`.
  memorySeq는 심별 단조 증가 카운터(월드 상태). tags는 **중복 제거 후 사전순 정렬** 고정.
- importance 규칙 테이블: argument=8, starving=8, party_info=7, relationship_changed=6,
  work_done=3, meal=2, small_talk=1 (전체 테이블은 코드 상수).
- 상한 심당 256. 퇴출 비교 키(완전 순서): 보존점수(recency×importance) 최저 → importance 최저 →
  tick 최고령 → memorySeq 최저. 회고 파생 기억 삽입은 해당 훅의 **모든 삽입 완료 후 일괄 퇴출**
  (처리 중인 원본이 도중 퇴출되는 일 없음).

### C. 검색 (retrieval) — 결정 시 상위 k=8, 동점 시 memorySeq 낮은 쪽 우선
```
ageDays    = min(floorDiv(max(0, worldTick - m.tick), 1440), 15)
recency    = RECENCY_LUT[ageDays]   // [1000,820,670,550,450,370,300,250,200,165,135,110,90,74,60,50]
relevance  = min(4, |후보 tags ∩ 기억 tags|) × 100
retrieval  = 2×recency + 100×importance + relevance     // 최대 2000+1000+400 = 3400
```
- **기억 유래 보정**과 **현재 상태 유래 보정을 분리**: 기억 보정 = 상위 k 기억이 후보 시설·대상과
  일치할 때의 가/감점(예: 그 시설의 argument 기억 → 감점). 상태 보정 = "지금 그 시설에 friend 티어
  심이 있음" 등 현재 world에서 직접 계산. 두 보정은 별도 항으로 정의·클램프.

### D. 하루 계획 — sleep 완료 정산 직후 생성 (3단계), `lastPlannedDay` 가드로 하루 1회
- 규칙 템플릿(근무 슬롯·식사 창 2회·저녁 여가)에 성격·전날 회고·아는 토큰(scheduledTick 슬롯 편향)
  반영. 계획은 편향이지 명령이 아님: 유효 후보에만 보너스가 붙고, **계획된 행동이 불가능하면
  (휴무·돈 부족·슬롯 없음·도달 불가) 보너스 없이 일반 후보 선택으로 자연 폴백** — 재시도 루프 없음.
- **위급 오버라이드는 구조적**: 어떤 욕구든 < 2000이면 그 틱 결정에서 위급 욕구를 회복하는 후보만
  남기고 계획·습관 보정은 아예 배제한다.

### E. 회고 — `onEnterPerforming(sleep)` 훅, 멱등
- 가드: `lastReflectedDay < 오늘(day)` 일 때만 실행 + `reflectionMemoryCursor`(memorySeq) 이후
  기억만 처리. 하루 2회 수면에도 중복 파생·중복 습관 증가·중복 티어 이벤트 없음.
- 산출: 관계 티어(stranger/acquaintance/friend/rival — 상호작용 수+호감도 임계, 변경 시 이벤트),
  `pendingMood`(당일 기억 importance 가중합), 습관 가중치(+상한 캡, §G 참조).
- 기분 이원화: 회고는 `pendingMood`만 기록, **기상(sleep 완료) 시 currentMood ← pendingMood 적용**.
  둘 다 직렬화. 수면 중 크래시·직렬화에도 모호성 없음.
- currentMood는 틱마다 성격 의존 기준선으로 정수 감쇠. 낮으면 play/socialize 가중, 매우 낮으면
  전 후보 감점(무기력).

### F. 정보 확산 (파티 확산 실험의 재현)
- 토큰: `{tokenId, topic, originTick, scheduledTick, placeId, expiresTick}`. tokenId는 월드 단조
  카운터. 습득 시각은 **수신자의 기억 레코드에** 기록(토큰 자체엔 없음).
- 생성 규칙(고정): `t % 4320 == 600`(3게임일마다 10:00)에 rngSim 1드로우로 장소(카페/공원) 선택,
  `scheduledTick = (day+1)×1440 + 1140`(다음날 19:00), `expiresTick = scheduledTick + 120`.
  초기 전파: 외향성 최고 2심(동점 시 id 낮은 쪽)이 습득. Phase 4에서 `announce` 입력(명령 2종째)으로
  플레이어도 주입 가능.
- 전파(socialize 페어링 틱마다): 한쪽만 아는 미만료 토큰을 **tokenId 오름차순**으로 순회, 각 토큰당
  **정확히 1회 rngSim 드로우**, 성공 임계 = f(호감도, 우호성) — 호감도는 **그 틱 관계 변동 적용 전**
  값. 양방향 각각 별개 토큰 전파 가능(방향 순서: 낮은 id → 높은 id 먼저). 이미 아는 토큰(심별 known
  집합, 직렬화)은 시도 자체를 안 함 — 재전송 없음. 성공 시 수신자 기억(party_info) + known 갱신.
- 만료 토큰은 4단계에서 활성 목록·known 집합 모두에서 제거.
- 결과: scheduledTick 슬롯의 계획 편향 → 몇 명이 모이는지는 창발. 리포트 하이라이트로 노출.

### G. 점수 산식 — **단일 고정 정수 스케일 + 포화 클램프** (BigInt 없음, 경계 증명 주석 의무)
```
SCORE_SCALE = 1e5
den    = manhattanDistance + 16             // manhattanDistance ≥ 0 정수 → den ≥ 16 (하한 확정)
base   = floorDiv(num × SCORE_SCALE, den)   // num=(10000-need)²×16 ≤ 1.6e9 → num×1e5 = 1.6e14 < 2^53
                                            // base ≤ floorDiv(1.6e14, 16) = 1e13
score  = floorDiv(base × persFactor, 100)   // persFactor ∈ [50,200], 중간값 ≤ 1e13×200 = 2e15 < 2^53
score  = floorDiv(score × planFactor, 100)  // planFactor ∈ [100,150], 중간값 ≤ 2e13×150 = 3e15 < 2^53
score += clamp(memoryMod, -5e11, 5e11) + clamp(stateMod, -2.5e11, 2.5e11)
       + clamp(moodMod, -2.5e11, 2.5e11) + clamp(habitMod, 0, 2.5e11)
```
- 모든 중간값 상한을 상수 옆 주석으로 증명(최대 ≈ 3e15 + 1.25e12 < 2^53). 나눗셈은 전부 floorDiv.
- 보정치 클램프는 전형 점수(욕구 5000, 거리 14 → den 30, base ≈ 1.3e12)의 ±20~40% 수준 —
  **개별** 보정이 의미는 갖되 단독으로 전형 base를 넘지 못하게 하는 설계이며, 보정 총합이 base를
  넘는 경우는 허용된다(욕구 여유 시 기억·계획이 행동을 바꾸는 것은 의도된 동작).
- 욕구 우선의 실제 보증은 클램프가 아니라 **위급 오버라이드**(§D: 욕구 < 2000이면 후보 제한 +
  계획·습관 보정 배제)가 담당한다.
- 캡: 습관 누적 상한(행동당 habitMod ≤ 2.5e11, 증가분/일 ≤ 1e10), 계획 보너스 ≤ ×1.5, 성격 [50,200].

### H. 단계적 구현
- **Phase 1 (MVP)**: §2 코어 루프만. 입력은 assign 1종. 인지 없음.
- **Phase 2**: 성격(A) + 기분 감쇠·보정(E 일부).
- **Phase 3**: 기억(B)+검색(C)+회고(E 전체).
- **Phase 4**: 하루 계획(D) + 정보 확산(F) + `announce` 입력 추가.
- 각 Phase: 결정성·분할 불변성 재통과 + 해당 Phase 전용 테스트(§7) 통과 후 진행.

### 코어 API
```
createWorld(seed) -> world
tick(world, inputsForThisTick) -> events
advance(world, inputsByTick, n) -> events
serialize(world) -> string          // canonical, 필드 순서 명시
deserialize(string) -> world
hashWorld(world) -> string
```
- 해시: FNV-1a 32-bit, UTF-8 바이트 단위, **`hash = Math.imul(hash ^ byte, 0x01000193) >>> 0`**
  (일반 곱셈 금지 — 2^53 초과 정밀도 손실), 출력 8자리 소문자 hex, 고정 벡터 테스트 포함.

## 3. 입력(개입) 모델

- append-only 입력 로그. 명령: Phase 1은 `assign(simId, actionType)` 1종, Phase 4에서 `announce` 추가.
- 서버가 `(target_tick = worldTick+1, sequence)` 부여, 부여+insert 동일 트랜잭션,
  `UNIQUE(target_tick, sequence)`. REST 응답은 커밋 후에만.
- 중복 client_input_id → 원래 부여값 반환(멱등). 무효 입력 → `input_rejected` (결정적 시뮬 이벤트).
- 재타게팅: 부팅 시 applied=0 && target ≤ lastSimulatedTick 발견 시(정상 불가능) last+1로 재타게팅,
  ops_log 기록. 따라잡기 중 수신 입력은 target 부여를 완료까지 보류.

## 4. 영속화 (better-sqlite3, `deepsims.db`, WAL)

```sql
meta(key TEXT PK, value TEXT)
snapshot(id INTEGER PK CHECK(id IN (1,2)), tick INTEGER, state TEXT)   -- 1=최신, 2=직전
events(tick, ordinal, type, sim_id, payload, schema_version, PRIMARY KEY(tick, ordinal))
event_daily_aggregates(day_start_tick, category, sim_id, count, sum,
                       PRIMARY KEY(day_start_tick, category, sim_id))
inputs(id PK AUTOINCREMENT, client_input_id UNIQUE, target_tick, sequence, command, payload,
       applied DEFAULT 0, UNIQUE(target_tick, sequence))
ops_log(ts_utc_ms, type, detail)
```

- 배치 트랜잭션: [snapshot 회전(1→2) + events + inputs.applied + meta(epoch 재고정 포함)].
  따라잡기 최대 1440틱/배치, 라이브는 매 반복 커밋.
- 크래시 복구 = 트랜잭션 롤백이 전부. snapshot.tick ≠ meta = 손상 → 안전 정지, id=2로 수동 복구 안내
  (meta·events·inputs 정합 절차는 README 운영 섹션에 문서화).
- 이벤트 payload ≤ 1KB, 타입 레지스트리 상수. 프루닝: 30게임일 이전 → 일 집계로 축약(잔액은
  money_changed sum 보존). 운영 이벤트는 ops_log(시뮬 이벤트 스트림 오염 방지).
- 단일 인스턴스 락: lock 파일(pid+시작시각), 죽은 pid면 스테일 제거.

## 5. 서버 (Express + ws)

부팅: 락 → DB → 무결성 검증 → target 캡처 → 배치 따라잡기(진행 중 접속자엔 `catchingUp{progress}`) →
라이브 루프. 마지막 클라이언트 퇴장 시 커밋 후 루프 정지. **0-클라이언트 중 새 접속: target 캡처 →
따라잡기 → snapshot → 라이브** (부팅과 동일 전이).

WS (모든 메시지에 protocolVersion, worldTick, seq): seq는 연결마다 0부터, hello에 connectionId.
snapshot(접속당 1회, 정적 데이터 포함) → tickBatch{fromTick,toTick,events,simDeltas}. 갭 → resync →
새 snapshot. 재접속 = 신규.

REST: `GET /api/report?cursor=` (exclusive~커밋틱 inclusive, nextCursor, 멱등 — 틱과 이벤트가 원자
커밋되므로 plain tick cursor로 충분), `POST /api/input`.

## 6. 클라이언트 (Phaser 3 + Vite) — 도트그래픽

- 아이소메트릭 2:1, painter's order. **아트는 도트(픽셀 아트) 스타일로 확정. 이미지 생성은 Codex의
  imagegen 스킬 전담** — Claude는 에셋 명세(타일셋: 잔디/도로/바닥, 건물 4종, 심 스프라이트 10종
  4방향, 시설 소품)를 작성해 Codex에 요청하고 결과물을 통합만 한다. 에셋 도착 전까지는 색 다이아 +
  원형 심 플레이스홀더로 개발.
- 틱 사이 이동 보간(렌더 전용). 이벤트 문장화는 클라이언트(구조화 payload → 한국어).
- UI: 심 클릭 → 욕구/행동/소지금/기분/관계 패널 + assign. 이벤트 피드. 접속 시 부재중 리포트 모달.
  게임 시각 표시. 탭 슬립·다중 탭 = resync.

## 7. 테스트 (node:test)

Phase 1:
1. 결정성(시드+입력 동일 → 해시 동일) / 2. 분할 불변성(무작위 파티션 5종) / 3. 직렬화 왕복(PRNG·예약
포함) / 4. 해시 고정 벡터(Math.imul 사양) / 5. 입력(순서·멱등·거부·재타게팅) / 6. 시계(재앵커 후
target 불변, 역행, 점프) / 7. 크래시 복구(배치 중 강제 종료) / 8. 미커밋 라이브 틱 재생(스냅샷+내구
입력만으로 동일 상태) / 9. 자원 경합(id 낮은 심 승리, walking 독점) / 10. 타깃 선택 타이브레이크
(enum→facility→resource) / 11. 자기 예약 재사용 assign / 12. 중단 원자성 / 13. socialize 페어링·lonely
/ 14. 경로 없음·맵 도달성 / 15. 30일 장기 바운드 / 16. 리포트 커서·프루닝 집계

Phase 2~4 (해당 Phase에서 추가):
17. 기억 상한·퇴출 완전 순서 / 18. 검색 랭킹·동점 memorySeq / 19. 회고 멱등(하루 2회 수면) /
20. 수면 중 직렬화(pendingMood 보존) / 21. 계획 하루 1회 생성 / 22. 측정 가능 불변식 3종 — (i) 30일 실행 후 habitMod ≤ 캡(2.5e11)·증가분/일 ≤ 1e10, (ii) 각 보정이
클램프 상수를 절대 초과하지 않음, (iii) 위급 욕구(<2000) 존재 시 보정 값과 무관하게 항상 위급 회복
후보가 선택됨(구조적 배제 검증) / 23. 확산(토큰 순서·rng 소비 고정) / 24. 파티 참석 재현성(같은 시드 → 같은 참석자) /
25. 인지 켠 상태의 따라잡기/라이브 등가성 / 26. Phase별 최악 케이스 벤치(전원 idle + 기억 만재)

## 8. 구현 순서

1. 스캐폴드 → 2. sim 코어 → 3. Phase 1 테스트 → 4. db+복구 → 5. 서버 → 6. 클라이언트(플레이스홀더)
→ 7. README(설치·운영) + 벤치 → **[Phase 1 완료 = 배포 가능 시점]** → 8. Phase 2~4 (각 Phase마다
Codex 리뷰 → 커밋 → 푸시) → 9. Codex 도트 에셋 생성·통합

## 9. 명시적 비목표 (MVP)

멀티 월드/서버, 오프라인 클라 명령, 프로시저럴 맵, 심 사망/출생, 가구 배치, 경제 밸런스,
저장 마이그레이션(schemaVersion만 예약), 모바일, 델타 재전송, LLM 런타임 호출.

## 10. 배포 (GitHub: devdongin/DeepSims)

- README에 설치 가이드: 요구사항(Node ≥ 20, npm), `git clone` → `npm install` → `npm start` →
  브라우저 `http://localhost:3000`. 외부 서비스·API 키 불필요(전부 로컬). DB 파일 위치·초기화 방법·
  손상 시 수동 복구 절차 포함.
- Phase 1 완료 시점부터 main에 푸시, 이후 Phase 단위로 푸시.

## 11. 협업 워크플로 (Claude ↔ Codex)

- **역할**: Claude = 설계·구현·통합, Codex = 검증·리뷰·이미지 생성(imagegen, 도트 에셋 전담).
- **셀프 리뷰 규칙**: 각자 판단(기획 개정·구현 결과·리뷰 의견)을 상대와 공유하기 전에 자기 산출물을
  1회 셀프 리뷰하고, 걸린 사항은 수정 후 공유한다.
- **정지 규칙**: 작업이 멈추는 모든 단계에서 로컬 서버를 띄운 채로 정지해 사용자가 현재 상태를
  브라우저로 즉시 확인할 수 있게 한다 (서버 실행이 가능해지는 Phase 1 이후 적용).

## 12. 특성 모델 개정 — 인구통계 + MBTI (Phase 2에서 Big Five를 대체)

사용자 결정: 심의 특성은 **성별·나이·MBTI·직업**으로 구성한다. §2.5.A의 Big Five는 이 모델로
대체되며, 유틸리티 변조 아키텍처(백분율 계수, [50,200] 클램프)는 그대로 재사용한다.

- traits = { gender, age(정수), mbti: {EI, SN, TF, JP} (각 0~100, 50=중립), occupation }
- 매핑 (전부 정수 백분율 계수):
  - **E/I**: E 높음 → socialize 가중↑, lonely 페널티↑ / I 높음 → play(혼자 노는 행동) 가중↑
  - **S/N**: Phase 3 기억 검색에서 S → 최근성(recency) 가중↑, N → 중요도·연관성 가중↑
  - **T/F**: F 높음 → 호감도 변동 폭↑, 다툼 임계 완화 / T → 관계 변동 둔감
  - **J/P**: J 높음 → 하루 계획 편향 계수↑(계획 준수), P → 계획 편향↓(즉흥, 유틸리티 지배)
  - **나이**: 20대 fun 감쇠↑, 60대+ energy 감쇠↑ (구간 테이블, 정수)
  - **직업**: 근무시간 창·임금 계수·선호 시설 테이블 (Phase 2는 단일 직장 유지, 계수만 차등)
- 행동 종류 확장 로드맵: 사람 상태를 6종으로 고정하지 않는다. Phase 4+에서 행동 enum·시설
  테이블 확장(산책 wander, 취미 hobby, 독서 read, 운동 exercise 등)을 데이터 주도로 추가한다.
  enum 추가는 타이브레이크 순서 뒤에 append(기존 리플레이 결정성 유지).

## 14.1 판단 로직의 데이터화·핫스왑·사유 기록 (사용자 결정, Phase 2에서 도입)

**목표**: 심의 판단 규칙이 코드에 고정되지 않고, LLM 리뷰를 거쳐 갱신된 로직이 **플레이 도중에도,
따라잡기 실행 전에도** 적용된다. 결정성은 유지한다.

### 로직 파일
- 모든 튜너블 규칙을 `logic/params.json`으로 외부화: 감쇠 테이블, 행동 정의(지속·회복·비용),
  MBTI 변조 공식의 계수, 기분 델타, 다툼 임계 계수, (Phase 3+) importance 테이블·검색 가중치.
- 공식의 **구조**는 코드, **수치**는 params. 구조 변경은 여전히 코드 릴리스.
- **검증 계약**: 적용 전 필수/허용 키(미지 키 거부), 전 수치 safe integer + 범위, canonical 해시가
  입력의 hash 필드와 일치, params 전문 UTF-8 ≤ 8KB, logicSchemaVersion 일치. 잘못된 **파일**은
  입력으로 등록하지 않고 ops_log 기록. 이미 내구 저장된 손상 입력은 결정적 input_rejected 처리.

### 결정성 보존 — 로직 변경은 입력이다
- world.logic = 활성 파라미터 전체 (스냅샷에 직렬화). tick()은 상수 대신 world.logic만 읽는다.
- 파일 변경 감지(부팅 시 + fs.watch로 플레이 도중) → 파일 파라미터의 canonical 해시가
  현행 로직과 다르면 `logic_update{params, hash}` 입력을 다음 틱에 등록.
  clientInputId = "logic:<revision>:<hash>" — revision은 meta의 단조 증가 카운터(A→B→A 복귀 지원).
  중복 억제는 "등록 대기 중인 revision+hash" 기준이며 콘텐츠 해시를 영구 멱등키로 쓰지 않는다.
- 1단계에서 logic_update 적용: world.logic 교체 + `logic_changed` 이벤트. **파라미터 전문이 입력
  로그에 내구 저장**되므로, 크래시 후 재생·따라잡기·리플레이 모두 같은 틱부터 같은 로직을 쓴다.
- 부팅 정합(reconcile): ① pending logic_update들을 target/sequence 순으로 읽어 **유효 대기 로직**
  (마지막 pending의 params, 없으면 snapshot의 world.logic)을 계산 → ② 파일과 비교 → ③ 다르면
  파일 params를 pending 뒤에 새 revision으로 등록 → ④ 따라잡기 → ⑤ 종료 후 world.logic 해시 ==
  파일 해시 단정(불일치 시 경고 + 재정합). 플레이 도중 fs.watch 감지도 같은 reconcile 경로.
- **1단계 적용 순서 계약**: 같은 틱의 입력은 [logic_update들(sequence 순)] → [나머지 명령(sequence
  순)]. 이벤트 ordinal도 이 적용 순서를 따른다 — 첫 따라잡기 틱의 기존 입력도 새 로직으로 검증된다.

### 판단 사유(reason) 기록
- action_started payload에 구조화 사유 첨부: { need, deficit, persFactor, planFactor, moodMod,
  urgencyOverride, (Phase 3+) citedMemorySeqs[] } — "왜 이 행동을 했는가"와 "무엇이 다음 행동에
  영향을 주는가"(인용된 기억·기분)를 추적 가능하게. 클라이언트가 사유를 문장화해 피드·패널에 표시.
- payload 1KB 상한 내로 요약(상위 요인만).

### LLM 자동 리뷰 루프 (GitHub Actions)
- `.github/workflows/llm-logic-review.yml`: `needs-llm-review` 라벨 이슈에 대해 저장소 Secret의
  LLM API 키(사용자가 설정)로 분석을 실행 → 원인 분석 + `logic/params.json` 수정안을 이슈 코멘트로
  게시. 사람이 PR로 반영 → 배포된 서버들이 파일 변경을 감지해 §14.1 경로로 적용.
- 권한 최소화: `issues: write` + `contents: read`만. 이슈 본문은 프롬프트 인젝션 가능 입력이므로
  LLM 출력은 비신뢰 — 직접 커밋·워크플로 디스패치·시크릿 접근 불가, 코멘트 게시까지만.

## 12.1 Phase 2 구현 스펙 (정수 테이블 확정)

### traits 구조
```
traits: {
  gender: 'F' | 'M' | 'X',
  age: 정수 15~90,
  mbti: { EI, SN, TF, JP: 각 0~100 },   // 0 = 첫 글자 극단(E/S/T/J), 100 = 둘째 글자 극단(I/N/F/P), 50 = 중립
  occupation: 'office_worker' | 'barista' | 'freelancer' | 'student' | 'retired'
}
```
- NPC 생성: rngWorldgen. 순서 고정: gender → age → mbti 4축 → occupation(나이 제약 필터 후 잔여 중 선택).
  나이 제약: retired는 age ≥ 60에서만, student는 age ≤ 25에서만 후보.
- 이름: 기존 SIM_NAMES 유지.

### 유틸리티 변조 persFactor (행동별, 곱은 floorDiv(·,100) 후 [50,200] 클램프 1회)
| 행동 | factor 공식 |
|---|---|
| socialize | 150 - EI (E일수록 ↑) |
| play | 100 + (EI - 50) (I일수록 ↑, 혼자 놀기) |
| work | 150 - JP (J일수록 ↑) |
| eat, sleep | 100 (생리 욕구는 변조 없음) |
- 반올림 순서: score = floorDiv(floorDiv(base × persFactor, 100) × planFactor, 100) (§G와 동일 슬롯).

### T/F → 관계 역학
- 호감도 델타(부호 보존): delta' = sign(delta) × floorDiv(|delta| × (50 + TF), 100) —
  F(100)일수록 변동 폭 1.5배, T(0)는 0.5배. 음수에서 0에서 멀어지는 floorDiv 편향 방지.
- 다툼 임계(심별): clamp(-3000 - (TF - 50) × 20, -5000, -1000) — F는 임계가 깊어져 다툼이 어려움.
- 페어 기준: 두 심의 임계 중 더 얕은(높은) 값 사용, 델타는 각자 자기 계수로 적용 → 호감도 비대칭
  허용으로 전환 (affinity[a][b] ≠ affinity[b][a] 가능). argument는 어느 한쪽이라도 임계를 하향
  교차하면 1회 발생.

### 나이 → 감쇠 (기존 DECAY에 가산)
| 구간 | 보정 |
|---|---|
| 15~29 | fun +2/틱 |
| 30~59 | 없음 |
| 60~90 | energy +2/틱 |

### 직업 테이블 (단일 직장 유지, 계수만 차등)
| occupation | 근무 창(tod) | 임금 계수(%) | 초기 자금 |
|---|---|---|---|
| office_worker | 540~1080 | 100 | 1000+rng500 |
| barista | 420~960 | 90 | 1000+rng500 |
| freelancer | 0~1440 (제한 없음) | 80 | 1000+rng500 |
| student | 840~1200 | 50 | 500+rng500 |
| retired | 근무 불가 | — | 3000+rng500 |
- moneyDelta = floorDiv(1200 × 계수, 100). retired는 work 후보에서 하드 제약으로 제외.

### 기분 (Phase 2 부분: 이벤트 직결 + 감쇠, 회고 없음)
- currentMood 정수 [-10000, 10000], 초기 0. pendingMood는 Phase 3에서 도입.
- 이벤트 직결 변동: **사실 발생 지점에서 즉시 적용+클램프** — argument(2단계) -800, lonely·
  action_completed(+50)·money_changed(+) +100(3단계), starving -1000(4단계 감쇠 직후, 기분 감쇠 전).
- 4단계 내부 순서 고정: 욕구 감쇠 → starving 판정·기분 델타 → 기분을 0 방향 5 감쇠.
  5단계는 감쇠 후의 기분을 읽는다.
- moodMod (§G 슬롯): action ∈ {play, socialize}이고 mood < 0이면 +floorDiv(-mood × 2.5e7, 1)
  (기분 전환 욕구, 최대 2.5e11). mood < -5000이면 전 후보에 (mood + 5000) × 5e7 (무기력 감점,
  최소 -2.5e11). 클램프는 §G 표 그대로.

### create_player 명령 (두 번째 명령)
- payload: { name(유니코드 코드포인트 1~12개), gender, age, mbti{4축}, occupation } — 전 필드
  §12.1 범위 검증. 초기 자금 고정값: office_worker/barista/freelancer 1000, student 500,
  retired 3000 (rng 미소비).
- 거부 조건: 범위 위반 / 나이-직업 제약 위반 / 이미 isPlayer 심 존재 → input_rejected.
- 생성(1단계에서 원자적): id = max(id)+1, isPlayer=true, 홈 = 거주자 최소 집(동수면 facilityId
  오름차순), 스폰 = 홈 문 앞(door.y+1), 욕구 전부 7000(고정, rng 미소비), 자금 = 직업 테이블
  (rng 미소비 — 고정분만), 기분 0, affinity 행/열 0 확장.
- 이벤트: player_created (레지스트리 추가).

### 마이그레이션
- schemaVersion 2. 마이그레이션은 **입력 처리 전 로드 시점에 완료**: ① traits/mood 기본값 —
  심별 임시 RNG mulberry32((seed ^ simId) >>> 0)로 §12.1 생성 규칙 재실행 (rngSim/rngWorldgen
  상태 비소비), ② world.logic에 코드 내장 기본 파라미터(v1 등가) 설치, ③ schemaVersion=2 기록.
  그 다음에야 파일 params가 logic_update 입력으로 등록된다. behaviorVersion 2를 meta에 기록.

### Phase 2 클라이언트
- 심 패널: MBTI 4글자·나이·성별·직업·기분 바 표시.
- 온보딩: snapshot에 isPlayer 심이 없으면 배경 입력 폼 모달(이름/성별/나이/MBTI 16유형 선택/직업)
  → create_player 전송. 생성 후 내 심 하이라이트(카메라 포커스).

## 13. 플레이어 온보딩 (Phase 2)

- 처음 접속 시 world에 플레이어 심이 없으면 클라이언트가 **배경 입력 폼**(이름/성별/나이/MBTI 4축
  또는 16유형 선택/직업)을 표시한다.
- 제출 → 새 입력 명령 `create_player(traits)` (Phase 2 시점 기준 assign에 이어 두 번째 명령, Phase 4의 announce가 세 번째). 심 생성도 **입력 로그를
  경유하는 결정적 상태 전이**다: 같은 스냅샷 + 같은 입력이면 리플레이에서도 같은 심이 생긴다.
- 플레이어 심은 id = 기존 최대 id + 1로 추가되고 isPlayer 플래그를 가진다. 자율 AI로 행동하되
  assign 우선권은 동일. 이미 플레이어 심이 있으면 create_player는 input_rejected.

## 14. 이슈 기반 로직 진화 체계

규칙은 고정될 수 없다 — 예상과 다른 행동·특이사항은 이슈로 수집해 LLM 리뷰를 거쳐 지속적으로
로직을 갱신한다.

- **수집**: (a) ops_log의 이상 기록, (b) 부재중 리포트/피드에서 발견한 이상 행동, (c) 플레이어
  제보 → GitHub Issue (.github/ISSUE_TEMPLATE의 '시뮬레이션 특이사항' / '로직 개선 제안' 템플릿).
  재현에 필요한 것: 시드, 스냅샷 틱, 입력 로그 구간 — 결정적이므로 이슈만으로 완전 재현 가능.
- **리뷰 루프**: 이슈 → Claude(원인 분석·설계 수정안) → Codex(검증·반례 탐색) → 합의 시 PLAN 개정
  → 구현 → 결정성·회귀 테스트 게이트 → 릴리스. 각자 공유 전 셀프 리뷰 1회(§11) 적용.
- **호환성**: 상태 구조 변경(schemaVersion)과 행동 규칙 변경(behaviorVersion, meta에 기록)을
  구분한다. 새 상태 필드는 결정적 기본값과 함께 도입해 기존 세이브를 이어 시뮬레이션한다
  (과거 리플레이 호환은 비목표). 재현 이슈에는 seed·게임 시각 외에 schema/behavior 버전과
  스냅샷 해시를 기록한다 — 이슈 템플릿에 반영.

## 15.1 로드맵 구현 스펙 (정수 테이블 확정)

### A. 대처 행동 (coping) — 행동 enum 뒤에 append: drink, binge_eat, hole_up, exercise
- **게이트**: coping 행동은 mood < copingThreshold(-2000)일 때만 후보가 된다 (하드 제약).
- 시설: 신규 **술집(bar)** — 맵 (30,41) 7×5, 문 (33,41), 좌석 4. drink는 bar, binge_eat는 cafe,
  hole_up은 **자기 집** 침대(홈 일치 하드 제약), exercise는 공원.
- 점수: needValueFor(coping) = 10000 + mood (mood<0 → deficit = -mood). 기분이 나쁠수록 급함.
- 성격 변조 persFactor (기존 [50,200] 클램프 재사용):
  drink = 120 - floorDiv(EI,2) (E↑) / binge_eat = 100 + (TF-50) (F↑) /
  hole_up = 100 + (EI-50) (I↑) / exercise = 100 + (50-TF) (T↑)
- 행동 정의: drink {duration 45, cost 300, moodPerTick +40, funPerTick +50, 완료 시 hangoverUntil =
  t+1440 — 숙취 중 energy 감쇠 +3, 'hangover' 이벤트}, binge_eat {duration 20, cost 400,
  hungerPerTick +400, moodPerTick +25, 완료 시 후회 mood -200}, hole_up {duration 120,
  moodPerTick +10, energyPerTick +15}, exercise {duration 60, funPerTick +80, moodPerTick +15,
  완료 보너스 mood +100}.
- 기억 kind: drank(3)/binge(3)/hole_up(2)/workout(3) — **중독 루프는 기존 습관 시스템이 창발**:
  반복 음주 → habit['drink:bar'] 증가 → 단골 보정 → 더 자주 음주. 별도 메커니즘 없음.
- 위급 오버라이드(욕구<2000)는 coping보다 우선(coping은 위급 후보 아님).

### B. 건설 — 세계가 심에 의해 바뀐다 (자재는 화폐로 추상화, 명시적 트레이드오프)
- **도로화(path wear)**: world.wear(타일별 정수 배열, 스냅샷 직렬화). 2a단계에서 심이 GRASS 타일에
  발을 디딜 때 +1. wear ≥ wearThreshold(400) → 타일 GRASS→ROAD 전환 + 'road_formed'{x,y} 이벤트.
  rng 미사용. ROAD/GRASS 모두 보행 가능이라 BFS·도달성 불변. 클라이언트는 이벤트로 타일 갱신.
- **집 증축(bed 건설)**: 행동 build (enum 마지막 append). 하드 게이트: 자기 집 && 거주자 수 >
  침대 수 && money ≥ bedCost(3000) && 그 집의 증축 침대 < maxExtraBeds(2). 수행 duration 240,
  대상은 자기 집 침대(예약)... 대상 자원은 기존 침대 하나(작업 공간). 완료 시 money -3000,
  집의 예비 슬롯((hx+2,hy+2) → (hx+3,hy+2) 순)에 침대 자원 추가 + 'bed_built'{facilityId,
  resourceId} 이벤트 + 기억 built_bed(5). needValueFor(build) = 5000 고정 (게이트 통과 시 중간 급함).
- 맵·시설이 world 상태이므로 스냅샷·리플레이 자동 호환. 신축(새 건물)·자재 채집은 후속 이슈로
  분리(§14 루프) — 증축·도로화로 "세계를 바꾸는 심"의 코어 계약을 먼저 확립한다.

### C. 문제 해결 사고 흐름 (reason chain)
- 5단계 결정에서 **막힌 대안**을 수집: 각 행동에 대해 blockedBy ∈ {no_money(비용 부족),
  off_hours(근무시간 밖), full(빈 슬롯 없음), sated(deficit 0), not_coping(기분 게이트),
  not_needed(build 게이트 불충족)} 판정. 선택된 행동의 reason에 chain: [{a, b}] (최대 4개,
  ACTIONS 순) 첨부 — "카페 못 감(돈 부족) → 대신 일하기"가 데이터로 남는다.
- payload 1KB 상한 내 (압축 키 a/b).

### 스키마
- 세이브 schemaVersion 6: sim.hangoverUntil(-1), world.wear, 구맵에 bar 시설·타일 주입(마이그레이션,
  결정적), 예비 침대 슬롯은 시설 데이터에 extraBedSlots로 명시.
- 로직 logicSchemaVersion 5: coping {copingThreshold, 행동별 수치}, build {wearThreshold, bedCost,
  maxExtraBeds}, 검증 범위는 기존 §G 경계 보존 규칙대로.

## 15. 로드맵 — 인간 행동 패턴 라이브러리 (Phase 5+) ✅ 2026-08-31 §15.1로 전 항목 구현

사용자 방향성: 특정 규칙 몇 개가 아니라 인간 행동 패턴을 자세히 분석해 로직화한다.
§14.1의 사유 기록이 "그 과정에서 어떤 생각이 관여했는지"의 기반 데이터가 된다.

- ✅ **대처 행동(coping)**: 스트레스(기분 저하 지속) → 대처 전략 선택이 성격·습관 의존.
  예: 술집 시설 추가 → 기분 급락 시 음주(단기 기분 회복, 다음날 energy 페널티, 반복 시 습관
  가중치 강화 — 중독 루프), 폭식, 은둔(집에만), 운동. 대처 선택 자체가 성격(T/F, E/I)과
  과거 기억(효과가 있었나)의 함수.
- ✅ **건설**(도로화·증축 구현, 자재→화폐 추상화·신축은 후속 이슈): 심이 세계를 바꾼다 — 자재 모으기 → 집 증축/신축, 도로 놓기(자주 다니는 경로가
  도로화). 맵이 불변이라는 Phase 1 전제가 깨지므로 경로 캐시·도달성 검증의 재설계 필요.
- ✅ **문제 해결 과정 추적**: 목표가 막혔을 때(돈 없음·시설 만석) 대안 탐색 체인을 reason에
  기록 — "카페 만석 → 집 식사 시도 → 재료 없음 → 일단 일하러" 같은 사고 흐름의 로그화.
- 각 항목은 §14 이슈 루프로 우선순위를 정하고 §12.1처럼 정수 테이블 스펙 확정 후 구현.
