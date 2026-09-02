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

## 16. 세계관 확장 — 해솔마을 (v0.4)

마을 이름 **해솔마을** 확정 (목업의 행정사무소 간판에서 유래). 목표: 세계가 플레이 중에도
변하고 자란다 — 새 시설, 새 경제 루프, 동적 오브젝트, 날씨.

### A. 신규 시설 3곳 (addVenuesTo 단일 권위 — 신규/마이그레이션 공유, §15.1 방식)
| 시설 | 위치 | 자원 | 행동 |
|---|---|---|---|
| library(도서관) | (3,10) 7×5, 문 (6,14) | 좌석 4 | read |
| market(시장) | (12,10) 7×5, 문 (15,14) | 계산대 2 | shop |
| pond(낚시터) | (38,42) 8×5 — 내부 3×2 WATER, 둘레 잔디 | 낚시 스팟 4 (물가) | fish |

### B. 신규 행동 (enum 뒤 append: read, shop, fish, cook_eat)
- **read**(도서관, 40틱): fun +120/틱, mood +5/틱. persFactor = 100 + (SN-50) + floorDiv(EI-50, 2)
  (N·I가 선호) — [50,200] 클램프.
- **shop**(시장, 15틱, cost 600): 완료 시 groceries +3 (심 인벤토리, 상한 6). 후보 조건(하드):
  groceries == 0 && money ≥ cost. needValue = hunger (배고픈데 장도 비면 급함).
- **cook_eat**(자기 집, 25틱): 후보 조건 groceries ≥ 1. hunger +350/틱, mood +8/틱(집밥),
  완료 시 groceries -1. **비용 0** — 장만 봐두면 카페(200원)보다 싸다: 집밥 경제 루프.
  eat과 같은 hunger 욕구로 경쟁 (거리·비용·성향이 가른다).
- **fish**(낚시터, 90틱): fun +60/틱, mood +12/틱. 완료 시 **rngSim 1드로우**:
  catch = rngInt(fishCatchSpan(400)) — 0이면 '허탕'(mood -100), >0이면 money += catch,
  'fish_caught' 이벤트. persFactor = 100 + (EI-50)/1 + (JP-50)/2 → 정수식: 100 + (EI-50) (I 선호).
- 기억 kind: read_time(2)/shopping(1)/home_meal(2)/fishing(3) — 습관 루프 편입(HABIT_KINDS).

### C. 동적 오브젝트 — 분실 동전 (플레이 중 "새 오브젝트가 생긴다")
- world.lostItems: [{itemId, x, y, amount, expiresTick}]. itemId 단조 카운터(world.itemCounter).
- 스폰: t % itemSpawnInterval(720) == itemSpawnAtTod(0 오프셋) 에서 rngSim로 위치 시도 최대 8회
  (x=rngInt(w), y=rngInt(h), **ROAD면** 확정 — 구현 중 개정: 잔디 스폰은 아무도 못 주워 죽은 콘텐츠 — 8회 모두 실패 시 스폰 없음, 드로우 수는
  항상 시도 횟수만큼 소비… 아니, **성공 시 즉시 중단**: 드로우 수가 상태에 의존하지만 맵도 상태이므로
  결정적). amount = itemAmountMin(50) + rngInt(itemAmountSpan(201)). expires = t + itemExpire(2880).
  'item_spawned' 이벤트.
- 습득: 2a 이동 직후(마모 처리 다음), 심 id 오름차순으로 현재 좌표의 아이템 검사(itemId 오름차순) →
  money += amount, mood +pickupMood(100), 'item_found' 이벤트, found_item(2) 기억, 목록에서 제거.
- 만료: 4단계에서 제거('item_expired' 없음 — 조용히). 클라이언트: 반짝이 코인 프롭 표시/제거.

### D. 날씨 (하루 단위, 결정적)
- world.weather = { day, kind: 'sunny'|'cloudy'|'rain' }. 4단계 서두(고정 순서: **날씨 → 모임 판정 →
  만료 → 토큰 생성 → 아이템 스폰**)에서 transitionDay ≠ weather.day면 rngSim 1드로우로 가중 추첨
  (sunny 50 / cloudy 30 / rain 20), 'weather_changed' 이벤트.
- 효과(구현 중 개정): stateMod 가산은 전형 점수(~3e12) 대비 클램프(±2.5e11)가 3%라 무력 →
  **곱셈 weatherFactor**로 §G 체인 확장: score = base×pers×plan×**weather**(우천 야외 60%, [0,100]
  축소만 허용 — 상한 증가 없음, 경계 증명 불변). 실내 100. 대화 weather 문장은 실제 날씨 반영(클라).
- 클라: 비 오버레이(파티클/틴트), 상단에 날씨 아이콘.

### 스키마
- 세이브 v7: world.weather/lostItems/itemCounter, sim.groceries(0), 신규 시설 주입(addVenuesTo).
- 로직 v6: weather{sunnyW,cloudyW,rainW,outdoorRainFactor(곱셈, [0,100])}, items{spawnInterval, amountMin,
  amountSpan, expireTicks, pickupMood, spawnTries}, 신규 행동 수치는 actions에.
- 클라 타이틀·README에 해솔마을 반영.

## 16.5 자율 세계 확장 — 빈 땅과 마을 건설 (사용자 지시: 심이 세계관을 스스로 넓힌다)

### A. 맵 확장 48×48 → 64×64
- 동쪽 +16열, 남쪽 +16행의 **빈 땅**. 기존 좌표 전부 불변(원점 유지). 옛 외곽 물(x=47/y=47)은
  잔디로 개방, 새 외곽(x=63/y=63, x=0/y=0 유지)이 물 테두리. 중앙 가로(y23-24)·세로(x23-24)
  도로를 새 땅 끝까지 연장.
- 단일 권위 `expandMapTo64(map, wear)`: buildMap(신규)과 v7→v8 마이그레이션이 공유.
  wear 배열은 좌표 보존 재배치(신규 칸 0).
- **공터(plots) 8곳** (7×5, 사용 순서 = 배열 순서): 동측 (50,4)(50,14)(50,30)(50,42),
  남측 (4,50)(14,50)(30,50)(42,50). world.plots = [{plotId, x, y, used}].

### B. 마을 건설 프로젝트 (결정적 도시계획)
- 하루 1회(4단계 서브순서 맨 끝, 날씨 다음 날 경계에서) 트리거 평가 — **활성 프로젝트는 최대 1개**:
  1) 총 침대 < 심 수 + 별거 married 부부 수 → house — 별거 부부(§17.11 개정: married인데 homeId가
     다른 페어, min-id asc 순회로 결정적 카운트, 드로우 없음)는 신혼집 수요 1침대로 계상
  2) 심 수 > 카페 좌석 합 × cafeRatio(2) → cafe
  3) 심 수 > 공원 스팟 합 → park (사실상 비활성 기본값)
  우선순위 house > cafe > park. 트리거 시 미사용 plot 첫 번째 배정, 'project_started' 이벤트.
- world.project = { type, plotId, progress, required(laborRequired 600) } | null.
- **construct 행동** (enum append, 시설 아님 — 프로젝트 현장): 후보 조건 = 프로젝트 활성.
  가상 시설 'site'로 취급: 현장 4 작업 스팟(plot 모서리). needValue = NEED_MAX - constructDeficit
  (4000) 고정. persFactor = 100 + floorDiv(100 - JP, 4) (J형이 부지런). stint 60틱,
  수행 틱마다 project.progress += 현장 수행 중 심 수 1(자기 몫).
- 완공: 4단계에서 progress ≥ required → 건물 축조(addBuilding: 타입별 벽/바닥/문/자원 —
  house 침대2+예비2, cafe 좌석4, park 스팟8 나무테두리 없음), facility id = `${type}${타입별 순번}`,
  plot.used = true, project = null, 'facility_built' 이벤트. **이주**: house 완공 시 가장 과밀한
  집(잔여=거주-침대 최대, 동률 facilityId asc)의 최고 id 거주자가 새 집으로 homeId 변경
  ('moved_home' 이벤트).
- 진행 중 현장은 클라가 공사 프롭 표시. 이벤트: project_started/facility_built/moved_home.
- **완공 레이스 규칙** (Codex 23차 항목 2): progress는 2c에서 수행 심 수만큼 가산(합산이라 순서
  무관). 완공 판정은 4단계 전용 — 즉시 건물 축조·project=null. 잔여 수행자는 스틴트를 무해하게
  마저 수행(수행 자원 id에 plotId 포함 — 옛 현장 수행자는 새 프로젝트에 기여 불가). 정산은 일반
  완료 경로(construct_work 기억)만.
- **addBuilding 좌표 확정** (항목 3): house 6×5 문(x+2,y+4) 침대(x+1,y+1)(x+4,y+1) 예비
  (x+2,y+2)(x+3,y+2) / cafe 7×5 문(x+3,y+4) 좌석(x+1,y+1)(x+4,y+1)(x+1,y+3)(x+4,y+3) /
  park 7×5 무벽 스팟 6곳 (x+1+2k, y+1+2j) k<3,j<2. id = type + (기존 동타입 시설 수) —
  축조가 시뮬레이션 전이이므로 신규/마이그레이션 월드 모두 동일 규칙으로 동일 id.
