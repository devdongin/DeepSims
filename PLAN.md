# DeepSims 기획서 v2.3 — 2D 쿼터뷰 심즈라이크 (오프라인 진행 세계)

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
6. 이벤트 방출: 발생 단계 순 → 단계 내 심 id 오름차순 → ordinal 부여
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

### A. 성격 (Big Five, worldgen 고정)
- 5요소 정수 0~100. 외향성→socialize, 성실성→work, 개방성→play 가중(백분율 계수),
  신경성→감쇠 +, 우호성→다툼 임계 완화. 성격 계수는 [50%, 200%]로 클램프.

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