- **마이그레이션 경계 변환** (항목 4): 구 x=47 열·y=47 행의 WATER(코너 포함)는 전부 GRASS로
  개방. x=0 열·y=0 행은 유지. 확장 후 모든 시설 자원 BFS 도달성 테스트 필수(연못 WATER 영구 차단).
- **정산 시점 로직 규칙** (항목 6, 일반 원칙): 모든 완료 정산은 정산 틱의 world.logic을 쓴다
  (§14.1 "같은 틱부터 새 로직"의 자연 귀결) — maxGroceries 축소 시 완료 시점 클램프 등.

### 스키마
- 세이브 v8: 맵 64×64 확장, world.plots/project. 로직 v7: construct{laborRequired, stintTicks,
  deficit, cafeRatio, parkRatio, persJDiv}.

## 16.6 2차 확장 — 128×128 (사용자 지시)

- expandMapTo를 파라미터화해 §16.5와 같은 계약으로 64→128 확장 (v8→v9 마이그레이션 체인
  48→64→128, buildMap도 동일 헬퍼·동일 순서). 옛 63 경계 개방, 새 127 물 테두리, 주 도로 연장
  + 새 땅 간선 2줄(가로 y=70, 세로 x=70 — GRASS만 도로화, 기존 구조물 불침).
- 공터 8 → **32** (plotId 8~31 append — 기존 id·used 보존): 동측 밴드 10, 남측 밴드 10,
  원거리 사분면 4.
- 동전 스폰은 items.spawnAreaW/H(64) 창으로 한정 (logic v8) — 128 전역 스폰은 아무도 못 줍는
  죽은 콘텐츠임을 §16.C 개정에서 확인한 원칙의 연장.

## 17. 사회 시뮬레이션 — 현실에 가까운 세계 (v0.6+, 사용자 지시: 목표를 원대하게)

원칙 불변: 전부 결정적 정수 규칙, 모든 변경은 입력/상태 전이, LLM 루프 개입 없음, Codex 교차 리뷰.

### 17.0 인프라 — 512×512
- expandMapTo 체인 연장: 48→64→128→**512** (v9→v10). 주 도로(y23-24/x23-24)와 간선(y70/x70)을
  끝까지 연장 + 광역 간선 추가: y=192·y=384 가로, x=192·x=384 세로 (GRASS만 도로화).
- 공터 32 → **+64 = 96곳** (plotId 32~95): 광역 간선변 그리드 (x∈{80,120,160,200,240,280,320,360,400,440} × y∈{66,74} 등
  구체 좌표 배열은 코드 단일 권위, 전부 BFS 도달성 테스트).
- **성능 계약**:
  - world.wear를 밀집 배열 → **희소 객체** {tileIdx: count}로 전환 (마이그레이션: 0 초과만 이관).
  - 라이브 커밋 주기 1틱 → **30틱** (engine 상수): 크래시 시 미커밋 ≤30틱은 스냅샷+내구 입력
    재생으로 결정적 복구 (기존 테스트 8 계약 그대로).
  - BFS 스크래치 버퍼 재사용 (모듈 캐시 — 순수성 불변).
  - 클라: 지면은 거대 다각형 1개 + 비-GRASS 타일만 개별 렌더.
  - 동전 spawnArea 유지(64) — 다운타운.

### 17.1 이민 (외부에서 오는 사람들)
- immigrationIntervalDays(7)마다 일일 평가(4c 도시계획 앞): 총 침대 > 인구면 이민자 1명 도착.
- 특성 rngSim 생성(§12.1 순서), 이름 = 확장 이름 풀[world.immigrantCounter % len] + 필요시 순번,
  id 단조, 스폰 = 서쪽 도로 끝 (2,23), 홈 = 빈 침대 있는 집 중 facilityId 최소, 'immigrated' 이벤트.
- 인구 증가 → 침대 부족 → §16.5 건설 수요 → 도시 성장 피드백 루프.

### 17.2 직업·회사 다양화 + 신규 공공시설
- 신규 시설 (addSocietyVenuesTo, 단일 권위): hospital(58,26) 8×6 병상4+진료슬롯2,
  city_hall(26,56) 8×6 슬롯4, school(44,56) 7×5 슬롯3.
- 직업 확장: doctor(hospital, wage 140%), civil_servant(city_hall, 110%), teacher(school, 105%),
  barista는 이제 **cafe에서 근무**. occupation→근무 시설 타입 매핑 테이블(logic) 도입 —
  work 후보는 자기 직업의 시설에서만. office_worker→office 유지.
- 이민자·플레이어는 신규 직업 선택 가능. 기존 심 직업 유지.

### 17.3 질병과 전염
- sim.sick = null | { kind: 'cold', untilTick }. 걸리면 energy·fun 감쇠 +50%, 😷 이모트.
- 감염 경로: ① 일일 위험 드로우(4단계 심 id 오름차순, 심당 1드로우): p(‰) = base(5) +
  starvingBonus(배고픔 0이었던 날 +30) + rainBonus(비 +10) + lowEnergyBonus(energy<2000 +20).
  ② **전염**: 페어링 틱에 한쪽만 감염 시 1드로우 p=contagion(40‰) — 사교가 병을 옮긴다.
- 'see_doctor' 행동 (hospital 진료슬롯, cost 800, duration 30): 완료 시 완치 + 'recovered'.
  자연 치유: untilTick(발병+4320) 경과. 아픈 심은 see_doctor가 위급 후보로 승격(coping류 게이트:
  sick일 때만 후보). 'fell_sick'/'recovered' 이벤트, 기억 sick(6)/healed(4).
### 17.4 정부와 투표
- electionIntervalDays(30)마다 선거일(일일 평가): 후보 = 인기(타 심들의 자신을 향한 양수 호감도 합)
  상위 2명(동률 id asc). 전원 투표: 자기→후보 호감도 높은 쪽(동률 id 낮은 쪽). 최다 득표가
  world.mayorId ('election' 이벤트 {votes}). **상호작용이 권력을 만든다.**
- 시장 효과: 건설 laborRequired ×mayorLaborPct(90%) (프로젝트 시작 시점 스냅샷 규칙 유지),
  시장 월급 보너스(시청에서 일하지 않아도 매일 +200, 일일 평가에서 지급, money_changed).

### 17.5 연애·결혼 (성별 무관)
- world.partners = { simId: partnerId } 대칭. 티어 확장: dating, married (relTiers와 별개 전역 상태).
- 회고에서 결정(무드로우, 결정적): 미혼 심 A가 상호 호감도 ≥ datingMin(6000) && interactions ≥
  100 && 상대도 미혼인 최고 호감 B 발견 → 'started_dating' (양쪽 기억 love(7)).
- dating && 상호 호감 ≥ marryMin(9000) && interactions ≥ 300 → 'married' 🎉 — 배우자가 상대
  집으로 이주(빈 침대 있을 때, 없으면 대기 — 건설 수요와 맞물림). 파혼: dating 중 어느 한쪽
  호감도 < breakup(2000) → 'broke_up', 양쪽 mood -1500, 기억 heartbreak(8, 부정).
- 효과: 파트너와 페어링 시 사교 회복 ×150%, 대화 주제 'sweet_talk' 추가(파트너 페어일 때 가중),
  파트너가 있는 시설로 stateMod 보너스 ×2.
### 17.6 동아리
- 고정 동아리 4개: 독서회(library/read), 낚시회(pond/fish), 운동모임(park/exercise), 술벗(bar/drink).
- 가입: habit['action:facility'] ≥ clubHabitMin(2e10) 회고 시 → 'joined_club', world.clubs[clubId] 멤버 추가.
- 주간 모임: 클럽별 고정 요일·시각(코드 테이블)에 토큰 자동 생성, **멤버 전원 즉시 인지**(learnToken)
  — 비멤버는 입소문으로만. 멤버끼리 페어링 시 호감도 델타 +clubBonus(10) 가산.
- 대화 주제 'club_talk' (같은 클럽 페어 가중).

### 17.7 상호작용 → 행동 영향 (사회적 전파)
- **험담의 영향**: gossip 대화 시 청자의 대상(C) 호감도가 sentiment × gossipInfluence(30)만큼
  변동 (청자 TF 부호보존 스케일) — 말이 관계를 바꾸고, 관계가 선택(투표·연애·stateMod)을 바꾼다.
- sweet_talk/club_talk도 소폭 상호 호감 가산. 모든 변동은 기존 클램프 내.

### 스키마
- 세이브 v10: 맵 512, wear 희소화, sims.sick, world.partners/clubs/mayorId/immigrantCounter/
  lastElectionDay, 신규 시설. 로직 v9: society/disease/election/romance/club 섹션 + 신규 직업·행동.
- 에셋 배치: hospital_cross, pill_bottle, ballot_box, flag_pole, wedding_arch, dog, school_desk,
  noticeboard (Codex imagegen).

### 17.8 정밀 규칙 확정 (Codex 26차 1~7)
- **페어링 내 서브순서(고정)**: ① 토큰 전파(토큰별 1드로우) → ② 전염(정확히 한쪽 감염 시 1드로우)
  → ③ 대화(0~1드로우 + 험담 영향 적용) → ④ 호감도 델타 1드로우(+동아리/파트너 보너스 가산) →
  다툼 판정. 상호작용 카운트는 기존 위치.
- **4단계 서브순서(최종)**: 날씨 → 모임 판정 → 토큰 만료 → 토큰 생성 → 아이템 만료/스폰 →
  완공 판정(매 틱) → **일일 평가**(날 경계에서만): ① 질병 위험 드로우(심 id asc, 심당 1드로우 —
  이날 도착 예정 이민자는 미포함) → ② 선거(주기 도래 시) → ③ 시장 수당 → ④ 이민(주기 도래 시,
  신규 심은 다음 틱부터 참여, 질병 드로우는 다음 날부터) → ⑤ 도시계획 트리거.
  자연 치유(untilTick 경과)는 4단계 감쇠 루프에서 매 틱 무드로우 판정.
- **연애 단일 실행**: 상태는 world.partners(대칭)+world.partnerStage(대칭 'dating'|'married').
  전이는 "먼저 회고하는 쪽"이 실행(회고 시각이 결정적이므로 단일 실행 보장). 한 회고 내 순서:
  파혼 검사 → 결혼 검사 → 새 연애 탐색. 파혼: 어느 한 방향 호감 < breakup. 결혼: 양방향 최소
  호감 ≥ marryMin && interactions ≥ 300. 연애 시작: 양쪽 미혼, min(양방향) ≥ datingMin &&
  interactions ≥ 100, 후보 중 min-호감 최대(동률 id asc).
- **선거 엣지**: 후보 = 인기(양수 호감 합) > 0인 심을 (인기 desc, id asc)로 상위 2. 0명이면 선거
  무산(현 시장 유지). 1명이면 단독 당선. 득표 동률 → id 낮은 쪽. 재선 허용, 시장 임기 무제한
  (다음 선거로만 교체).
- **리포트 경계**: /api/report의 upto·nextCursor는 **커밋된 틱**(meta.lastSimulatedTick)으로
  클램프 — 30틱 캐던스의 미커밋 상태는 리포트에 노출되지 않는다.
- **희소 wear 정규형**: 10진 정수 문자열 키, 0 엔트리 저장 금지(증가 전용, ROAD 전환 시 삭제),
  canonical 정렬은 문자열 사전순(결정적이면 충분). 마이그레이션은 >0만 이관.
- **반올림·클램프**: 질병 감쇠 가산 d += floorDiv(d,2); 파트너 stateMod 보너스는 2배 후 기존
  클램프; 동아리/달콤한말/험담 델타는 부호보존 스케일 + AFFINITY 클램프; 시장 효과
  required = floorDiv(laborRequired × mayorLaborPct, 100) (프로젝트 시작 스냅샷 규칙 유지).

### 17.9 사회 라운드 2 (같은 원칙: 결정적·기존 시스템 재사용)
- **결혼식 잔치**: married 이벤트 시 공원 토큰 자동 생성(다음날 19:00, expire +120) — 부부 +
  각자의 friend 티어 심들에게 즉시 인지(learnToken), 나머지는 입소문. 결혼이 마을 행사가 된다.
- **선거 유세**: 선거일 D-3~D-1, 현재 인기 상위 2명은 socialize planFactor에 campaignPull(140)
  적용(파티 끌림과 같은 슬롯 우선순위: party > campaign > slot). 유세가 상호작용을 낳고
  상호작용이 표가 된다.
- **대화 주제 추가**: politics(선거 D-3~당일 + 당선 후 3일, 시장/후보 실명), couple_news(마을의
  최신 커플/부부를 실명 험담 — started_dating/married 이후 7일간 화제). 문맥 필터로만 추가,
  가중치는 logic.conversation.topicWeights에 신규 키.
- **새해**: day % 360 == 0 (day>0) 일일 평가 마지막에 전원 age+1 ('new_year' 이벤트 1건).
  age>25가 된 student는 office_worker로 전직('graduated', 근무지 매핑 자동 변경).
  퇴직: age 65 도달한 비-retired는 retired로 전직('retired_now') — 현실의 생애 주기.
- **마을 통계 표시**(클라 전용): 상단바에 인구·커플 수·시장 이름.
- 스키마 불변(신규 상태 없음 — 토큰·plan·traits 재사용), logic v10: conversation.topicWeights에
  politics(25)/couple_news(25), election.campaignPull(140)·campaignDays(3), society.yearDays(360)·
  retireAge(65)·graduateAge(26).

### 17.10 라운드 3 — 실내 여가·축제 (오브젝트 다양화)
- 신규 시설(addLeisureVenuesTo, 단일 권위): restaurant(70,26) 7×5 좌석4 — eat 제2 시설(인구 수용),
  gym(70,34) 7×5 스팟4 — exercise 실내 대안(우천 무페널티), cinema(70,44) 8×6 좌석6 — play 실내
  대안. **enum 불변** — ACTION_FACILITY 확장만: eat:[cafe,restaurant], exercise:[park,gym],
  play:[park,cinema]. binge_eat도 restaurant 포함.
- **축제**: day % festivalDays(90) == 0 && day>0 일일 평가 마지막에 공원 토큰(당일 19:00, expire
  +180) — **전 주민 즉시 인지**(축제는 모두가 안다), 'festival' 이벤트, 클라 🎆.
- 스키마 불변(신규 상태 없음), 로직 v11: society.festivalDays(90), 시설은 v12 마이그레이션으로 주입.
  (시설 주입은 맵 상태라 세이브 v12 필요 — 정정.)
- 에셋: restaurant_table, gym_rack, cinema_screen, popcorn, festival_lantern (5종).

### 17.11 라운드 4 — 가족 (자녀 정착)
- 새해 평가(§17.9 다음)에서 married 부부(id 낮은 쪽 기준 페어 순회, id asc)마다 **1드로우**:
  p = childPermille(300)‰ && 부부 집에 빈 침대 있으면 'child_settled' — 새 심(나이 15, student,
  성별·MBTI rngSim, 이름 이민 풀 공유) 부모 집에 정착. world.parents[childId] = [부모A, 부모B]
  (id asc). 부부·자녀 상호 호감 +5000 초기화, 전 주민 new_neighbor 기억, 부모는 child(9) 기억.
- 대화 주제 family_talk: 화자에게 자녀/부모 있으면 후보(가중 30) — 실명 문장("우리 애가 벌써
  학교엘 다녀"). 자녀는 부모와 페어링 시 호감 보너스 familyBonus(12) (pairDeltaBonus 확장).
- 자녀 술어(개정): 부부 집에 빈 침대 **또는 증축 여력**(잔여 예비 슬롯 = min(extraBedSlots 수,
  build.maxExtraBeds) − 이미 증축한 침대 수 > 0) 있으면 성립 — 아이가 태어나 일시 과밀이 되면
  부모의 build(§15.1)가 발동해 침대를 짓는 창발(닭-달걀 해소). 둘 다 없으면 그 해 스킵(드로우 없음).
  드로우는 조건 충족 부부만 소비(순서 결정적).
- **합가 재시도**(회고 ①.5, §17.5 개정): married인데 별거 중인 부부 — ⓐ min-id 쪽 집에 빈 침대
  있으면 상대가 이주(moved_home), ⓑ 없으면 빈 침대 ≥2인 house 중 시설 배열 첫 번째(삽입 순 — 축조 순서라 결정적; id 사전순 아님)로 **부부가 함께
  이사**(신혼집, moved_home ×2 — lo 먼저). 실행자는 §17.5 단일 실행자 규칙(먼저 회고한 쪽) 동일.
- 주거 수요 개정: §B 트리거 1이 별거 부부 수를 수요로 계상 → 건설→합가→자녀→이민 성장 루프 폐쇄.
- 스키마 v13(world.parents), 로직 v12(family{childPermille, familyBonus, talkWeight}).

### 17.12 v0.9.1 — 라이브 세이브 교착 수리 + 관람 페이싱
- 세이브 v14: 구 빌드가 required 스냅샷 없이 만든 진행 중 프로젝트 백필(!Number.isSafeInteger →
  600, 멱등). 완공 판정 불능으로 프로젝트 슬롯이 영구 점유되던 교착 수리(§16.5 완공 규칙 불변).
- createWorld의 schemaVersion은 SCHEMA_VERSION 상수 단일 권위(리터럴 금지 — 왕복 해시 드리프트 방지).
- 로직 v13(값만 변경, 형태 불변 — 값 변경도 버전 경계 필요): 실시간 1틱=1초(1게임일=24실분) 관람
  기준 사회 페이싱 — immigrationIntervalDays 3, yearDays 120, festivalDays 30,
  election.intervalDays 15, dating 4500/40회, marry 7500/120회.
- 테스트는 주기값 하드코딩 금지 — logic 값에서 유도(S-5 정정).

### 17.13 라운드 5 — 생활 리듬·직업 확충 (행동 다양화, Generative Agents 일정 개인화)
- **크로노타입**(무드로우, 저장 안 함 — traits 순수 함수): v=(EI×3+JP×5+age×7)%100 →
  v<earlyMax(20) early / v≥owlMin(70) owl / 그 외 normal. 나이 들면 값이 이동(새해마다 재평가되는
  창발). early는 근무·여가·수면 -90분, owl +120분(flex 직업만).
- **야근/칼퇴**: flex 직업 && J형(JP≤overtimeJpMax 40) → 근무 종료 +overtimeMin(120) 야근.
  그 외 정시 칼퇴. slot.to>1440은 자정 랩(매칭: tod≥from || tod<to−1440).
- **교대근무**: police/firefighter/nurse는 shift:'rotating' — 조 = sim.id%2, A조 주간(540–1080),
  B조 야간(1320–1800 랩). B조 수면 슬롯 주간(480–960). 밤엔 대부분 자고 누군가는 새벽에 일한다.
- **수면 슬롯 신설**: buildDailyPlan에 intent 'sleep' 슬롯(개인 크로노타입 반영, 야간조는 주간).
  수면은 여전히 욕구 주도 — 슬롯은 planFactor로 타이밍만 끌어당김(우선순위 배열 맨 뒤).
- **직업 확충**: OCCUPATIONS 풀에 §17.2 3종(doctor/civil_servant/teacher — 풀 누락 버그 수리) +
  신규 4종 police(115%)/firefighter(115%)/nurse(120%)/politician(125%). 나이 제약: doctor·politician
  ≥26, police·firefighter·nurse ≥20. workplace: police_station/fire_station/hospital/city_hall.
- **신규 시설**: addCivicVenuesTo — police_station(34,64) 7×5 슬롯3, fire_station(16,64) 7×5 슬롯3
  (도로 인접·BFS 도달 검증). 세이브 v15로 주입, 신규 월드는 buildMap 체인.
- **자녀 월간화**: maybeChildren 게이트 yearDays → childCheckDays(30) (day>0 && day%30==0).
  나이·졸업·은퇴는 새해 유지. 일일 서브순서 위치 불변(newYear 다음). '모두 나이만 먹는' 문제 해소.
- 로직 v14(chrono/occupations/workplace/society.childCheckDays), 세이브 v15(시설 주입).
  워크 게이트·계획이 workWindowFor 단일 헬퍼 공유(§17.2 매핑 유지). 에셋: 경찰서·소방서 +
  경찰·소방관 원형 스프라이트(Codex imagegen, §17.14 아트 라운드에 합류).

### 17.14 라운드 6 — 캐릭터 아트·보행 애니메이션 (탈 클립아트)
- 스타일: 16비트 SNES풍 치비 도트(스타듀 계열), 진한 외곽선, 3/4 뷰. 원형 10종(id%10 재사용 —
  이민자·자녀 포함) + 플레이어. 시트: 가로 4프레임 걷기(↙), 마젠타 배경(Codex imagegen 전담).
- 파이프라인: chromakey 플러드필 → tools/slice-sheet.js(알파 열-투영 분리 — 격자 오차 흡수,
  프레임별 bbox 공통 셀 하단-중앙 정렬 = 발끝 기준선 고정) → walk{N}_{0..3}.png.
- 클라: Phaser anims(8fps 루프) 이동 중 재생·정지 시 frame 0, dx 부호로 flipX(↘ 반전),
  발밑 타원 그림자. 프레임 미존재 원형은 구 정적 이미지 → 색 원 폴백 체인 유지. 시뮬 코어 무변경.

### 17.15 라운드 7 — 경제 순환: 소득세·국고·복지 (닫힌 내수 탈피 1단계)
- world.treasury(국고, 정수, 초기 0) — 세이브 v16. 로직 v16 economy{taxPct 15, welfareThreshold
  300, welfareAmount 200, welfareDailyCap 5}.
- 소득세: work 정산에서 원천징수 — net=floorDiv(wage×(100−taxPct),100), 세금은 국고.
  money_changed payload에 tax 필드(이벤트 수 불변).
- 시장 수당 국고화: min(수당, 국고)만 지급, 국고 0이면 미지급·무이벤트(재정난 창발).
- 복지: 일일 평가에서 수당 다음(서브순서 고정) — 잔고<threshold 심 id asc, 국고 한도 +
  일일 캡. 'welfare_paid' 이벤트(EVENT_TYPES 신규).
- 보존: 임금 민트 유지(고용주=추상 외부), 소비 비용 소멸 유지 — 완전 폐쇄(기업 임금기금)는
  후속. WS 스냅샷·tickBatch에 treasury 동봉, 상단바 🏛️ 표시.

### 17.16 라운드 8 — 서카디언 수면 압력 (논문 로드맵 P1-②)
- 로직 v17 circadian.energyPct[24]: 시각별 에너지 감쇠 가중%(심야 150 → 오전 90). 생리 기반
  rest/activity 모델의 수면 압력 곡선 이산화.
- 개인 위상: 크로노 오프셋(분)만큼 좌우 이동 + 야간조(교대 홀수 id)는 12h 반전 — 밤에 대부분
  자고, 야간조는 낮에 졸리다.
- 적용 순서: (기본+나이보정)×서카디언% → 숙취 가산 → 질병 가산 (감쇠 수식 §12.1 확장).
- 60일 소크: 야간(20-06시) 수면 비율 48% → 53%.

### 17.17 라운드 9 — 주중/주말 리듬 (논문 로드맵 P1-①, TUS)
- day%7: 0..4 주중, 5..6 주말. 주말엔 일반 직업 근무 창 없음(계획·게이트 단일 권위 workWindowFor).
- 예외: 교대(rotating)·weekendWork 직업(barista, freelancer)은 주말에도 근무 — 현실의 서비스업.
- 주말 여가 슬롯 확장: 아침 식사 후부터 여가(빠진 근무 자리를 여가가 채움) — 주말 공원·카페가
  붐비는 창발. 로직 v18(occupations.weekendWork).

### 17.18 라운드 10 — 삼각 폐쇄 (논문 로드맵 P2-④)
- pairDeltaBonus 확장: 양방 'friend'인 공통 친구 수 × perFriendBonus(8), maxCommon(3) 캡.
  무드로우·그라데이션 — 친구의 친구와는 빨리 가까워진다(Science Advances aax7310).
- 로직 v19(triad). 기존 커플·가족·동아리 보너스와 합산.

### 17.19 라운드 11 — 건물 내부 모드 + 차량 (시각 계약 확장)
- 건물 클릭(빈 클릭 → 화면→타일 역변환, 발자국+북서 3타일 지붕 여유) → interiorOpen 토글.
- 열림: bld_*_int 컷어웨이(지붕 제거·낮은 벽·가구) 텍스처, 북쪽 모서리 깊이로 안의 심이 위에
  그려짐. 텍스처 없으면 스프라이트 생략 → 타일 내부 폴백. 닫힘: 기존 외형(야간 점등 포함).
- 차량 소품: 경찰차(파출소)·소방차(소방서)·구급차(병원) 문 앞 배치. 시뮬 코어 무변경.

### 17.21 라운드 12 — 도시 성장 드라이브 (행동 → 성장 폐루프)
- world.reputation(세이브 v17): 틱 끝 5.5단계에서 이번 틱 이벤트 가중 합산(married 40·festival
  30·facility_built 25·child_settled 30·election 10·gathering 2, 캡 500), 일일 블록 마지막
  (축제 다음)에 ×repDecayPct(95)% 감쇠.
- 이민 웨이브: 주기마다 1 + floor(평판/immigPerExtra 80)명(캡 immigWaveMax 3), 각자 빈 침대
  필요(immigrateOne 반복 — 결정적, 드로우는 특성 생성만).
- 계획 트리거 개정(우선순위): ① 선제 주택 pop+별거+headroomBeds(2) > 침대 ② 일자리: office
  근무 직업 심 수 > 책상 합 → office 신축 ③ cafe 비율 ④ park. addBuilding 'office' 7×5
  문(x+3,y+4) desk4 (x+1,y+1)(x+4,y+1)(x+1,y+3)(x+4,y+3).
- 로직 v20(growth). 행동이 평판을 만들고 평판이 사람을 부르고 사람이 건물을 부른다.

### 17.22 라운드 13 — 성장 월드 성능 (결과 불변 최적화, 이슈 #17)
- 계측: 인구 69에서 22.5s/게임일. BFS는 0.2%(호출당 평균 13셀) — 병목은 후보별 기억 retrieval.
- 결과 불변 최적화(46일 해시 f0da44a9 비트 동일 검증):
  ① prepareShortlist(심 결정당 1회): base retrieval 내림차순 정렬 + 기억별 tagSet(WeakMap 캐시).
  ② memoryModFast: overlap 버킷(0..cap) k-way 병합으로 topK — 전체 정렬과 동일 총순서
     (retrieval desc, memorySeq asc). 버킷 스크래치 재사용.
  ③ (action, 시설) 메모: planFactor·memoryMod를 자원(좌석)들이 공유 — 좌석 4개면 4배 절약.
  ④ 시설 타입 인덱스(길이 변화 시 재구축), 결정 내 stateMod 시설 캐시, 태그 문자열 호이스팅.
- 46일 소크 97.1s → 48.4s (2.0×). 잔여 병목(후보 볼륨 자체)은 후속 — 후보 상한은 행동 변경이라
  별도 버전 경계 필요.

### 17.20 라운드 14 — 사건: 화재와 소방관 (제복에 업무를)
- world.incidents(세이브 v18): {type:'fire', facilityId, sinceTick}. 로직 v21 incidents.
- 발화(§17.8 ①.5 — 질병 다음): 시설 배열 순, park·pond 제외 시설당 정확히 1드로우
  (불타는 중에도 드로우 소비 — 드로우 수 불변). p=base(2‰)+주방 보너스(식당·카페 +3‰).
- 사용 배제: 불타는 시설은 행동 후보에서 제외(자기 집 포함 — 드라마 허용).
- 진압: respond_fire(enum append, 소방관 전용 게이트) — 시설 문 북측 가상 스팟(firesite),
  deficit 고정 respondDeficit(5500, construct보다 급함). 완료 시 resolveFire: 사건 제거,
  목격자(맨해튼≤heroRadius 10) → 진압자 호감 +heroAffinity(800), heroic(8) 기억, heroic_save.
- 자연 진화(4단계 매 틱): sinceTick+selfOutTicks(1440) 경과 → 꺼지되 평판 −selfOutRepPenalty(40)
  — 소방관이 없는 마을은 소문이 나빠진다(§17.21 이민 위축과 연결).
- 이벤트: fire_started/fire_out{by}/heroic_save. 클라: 🔥 오버레이(스냅샷·tickBatch incidents 동봉),
  피드 문구. 드로우 추가로 rngSim 스트림 변경 — 행동 버전 경계.

### 17.23 라운드 15 — no_path 고착 수리 (이슈 #21)
- 근인: extraPlots128 (72,26)이 v12에서 추가된 restaurant와 좌표 충돌 — 선제 건설이 그 공터에
  house를 축조해 식당 동쪽을 벽으로 덮음 → 좌석 도달 불가 → 최우선 후보 무한 재선택 고착.
- 예방: plotBuildable(공터 7×5 전 타일 GRASS) — 도시계획 freePlot 필터 (침범·도로·물 방지).
- 수술(세이브 v19): 공터-축조물(^type\d+$)이 다른 시설과 겹치면 제거·초지화, 주민 재배치
  (빈 침대 배열 순), 피해 시설 둘레벽·내부·문 재축조. 결정적 순수 함수.
- 치유: sim.noPathCool — no_path 실패 자원을 noPathCoolTicks(240) 동안 후보 제외(차순위 진행),
  일일 블록에서 만료 청소. 신규 심 생성 4경로 모두 초기화.

### 18.T1 라운드 16 — 시정 운영: 재정 정책 (타이쿤 1단계, Codex 44차 합의안)
- 신규 내구 커맨드 'policy' (logic_update와 분리 — 44차 합의 (a)): 화이트리스트
  POLICY_FIELDS{taxPct 5~30, welfareAmount 0~1000, welfareThreshold 0~2000} 정수·범위 검증
  (validatePolicy — 서버·시뮬 단일 권위). world.policy(세이브 v20)에 병합, 입력 로그 원문 보존.
- 유효값 규칙: econ(world,key) = policy 오버라이드 ?? logic.economy 기본 — 소득세·복지 지급.
- 납세 불만(합의 (c) 조건): §G modifier가 아닌 정산 시점 mood 델타 = -floorDiv(tax×taxMoodPer(5),10)
  — 세율 비례 그라데이션. 세율↑ → 국고↑ vs 기분↓ → 평판·이민 연쇄 (타이쿤 트레이드오프).
- policy_changed 이벤트(before/changes), 클라 🏛️ 시정 패널(슬라이더 3종), 스냅샷 policy 동봉.
- 로직 v22(economy.taxMoodPer). 다음 단계(T2 건설 지시+회전)는 완료 후 Codex 재합의.

### 18.T2 라운드 17 — 건설 지시 + 건물 회전 (타이쿤 2단계, Codex 47차 합의)
- 신규 내구 커맨드 'zone' {plotId, type, dir}: 검증(존재·!used·plotBuildable·ZONEABLE·dir 0..3·
  국고≥zone.costs[type]) → **주문 시 차감**(취소 없음), zoneOrders FIFO, 'zoned' 이벤트.
- 도시계획: 주문이 자동 수요보다 우선 — 프로젝트 슬롯 빌 때 즉시 착공(일일 게이트 무관).
  **착공 재검증**(!used·plotBuildable — 그 사이 침범 가능): 실패 주문은 input_rejected(stale_order)
  결정적 폐기, 환불 없음(합의).
- 회전: dir 0..3, 90°마다 로컬 (lx,ly)→(h−1−ly, lx), footprint w/h 스왑, 문·자원·예비 슬롯
  단일 변환. facility.dir(기존 세이브 ??=0 — 마이그레이션 불요). 세이브 v21(zoneOrders), 로직 v23(zone.costs).
- 클라: 공터 클릭 → 📐 지정 모달(타입 4종·회전·비용), 회전 외형 bld_*_d{1,2,3}(배치 7) 폴백 d0.

### 18.T4 라운드 18 — 도시 등급·마일스톤 (타이쿤 3단계, Codex 49차 합의)
- world.cityTier(세이브 v22, 비가역): 마을(0)→읍(25)→시(60)→대도시(120). 판정은 일일 평가
  이민 직후·새해 전(합의), 최고 도달 등급으로 1회 승급.
- 승급 효과: city_promoted 이벤트, 전 주민(id asc) mood +1000(clamp, 사실 델타 — §G 무오염),
  celebration(7) 기억, 평판 +100(캡). 이민 웨이브 캡 = immigWaveMax + cityTier.
- zone 언락 프레임: tiers[].unlocks(읍 apartment / 시 factory·mall / 대도시 university) —
  게이트 tier_locked, 언락됐지만 레시피 미구현은 bad_type(T3에서 해제). 로직 v24(tiers/promotion).
- checkShape 확장: 객체 배열(tiers) 원소별 형태 재귀 + 문자열 leaf 허용.
- 클라: 상단 등급 배지(배치 8), 승급 피드 + 폭죽 연출.

### 18.T3 라운드 19 — 시설 티어: 아파트·공장·상가·대학 (Codex 51차 조건부 GO 이행)
- ZONEABLE·ZONE_DIMS·zone.costs 확장(아파트 7×5 6000 / 공장 8×6 8000 / 상가 8×6 8000 /
  대학 8×6 10000). 전부 zone 전용(자동 수요 없음 — 시장의 선택), 회전·plotBuildable 동일 계약.
- 아파트: 침대 8 — 이민·합가 가속의 핵심. 공장: 슬롯 8 + 신규 직업 worker(임금 95%, 이민·졸업
  풀 참여 — 행동 경계 v25) + **공해**: 일일 블록 복지 다음·이민 전(51차 고정)에서 평판
  −공장수×repPerFactoryPerDay(3). 상가: till 3(shop 전용)+seat 3(play 전용) — mall 자원 kind
  분리(51차 명시), groceries 규칙은 market 공유. 대학: 슬롯 4, student 근무지 확장은 후속,
  **졸업 가중 풀**: 단일 rngInt 유지(51차 (a)) — poolBase(사무·노동·교사·공무원) + 대학 보유 시
  poolUni(의사·정치인·간호사) append. 졸업 고정 전직(office_worker) → 드로우 1회는 행동 경계.
- 클라: 지정 모달 2단 버튼(티어 잠금 표시), 신규 색·라벨·스프라이트·내부 매핑, 공장 연기 프롭.

### 18.T5 라운드 20 — 시정 대시보드 (타이쿤 5단계 완결, Codex 54차 합의)
- world.statsHistory(세이브 v23, 캡 180 shift): 일일 평가 끝(평판 감쇠 다음 — 54차 고정)에
  {day,pop,treasury,reputation,avgMood(floorDiv, 인구 0 가드),employed(wagePct>0·비학생),tier}.
- 전송: 스냅샷 전체 + tickBatch statsToday 증분(클라 동일 day upsert — 54차).
- 클라 📊 지표 모달: 3중 라인 그래프(인구·국고·평판) + 지표 카드(행복도=(avgMood+10000)/200%,
  고용률, 등급). §18 타이쿤 로드맵 T1~T5 전 단계 완료.

### 17.24 라운드 21 — 경찰 순찰·분실물 신고 (#14 2단계, Codex 56차 조건부 GO 이행)
- 순찰: 경찰 work = patrol 가상 스팟(대상: cafe·park·market·bar·mall, byType 배열 순 결합) —
  sim.patrolIdx(세이브 v24, 56차 (a)) % 대상 수 지점의 문 앞. 완료 정산에서 patrolIdx++ +
  평판 +repPerPatrol(1, 캡) — 공해의 대칭(치안이 마을 매력 유지).
- 정직 신고: 동전 습득 지점에서 경찰 존재 시 p = honesty.base(50) + floorDiv(TF, tfDiv 4) %
  (정수식 고정, dayHash salt 7 — rng 비소비) → 신고면 소지 대신 world.lostAndFound(v24)
  {itemId, finderId, amount, dueDay=day+holdDays(3)}, mood +200, honest(6) 기억.
- 귀속(56차): 일일 블록 복지 다음(공해 전) — dueDay ≤ day, itemId asc, 신고 시점 경찰 존재만
  검사(이후 경찰 감소 무관). item_reported/item_returned 이벤트. 로직 v26(patrol/honesty).

### 19 R-A 라운드 22 — 지형 대개편: 강·산·바다·다리 (Codex 61차 조건부 GO)
- 타일 append: RIVER(6)·BANK(7)·SAND(8)·MOUNTAIN(9)·HILL(10)·BRIDGE(11). 기존 0..5 의미 불변.
  isWalkable은 BLOCKING_TILES(WATER·WALL·RIVER·MOUNTAIN)+TREE만 차단 — 다리·모래·언덕·강가 통행.
- generateTerrain(map, rngTerrain): **별도 스트림**(seed ^ 0x7e44a1)으로 rngSim 비소비(61차 ③).
  구시가 CORE(140) 이내 절대 미개입 + GRASS 타일만 덮어써 기존 지물 침범 0.
  사행 강 2줄(폭 2~3, 양안 강가) / 산맥 3덩어리(주변 언덕) / 남단 해변+바다 / 다리 4행(강 폭 관통).
- 세이브 v25: 기존 세이브에 1회 주입 + terrainVersion 고정(61차 ③). 클라 TILE_TEX 매핑으로
  스탬프 레이어가 지형 텍스처 렌더(배치 10·12 에셋).
- 근거: 지형 제약이 도시 형태를 만든다(시티즈 스카이라인). 강 건너기는 다리를 통해서만 —
  §19 R-B 교통 수요의 물리적 토대.

### 19 R-B 라운드 23 — 교통 1단계: 이동 수요 → 자가용 (Codex 64차 조건부 GO)
- 인용: 교통 4단계 모델의 ABM 대체 — 개별 심의 이동이 누적돼 수단 수요를 만든다(유발수요).
  사용자 지시 '바로 적용이 아니라 필요에 의해 생성'과 일치.
- 통계: sim.longTrips — startAction에서 path.length ≥ longTripMin(40)이면 +1 (**출발 시점**
  누적으로 계약 고정, 64차 (c)). 세이브 v26.
- 자가용: 회고 시점 maybeBuyCar — longTrips ≥ carTripsMin(12) && money ≥ carPrice(6000)이면
  구매(회고 1회당 최대 1대, 중복 불가 — 64차 (d)). 취득세 taxPct%가 국고로(경제 순환 연결).
  RNG 미사용.
- 이동: walking 전진이 hasCar면 틱당 최대 carSpeedTiles(2)칸을 **경로 순서대로**(64차 (a)) —
  마모·습득·인사 등 칸 효과는 각 칸마다 그대로. 예약은 최종 자원만 점유(기존 계약 불변).
- 실측 조정(64차 (c) 요구): carPrice 15000 → 6000. 잔고 상한이 ~9.8천이라 15000은 영구 미달이었음
  (120일 soak 구매 0대) → 6000에서 day 4 첫 구매, 120일 99명 중 69명 보유.
- 기차역(stationDemand 300)·공항은 후속 라운드. 에셋 5장 세트(4방향+내부) 확보 완료.

### 19.3 라운드 24 — 동시 건설 슬롯 (구조 변경, Codex 66차 GO)
- world.project(단수) → world.projects(배열), 세이브 v27. 마이그레이션은 legacy가 있고 배열이
  비었을 때만 이관(66차 ④ — `??=`는 이미 존재하는 빈 배열 때문에 놓친다).
- 동시 슬롯 = clamp(1 + floor(treasury / slotPerTreasury 15만), 1, maxProjectSlots 3) — 계획 단계
  시작 시 1회 계산(66차 ②). 로직 v27.
- construct 후보는 맨해튼 최근접 프로젝트(동률 plotId asc), 진행도는 자원 id `p{plotId}:`가
  프로젝트를 식별해 가산(§16.5 레이스 규칙 유지). 완공은 plotId asc 다중 처리(66차 ③).
- 자동 계획은 슬롯이 찰 때까지 **while 반복**으로 수요를 재평가하며 착공한다(67차 ①).
  수요가 없거나 공터가 없으면 break — 슬롯이 남아도 억지로 짓지 않는다.
- 진행도 가산의 프로젝트 식별은 /^p(\d+):/ 엄격 파싱 + safe-integer 확인(67차 ②).
- **실측(라이브 고정 스냅샷 60일 A/B)**: 단일 슬롯 인구 38→62·착공 18 → **다중 슬롯 인구 38→84·
  착공 39**. 성장률 약 1.8배. (첫 구현은 자동 계획이 여전히 1건만 착공해 A/B가 동일했고,
  67차 리뷰가 그 누락을 지적해 while 반복으로 수정한 뒤에야 효과가 나타났다.)
- 함정 기록: logicSchemaVersion을 올리지 않으면 mergeLogicDefaults가 스킵되어 신규 파라미터가
  undefined가 되고, 그 값을 쓰는 clamp가 NaN이 되어 **모든 계획이 조용히 차단**된다(이번에 실제 발생).

### 19.4 라운드 25 — 순찰 no_path 고착 수리 (이슈 #40)
- 증상: 60일 soak에서 no_path 2,931건 — **전부 work, 단 한 명(경찰)**이 day 177부터 발생.
- 원인: §17.24 순찰 지점을 '문 북쪽 한 칸'으로 고정했는데, 실측 27개 대상 중 2곳(park 문 북쪽
  나무, cafe3 문 북쪽 벽)이 막혀 있었다. patrolIdx는 **완료 시에만** 증가하므로 같은 지점을
  영원히 재시도했고, §17.23 noPathCool은 일반 시설 자원 루프에만 적용돼 차순위로도 못 넘어갔다.
- 수리: ① 순찰 지점을 문 주변 도달 가능 칸에서 선택(북→남→동→서→문 자체, 고정 순서·결정적),
  전부 막히면 후보 미생성. ② 순찰 후보에 noPathCool 적용. ③ startAction의 no_path 분기에서
  facilityId === 'patrol'이면 patrolIdx++ — 실패해도 다음 순찰 지점으로 진전.
- 실측: 같은 고정 스냅샷 60일 — no_path **2,931 → 0**, 인구 38→84 유지, 평판 493(순찰 완료가
  치안 평판으로 정상 전환).

### 19.5 라운드 26 — 시민 불만 → 집단 청원 (이슈 #42, Codex 70차 조건 이행)
- 근거: Granovetter, *Threshold Models of Collective Behavior* (개인 임계가 집단 결과를 만든다).
  사용자 지시의 핵심 루프 '심이 스스로 문제를 제기 → 기록 → 이슈 → 수정'의 시뮬 측 절반.
- world.complaints(세이브 v28): [{kind, placeId, severity, sinceDay, count}] 캡 64.
  world.petitions: kind별 {lastDay, armed}. sim.complaintCursor: 집계 커서.
- 적재(회고 직후, 두 sleep 전이 모두): **커서 이후 신규 기억만** 스캔(70차 ① 중복 가산 방지),
  lonely ≥ lonelyMin(3)·starving ≥ 1·**unmet(위급한데 후보 0)**을 (kind, placeId)로 집계.
  no_facility의 placeId에는 막힌 행동이 들어간다 — '무엇이 없어서 못 했는지'가 기록된다(71차 ①). 키 정렬 순회로 결정적.
  기존 항목은 배열 위치 유지, 신규만 push, 캡 초과 시 sinceDay asc oldest-first 제거(70차 ④).
- 청원(일일 평가, **평판 감쇠 다음**·이민 전 — 70차 ③): kind별 count 합 > floorDiv(pop×petitionPct
  40, 100)이면 'petition' 이벤트 1회 + 평판 −25. 발화 후 armed=false, 문턱 아래로 내려가야
  재무장(70차 ②). 드로우 0.
- 실측(라이브 30일): 불만 20종 구조화(lonely@cafe3×586 등), 청원 2건, 재발화 없음.
- 루프 연결: 서버 스냅샷·logs/world-snapshot.json에 complaints가 실려 로드맵 에이전트가
  매 사이클 근거로 사용 — 세계가 스스로 말하고, 그 말이 이슈가 된다.

### 19.7 라운드 27 — 불만 망각과 사람 수 문턱 (이슈 #45, §19.5 결함 수리)
- 라이브 실측 결함: 불만 count가 **누적만 되어**(lonely 2,916 vs 문턱 16) 재무장이 영원히
  불가능 → 청원이 kind당 1회로 **동결**. 71차가 '발산 위험 없음'이라 본 지점이 반대 방향
  (동결)으로 실패했다.
- 수리 ①: **일일 망각** — 청원 판정 뒤(당일 불만은 온전히 반영) count·severity에 decayPct(82)
  적용, 0이 되면 항목 제거. 개선되면 잊히고 지속되면 다시 쌓인다.
- 수리 ②: **사람 수 문턱** — 사건 수가 아니라 최근 windowDays(3) 내에 그 불만을 제기한
  **심의 수**로 판정(sim.complaintDays[kind], 세이브 v29). 한 명이 하루 열 번 외로워도 한 사람
  — Granovetter 모델의 원의미 복원. count 기반은 한 심의 반복이 인구 비례 문턱을 즉시
  압도해 판정이 무의미했다.
- 실측(라이브 60일 A/B): 청원 0건(감쇠만) → **8건 주기적 발생**, 평판 165→438 정상 성장.

### 19.10 라운드 28 — 불만 원인 분화 (이슈 #49)
- 라이브 오진: no_facility:eat ×125(severity 100)인데 카페 5·식당 1(좌석 24석)이 멀쩡히 있었다.
  실체는 **빈곤** — 밥값 200원조차 없는 심이 9/40명(은퇴자 다수), 복지는 하루 5명 캡.
  §19.5가 '위급한데 후보 0'을 전부 no_facility로 적어 잘못된 처방(식당 증설)을 유도했다.
- 수리: unmet 기록 시 actionBlockReason(world, sim, action, t)을 호출해 사유를 태그로 남긴다.
  no_money → kind 'no_money' / off_hours → 'blocked' / 그 외 → 'no_facility'.
  **용어 정의(73차 ①)**: 'no_facility'는 '그 시설이 세상에 없다'가 아니라 **'지금 쓸 수 있는
  시설이 없다'** — 자원 전부 예약됨·BFS 도달 불가도 여기 포함된다.
  collectComplaints가 태그로 kind를 분화한다. 드로우 0.
- 실측(라이브 20일 재수집): no_money:eat ×382, lonely 270, hungry 11 — no_facility는 0.
  로드맵이 '식당 증설'이 아니라 '빈곤 대책'을 가리키게 됐다.

### 20 라운드 29 — 시뮬레이션 배속 (x1/x2/x3)
- 시간 권위 computeTarget에 speed(기본 1) 도입: target = floor((now − epoch) × speed / TICK_DURATION_MS).
  **틱 내용은 불변** — 같은 틱을 더 자주 돌릴 뿐이라 state[t] = simulate(state[t−1], inputs[t])
  계약과 결정성에 영향이 없다(테스트 T-8이 못박음).
- engine.setSpeed(1..3): 변경 시 epoch를 현재 틱 기준으로 **재기준화**
  (epoch = now − floor(worldTick × TICK_DURATION_MS / speed))해 시간축 점프를 막는다.
- 배속은 **서버 런타임 설정**이며 시뮬 상태가 아니다 — 세이브·입력 로그에 들어가지 않고
  리플레이에 영향을 주지 않는다. POST /api/speed로 변경, WS 'speed'로 전 뷰어에 즉시 반영.
- 클라 상단바 ×1/×2/×3 버튼(현재 배속 강조). 실측: x3에서 초당 3틱 확인.
- **배속은 서버 전역 1개 값이고 마지막 요청이 이긴다(last-writer-wins).** 여러 뷰어가
  각자 누르면 마지막 것이 적용되고 WS 'speed' 브로드캐스트로 모두 그 값으로 수렴한다.
  뷰어별 개인 배속이 아니다 — 같은 세계를 같은 속도로 함께 본다 (74차 ②).
- **따라잡기 중 배속 변경**: catchUp은 시작 시 캡처한 target까지 완주하므로 중간에
  epoch를 다시 잡으면 안 된다. 그러면 따라잡기가 그 지점을 지나친 뒤 라이브 목표가
  현재 틱에 묶여 **세계 시간이 멈춘다**. 플래그만 세우고 catchUp 종료 직후 재기준화한다
  (74차 ①, 테스트 T-9이 회귀를 막는다).
- **재기준화는 ceil**: floor면 절삭분만큼 재기준화마다 1틱씩 영구히 잃어 배속을 자주
  바꾸면 누적된다. ceil은 목표가 현재 틱 아래로 내려가지 않게 한다 (74차 ②).
- 배속은 재시작 시 ×1로 돌아간다 — 세이브가 아니라 관람 설정이기 때문이다.

### 20.1 라운드 30 — 복지 수급 순서: id 편향 → 필요도 순 (이슈 #55)
- **증상**: 국고 431,606원이 매일 1만원씩 쌓이는데 심들은 굶었다. `no_money` 불만 121건·severity 94.
  라이브 14일 실측: 잔고 **0원인 #36이 복지를 한 번도 못 받는 동안 #4는 11번** 받았다.
- **원인**: `applyWelfare`가 `world.sims`를 id 오름차순으로 훑다 캡(5명)에 닿으면 break 했다.
  빈곤층이 캡보다 많으면(9명 > 5) id가 높은 빈곤층은 **영구히 배제**된다. 낮은 id는 받아서
  문턱을 넘고 다시 내려오면 또 먼저 받는 순환에 갇힌다.
- **수정**: 잔고 오름차순으로 정렬해 지급한다. 동점은 id 오름차순으로 갈라 결정성을 보존한다.
  정렬은 tick 내 순수 계산이라 `rngSim`을 소비하지 않고 드로우 순서 계약과 무관하다.
- **A/B 소크 (같은 라이브 스냅샷 Day141 → 30일)**:
  | 지표 | 옛 id순 | 필요도순 |
  |---|---|---|
  | 복지 수급자 수 | 13명 | **29명** |
  | 빈곤인데 한 번도 미수급 | 14명 | **1명** |
  | 최빈 잔고 | 0 | **50** |
  | 하위 10% 잔고 | 100 | **160** |
  | `no_money` 불만 | 481 | **388** (−19%) |
  | 굶주림 총 발생 | 81 | 85 |
  | 한 심 최대 굶주림 | 7 | **6** |
- **정직한 한계**: 같은 150회 지급을 두 배 넓게 퍼뜨렸을 뿐, **굶주림 총량은 제자리다**.
  순서는 *누가 받는가*를 고치지 *얼마나 지원하는가*를 늘리지 않는다. 이제 병목은
  `welfareDailyCap = 5`다 — 국고가 30일간 43만 → 74만으로 늘도록 복지는 하루 2,750원만 쓴다.
  다음 사이클 후보로 분리 기록한다(캡 조정은 별도 가설·A/B가 필요하다).
- **버전 계약 (Codex 75차 ①, NO-GO 반영)**: 세이브 구조는 그대로지만 **같은 스냅샷에서
  다른 궤적**이 나오는 거동 변경이므로 세이브 v31 · 로직 v30으로 올렸다. 구 로그 재생이
  어긋났을 때 "버그"가 아니라 "행동 버전 차이"로 식별하기 위한 표식이며, 데이터 이관은 없다.
- **장기 공정성 (Codex 75차 ②, 반증됨)**: "최저 잔고 우선이면 같은 소수에게 반복 집중될
  수 있다"는 우려를 100일 소크로 검증한 결과 **반대로 나왔다**.
  | 100일 지표 | 옛 id순 | 필요도순 |
  |---|---|---|
  | 수급자 수 | 15명 | **60명** |
  | 최다 수급자 1인 | 89회 | **25회** |
  | 상위 3인 점유율 | 52% | **14%** |
  | 지니계수 | 0.927 | **0.684** |
  받은 심이 문턱 위로 올라가 자리를 비우기 때문에, 강제 라운드로빈 없이 순환이 창발한다.

### 20.2 라운드 31 — 시설 매출 원장: 소비금이 소멸하지 않는다 (이슈 #43 첫 슬라이스)
- **관측**: 라이브 7일 화폐 흐름에서 임금 +187,155원이 **무에서 생성**되고
  소비 -183,000원(eat -164,000 / see_doctor -16,000 / shop -3,000)이 **허공으로 소멸**했다.
  심이 카페에 낸 돈은 주인에게도 국고에도 가지 않았다.
- **변경**: 시설에 정수 `revenue` 원장을 두고 소비금을 그 시설로 **이전**한다.
  민간 서비스 직군(화이트리스트 `economy.privateWageOccupations = ['barista']`)의 임금은
  **일한 시설의 매출에서** 나오며, 모자라면 있는 만큼만 받고 `wage_shortfall`을 남긴다.
  가게는 빚을 지지 않는다(매출은 0 아래로 내려가지 않는다).
- **범위 밖 (77차 합의)**: 사업세와 공공 임금의 국고 부담은 뺐다.
  - 사업세는 국고에 소비처가 없어 퇴장(hoarding)만 키운다 → 지출 설계와 함께 도입.
  - 공공 임금을 국고에서 내면 순유출이다: 취업자 25명 중 공공직이 약 14명인데
    세수는 전체 임금의 25%뿐이라 국고가 무너진다.
  - 사무·공공 임금은 **경제기반이론의 기반 부문**(마을 밖에서 벌어오는 소득)으로 문서화한다.
- **A/B 소크 (같은 라이브 스냅샷 Day143 → 30일)**:
  | 지표 | 옛 소멸 | 매출 원장 |
  |---|---|---|
  | 시설 매출 총액 | 0 | **922,680** |
  | 세계 총통화(심+국고+시설) | 1,041,023 | **1,977,715** |
  | 임금 부족 누적 | — | 2,120 |
  | 매출 상위 | — | hospital 316,000 / restaurant 139,200 / cafe2 137,840 |
- **정직한 한계 — 이 슬라이스는 세계의 고통을 줄이지 못한다.** 그리고 이번엔 그걸
  **대조군으로 증명했다** (78차 ⑥ 지적: 단정만 하고 대조군이 없었다).
  같은 스냅샷에서 세 팔을 돌렸다:
  | 팔 | 인구 | 굶주림 | 시설 매출 | 보존식(심+국고+시설) |
  |---|---|---|---|---|
  | A 옛 코드 (원장 없음) | 59 | 91 | 0 | 1,041,023 |
  | **C 원장만 (임금 경로 끔)** | **59** | **91** | 1,111,800 | 2,152,823 |
  | B 원장 + 민간 임금 | 65 | 83 | 922,680 | 1,977,715 |
  - **A와 C의 행동 지표가 완전히 같다** — 매출 원장 자체는 거동을 1도 바꾸지 않는다.
    (해시는 다르다. `revenue`가 세계 상태의 일부라 당연하다.)
  - 따라서 B의 모든 차이는 **오직 바리스타 임금 경로**에서 온다.
  - 그 경로가 한 일은 바리스타를 30일간 **2,120원 더 가난하게** 만든 것뿐인데
    인구는 늘고 굶주림은 줄었다. 인과라면 방향이 반대여야 한다 →
    **혼돈계의 궤적 발산이지 개선이 아니다.**
  증명된 것은 하나다: **사라지던 돈이 이제 장부에 남아 어디에 고이는지 보인다.**
- **원장이 드러낸 다음 문제**: 매출 1위가 hospital(316,000)인데 의사·간호사는 공공 직군이라
  그 돈을 받지 않는다. restaurant·market·bar·cinema·gym에는 **근무자가 아예 없다**.
  즉 돈은 이제 소멸하지 않지만 **고여만 있다** — 순환을 닫으려면 다음 슬라이스에서
  이 시설들에 고용을 만들거나 매출을 배분해야 한다. (다음 사이클 후보)
- **78차가 남긴 후속 과제**:
  - 고정 가격 세계에서 소멸 싱크를 없앴으므로 **통화량이 단조 증가**한다.
    가격·매출 상한은 별도 슬라이스로 분리한다. 보존식(심+국고+시설)을 상시 계측한다.
  - 민간 직군인데 payer 시설이 없으면 임금 0이 된다. 지금은 안전한 결정적 실패이지만,
    시설 소멸이 정상 경로가 되면 **후보 단계에서 그 work를 제외**하는 편이 낫다.
    (외부 소득 폴백은 금지 — 순환을 다시 뚫는 셈이다.)
  - 시설 매출은 **서버 스냅샷 계측 전용**이다. `tickBatch`로 보내지 않으므로 클라이언트는
    이 값을 표시하지 않는다 — 표시하려면 증분 전파를 먼저 설계해야 한다.

### 20.3 라운드 32 — 사회적 중력: 네 번째 시도에 처음 작동했다 (이슈 #33)
- **이 가설은 과거 세 번 반증됐다.** 이번에 통한 이유는 '무엇을 세느냐'가 아니라
  **'어떻게 더하느냐'** 였다.
- **진단 (7일 실측, 인구 43)**: 동시에 사교 중인 심 수 분포는 6명 16.9% / 7명 15.2% / 8명 14.4%,
  **아무도 사교 안 하는 틱은 0.0%**. 과거 폐기 사유였던 "동시 사교자가 2~3명뿐"은 더 이상 사실이 아니다
  (그때는 인구가 절반이었다). 문제는 그 6~8명이 10여 개 장소로 흩어진다는 것:
  체류 틱 중 혼자인 비율이 cafe5 99%, cafe3 91%, park2 82%.
  사교 목적 이동은 전체 사교 시간의 8%뿐이고, 사교 시각은 24시간에 고르게 퍼져 있어
  **시간 축은 레버가 아니다**.
- **1~3차가 실패한 진짜 이유**: 가산 슬롯(stateMod)은 전형 점수 ~3e12 대비 클램프가 ±2.5e11
  (약 8%)뿐이라 거리 항(den = manhattan + 16)을 이길 수 없다. PLAN §571에 이미
  "stateMod 가산은 무력"이라 적혀 있었는데도 같은 형태를 세 번 시도한 셈이다.
  이번 회차에서도 79차 합의값(gravityPerSim 1e10, cap 5e10)으로 가산을 다시 재보고
  **3군 A/B에서 다시 반증**했다: 혼자 비율이 80%로 세 군 모두 동일.
- **작동한 형태**: 점수에 **곱하는** 인자. `pull% = min(인원 × gravityPullPct, gravityPullCap)`,
  `score += score × pull / 100`. 곱셈이라야 거리와 같은 축에서 겨룰 수 있다.
- **§G 순서에서 의도적으로 벗어났다**: plan·weather와 같은 자리(mods 이전)에 두면
  헛걸음이 29%까지만 내려가고 **no_path가 1,375건** 터진다. mods 이후에 곱하면
  memoryMod·habitMod — '내가 실제로 가본 곳'의 기여 — 도 함께 커져, 중력이 가본 적 없는
  먼 시설로 심을 내던지지 않는다. 결과: 헛걸음 14.5%, **no_path 0**.
- **좌석 포화 시 중력 0** (79차 ③): 몰려가도 앉을 자리가 없으면 헛걸음만 는다.
- **도달 방어 (80차 ②)**: 갈 수 없는 곳은 아무리 붐벼도 끌리지 않는다. 심은 타일을 막지 않으므로
  연결성은 **타일에만** 의존한다 — `sameRegion`이 플러드필 라벨을 비교한다. 캐시는 `map.tiles`를
  키로 하는 WeakMap이라 세이브·해시에 들어가지 않고, 고정 주사 순서라 재계산해도 같은 결과다.
  건물이 서면 `map.reachVersion`을 올려 무효화한다(도로는 GRASS→ROAD로 통행성을 줄이지 않는다).
  **이 방어가 no_path 절벽을 완전히 없앴다** — 끌림 150%에서도 0건(전엔 1,880건).
- **'오는 중'인 심 세기(walkingPct 50%)의 역할 — 해석을 두 번 고쳤다.**
  도달 방어를 넣기 **전에는** 헛걸음을 줄이는 게 아니라 쏠림 폭주를 막는 감쇠처럼 보였다
  (walkingPct=0이면 헛걸음 27.2%로 더 낮지만 no_path 1,973건). 그런데 도달 방어를 넣자
  no_path가 양쪽 모두 0이 되면서 **원래 가설대로** 돌아왔다:
  walkingPct=0 → 헛걸음 20.8%·혼자 69%, walkingPct=50 → **헛걸음 16.0%·혼자 63%**.
  즉 '오는 중' 신호는 랑데부를 실제로 돕는다. 앞선 '폭주 억제' 해석은 방어가 없어서 생긴 착시였다.
- **A/B 소크 (같은 라이브 스냅샷 Day145 → 14일)**:
  | 지표 | 중력 없음 | 중력 켬 |
  |---|---|---|
  | 헛걸음 비율 | 46.8% | **16.0%** |
  | 혼자 끝난 사교 | 1,166 | **590** |
  | 성공한 사교 | 1,326 | **3,092** |
  | 대화 이벤트 | 1,900 | **5,761** |
  | 장소에서 혼자인 비율 | 80% | **63%** |
  | no_path | 0 | **0** |
  | **노동 완료** | 588 | **711** |
  마지막 줄이 중요하다 — 사교가 늘어도 **노동을 잠식하지 않았다**(80차 ④ 확인 요청).
- **강도 절벽은 도달 방어로 제거됐다**: 방어 이전엔 `gravityPullPct=150`에서 no_path가 1,880건
  터졌으나, 이후엔 150에서도 0건이다(헛걸음 13.0%). 그래도 기본값은 보수적으로 60을 쓴다 —
  더 올리면 사교 쏠림이 세지므로 관측 후에 올릴 일이다.
- **검증 상한은 역산했다 (80차 ③)**: 이론상 최대 점수 ≈ 3.10e13
  (deficit² × 16 × SCORE_SCALE / den(최소 16) × persFactor(≤300%) + mods 1.0e12).
  `MAX_SAFE_INTEGER`(9.007e15) 대비 cap ≤ 약 28,000까지 안전하지만 **500으로 제한**했다
  (cap=500이면 1.86e14로 안전 정수의 2%).
- **기분(avgMood)은 튜닝 지표로 쓰지 않았다**: 값이 팔마다 241 / -11 / -146 / 50으로
  단조성이 전혀 없다. 혼돈계의 잡음이지 신호가 아니다.
- 세이브 v33 · 로직 v32. 무드로우·정수·결정적. 인구 직접 조작 없음.

### 21.1 라운드 33 — 심 능력치 (사용자 지시, 이슈 #62)
사용자 지시: "사람의 능력치도 부여해야 하고"
- **문제**: 심의 특성이 성별·나이·MBTI·직업뿐이라, MBTI가 *성향*은 만들어도 **역량**이 없었다.
  같은 직업이면 임금이 똑같고, 졸업·이민 배정에 적성이 반영되지 않았다.
- **능력 4종 (0~99)**: 체력 stamina · 손재주 dexterity · 지능 intellect · 사교성 charisma.
- **RNG를 소비하지 않는다.** `chrono.js`의 `dayHash`와 같은 Math.imul 믹서로
  `(seed, simId, 능력 인덱스)`에서 유도한다. 그래서 §17.8 드로우 순서 계약이 **전혀 바뀌지 않고**,
  기존 세이브의 심도 마이그레이션에서 즉시 같은 값을 갖는다(스트림 어긋남 위험 0).
  값은 `sim.abilities`에 저장해 스냅샷·UI에 보이게 하고, 나중에 경험으로 자라날 자리를 남겼다.
- **효과는 가중치다 (이분 컷 금지 원칙)**:
  - **임금**: 직업의 핵심 능력에 따라 완만히 갈린다. 능력 0 → -(span/2)%, 50 → 0%, 99 → +(span/2)%.
    `wageSpanPct = 40`이라 최대 ±20%다 — 능력만으로 직업 간 임금 격차를 뒤집지는 못한다.
  - **졸업 배정**: 적성 높은 직업을 풀에 **여러 번 넣어** 뽑힐 확률을 올린다.
    `rngInt` 호출은 **1회 그대로**라 드로우 순서 계약이 유지된다 (S-66이 이를 못박는다).
- 세이브 v34 · 로직 v33. 인구 직접 조작 없음.
- **다음**: §21.2 산업 다양화(#63)의 선행 조건이다 — 새 업종이 생겨도 그걸 할 역량이 없으면
  배정이 무의미하다. 새 건물(workshop·lab·warehouse)은 에셋 5종 세트가 필요해 Codex에 생성 요청 중.
