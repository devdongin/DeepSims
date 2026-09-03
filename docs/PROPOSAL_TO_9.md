# 제안: 평가 평균 5.5 → 9.0 (Opus 구현용 로드맵) — v11, Codex 10차 반영 + 범위 경계 확정

**성격**: 제안서. 구현하지 않는다. 한 항목 = *파일·함수 / 완료 기준(숫자) / 테스트 / 점수*.

**v11에서 바뀐 것** (Codex 10차 — 9차 "조건부 GO"에서 다시 NO-GO. 구체 계약 8건은 반영, 범위 확장 요구는 §9에서 경계를 긋는다):
- `vacancy` **이벤트 계약**(§0.8 행 + `EVENT_TYPES` 끝 append — 저장 계층이 미등록 타입을 거부한다, `constants.js:44`), payload `{facilityId, occupation, before, after, simId, inputId: null}`.
- **초대 경로 전체**: 현재 `invitedTo = {facilityId, untilTick}`는 §22.6 *동석 초대*(`society.js:1353`)이지 모임 초대가 아니다 → announce 토큰 생성 시
  **`invite_to_party` 단계**(같은 §22.6 수락 해시, `invitedTo = {facilityId: token.placeId, untilTick: token.scheduledTick + 60, partyId: token.tokenId}`)
  → `attend_party` → 집계 루프 `party_attended`. 동석 초대는 `partyId: null`.
- **T0-4 원자성**: 스냅샷 직전 `engine.flushLive()`(`engine.js:147`)를 호출해 `pendingEvents`를 커밋한 뒤 같은 트랜잭션 범위에서 이벤트를 읽는다.
- `world.goals[id].doneTick`으로 통일. 위기 창 = **일별 비중첩(day 경계)** 3일. `NAME_BEARING_EVENT_TYPES` 문서에 열거. reply payload =
  `{speakerSeq, replySeq}`. BFS·공간 캐시에 `mapVersion` 무효화 + 도로·신축 후 해시 동일 테스트. 결과 카드는 **DB 이벤트에서 재구성**
  (`GET /api/inputs/:uuid/events`). T3-3a = 30분 실행 후 **마지막** 1,000프레임.

**v10에서 바뀐 것** (Codex 9차 **조건부 GO** — 남은 조건 4개 + 측정 보강 7건):
- **T1-0 굶주림 지표를 상태 기반으로**: `starving`은 *진입 전이* 이벤트라 자주 먹을수록 더 찍힌다(`tick.js:1051-1056` 주석이 이미 그렇게 말한다).
  위기 = **3일 창의 `Σ hungerZeroTicks` 증가분 ≥ 기준**. 굶주림 fixture 추가(5/5).
- **C-3 참석 의미 단일화**: `party_attended`는 **`expireAndMeasureTokens` 집계 루프에서만** emit(§0.8 표의 "행동 완료 시"를 삭제). 행동 완료와
  참석은 다른 사실이다.
- **C-2 fallback 단일화**: top-level `name` fallback **폐기**(§0.7 문장 정정), 순서 = `payload.names` → `nameRegistry` → 프루닝 등으로 이름을 알 수
  없으면 `simId` 고정 표기(`#id`); `NAME_BEARING_EVENT_TYPES` 목록 분리.
- **C-1 `startAction()` 경로**: `sim.state = {...emptyState(), …}`로 상태를 통째로 다시 만들므로(`tick.js:473-480`) 먼저 세팅한 `inputId`는 사라진다 →
  `startAction(sim, cand, inputId)` 인자로 전달해 그 리터럴에 넣는다. 거부·stale-order 경로 전수 테스트.
- **T2-3B 키 = `(speaker→listener, topic, variant)`**: variant = `memory_share`의 kind / `gossip`의 tier·sentiment / 그 외 `''`; reply는 **별도 카운터**
  `…:reply`. speaker·reply 문장 각각 측정, 표 길이 고정.
- 게이트 표 순서 G2-0 → **G2-1** → T2-4로 이동. T0-3 3개 폭 = 1000/1400/1920. T0-9/T1-5 **kind별** 원본 건수 동일. G1-3·G1-2 fixture에
  **manifest**(기억·관계·프로젝트·상호작용 카운트) + hash. T2-2 통제 fixture(같은 seed, 행동 비활성) 대비. T3-1 이미지 fixture·정답표 커밋.

**v9에서 바뀐 것** (Codex 8차 NO-GO — 코드 사실 3건이 틀렸었다):
- **C-3 정정**: 토큰은 이미 `tokenId`(= `world.tokenCounter++`, 전역 단조)를 가진다(`world.js:141`, `tick.js:609`, `planning.js:65`,
  `society.js:339/502/579`). v8의 `tokenSeq`/`token.id`는 **중복 발명**이라 삭제 — `partyId = tokenId`, 추가는 `hostId` 하나. `world.gatherings`
  잔재 제거. C-3에 **독립 게이트 G2-1**.
- **T2-2 전제 정정**: 공공 임금은 §22.23(사용자 지시)로 **전액 보장**이고 `wage_shortfall`은 **민간 서비스 직(barista·chef·clerk)의 시설 매출
  부족**에서만 난다(`tick.js:950-985`). "무급 공무원"은 존재하지 않는다 → T2-2는 **매출 없는 가게의 노동자**를 다루고, `protest`/`world.support`는
  삭제(시장 책임이 아닌 것을 시장에 귀속시키지 않는다). 공공 임금 로직은 **건드리지 않는다**.
- **§0.10에 `world.nameRegistry`** 추가(구세이브 백필 규칙, fallback 충돌 해소: fallback은 top-level 이름이 아니라 **registry 조회**).
- **T0-4 커서 프로토콜 필드** 정의(`events`, `cursor`, `prevCursor`), 충돌 시 **스냅샷 값으로 교체 + 오류**. **G1-3 fixture는 커밋된 파일 + hash**
  (라이브 DB 순환 의존 해소). G-0 **M = 28 목록**, T2-1 사유 토큰 allowlist + hash, T0-9/T1-5 fixture 명세, G1-4 델타 경로 기준, §6.5 null 규칙.

**v8에서 바뀐 것** (Codex 7차 NO-GO 조건 4개 — 상태·프로토콜 계약):
- **C-1 축소·정정**: `inputs.client_input_id` 컬럼은 **이미 있고** `addInput()`이 그걸로 중복 제거한다(`db/storage.js:141-148`). C-1은
  `getPendingInputs()`가 그 컬럼을 SELECT해 `advance()`로 넘기고 이벤트에 싣는 일이다. **플레이어 원인 이벤트만 UUID, 자동 이벤트는
  `inputId: null`** — 시장 정책·자동 건설·NPC 행동이 같은 타입을 쓰므로 이 구분이 없으면 "10종 동일"은 검증이 아니다.
- **인과 판정 규칙**: `/api/input` 응답은 `{targetTick, sequence, duplicate?}`뿐이고 적용 `(tick, ordinal)`은 **`inputId`를 실은 이벤트로만**
  안다. 결과 카드는 `[applyTick, applyTick+4320]` 구간의 전후 비교이며 **인과 증명을 주장하지 않는다**(겹침 표시).
- **§0.10 상태 계약 표**: `goals`·`goalsHash`·`crisis`·`pairTopicSeq`·`token.hostId`·`nameRegistry`·`invitedTo.partyId`·
  `wageShortfallDays`·`state.inputId`·`zoneOrders[].inputId`·`projects[].inputId` — 초기값·마이그레이션(SCHEMA_VERSION 50→51)·
  직렬화·해시·구버전 세이브·`makeSim` 단일 창구.
- **모임 데이터 모델(C-3)**: 현재 토큰은 `{topic, scheduledTick, placeId}`뿐이고 참석은 그 시각 그 장소에서 performing 중인 심 수
  (`planning.js` `expireAndMeasureTokens`)다 → `partyId = token.id`, `hostId`, `invitedTo.partyId`, `party_attended`를 그 루프에서 emit.
- T2-2 **결과 지표**(임금 부족 실제 완화), T0-4 **리싱크 dedupe·커서 연속성**, G1-4 **resync 프로토콜**(`protocolVersion`, 4비트+RLE
  타일, 왕복 동일성) — 200KB는 인코딩 실측 조건부. C-2 전 기준은 `simId`만. 순서 T1-4 → T1-0. 최종 9점 전 G1-3 **재실행**.
  20k tick/s는 **조건부 목표**(약속 아님). 완료 기준 12건 수치화.

**v7에서 바뀐 것** (Codex 6차 NO-GO 조건 4개 — 전부 *구현 명세*: 산술은 6차에서 "맞다"로 확정):
- **T1-0**: 존재하지 않는 "건설 취소"를 **기존 명령**(`policy`: 세율·복지, `zone`: 주거 지시)으로 교체 — 새 명령을 만들지 않는다.
  굶주림 **N = `starving` 이벤트 ≥ 5건/일이 3일 연속**, 관찰 구간·해제 조건 고정.
- **§0.8 신규 행동·이벤트 계약**을 신설 — T2-2(`protest`·`job_changed`·`side_job`)·T2-4(`host_party`·`attend_party`·`party_attended`)를
  `ACTIONS` **끝에 append**, 후보 조건·지속시간·우선순위·RNG 무소비·직렬화·마이그레이션을 한 표로.
- **C-1을 독립 게이트 G1-0**으로 승격(마이그레이션 + 리플레이/해시 통과가 Tier 1 시작 조건). 현재 `getPendingInputs()`가 내부 DB `id`만
  넘기므로 **`inp.id`를 계속 쓰면 위반**임을 명시하고, 전파 대상 이벤트 10종 전수 검증.
- **T1-4 레지스트리 파일 `logic/goals.json`** + JSON schema + SHA-256(canonical JSON) + **8노드 각각** 성공/실패 fixture.
- **T0-4 해시 정의**: canonical JSON `{tick, ordinal, type, simId, payload}`(키 정렬)의 SHA-256, 스냅샷 포함 최근 이벤트 **N = 60틱**,
  fixture ≥ 500건. **G1-4 oracle**: 증분 결과 == 전면 재빌드(스프라이트 집합 동일 + 픽셀 ΔE 0).
- T0-2 완료를 임시 표기만으로 닫고 C-2 호환은 **별도 게이트 G2-0**으로. T2-3B 카운터를 **(pair, topic)별**로. ΔE는 **CIE76, sRGB→Lab**.
  게이트 표의 "30/30" 잔재 제거. 1,000프레임 = 워밍업 후 **마지막 측정창**, resync p95는 **10회 측정**.

**v6에서 바뀐 것** (Codex 5차 NO-GO 조건 5개 — 구조 지적은 끝났고 산술 1건·명세 4건):
- **Tier 2 산술은 정정하지 않는다** — 문서에 적힌 8개 값의 합은 62.7이고 Codex의 63.3은 어느 항목에도 대응하지 않는다. 대신 8개 값을
  전부 펼쳐 적어 검증 가능하게 했다(§4).
- **T1-4 목표 레지스트리를 지금 코드에서 열거**했다: `sim/logic.js` `L.tiers`(마을→읍 25→시 60→대도시 120) 승급 3 + 기차역 언락
  (`stationDemand` 300, §19.12) 1 + 언락 건물(apartment·factory·mall·university) 4 = **K = 8**. 달성 이벤트·도달 행동·실패 fixture 명시.
- **C-1 lineage**: `applyAssign → sim.state.inputId → action_completed/failed`, `applyZone → zoneOrders[].inputId → projects[].inputId →
  project_started/facility_built`. 완료 기준은 "존재"가 아니라 **`payload.inputId === 제출 UUID`**.
- **G1-4 신설**: T3-3a의 핵심(맵 전면 재빌드·Text 재생성·리싱크 전송)을 Tier 1 전으로. **G1-3 workload 재정의**: 얕은 합성 인구·best-of 폐기,
  실제 138~200명 세계의 스냅샷 fixture, 5회 최악값.
- T0-4에 **비루틴 100% 보존·루틴 집계량 보존**, T0-5에 `NULL_EVENT_TYPES` 18종 열거, `eventText()` **totality 테스트**(전 `EVENT_TYPES` ×
  현재/빈/구형 payload에서 예외 0), T1-0에 **상태 전이**(보상·언락·위기·회복), 나머지 완료 기준 12건 보강.

**v5에서 바뀐 것** (Codex 4차 NO-GO 조건 4개 — 전부 *문서의 내부 모순*과 *아직 없는 계약을 있는 것처럼 쓴 것*의 정정):
- **선행 계약 §0.7을 신설**해 지금 저장소에 **없는** 것을 있는 것처럼 쓰지 않는다: C-1 입력 ID 전파(현재 `getPendingInputs`는
  `id,target_tick,sequence,command,payload`만 시뮬에 넘긴다 — `clientInputId`는 시뮬에 **안 간다**), C-2 불변 이름(현재
  `player_created` payload는 `{name, occupation, homeId}` — 성이 **없다**), C-3 참석자 이벤트.
- **Tier 0 모순 제거**: T0-2·T0-9에서 `sim/`·백엔드 몫을 떼어 각각 Tier 2(C-2)·Tier 1(T1-5)로 옮겼다. Tier 0은 클라 + `server/`만.
- `eventSeq` 전부 **`(tick, ordinal)`**로. WebSocket `seq`는 연결별 값이라 인과 식별자가 될 수 없다.
- T2-3 중복 기준을 **가능한 것**으로: 발화 간격 15틱(`logic.js` `lineInterval`)이라 6시간=24회이므로 "재사용 0"은 불가능 →
  "테이블 길이 L 내 최초 L회 중복 0". 해시 알고리즘·인코딩·모듈러 명시.
- 시뮬 성능 게이트를 **G-1로 이동**(PLAN G6: 인구 200 성장 전 통과). Tier 0과 병행 가능한 별도 트랙.
- 절사 규칙 정정(**소수 첫째 자리 절사**: 8.325→8.3, 8.45→8.4), 부록의 8.48→8.45 모순 제거.
- **최종 9점 검증 프로토콜 §6.5** 신설. 점수는 구현 완료가 아니라 **동일 평가표 재플레이 결과로만** 부여한다.
- 완료 기준 보강(T0-4 창 경계 59/60/61·해시, T0-5 `EVENT_TYPES−NULL`, T0-9 20줄·allowlist·kind≤6, G1-2 p95, T1-1 정답 목록,
  T1-2 allowlist·카운터·fixture, T1-4 레지스트리 hash, T3-1 20회 시험, T3-2 ΔE≥5, T3-3a 벽시계 24h·GC 후).

**v4에서 바뀐 것** (Codex 3차 **조건부 GO**의 조건 5개 + 세부 지적):
- **부재중 리포트 개편(T0-9)** 추가 — 라이브 피드만 고치면 절반이다(§22.11 #5: 74줄 중 61줄이 식사 횟수).
- **시뮬 성능 게이트(T3-3b)** 추가 — §22.27 실측: 인구 200에서 158~278 tick/s, G6 예산 20k의 **70~127배 미달**, 초선형 항 실재.
  렌더만 고쳐서는 성능 9가 안 된다. 성능 목표를 7.5(렌더)/8.5(시뮬 게이트 통과)로 낮췄다.
- **불변 이름·이벤트 인과 계약**: 화자·청자·제3자·사망자·리포트 이름은 이벤트/불변 레지스트리에서; `clientInputId`는 인과 추적 전용(선택·RNG 금지)이고 `action_started`·`project_started`·`policy_changed`·결과 이벤트에 전파.
- **T2-4 fixture 산술 정정**(주최자 5/5, 수락자 ≥14/20), **Tier 3 게이트 정밀도**(계산값 8.3, 절사 규칙 명시).
- 카메라 팔로우 동작 규칙, 입력 실패의 네트워크 경로, 완료 기준 보강(전 항목).

**v3에서 바뀐 것** (Codex 2차 NO-GO 최소 조건 4개 + 세부 지적 전부):
1. **산술을 다시 했다** — v2는 세 군데 틀렸다(7.5/7.8/8.6 → 실제 7.3/7.5/8.2). 아래는 8항목 합/8을 매 단계 적는다.
2. T1/T2의 카드·행동을 **입력 ID로 연결**한다 — `clientInputId`(이미 있음, `client/main.js:1854`)와 적용 tick·eventSeq.
3. T2-2·T2-4에 **실제 결과 전이**를 넣었다(이벤트 1회 발생으로 통과 금지).
4. **심 가독성과 핵심 렌더 병목을 Tier 1 전 게이트(G-1)로** 옮겼다.
5. T0-2는 사용자 지시("성별·이름·MBTI까지만 본인이 선택")를 **바꾸지 않는다** — 표기 일관성만 고치고, 성 입력란은 사용자 결정 사항으로 분리.
6. T0-4 롤업은 **게임 틱 고정 창**으로, T2-3은 **이름을 이벤트 계약에** 싣는 것까지 포함.

## 0. 전제

- "9점" = `docs/REVIEW_RUBRIC.md` 8항목 평균 9/10. 3차(5인) 실측 **5.45/10 (43.6/8), ★2.5, 게임으로서 계속 0/5**.
- 공통 진단: **엔진은 진짜인데 창(상단바·피드·패널)이 거짓말하거나 안 열린다.** 순서: 창 수리 → (가독성·성능 게이트) →
  게임화 → 설명 → 마감. 창이 거짓말하는 동안의 기능은 검증 불가(§22.22 전례).
- 계약: §0.1(지표 조작 금지·행동 추가), 결정성(클라의 모든 선택은 **이벤트/스냅샷에 실린 값만으로**), `sim/` 변경은
  Codex 합의 + 해시·리플레이 테스트, 새 건물 = 5장 에셋, 사용자 지시(온보딩은 성별·이름·MBTI만).
- **인과·이름 계약은 §0.7 선행 계약(C-1·C-2)으로 정의한다 — 지금은 없다.**
- **성능 사실**(§22.27): 인구 10에서 18.2k tick/s, 100에서 1,039, **200에서 158~278** (µs/sim-tick 5.2→31.5, BFS 비중 34%).
  라이브 인구가 138이다. 이 곡선을 두고 성능 9를 말할 수 없다.

## 0.7 선행 계약 — 지금 저장소에 없는 것 (각각 Codex 합의 + 해시·리플레이 테스트)

**C-1 입력 ID 전파 (server + sim)** — 현재: `inputs.client_input_id` 컬럼은 **이미 있고** `addInput()`이 그것으로 중복을 걸러 `{targetTick,
sequence, duplicate: true}`를 돌려준다(`db/storage.js:139-148`). 그러나 `getPendingInputs()`는 `id, target_tick, sequence, command, payload`만
SELECT해 시뮬에 넘기므로(`storage.js:154`) **UUID가 시뮬에 닿지 않는다** — `applyAssign`이 이벤트에 넣는 `inp.id`는 내부 DB id다
(`tick.js:664`). 정의: SELECT에 `client_input_id` 추가 → `advance()` 입력 객체에 `clientInputId` → 수락·거부·결과 이벤트에 `payload.inputId`.
**플레이어 원인 이벤트만 UUID를 싣고, 자동 원인(시장 재정 검토의 `policy_changed`, 자동 건설의 `project_started`, NPC의 `action_*`)은
`inputId: null`** — 같은 이벤트 타입을 공유하므로 이 규칙이 없으면 "동일성 검사"가 성립하지 않는다.
**`startAction()` 경로**: 현재 `sim.state = {...emptyState(), kind, action, …}`로 상태를 통째로 새로 만든다(`tick.js:473-480`) → 미리 `sim.state.inputId`를 두면 사라진다. `startAction(world, sim, cand, inputId = null)`로 **인자 전달**해 그 리터럴에 `inputId`를 넣는다. 거부 경로(`assign_rejected`·`zone_rejected`·stale order 만료)도 같은 UUID를 싣는 전수 테스트.
**금지**: `inputId`는 이벤트 payload 전용이다 — 행동 선택·RNG·타이브레이크·해시 입력에 쓰지 않는다.
**API 응답과 적용 위치**: `/api/input`은 접수 시점에 `{targetTick, sequence}`만 안다. 적용 `(tick, ordinal)`은 **`inputId`를 실은 첫 이벤트**로
클라가 안다 — 카드·타임라인은 그 이벤트를 기다린다(접수 카드 즉시, 적용 표시는 이벤트 도착 시).
**지연 인과(lineage)** — 결과가 나중에 나오는 명령은 ID를 **월드 상태에 보존**해야 한다(현재 `startAction()`은 저장하지 않고
`zoneOrders`도 ID가 없다):
  · `applyAssign` → `sim.state.inputId` 설정 → `startAction`이 `action_started`에, 이후 `action_completed`/`action_failed`에 같은 ID.
  · `applyZone` → `world.zoneOrders[].inputId` → 착공 시 `world.projects[].inputId`(`tick.js:1231`) → `project_started`·`facility_built`.
  · 정책 → `policy_changed`(플레이어 경로) 즉시. `create_player` → `player_created`. 거부 → `input_rejected`.
  `sim.state`·`zoneOrders`·`projects`는 직렬화·해시 대상이므로 **필드 추가는 마이그레이션 + 해시 테스트**를 동반한다.
대상 이벤트(누락 금지): `action_started`·`action_completed`·`action_failed`·`project_started`·`facility_built`·`zoned`·`policy_changed`·
`input_rejected`·`player_created`·`token_created`. **추적 전용** — 선택·RNG·타이브레이크에 쓰지 않는다. 서버는 `client_input_id`로 중복
제거. 인과 식별은 언제나 **`(tick, ordinal)`**.
- 완료: 플레이어 원인 fixture에서 **`payload.inputId === 제출한 UUID`** 10/10(내부 DB `id`가 들어가면 실패), 자동 원인 fixture(시장 정책·
  자동 건설·NPC 행동 각 1건 이상)에서 **`inputId === null`** 전수, **지연 결과**(assign→completed, zone→project_started→facility_built)까지
  같은 UUID 4/4, 같은 UUID 재전송 시 `duplicate: true`이고 적용 1회, 해시 동일.

**C-2 불변 이름 (sim)** — 현재: `player_created` payload는 `{name, occupation, homeId}`로 성이 없고, 서버는 클라 `surname`을
받는다(`sim/tick.js:577`). 정의: ① 이름을 언급하는 모든 이벤트가 emit 시점에 `payload.names = {simId: {surname, name}}`를
싣는다(화자·청자·제3자·사망자 포함), ② `world.nameRegistry`(append-only, 사망해도 삭제 안 함)를 두고 직렬화·스냅샷·해시·
마이그레이션에 포함 — 부재중 리포트와 과거 이벤트 렌더는 여기서 읽는다, ③ `create_player`는 클라 `surname`을 **무시**하고
서버 결정 성만 저장(사용자 지시 유지).
**우선순위 고정**: 렌더는 `payload.names` → `world.nameRegistry[simId]` → (둘 다 없으면, 프루닝된 구이벤트 등) **`#simId` 고정 표기** 순이다. 구형 top-level `name`은 **읽지 않는다**(§0.10과 동일 규칙). 이름을 싣는 타입은 `NAME_BEARING_EVENT_TYPES`로 코드에서 열거— 현재 `EVENT_TYPES`에서 이름을 싣거나 이름으로 렌더되는 타입 열거: `argument·money_shared·job_changed·died·bereaved·grew_up·invited·player_created·conversation·greeting·immigrated·married·child_settled` (구현 시 이 목록을 코드 상수로 옮기고 totality 테스트가 목록 == 렌더에서 이름을 쓰는 타입임을 검사).
- 완료: `NAME_BEARING_EVENT_TYPES` 전부에서 C-2 이후 발생 이벤트 `names` 누락 0, 구이벤트는 registry 조회 또는 `#simId` 표기(미정의 표기 0), 사망·리싱크 후 같은 이벤트 문자열 해시 100/100 동일, **과거 DB
  이벤트 100건 재생 문자열 동일**, 악의적 `surname` 주입 시 무시 10/10.

**C-3 모임 데이터 모델 + 참석자 이벤트 (sim)** — 현재: 토큰은 `{topic: gathering|announce|festival, scheduledTick, placeId}`뿐이고(id·주최 없음,
`planning.js:60`·`tick.js:606`·`society.js:338`), 참석은 `expireAndMeasureTokens`가 **그 시각 그 장소에서 performing 중인 심 수**로 센다
(`planning.js:116`), `invitedTo`는 `{facilityId, untilTick}`(`society.js:1353`)이라 어느 모임인지 모른다. 정의:
① **`partyId = token.tokenId`**(이미 있음: `world.tokenCounter++`, 전역 단조, 파이프라인 순서로 결정적 — 새 카운터를 만들지 않는다),
`token.hostId` **추가**(announce는 입력한 플레이어 심 id, gathering·festival·결혼식 잔치는 `null`; 생성 지점 5곳 전부), ② `sim.invitedTo`에
`partyId` 추가(초대 §22.6에서 설정), ③ `expireAndMeasureTokens`(`planning.js:118`) 집계 루프에서 performing 중인 심마다
`party_attended {partyId, simId, role: hostId === simId ? 'host' : 'guest'}` emit(집계 `count`는 유지).
- **G2-1 (C-3 독립 게이트, T2-4 전)**: 마이그레이션(구세이브 토큰 `hostId: null`, `invitedTo.partyId: null`) 왕복, `hashWorld` 결정성, 리플레이 동일,
  fixture(announce 입력 → §22.6 초대 20명 → scheduledTick) 5회에서 party별 **`Set(simId)`가 실제 참석 심 목록과 일치**, `role` 정확, `count` == Set 크기.

## 0.8 신규 행동·이벤트 계약 (T2-2·T2-4가 쓰는 것, 전부 `sim/` — Codex 합의)

규약은 §21.3과 같다: **`ACTIONS`·`EVENT_TYPES`·`memory.importance`는 끝에 append만**, 기존 원소의 순서·인덱스·타이브레이크·RNG 소비
순서를 바꾸지 않는다(테스트로 고정). 후보 생성은 기존 per-action 게이트 함수(`logic.js`의 `'no_project'` 분기와 같은 자리)에 조건을 더한다.

| 행동/이벤트 | 종류 | 후보 조건 | 지속(틱) | 우선순위 | RNG | 상태·직렬화 |
|---|---|---|---|---|---|---|
| `attend_party` | ACTION | `sim.invitedTo !== null` 이고 `scheduledTick - 120 ≤ t ≤ scheduledTick + 60` | 60 | 기존 점수식 그대로, 급함 = `NEED_MAX - social.deficit`(초대는 사회 욕구 행동) | 소비 0 | `sim.invitedTo`(기존) |
| `host_party` | ACTION | `world.tokens`에 `hostId === sim.id`이고 같은 시간창인 토큰 존재 | 90 | `attend_party`와 동일 식, 주최자 가산 없음 | 소비 0 | `token.hostId`(C-3 신규) |
| `party_attended` | EVENT | **행동 완료가 아니라** `expireAndMeasureTokens` 집계 루프에서, scheduledTick에 그 장소에서 performing 중인 심마다 emit(§0.7 C-3) | — | — | — | payload `{partyId, simId, role}`; 행동을 골랐어도 도착 못 하면 참석 아님 |
| `side_job` | ACTION | 민간 서비스 직, `wageShortfallDays ≥ 3`, **매출 > 0인 다른 민간 시설**에 근무 슬롯 있음 | 기존 `work.duration` | 기존 `work` 식 | 소비 0 | 소득은 기존 `money_changed` |
| `job_changed` | EVENT | 기존 §21.3 전직 경로 재사용 | — | — | — | 기존 |
| `vacancy` | EVENT | `job_changed`로 원 시설 근무 슬롯이 비는 순간 emit | — | — | — | **`EVENT_TYPES` 끝에 append**(저장 계층이 미등록 타입 거부, `constants.js:44`); payload `{facilityId, occupation, before, after, simId, inputId: null}`(자동 원인) |
| `invite_to_party` | (단계, 행동 아님) | announce 토큰 생성 tick에 §22.6 수락 해시(`pairHash(host, target, day, 83)`)로 후보 N명 판정 | — | — | 소비 0 (pairHash) | 수락 시 `invitedTo = {facilityId: token.placeId, untilTick: token.scheduledTick + 60, partyId: token.tokenId}`; 동석 초대(§22.6 기존)는 `partyId: null` 유지 |

- 완료(계약 자체): `ACTIONS`·`EVENT_TYPES` 기존 원소 인덱스 불변 테스트, 신규 필드 마이그레이션 왕복(`deserialize(serialize(w))` 고정점),
  해시·리플레이 동일, `makeSim` 키 집합 4경로 동일(QA 기존 테스트 확장).

## 0.10 신규 상태 필드 계약 (전부 `sim/`; 마이그레이션 `SCHEMA_VERSION` 50→51, `logicSchemaVersion` 45→46)

규약: `deserialize(serialize(w))` 고정점(§22.13 — `undefined` 금지, 명시적 기본값), 심 필드는 **`makeSim`/`emptyState` 단일 창구**(§22.16, 4경로
키 집합 동일 테스트), 마이그레이션은 `if (from < 51)` 블록에서 기본값 주입, 해시 대상 포함, 구버전 세이브는 마이그레이션 후 리플레이 동일.

| 필드 | 소유 | 초기값 | 쓰는 항목 | 비고 |
|---|---|---|---|---|
| `world.goals` | world | `{}` (`{[id]: {doneTick}}`) | T1-0·T1-4 | 달성 이벤트 발생 시에만 기록 |
| `world.goalsHash` | world | `''` | T1-4 | `logic/goals.json` SHA-256 |
| `world.crisis` | world | `null` (`{kind, since}`) | T1-0 | 해제 시 `null` |
| `world.pairTopicSeq` | world | `{}` (`{"a>b:topic:variant": int}` + `"…:reply"`) | T2-3B | variant = `memory_share` kind / `gossip` tier·sentiment / 그 외 `''`; speaker·reply 카운터 분리; emit **직전** +1 |
| `token.hostId` | world.tokens[] | `null` | C-3 | `tokenId`는 기존 필드 그대로 partyId로 사용; 구세이브 토큰은 `null` |
| `world.nameRegistry` | world | `{}` (`{[simId]: {given, surname}}`) | C-2 | append-only; 생성(`player_created`·출생) 시 기록, 사망해도 유지. **구세이브 백필**: 마이그레이션이 현재 `sims` 전원 + DB 이벤트 중 이름 필드를 가진 `player_created`·`died` payload에서 채움. 클라 표기 = `payload.names?.[simId] ?? nameRegistry[simId]`(top-level 이름 fallback은 **폐기**) |
| `sim.invitedTo.partyId` | sim | `null` | C-3 | 기존 `{facilityId, untilTick}` 확장; 동석 초대는 `null`, 모임 초대는 `token.tokenId` |
| `world.map.version` | world.map | `0` | G1-3 | 도로 형성·신축·철거·공공사업마다 +1; BFS·공간 캐시 키 |
| `sim.wageShortfallDays` | sim | `0` | T2-2 | **민간 서비스 직만**(`L.economy.privateWageOccupations`); 그날 `wage_shortfall`(source: facility) 있으면 +1, 전액 지급된 날 0, 전직 시 0 |
| `sim.state.inputId` | sim.state | `null` | C-1 | `emptyState()`에 추가 |
| `zoneOrders[].inputId` | world | `null` | C-1 | `applyZone`에서 설정 |
| `projects[].inputId` | world | `null` | C-1 | 착공 시 order에서 복사, 자동 건설은 `null` |

- 완료: 마이그레이션 왕복 테스트(구세이브 fixture 3종), `makeSim` 4경로 키 집합 동일, `hashWorld` 결정성, 리플레이 동일.

## 0.9 Tier 1 진입 게이트 G1-0 = C-1 완료

C-1은 "T1-0의 선행"이 아니라 **독립 게이트**다. 현재 `getPendingInputs()`가 UUID가 아니라 내부 DB `id`만 넘기므로, 구현이 `inp.id`를
계속 쓰면 **§0.1 인과 계약 위반**이다 — 완료 기준은 `payload.inputId === 제출 UUID`이지 "값 존재"가 아니다.
- 완료: `inputs.client_input_id` 마이그레이션, 전파 대상 **10종 전수**(`action_started`·`action_completed`·`action_failed`·`project_started`·
  `facility_built`·`zoned`·`policy_changed`·`input_rejected`·`player_created`·`token_created`)에서 UUID 동일 10/10, 지연 lineage 4/4,
  리플레이·해시 동일 → 통과해야 Tier 1 착수.

## 0.5 사전 게이트

**G-0 테스터 도구** — 3차 5인 전원 마우스 좌표 4.46~8.75배 어긋남.
- 완료: 조작 대상 **M = 28**, 목록 고정: 심 스프라이트 5(화면 내 id 오름차순 앞 5명) · 📣 1 · 🏛️ 1 · 건설 메뉴 열기 1 · 구역 타입 항목 8(`L.tiers` 시설 종류) · 배속 4 · 모달 확인/취소 2 · 패널 닫기 3(심·시장·리포트) · 시장 패널 정책 조작 3 = 28.
  UI가 늘면 목록·M을 이 문서에서 갱신하고 커밋. → **28 × 3해상도(1000/1400/1920) × 2 DPR × 3회 무작위 순서 = 504회** 전수 실제 `computer` 클릭, 명중 100%·오클릭 0. 미충족 시 재검증 결과 불채택.

## 1. 항목별 갭 (실측 → 목표 9)

| 항목 | 현재 | 갭의 정체 |
|---|---|---|
| 재미 4.2 | 레버 없음 · 따라갈 인물 없음 · **행동→결과→다음 목표 루프 없음** |
| 안정성 5.0 | 확인 3건 + 피드 도배 + undefined + 적자 무설명 + 패널 널 참조 + `assign` 응답 무시 |
| 이해도 4.8 | 첫 화면 안내 0줄 |
| 조작·UI 4.8 | 패널·버튼 겹침·상단바 거짓 |
| 그럴듯함 5.4 | 적자 무설명 · 모임 0명 · 대화 반복 |
| 보는 재미 6.0 | 심 5~25px 점 — §22.36을 아무도 못 봄 |
| 성능 6.0 | §22.10 미해결 병목 5건 + 계측 부재 |
| 문서 7.4 | PORT · 첫 화면 · 부재중 리포트 |

## 2. Tier 0: 거짓말 멈추기 — **`sim/` 변경 없음**

**T0-1 상단바 라이브 갱신** — `client/main.js` tickBatch 분기가 `updateStats()`를 안 부른다(snapshot 분기만). confirmed(3인).
- 완료: tickBatch 10회 주입 시 `#stats`의 **모든 동적 값**(인구·커플 수·결혼 수·**시장 이름**·국고 — `updateStats()`의 실제 항목)이 매번 `world`와 일치.

**T0-2 이름 표기 일관성 — Tier 0 몫만 (server + client)** — `player_created` 피드(`main.js:1726`)는 원본 이름, 그 외는
`simName`(성+이름) → 혼재(4인). **성 입력란은 추가하지 않는다**(사용자 지시 유지).
(a) **`server/index.js`의 `create_player` 입력 정제**: payload의 `surname`을 **제거**하고 넘긴다(시뮬은 그대로 `surnameFor()`) —
    `sim/` 변경 없이 계약을 지키는 실체,
(b) 클라는 `player_created`를 렌더할 때 **스냅샷의 해당 심**에서 성을 읽어 `simName`과 같은 표기 — C-2 전까지의 임시 처리이며
    C-2가 오면 `payload.names`로 교체,
(c) 온보딩 완료 화면에 "마을 성씨 분포에서 **김**씨가 뽑혔습니다" 1줄. 성 선택 입력란은 **사용자 결정 사항**으로 별도 표기.
이벤트 스키마에 성을 싣는 것(`sim/tick.js`)은 **C-2(Tier 2)**다.
- 완료(Tier 0): 입력 10건·공란·구세이브·악의적 `surname` 주입 각 10건에서 피드·패널·이름표 표시 전부 동일, 주입은 서버가 제거, 미등록 토큰 0. **C-2 전에는 사망·리싱크 후 문자열 동일성을 주장하지 않는다**(현재 `simName()`이 월드를 조회한다). 임시 표기 ↔ `payload.names` 표기의 일치는 **G2-0**(C-2 완료 게이트)에서 검사.

**T0-3 상단바 레이아웃** — `client/index.html:15-17` `#clock` `position:absolute` → in-flow, 2단, 1000px 규칙.
- 완료: 3개 폭(**1000/1400/1920px**)에서 `elementFromPoint(버튼 중앙)` === 그 버튼(주 기준); 1000px에서 상단바 높이 ≤ 2줄(88px), `overflow` 잘림 요소 0, 비활성 버튼은 `disabled` + opacity 0.5로 상태 구분; 스냅샷은 보조.

**T0-4 피드 신호/잡음 분리 (클라 전용, 고정 틱 창)** — 전원 불만 1순위. **시뮬 원인 아님**: 테스터 DB 3개(Day 0·2·11)
construct 575쌍의 시작→완료 차이 **최소 60·중앙 60·같은 틱 0** (`sim/logic.js` `duration: 60`). 배속 배치에 두 이벤트가
함께 실려 붙어 보이고 60틱=1시간이라 매시 같은 분에 반복 — 표시 착시.
제안: *사건*(결혼·출생·사망·굶주림·파산·선거·완공·정책·모임)은 개별, *루틴*(work·sleep·eat·construct started/completed)은
**게임 틱 고정 창(60틱)**으로 롤업 — WebSocket 배치 경계로 집계하면 접속 시점·배속·리싱크마다 표시가 달라진다(결정성).
원본 스트림 보존, "루틴 보기" 토글.
집계 키는 **`(tick, ordinal)`**이며 집계 상태를 WebSocket 배치 경계에 두지 않는다. **리싱크 복원**: 현재 리싱크는 새 스냅샷만
보낸다(`server/index.js:247`) → 스냅샷에 **최근 N틱의 이벤트를 포함**(`server/`, sim 변경 아님)하고 롤업 상태를 그 이벤트에서
**순수 함수로 재계산**한다(클라 로컬 상태에 의존 금지).
창 기준점: `floor(tick / 60) * 60` (게임 정시). "루틴 ≤ 30%"는 비루틴을 숨겨도 통과할 수 있으므로 **보존 조건이 함께 있어야 한다**.
**해시 정의**: 이벤트 하나 = canonical JSON `{tick, ordinal, type, simId, payload}`(키 정렬, 공백 없음, UTF-8) — **payload까지 보존**한다;
멀티셋 해시 = 각 이벤트 SHA-256을 `(tick, ordinal)` 순으로 이어 붙인 SHA-256. 스냅샷에 포함하는 최근 이벤트 = **`[worldTick−59, worldTick]`**
(N = 60틱). 사건 allowlist = T1-2의 allowlist와 동일 목록. fixture ≥ 500 이벤트(루틴·비루틴 혼합, 창 경계 걸침 포함).
**리싱크 커서 프로토콜**(현재 스냅샷엔 이벤트가 없고 `seq`만 있다, `server/index.js:243-275`; 미커밋 이벤트는 `engine.pendingEvents`에 최대 30틱 머문다, `engine.js:39,138`): 스냅샷 직전 **`engine.flushLive()` 호출 → 같은 동기 구간에서 DB 이벤트 읽기 → 스냅샷 전송**(Node 단일 스레드 + better-sqlite3 동기라 그 사이 틱이 끼지 않는다). 메시지 필드 추가 —
snapshot: `events: [{tick, ordinal, type, simId, payload}]`(범위 `[worldTick−59, worldTick]`), `cursor: {tick, ordinal}`(포함된 마지막 이벤트,
없으면 `{tick: worldTick, ordinal: -1}`); tickBatch: `prevCursor`(이 배치 직전 커서), `cursor`(이 배치 마지막). 클라: 피드는 `Map` 키
`` `${tick}:${ordinal}` ``, 스냅샷 이벤트와 기존 피드는 **키 합집합**, 같은 키에 내용이 다르면 **스냅샷 값으로 교체하고 `console.error`**(테스트에선
실패); tickBatch의 `prevCursor`가 자기 커서와 다르면 **갭 경고 + 리싱크 요청**. 테스트: 5개 오프셋(창 시작·중간·끝·경계 전후)에서 재접속 →
중복 0·누락 0·충돌 0·갭 경고 0.
- 완료: 토글 끔에서 표시 줄 중 루틴 ≤ 30%(분모 = 표시 줄) **그리고** 비루틴 이벤트 표시 **100% 보존** **그리고** 롤업 줄의 집계 수 합 ==
  원본 루틴 이벤트 수; 원본 `(tick, ordinal)` 멀티셋 해시와 복원 해시가 창 경계 59/60/61틱·리싱크·재접속에서 동일(누락·중복 0).

**T0-5 내부 표기 우리말화 + 커버리지 테스트** — `OCC_KO` 5종·폴백 없음, `treasury_short`·`plot_used`·`[근무✗시간 아님]`.
`NULL_EVENT_TYPES`(simId 없이 emit되는 18종, 코드에서 열거): `city_promoted facility_built festival fire_out fire_started gathering
input_rejected item_spawned logic_changed new_year petition policy_changed project_started public_revenue_remitted station_unlocked
token_created weather_changed zoned`.
- 완료: `EVENT_TYPES − NULL_EVENT_TYPES` 전부에서 폴백 사용 **0회**(테스트), 16직업·모든 enum 커버리지 100%, 피드 스네이크케이스 0.
- **totality 테스트**(안정성 조건): `eventText()`·`conversationLine()`·`replyLine()`을 **전 `EVENT_TYPES` × {현재 payload, 빈 payload `{}`,
  라이브 DB에서 뽑은 구형 payload 100건}**에 대해 실행해 예외 0 — 커버리지는 폴백 검사이고 이것은 안 죽는다는 검사다(§22.37 부류).

**T0-6 적자를 말하게** — `treasury_debt`·`wage_shortfall`·`insolvent`가 emit되는데 미렌더(§22.37 부류).
- 완료: `before ≥ 0 && after < 0` 경계에서 피드 정확히 1회 + 상단바 음수 경고.

**T0-7 입력 응답을 모달·패널에** — 건설 모달이 '착공합니다'를 먼저 띄움; **`assign`은 `res.json()`을 받고 버린다**
(`main.js:1852-1855`, 서버 `index.js:213`의 거부 분기 있음). 접수/거부를 즉시 표시.
**네트워크 경로**(Codex 지적): HTTP 4xx뿐 아니라 timeout·5xx·JSON 파싱 실패·중복 클릭을 표시한다. 재전송 정책: timeout에 한해
같은 `clientInputId`로 최대 1회 재전송(서버가 ID로 중복 제거), 그 외는 표시만. 중복 클릭은 응답 전 버튼 비활성.
- 완료: 명령 4종(assign·zone·policy·announce) × 실패 유형 4종(timeout **10초**·5xx·파싱 실패·중복 클릭) **각 30회**(모집단 480회) — 사용자에게 표시 100%, 상태 이중 적용 0; **응답만 유실된 케이스**(서버는 적용, 클라는 timeout): 같은 UUID 재전송 → `duplicate: true` 수신 → "적용됨"으로 표시(30/30); 고정 서버 응답 p95 ≤ 500ms(480회 기준), 시뮬 거부 2틱 이내, 거부 시 모달 유지.

**T0-8 패널 널 참조** — `renderPanel()`이 `find()` 결과를 검사 없이 `sim.name`으로 읽음. 선택 심 사망·이민·리싱크 시 예외.
- 완료: 대상 소멸 시 패널 닫힘 + 안내 1줄; 선택 후 sims에서 제거하고 100틱 렌더 예외 0.

**T0-9 부재중 리포트 — Tier 0 몫(클라 표시)** — `showReport()`(`client/main.js`)는 식사·근무 집계와 `lonely` 도배다(74줄 중 61줄
식사, highlights 50칸 중 48칸 `lonely`). **백엔드 한계가 먼저 있다**: `Storage.getReport()`(`db/storage.js:212-222`)의 highlights는
12종·`LIMIT 50`이고 `died`·`policy_changed`·`public_works`·`city_promoted`·`treasury_debt`가 **빠져 있다** → 그 확장은 **T1-5**.
Tier 0에서는 지금 오는 데이터로: 식사·근무 집계 접힘, highlights kind별 상한, 사건 우선 정렬.
- 완료: fixture = 커밋된 `test/fixtures/report-day.json`(seed·시작 tick 고정, 사건 ≥ 30건, 기대 원자료 count 동봉) — 20줄 미만은 fixture 오류로 실패; **상위 20줄 = 본문 사건 줄**(헤더·소개문·접힌 집계줄 제외), 사건 allowlist 고정, 같은 kind ≤ 6줄; 접힘·상한은 표시만 — **kind별 원본 사건 수 보존**(리포트 원자료의 kind별 카운트 == DB kind별 카운트); C-2 전에는 이름 문자열이 아니라 **`simId`로만** 검사.

**Tier 0 산술**: 재미 5.0 · 안정 7.5 · 이해 5.8 · UI 7.0 · 그럴듯 6.9 · 보는 6.0 · 성능 6.0 · 문서 7.4 = **51.6/8 = 6.45**. 게이트 ★3.3.

## 2.5 G-1: Tier 1 전 게이트 — 가독성·성능

*이유(Codex): 심이 5~25px 점이고 9.9ms/frame이 상수로 나가는 상태에서 "따라가기"와 재미를 재면 창이 다시 거짓말한다.*

**G1-1 심 가독성** — `client/main.js` 카메라 기본 줌·`body.setScale(38/height)`·이름표 폰트. 기본 줌에서 심 실제 높이와 이름표
최소 픽셀을 수치로 고정.
- 완료: 기본 줌에서 심 높이 ≥ 48px, 이름표 ≥ 11px; **고정 fixture(성별·나이대 라벨 있는 심 20명) 블라인드 판정 — 개인별 정답률 ≥ 80%**를 5명 중 4명 이상이 충족; fixture는 회차마다 **seed를 바꿔 20명을 새로 뽑는다**(암기 방지).

**G1-2 mapLayer 최소 수정** — §22.10 #2: 22,027 다각형 매 프레임 재래스터화(9.9ms, 가시 2.9%) → 뷰포트 컬링/청크 캐시.
- 완료: 고정 하드웨어·**브라우저 버전·DPR 2**·CPU 유휴(다른 부하 없음)·뷰포트 1440×900·**커밋된 fixture `test/fixtures/render-pop100.json`**(seed·tick·sha256 기록)·워밍업 5분 후 **마지막 1,000프레임 p95** mapLayer 비용 ≤ 2ms(평균 아님, 계측 스크립트 첨부).

**G1-3 시뮬 성능 게이트 (sim, Tier 0과 병행하는 별도 트랙)** — v4의 T3-3b를 여기로 옮겼다. PLAN G6은 인구 200 성장 **전에**
성능 게이트를 통과시키게 돼 있고 라이브 인구가 138이다. §22.27: 인구 200에서 158~278 tick/s(예산 20k의 70~127배 미달),
µs/sim-tick 5.2→31.5의 초선형 항, BFS 34%. 원인은 기록돼 있다 — 결정당 시설 수 비례 후보 스캔(`collectCandidates`, §17.21)과
행동 시작당 1회 BFS. 제안: 후보 스캔 공간 인덱스/근접 캐시, 맵 불변 구간 BFS 결과 캐시. **캐시는 같은 입력에 같은 출력만**(결정성).
**workload 재정의**(Codex 지적): 현재 `bench/popscale.js`는 얕은 합성 인구·best-of-2라 실제 세계를 대표하지 않는다. fixture는 **실제
138~200명 세계의 스냅샷**(라이브 DB 복사, 기억·관계·프로젝트·상호작용 포함)으로 고정하고, best-of를 폐기해 **5회 중 최악값**을 쓴다.
- **캐시 무효화 계약**: BFS·공간 인덱스 캐시는 `world.map.version`(정수, 도로 형성·시설 신축·철거·공공사업마다 +1; §0.10 표에 추가, 초기 0)을 키로 하고 버전이 다르면 폐기. 테스트: 캐시 on/off 리플레이 해시 동일(도로 형성·신축·공공사업 각 1회 포함), 적중/미적중 카운터 기록.
- 완료: fixture = **커밋된 파일 `test/fixtures/perf-pop200.json`**(헤드리스 seed 실행으로 1회 생성: `{seed, worldTick, population: 200, sha256, manifest: {memories, relations, projects, facilities, interactionsLastDay}}`를
  파일 헤더와 이 문서에 기록(manifest가 실제 workload임을 보인다 — 라이브 인구 200 시점 관측치와 ±20% 이내); 재생성은 커밋 메시지에 사유 명시) — 라이브 DB 의존 없음; Node 버전·CPU 유휴 상태 기록,
  워밍업 1일·측정 3일, **5회 최악 ≥ 2,000 tick/s(10배)**, 해시·리플레이 동일. 통과 시 성능 8.5 인정. **20,000 tick/s는 조건부 목표**다 — 인구 10의
  현재 값(18,179)보다 높고 제안된 캐시만으로 도달할 근거가 없으므로 약속하지 않는다; 성능 9는 이 조건이 충족될 때만이다.

**G1-4 렌더·전송 핵심 병목 (Tier 1 전, client + server)** — T3-3a에서 앞당김. 플레이테스트를 다시 왜곡하는 항목만: §22.10 #3 타일
1칸 변경 → 전면 재빌드(2,218 스프라이트 + 61 Text/6초) → **증분 갱신**, Text 재생성(261/4초) → **캐시**, resync 0.85MB/4~5초와
스냅샷 map 542KB(#4) → **증분 + 팔레트 인코딩**. 나머지(#5 스프라이트 70.5MB)는 T3-3a에 남긴다.
**resync 프로토콜 계약**: 스냅샷에 `protocolVersion`(정수, 불일치 시 클라가 전체 리로드), 타일은 **4비트 팔레트(12값) + 런렝스**로 인코딩해
base64(현재 map 542KB의 90%가 타일, 그중 90%가 바탕 0이라 RLE 효과가 크다 — 단 실측 전엔 크기를 약속하지 않는다), 클라 디코더는 왕복
동일성 테스트(`decode(encode(tiles)) === tiles`), 나머지 상태는 기존 JSON.
- 완료: 배속 ×48·인구 100에서 30분간 전면 재빌드 0회, Text 생성 수 ≤ 변경 심 수; resync 페이로드: 4비트+RLE 전체 스냅샷이 **p95 ≤ 200KB**를
  못 넘기면 델타 리싱크(마지막 커서 이후 변경분)로 대체하되, **어느 경로든 payload p95 ≤ 200KB·왕복 p95 ≤ 500ms·10회 측정**이 합격 기준; map/state 왕복 동일 100%, 이벤트 커서 연속(T0-4), `protocolVersion`
  불일치 케이스 리로드 1/1; p95 프레임 < 16.7ms(워밍업 후 **마지막 1,000프레임 창**). **oracle**: 증분 갱신 결과가 같은 상태의 전면 재빌드와
  동일 — 스프라이트 집합(키·좌표·깊이) 동일 + 두 캔버스 픽셀 ΔE(CIE76) 최대 0.

**G-1 산술**: 보는 6.0→7.5, 성능 6.0→7.0(G1-2) → **54.1/8 = 6.76**. G1-3 통과 시 성능 8.5(+1.5)는 Tier 3 산술에서 반영.

## 3. Tier 1: 게임이 되게 하기

**T1-0 핵심 루프 (게이트) — 선행: G1-0(C-1), 그리고 T1-4(목표 트리)가 먼저다.** **카드 영속성**: 카드는 클라 메모리가 아니라 **DB 이벤트에서 재구성**한다 — `GET /api/inputs/:uuid/events`(그 UUID를 `payload.inputId`로 가진 이벤트 전부 + 관찰창 통계), 재접속 시 최근 입력 10건의 카드를 이 API로 복원(테스트: 재접속 후 카드 문자열 동일 10/10). 루프: 행동(정책·건설·심 지시, 각각 `clientInputId`) →
접수 응답 `{targetTick, sequence}` → **`inputId`를 실은 첫 이벤트**로 `applyTick=(tick, ordinal)` 확정 → 결과 카드 → 다음 목표(T1-4 노드).
**인과 판정 규칙**: 카드의 관찰창은 **`[applyTick, applyTick + 4320]`**, 내용은 창 시작 값 vs 창 끝 값의 **전후 비교**다. 카드는 인과를
증명한다고 주장하지 않는다(§0.1 — "이 행동 덕분"이 아니라 "이 행동 이후 3일간"). 같은 창 안에 다른 플레이어 입력이 있으면 카드에
**겹침 표시**(그 `inputId` 목록). 자동 원인 이벤트(시장 재정 검토 등)는 카드를 만들지 않고 피드에만 나온다. 성공/실패:
- 성공: 목표 트리 노드 달성(T1-4) → 카드(입력 ID·적용 tick·실측값 표기) + 다음 노드.
- 실패(위기): 국고가 **3일(4320틱) 연속 음수** 또는 **굶주림: 3일 창에서 전 심 `Σ hungerZeroTicks` 증가분 ≥ 1440**(= 심 1명이 하루 종일 굶은 양; `starving` 건수는 진입 전이라 지표로 쓰지 않는다 — `tick.js:1051` 주석) → `world.crisis = {kind, since}` + "위기" 카드 +
  회복 행동 3개 — **전부 기존 명령**: `policy`(세율↑), `policy`(복지 기준↓), `zone`(주거 지시). "건설 취소"는 명령이 없으므로 쓰지 않는다.
  관찰 구간 = 위기 진입 tick부터; 창은 **day 경계 비중첩**(§22 `day` 단위, 슬라이딩 아님); 해제 = 국고 ≥ 0 **비중첩 3일 연속** 또는 일별 `Σ hungerZeroTicks` 증가분 < 480 **3일 연속**. fixture: 국고 음수 5/5 **+ 굶주림(식료품 공급 0) 5/5**, 각각 진입·해제 tick 결정적.
- 단순 지표 상승은 성공으로 인정하지 않는다 — 카드는 반드시 입력 ID를 참조한다(§0.1).
**상태 전이**(§0.1 "행동 추가" — 카드만 붙이면 루프처럼 보이는 UI다): 성공 = 목표 노드의 달성 이벤트(`city_promoted`·`station_unlocked`·
`facility_built`)가 실제로 발생 → `world.goals[node].doneTick = tick` 기록 + 다음 노드 활성(보상은 곧 언락이다 — 이미 있는 §18 승급 언락을
그대로 쓴다). 실패 = 위기 조건 충족 → `world.crisis = {kind, since}` → 회복 행동 3개 제시 → 회복 이벤트(국고 ≥ 0 3일 유지 등)로 해제.
- 완료: 고정 시나리오 3개(`assign`·`policy`·`zone`) × **seed 5개**에서 입력 ID·적용 tick·ordinal·결과 카드 **1:1**(15/15); 성공 fixture
  (인구 25 도달 → 읍 승급 → 카드 → 다음 노드 활성) 5/5, 실패 fixture(국고 3일 음수 → 위기 → 회복 행동 → 해제) 5/5; 30분 플레이에서
  서로 다른 `clientInputId` 3/3 연결. **게이트: 재검증 "게임으로서 계속" ≥ 4/5, 2회 연속.**

**T1-1 첫 3줄 + 첫 목표 카드** — 완료: 정답 목록 고정(역할 = "시장", 첫 행동 ∈ {세율 조정, 복지 조정, 건설 지시}); **무도움 조건**(진행자 개입 0)에서 5명 중 4명 이상이 30초 내 정답, 첫 행동 전 카드 유지, `localStorage` 재표시 억제.

**T1-2 한 명 따라가기 — 두 부분으로 분리** — (a) **카메라·타임라인(Tier 1)**: G-0 통과 후 클릭 판정 확정. 상세 투영(최근 기억 N건·
관계 변화·`action_started.reason.chain`)은 **선택된 심에 대해서만** 요청형/이벤트형 — 전 심 투영에 넣으면 §22.8 전송 최적화를 되돌린다.
순서 계약은 **`(tick, 이벤트 ordinal)`**. 카메라 규칙: 고정/해제 토글, 대상 사망·이민 시 **해제 + 안내 1줄**, 리싱크 시 대상 id가 살아
있으면 **유지**, 없으면 해제. **추적 이탈 정의**: 대상과 카메라 중심 거리 > 3타일인 프레임 수.
(b) **이름 표시(C-2 이후)**: 타임라인 문자열의 이름은 `payload.names`에서 — C-2 전에는 (a)만 검증한다.
- 완료(a): **비루틴 사건 allowlist** 고정(결혼·출생·사망·굶주림·파산·선거·완공·정책·모임·전직·발병·쾌유), 팔로우 5분간 **팔로우된 `simId`의**
  allowlist 사건 ≥ 5건, `(tick, ordinal)` 순서 보존, 이탈 프레임 0, **고정 fixture**(사망·이민·리싱크 유지·리싱크 해제) 4/4.

**T1-3 레버의 인과** — 정책 변경(`clientInputId`)당 **접수 카드(즉시) 1장 + 결과 카드(`t+4320`) 1장**을 분리한다(접수 표시까지 막지 않는다). 결과 카드는 변경 전/후 값 + 구간 실측.
- 완료: 정책 6회 연속(리싱크 포함) 접수 6/6·결과 6/6, 결과 카드 조기 표시 0; 각 결과 카드의 창은 자기 `applyTick` 기준 `[applyTick, applyTick+4320]`이며 **겹치는 다른 입력 ID를 표시**(6회가 겹치면 6장 모두 겹침 표시); 자동 원인 `policy_changed`(시장 재정 검토)는 카드 0장.

**T1-4 목표 트리 — 레지스트리를 지금 코드에서 열거한다 (K = 8)** — 승급 로직·언락 조건은 손대지 않는다(창발 유지). 커밋 시점에
레지스트리 JSON의 hash를 기록한다.

| # | 노드 | 출처 | 목표값 | 달성 이벤트 | 도달 행동(플레이어) |
|---|---|---|---|---|---|
| 1 | 읍 승급 | `L.tiers[1]` popMin 25 | 인구 ≥ 25 | `city_promoted` to=1 | 복지·세율로 굶주림↓ → 이민 파동(§18.T4) |
| 2 | 시 승급 | `L.tiers[2]` popMin 60 | 인구 ≥ 60 | `city_promoted` to=2 | 주거 확보(아파트 건설) |
| 3 | 대도시 승급 | `L.tiers[3]` popMin 120 | 인구 ≥ 120 | `city_promoted` to=3 | 공장·상가로 고용 |
| 4 | 기차역 언락 | `transport.stationDemand` 300 | Σ 장거리 수요 ≥ 300 | `station_unlocked` | 공공사업 도로·자가용 보급 |
| 5 | 아파트 첫 완공 | tier 1 unlocks | 1채 | `facility_built` type=apartment | zone 지시 |
| 6 | 공장 첫 완공 | tier 2 unlocks | 1채 | `facility_built` type=factory | zone 지시 |
| 7 | 상가 첫 완공 | tier 2 unlocks | 1채 | `facility_built` type=mall | zone 지시 |
| 8 | 대학 첫 완공 | tier 3 unlocks | 1채 | `facility_built` type=university | zone 지시 |

**레지스트리**: `logic/goals.json` — `params.json`과 같은 검증기 경로(T-14/T-16 부류 테스트: 배포 파일이 스키마를 통과). 스키마:
`{ id, nameKo, source: {kind: 'tier'|'station'|'facility', ref}, target: {metric, op, value}, doneEvent: {type, match}, hint }[]`.
**스키마 세부**: `id`는 유일(테스트), 배열 순서 = 표시 순서, `doneEvent.match`는 `{type: string, payload: {필드: 값}}`의 **동등 비교**(예:
`{type:'city_promoted', payload:{to:1}}`, `{type:'facility_built', payload:{type:'apartment'}}`), `target.op ∈ {'>=','=='}`.
**hash**: canonical JSON(키 정렬·공백 없음) SHA-256, 커밋 메시지와 `world.goalsHash`에 기록 — 레지스트리가 바뀌면 해시가 바뀌어 리플레이가
그 시점을 안다.
- 완료: 8/8 렌더, 각 노드에 현재값·목표값·상태·도달 행동; **8노드 각각** 성공 fixture(해당 전이 이벤트를 만드는 세계) 8/8 · 실패 fixture
  (미달 세계에서 미달성·힌트) 8/8; 달성 판정은 **실제 전이 이벤트**로; `goals.json` 스키마 테스트 통과.

**T1-5 부재중 리포트 백엔드 (`db/storage.js`, sim 변경 아님)** — T0-9의 나머지 반. `getReport()` highlights allowlist를 사건 전체로
확장(`died`·`policy_changed`·`public_works`·`city_promoted`·`treasury_debt`·`party_*` 추가), kind별 상한을 쿼리에서, **당신의 행동→결과**
섹션은 C-1의 `inputId`로 조인(C-1 전에는 `input_rejected`·정책 이벤트만).
- 완료: 상위 20줄 중 사건 ≥ 60%, 단일 kind ≤ 6줄, 플레이어 입력이 있었으면 행동→결과 섹션 존재(**`inputId` 보존**); 20줄 미만은 미검증; 원본 사건 수 보존.

**Tier 1 산술**: 재미 8.0 · 안정 7.5 · 이해 8.3 · UI 8.0 · 그럴듯 7.4 · 보는 7.5 · 성능 7.0 · 문서 7.4 = **61.1/8 = 7.64**. 게이트 ★4.0 + 게임으로서 계속 ≥3/5.

## 4. Tier 2: 세계가 설명되게 (`sim/` 변경은 각각 Codex 합의)

**T2-1 판단 사유 노출** — `action_started.payload.reason.chain`이 이미 있다. 패널에 문장으로.
- 완료: 사유 토큰 allowlist = `logic/reason-tokens.json`(현재 `reason.chain`에 등장하는 토큰 전수 열거, SHA-256을 문서·커밋에 기록; 새 토큰은 파일 추가 + hash 갱신), `action_started` 1,000건에서 목록 밖 토큰 0·미표시 0.

**T2-2 임금 못 받는 가게 노동자 — 행동과 *결과*** — 사실: 공공 임금은 §22.23으로 전액 보장(국고 음수 허용)이고, `wage_shortfall`은
**민간 서비스 직(barista·chef·clerk)이 매출 없는 시설에서 일할 때만** 난다(`tick.js:950-970`, `source: 'facility'`). 이 로직은 **바꾸지 않는다**
(공공 임금을 깎아 `wage_shortfall`을 만들면 사용자 지시 위반). 문제는 "손님 없는 가게의 직원이 무한히 무급으로 출근한다"이다.
전이: `wageShortfallDays ≥ 3` → `job_changed`(공석 있는 다른 직업·시설로 전직 → `vacancy` 이벤트) / `side_job`(매출 있는 다른 시설에서 근무
슬롯 → 소득). 선택은 기존 ACTIONS 점수식(§0.8), 우선순위 append. **시설 매출·국고 직접 증액 금지.**
**결과 지표(원래 문제가 완화됐는가)**: 행동이 났다는 것만으로는 부족하다.
- 완료: **N = 3일(4320틱) 고정**; fixture = 매출 0인 카페·식당에 배치된 민간 서비스 직 10명, **통제군 = 같은 seed에서 신규 행동만 비활성**(완화 지표는 통제군 대비로 계산하고 각 개선은 그 심의 `job_changed`/`side_job` 이벤트에 귀속) → 1440틱 내 행동 10/10, 7일 내 **심별 결과 이벤트
  정확히 1회** 10/10; 상태 델타 — `job_changed`면 원 시설 공석 +1(`vacancy` 이벤트 신규, §0.8 규약), `side_job`이면 소득 ≥
  **0.5 × 일 임금**(`wageBase × wagePct/100`; 1원은 통과 아님); **완화 지표**: 7일 창에서 해당 10명의 `wage_shortfall` 건수 ≥ **30% 감소**
  **또는** 심별 잔액 델타 ≥ 1일 임금; `wageShortfallDays` 규칙 테스트(가산·리셋·전직 시 0); 직접 국고 증액 0; 해시·리플레이 통과.

**T2-3 대화 반복 억제 — 결정성 보존** — 로컬 캐시 폐기.
- A(클라, 무상태): 선택 인덱스를 `(tick, speakerId, listenerId)` 해시로 — 상관만 끊는다.
- B(sim): 월드 상태에 **`(speaker→listener, topic)`별** 카운터 `pairTopicSeq`를 두고(주제가 섞이면 pair 단위 카운터로는 "주제 내 최초 L회"를 보장 못 한다) 직렬화·스냅샷·해시·리플레이·마이그레이션에 포함, 페이로드에 실어 클라가 `seq mod L_topic`으로 고른다.
- **공통(선행: C-2)**: `conversationLine()`·`replyLine()`의 **화자·청자·제3자 이름 전부**를 `payload.names`에서 읽는다(현재는
  `simName()` 현재 월드 조회 — 사망·리싱크 뒤 문자열이 달라진다). A 방식은 로컬 캐시가 선택에 영향을 주지 않을 때만 결정적이다.
- **해시 명세(A)**: FNV-1a 32비트, 입력은 UTF-8 `${tick}|${speakerId}|${listenerId}`, 인덱스 = `h mod L`(L = 그 문장 표 길이).
- **중복 기준 정정**: 발화 간격이 15틱(`sim/logic.js` `conversation.lineInterval`)이라 6시간 = 24회이고 표는 3~7줄이다 — "6시간 내
  재사용 0"은 **불가능**하다. 기준: **같은 쌍·같은 주제에서 테이블 길이 L 내 최초 L회는 중복 0**(B는 `pairSeq mod L` 라운드로빈으로
  보장, A는 통계적 감소만 — A의 완료 기준은 "연속 2회 동일 문장 ≤ 5%").
- **채택: B**(A는 B 전 임시 폴백). `pairTopicSeq` 키 `"speakerId>listenerId:topic:variant"`(variant = `memory_share` kind / `gossip` tier·sentiment / 그 외 `''`), reply는 `"…:reply"` 별도 카운터, 초기 0, **conversation 이벤트 emit 직전 +1**, payload에 **`{speakerSeq, replySeq}`** 실음(`conversation` payload 확장, 둘 다 정수), 클라 인덱스 = `speakerSeq mod L_speaker`, 응답 = `replySeq mod L_reply`(현재 `replyLine()`은 `t`로 고른다, `main.js:1339` → 교체); variant별 표본 = 라이브 DB에서 variant마다 ≥ 200쌍(L = 그 주제·kind 표 길이, 표 길이는 배열 추가로만 늘어남 §22.12). A의 reply 규칙: 같은 해시에 salt `|reply`. **표본**(A 검사용): 라이브 DB 같은 쌍 연속 대화 1,000쌍, 분모 = 쌍 수, "연속 동일" = 직전 발화와 문자열 동일.
- 완료: 동일 이벤트 100건을 재접속·리싱크·재생성에서 비교해 문자열 해시 100/100 동일; B는 L회 내 중복 0, A는 연속 동일 ≤ 5%(1,000쌍).

**T2-4 모임 0명 — 초대 이행 *행동* 추가 (튜닝 금지)** — 가설: 초대 이행(§22.6)이 construct 고정 급함(`logic.js:85`)에 밀림.
**`construct` 우선순위·계수는 손대지 않는다**(§0.1). 대신 수락한 초대에 `attend_party` 행동을 추가해 시간이 되면 그 행동이 후보에
오르게 한다(공지자는 주최 행동 `host_party`).
`attend_party`가 `construct`보다 선택될 수 있는 것은 행동 추가이므로 §0.1 위반이 아니지만, **기존 `construct`의 점수·계수·타이브레이크·
enum 순서가 바뀌지 않았음을 테스트로 고정**한다(§21.3의 append-only 원칙과 같다).
- 완료(선행: C-3): fixture 생성 = `announce` 입력(플레이어 심 = host) → §22.6 초대로 20명 `invitedTo.partyId` 설정 → `scheduledTick` 도달; 모임 **5회** → `party_attended`의 party별 `Set(simId)`로 **주최자 5/5**, 수락자 **≥ 14/20**, 수락자 0인 케이스 불인정; **기존 `ACTIONS` 전체**의 순서·타이브레이크·RNG 소비 순서 불변 테스트(construct만이 아니라) 통과.

**Tier 2 산술**(검증용으로 8개 값 전부): 재미 8.4 · 안정 7.5 · 이해 8.3 · UI 8.0 · **그럴듯 8.6** · 보는 7.5 · 성능 7.0 · 문서 7.4 = **62.7/8 = 7.8375** → 절사 **7.8**. (Codex 5차의 63.3은 위 어느 값에도 대응하지 않는다 — 정정하지 않는다.)

## 5. Tier 3: 마감

**T3-1 보는 재미 (G1-1 위에)** — 프롭·간판 리스케일(에셋 회차, `put()` h 값 표 정리), 카메라 프레이밍.
- 완료: **커밋된 fixture `test/fixtures/look-quiz/`(이미지 20장 + `answers.json`, sha256 기록)** 식별 시험(건물 기능 10·심 성별/나이대 10), 5명 중 4명 이상 개인별 정답률 ≥ 80%.
**T3-2 조명** — `applyDaylight(tick)` 룩업. 완료: 05:00/07:00/12:00/19:00 네 tick에서 **고정 probe 픽셀 3점(좌표: 하늘 (20,20)·건물 창 (560,420)·바닥 (300,700), 1120×848 캡처 기준)**의 **인접 시각 쌍(05→07, 07→12, 12→19)** 색차 **ΔE ≥ 5 (CIE76, sRGB→CIELAB, D65)**; probe만 맞추는 악용을 막기 위해 **전체 캡처 평균 밝기가 05 < 07 < 12 > 19로 단조**, 정오의 점등 창 픽셀 비율 ≤ 5%, stale 상태 0.
**T3-3a 성능(렌더·전송) — §22.10 나머지 병목** — #3 타일 1칸 변경이 전면 재빌드(2,218 스프라이트 + 61 Text/6초) → 증분 갱신,
#4 스냅샷 map 542KB(12값을 2.0B) → 팔레트 인코딩, #5 스프라이트 70.5MB → 아틀라스 다운스케일, Text 재생성(261/4초) → 캐시,
resync 0.85MB/4~5초 → 증분.
- 완료(측정 명세 고정): 하드웨어(이 Mac, 12코어)·브라우저(내장 Chromium, GPU 가속 on)·**DPR 2**·인구 100·뷰포트 1440×900·**워밍업 5분**·30분 실행 후 **마지막** 1,000프레임·
  **rAF 매 프레임 샘플링**(간헐 샘플 금지), 30분/1,000프레임 p95 < 16.7ms, heap **벽시계 24시간** 증가 < 1MB(**측정 직전 수동 GC 후**
  DevTools 힙 스냅샷, 시작·종료 2회 차), uncaught 0. (#3·#4·Text·resync는 G1-4로 이동, 여기는 #5 스프라이트 + 소크.)

**T3-3b** → **G1-3**으로 이동(v5).

**T3-4 README** — 완료: 명령어·OS·브라우저 고정한 깨끗한 클론 **5/5회** 5분 내 설치·PORT·첫 플레이·리포트.

**Tier 3 산술**: 보는 8.5 · **성능 7.5**(T3-3a만) · 문서 8.8 · 안정 8.5(소크 + 네트워크 실패 + 전체 `EVENT_TYPES` 커버리지) →
62.7 + 1.0 + 0.5 + 1.4 + 1.0 = **66.6/8 = 8.325**. G1-3 통과 시 성능 8.5 → **67.6/8 = 8.45**.
게이트 표기 규칙: **소수 첫째 자리 절사**(8.325 → 8.3, 8.45 → 8.4). 반올림으로 게이트를 넘기지 않는다.
**점수 부여 원칙**: 위 숫자는 *예상*이다. 실제 점수는 구현 완료가 아니라 **동일 평가표의 재플레이 결과로만** 부여한다(§6.5).

## 6. 9.0 — 산술이 아니라 게이트가 결정한다

위 항목의 합은 **8.3**(T3-3b 통과 시 8.4)이다. 9.0은 8항목 **전부 ≥ 9**일 때만 나온다. 남은 만큼은 다음 조건부 근거에서만 온다:
재미 8.4→9 (T1-0 게이트 "게임으로서 계속 **≥4/5, 2회 연속**" 실측) · 그럴듯함 8.6→9 (T2-2·T2-4 *결과* 전이 실측) ·
UI 8.0→9 (G-0 **전 조작 대상** 실제 클릭 + 패널·모달·카메라 조작 전체 검증) · 이해도 8.3→9 · 보는 8.5→9 · **성능 7.5→9 (T3-3b 20k
tick/s 조건)** · 문서 8.8→9 · 안정 8.5→9 (네트워크 실패·과거 이벤트·전체 `EVENT_TYPES` 커버리지 통과).
**커밋하는 바닥은 8.3, 9.0은 재검증 실측이 조건이다.** 약속하지 않는다.

## 6.5 최종 9점 검증 프로토콜

- **평가자**: 같은 5인 페르소나 + 확대 20인(직전 회차 구성 재사용), 각자 별도 클론·포트, 세계 seed **고정**.
- **플레이**: 스크립트 시나리오 30분(첫 접속 → 정책 1회 → 건설 1회 → 심 지시 1회 → 팔로우 5분 → 재접속 1회) + 자유 플레이 15분.
- **평가표**: `docs/REVIEW_RUBRIC.md` 그대로, 근거 없는 점수 무효. **스크립트 시나리오가 다루는 항목의 null은 불합격**(선택적 누락 방지); 자유 플레이에서만 생긴 null은 미검증.
- **산식**: 항목별 평균은 (자유 플레이) null 제외. "게임으로서 계속"은 **Yes/No 응답의 Yes 수**로 센다. **두 집단 모두 필수, 순차**: 5인에서 각 항목 검증자 ≥ 4/5로 먼저 통과 → 20인에서 각 항목 검증자 ≥ 16/20으로
  확인. 어느 집단이든 미달 항목이 있으면 그 항목은 미검증 → 전체 불합격.
- **합격**: 두 집단 모두 8항목 **각각 ≥ 9.0**, "게임으로서 계속" ≥ 4/5(5인)·≥ 16/20(20인), **2회 연속**(다른 seed 1회 포함). 소수 첫째 자리 절사.
- **재현 조건**: 커밋 hash·seed·시나리오 파일·페르소나 정의를 결과와 함께 기록.

## 7. 검증 게이트

| 단계 | 게이트 | 재검증 |
|---|---|---|
| G-0 | M × 3해상도 × 2 DPR × 3회 전수 실제 클릭 명중 100% | 도구 |
| Tier 0 | 평균 ≥ 6.4, ★3.3 | 같은 5인 |
| **G1-0** | C-1: UUID 동일 10/10 · 지연 lineage 4/4 · 리플레이/해시 동일 | 테스트 |
| G-1 | 심 ≥48px·이름표 ≥11px 블라인드 ≥80%, mapLayer p95 ≤2ms, **G1-3 실세계 fixture 5회 최악 ≥2,000 tick/s**, **G1-4 재빌드 0·resync ≤200KB** | 계측 + 5인 |
| Tier 1 | 평균 ≥ 7.6, ★4.0, **게임으로서 계속 ≥ 4/5, 2회 연속** | 같은 5인 × 2회 |
| **G2-0** | C-2: `NAME_BEARING` `names` 누락 0 · 과거 100건 재생 동일 · 임시 표기 ↔ `names` 표기 일치 | 테스트 |
| **G2-1** | C-3: 마이그레이션·해시·리플레이·참석 Set 5/5 (T2-4 전) | 테스트 |
| Tier 2 | 평균 ≥ 7.8 | 같은 5인 |
| Tier 3 | 평균 ≥ 8.3(절사) · G1-3 통과 시 ≥ 8.4 → §6.5 프로토콜 | 5인 + 20인, 2회 연속 |
| **G1-3 재실행** | Tier 2의 `sim/` 변경(T2-2·T2-3B·T2-4·C-2·C-3) 후 같은 fixture로 재측정 ≥ 2,000 tick/s | 계측 (§6.5 전 필수) |

## 8. 하지 말 것

- 지표를 만지지 않는다(§0.1) — T2-4에서 `construct` 계수를 낮추는 것은 금지, 행동을 추가한다.
- Tier 0에 `sim/` 변경을 넣지 않는다. 클라 선택을 클라 로컬 상태에 의존시키지 않는다. 롤업은 WebSocket 경계가 아니라 틱 창.
- 원본 이벤트 스트림을 삭제하지 않는다. 사용자 지시(온보딩 3항목)를 바꾸지 않는다.

## 9. Opus 구현 지시 형식

한 항목 = 한 작업: (1) 파일·함수 (2) 완료 기준 — 숫자 (3) 회귀 테스트 — 고치기 전 상태에서 **실제로 실패** 확인
(4) 점수 (5) **파괴적 검증 전 커밋**(§22.37·§22.39 사고).

## 부록 A. Codex 2차 리뷰(NO-GO) 반영

| 지적 | 반영 |
|---|---|
| 산술 오류(7.5/7.8/8.6) | 매 단계 합/8 명기: 6.45 → 6.76 → 7.64 → 7.84 → 8.325(G1-3 시 8.45) |
| T1-0 인과성 부재 | `clientInputId`·적용 tick·eventSeq로 카드 연결, 단순 지표 상승 불인정 |
| `assign` 응답 무시 | T0-7에 포함(`main.js:1852-1855` 확인) |
| T1-2 데이터 계약 없음 | `server/view.js` 투영 + `(tick,seq)` 순서 계약 |
| T2-2·T2-4 조사 메모 | 결과 전이·fixture 수치화, T2-4는 행동 추가(튜닝 금지) |
| T3-1·T3-2 기준 없음 | 파일·함수·수치 추가, T3-1은 G1-1로 승격 |
| T0-2가 §22.17 계약 변경 | PLAN에 §22.17은 없으나 **사용자 지시**가 계약 — 성 입력란 제외, 표기 일관성만 |
| T0-4 배치 경계 집계 | 틱 고정 창(60) |
| T2-3A `simName()` 의존 | 이름을 이벤트/스냅샷 계약에 |
| T2-3B pairSeq 메모리 변수 | 월드 상태·직렬화·해시·방향성 명시 |
| T3-3 병목 잔존 | §22.10 #3·#4·#5·Text·resync 전부 열거 |
| 완료 기준 수치화 | Codex 표 채택 |

## 부록 B. Codex 1차 리뷰(NO-GO) 반영 — v2에서 처리
T0-4b 삭제(오진 확인) · T1-0 신설 · T2-3 로컬 캐시 폐기 · renderPanel(T0-8) · G-0 · 점수 재계산(이번에 다시 정정).

## 부록 C. Codex 3차 리뷰(조건부 GO) 반영

| 조건·지적 | 반영 |
|---|---|
| 부재중 리포트 개편 없음 | **T0-9** 신설 (사건 우선·행동→결과→다음 목표·집계 접힘·highlights 상한) |
| 시뮬 성능 게이트 없음 (§22.27 158~278 tick/s) | **T3-3b** 신설, 성능 목표 8.7→7.5/8.5로 하향, 9는 20k 조건 |
| 카메라 팔로우 동작 미정의 | T1-2에 고정/해제/사망/리싱크 규칙 |
| 입력 실패 네트워크 경로 없음 | T0-7에 timeout·5xx·파싱·중복 클릭 + 재전송 정책 |
| T1-2 전 심 투영이 §22.8을 되돌림 | 선택 심만 요청형/이벤트형 |
| T0-2 서버가 클라 surname 수용 | 무시/거부 명시, 악의적 주입 테스트 |
| T0-4 집계 키·리싱크 초기화 | `(tick, ordinal)`, 초기화 금지, 멀티셋 비교 |
| `clientInputId` 오용 위험·전파 | §0 인과 계약: 추적 전용, 4개 이벤트에 전파, 서버 중복 제거 |
| `(tick, seq)` 모호 | 이벤트 ordinal로 명시 |
| 이름 계약 범위 | 화자·청자·제3자·사망자·리포트 전부 |
| T2-4 fixture 산술 불일치 | 주최자 5/5, 수락자 ≥14/20, construct 불변 테스트 |
| Tier 3 게이트 8.5 vs 8.475 | 재계산 8.325/8.45, 절사 규칙 명시 |
| 재미 9에 3/5 부족 | 4/5 × 2회 연속 |
| UI 30/30 부족 | 전 조작 대상 × 해상도 × DPR × 무작위 3회 |
| 안정성 낙관 | 네트워크 실패·과거 이벤트·전체 `EVENT_TYPES` 커버리지를 조건에 |
| 완료 기준 보강 (G-0·T0-1·T1-0·T1-3·T1-4·T2-2·T3-2·T3-3) | 전부 반영 |
| "상단의 6.9/7.9" | 문서가 아니라 **1차 리뷰 프롬프트의 문항 4**에 남은 v1 수치였다 — 4차 프롬프트에서 제거 |

## 부록 D. Codex 4차 리뷰(NO-GO) 반영

| 조건·지적 | 반영 |
|---|---|
| `clientInputId`가 시뮬에 전달되지 않음(`getPendingInputs`) — 계약 아님 | **C-1** 선행 계약으로 분리, 8종 이벤트 전파 명시(`zoned`·`input_rejected`·`player_created`·`token_created` 포함) |
| `eventSeq` 위험(WebSocket seq는 연결별) | 전부 `(tick, ordinal)` |
| 이름 계약이 스키마로 안 닫힘, `player_created`에 성 없음 | **C-2**: `payload.names` + `world.nameRegistry`(append-only, 직렬화·해시), 서버가 클라 `surname` 무시 |
| T0-2·T0-9가 Tier 0 "sim 변경 없음"과 모순 | T0-2는 `server/` 입력 정제 + 클라 임시 표기만; 이벤트 스키마는 C-2. T0-9는 클라 표시만; `getReport()` 확장은 **T1-5** |
| T2-4 참석 검증 불가(`gathering.count`뿐) | **C-3** `party_attended` 이벤트 |
| T3-3b가 너무 늦음(PLAN G6) | **G1-3**으로 이동, Tier 0 병행 트랙 |
| "6시간 재사용 0" 불가능(간격 15틱=24회) | "L회 내 중복 0"(B 라운드로빈) / A는 연속 동일 ≤5%; FNV-1a·UTF-8·mod L 명시 |
| T0-4 리싱크 복원 미정의(리싱크는 새 스냅샷만) | 스냅샷에 최근 N틱 이벤트 포함(`server/`), 순수 함수 재계산 |
| 절사 규칙 오기(둘째 자리) · 부록 8.48 모순 | 첫째 자리 절사, 8.45로 통일 |
| `updateStats`의 "시장"은 이름 | T0-1 항목 명시 |
| 최종 9점 프로토콜 없음 | **§6.5** 신설 |
| 점수는 재플레이로만 | Tier 3 산술 아래 원칙 명시 |
| 완료 기준 보강 12건 | 전부 반영(T0-4·T0-5·T0-9·G1-2·T1-1·T1-2·T1-4·T2-3·T3-1·T3-2·T3-3a·최종) |

## 부록 E. Codex 5차 리뷰(NO-GO) 반영

| 조건·지적 | 반영 |
|---|---|
| Tier 2 산술 63.3/8 | **정정하지 않음** — 문서의 8개 값 합은 62.7. 값을 전부 펼쳐 검증 가능하게 함 |
| T1-4 K "구현 시 확정" | 코드에서 열거 **K = 8**(승급 3 + 기차역 1 + 언락 건물 4), 달성 이벤트·도달 행동·성공/실패 fixture |
| T1-0이 카드 연결만 검증 | 상태 전이 명시(`world.goals`·`world.crisis`), 성공/실패 fixture 5/5 |
| C-1 지연 인과 미정의(`startAction`·`zoneOrders`에 ID 없음) | lineage: `sim.state.inputId`·`zoneOrders[].inputId`·`projects[].inputId`, 완료 기준 **UUID 동일성** + 지연 결과 4/4 |
| `eventText()` totality 없음 | 전 `EVENT_TYPES` × {현재·빈·구형 100건} 예외 0 |
| G1-3 얕은 합성 인구·best-of | 실세계 스냅샷 fixture, 5회 최악값 |
| T3-3a 핵심이 플레이테스트 왜곡 | **G1-4** 신설(재빌드·Text·resync·팔레트), T3-3a는 #5·소크만 |
| T1-2가 C-2에 의존 | (a) 카메라(Tier 1) / (b) 이름(C-2 후) 분리, `simId` 범위·이탈 정의 |
| T0-4 비루틴 숨기면 조작 가능 | 비루틴 100% 보존 + 집계량 보존, 창 기준점 명시 |
| T0-5 목록 미열거 | `NULL_EVENT_TYPES` 18종 열거 |
| C-2 우선순위·과거 이벤트 | `names` 우선, 과거 DB 100건 재생 동일 (v9: 구이벤트는 `nameRegistry` 백필 조회, top-level fallback 폐기) |
| C-3/T2-4 `Set(simId)`, 전체 `ACTIONS` 불변 | 반영 |
| G-0 M×3×2×3, T0-2 오라클, T0-7 30회, T0-9/T1-5 보존, T2-2 상태 델타, T2-3 표본·reply 규칙, T3-2 probe 좌표, T3-3a 샘플링, §6.5 집단 | 전부 반영 |

## 부록 F. Codex 6차 리뷰(NO-GO) 반영

| 조건·지적 | 반영 |
|---|---|
| "건설 취소" 명령 없음 | 기존 명령(`policy`·`zone`)으로 교체, 새 명령 안 만듦 |
| 굶주림 N 미정 | `starving` ≥ 5건/일 × 3일 연속; 관찰 구간·해제 조건 고정 |
| 신규 행동·이벤트 계약 없음 | **§0.8** 표: 후보 조건·지속·우선순위·RNG 무소비·직렬화·마이그레이션, append-only 불변 테스트 |
| T1-4 파일·스키마·hash·8노드 fixture | `logic/goals.json` + 스키마 + SHA-256 + `world.goalsHash`, 8노드 각각 성공/실패 |
| T0-4 hash 대상·알고리즘·N·allowlist | canonical JSON(payload 포함) SHA-256, N=60틱, allowlist=T1-2, fixture ≥500 |
| G1-4 oracle 없음 | 스프라이트 집합 동일 + 픽셀 ΔE 0 |
| T0-2 oracle이 C-2 참조 | Tier 0은 임시 표기만; 호환은 **G2-0** |
| C-1이 게이트가 아님 · `inp.id` 위반 위험 | **G1-0** 승격, 10종 전수, `inp.id` 사용 = 위반 명시 |
| T2-3B pair 카운터 vs 주제 기준 | `(pair, topic)`별 `pairTopicSeq` |
| C-2 전 문자열 동일성 주장 | T0-2에서 주장하지 않음 명시 |
| 게이트 표 "30/30" 잔재 | M×3×2×3으로 교체 |
| ΔE 방식·색공간 · 1,000프레임 창 · resync 횟수 | CIE76/sRGB→Lab/D65, 인접 쌍 명시 · 마지막 창 · 10회 p95 |
| 점수 상승폭 근거 약함 | 유지 — 예측치이며 실제는 §6.5 재플레이로만(6차도 "타당" 판정) |

## 부록 G. Codex 7차 리뷰(NO-GO) 반영

| 조건·지적 | 반영 |
|---|---|
| API 응답이 `targetTick, sequence`뿐 — 인과 판정 규칙 없음 | 적용 위치는 `inputId` 이벤트로 확정, 카드 창 `[applyTick, +4320]` 전후 비교, 인과 증명 불주장, 겹침 표시 |
| 플레이어 vs 자동 이벤트 구분 없음 | 자동 원인 `inputId: null` 규칙 + fixture |
| `goals/crisis/support/pairTopicSeq/gatherings` 상태·마이그레이션 없음 | **§0.10** 표(초기값·SCHEMA 50→51·직렬화·해시·구세이브·`makeSim`) |
| 모임에 `hostId`·`partyId` 없음(토큰·count뿐) | C-3 재정의: `tokenSeq`→`token.id`=partyId, `hostId`, `invitedTo.partyId`, 집계 루프에서 emit |
| T2-2 결과 지표 없음(1원도 통과) | 완화 지표(`wage_shortfall` 30%↓ 또는 잔액 ≥ 1일 임금), `side_job` ≥ 0.5×일 임금, `vacancy` 이벤트, `wageShortfallDays` 규칙 (v9에서 대상을 민간 서비스 직으로 정정) |
| T0-4 리싱크 dedupe·커서 없음 | `${tick}:${ordinal}` 키 합집합, 범위 `[worldTick−59, worldTick]`, 갭 경고, 5오프셋 테스트 |
| G1-4 resync 프로토콜 없음, 200KB 근거 없음 | `protocolVersion`, 4비트+RLE, 왕복 동일, 목표는 실측 후 확정(델타 대체안) |
| C-2가 Tier 2라 이름 의존 | C-2 전 기준은 `simId`만(T0-9·T1-5·T1-2) 명시 |
| T1-4 → T1-0 순서 | 명시 |
| 최종 전 성능 게이트 재실행 | G1-3 재실행 행 추가 |
| 20k tick/s 근거 없음 | 조건부 목표로 명시 |
| C-1이 `inp.id`를 넣고 있음 | 현재 상태 정확히 기술(`client_input_id` 컬럼·dedup은 이미 있음, SELECT 누락) |
| 완료 기준 12건(T0-3·T0-7·T0-9·G1-1·G1-2·G1-3·T1-3·T1-4·T2-2·T2-3·T2-4·T3-2) | 전부 반영 |

## 부록 H. Codex 8차 리뷰(NO-GO) 반영

| 조건·지적 | 반영 |
|---|---|
| `world.gatherings` vs `tokens` 모델 불일치; `tokenCounter` 이미 존재 | C-3: `partyId = tokenId`(기존), `hostId`만 추가, `gatherings` 잔재 제거, `tokenSeq` 삭제 |
| 공공 임금 전액 보장(§22.23)이라 무급 공무원 전제 오류 | T2-2를 **매출 없는 가게의 민간 서비스 직**으로 재정의, `protest`·`world.support` 삭제, 공공 임금 로직 불변 |
| `nameRegistry`가 §0.10에 없음, fallback 충돌 | 행 추가(백필 규칙), fallback = registry 조회, top-level 이름 fallback 폐기 |
| 리싱크 커서 필드 없음 | `events`·`cursor`·`prevCursor` 정의, 충돌 시 스냅샷 값으로 교체 + 오류 |
| 동일 키 내용 불일치 시 기존 값 유지는 거짓 보존 | 교체 + `console.error`, 테스트 실패 |
| G1-3 fixture 순환 의존 | 커밋된 `test/fixtures/perf-pop200.json` + sha256 (G1-2도 동일 방식) |
| C-3 독립 게이트 | **G2-1** |
| G-0 M 미정 | M = 28, 목록·504회 |
| T0-9/T1-5 fixture | `test/fixtures/report-day.json`(사건 ≥ 30, 기대 count) |
| G1-4 델타 경로 기준 | 어느 경로든 p95 ≤ 200KB·왕복 ≤ 500ms·10회 |
| §6.5 null 조작 가능 | 시나리오 항목 null = 불합격, "계속" = Yes 수 4/5·16/20 |
| T2-1 사유 토큰 allowlist | `logic/reason-tokens.json` + hash |
| C-1 `inputId`를 선택·RNG·타이브레이크에 쓰지 말 것 | §0.7 C-1에 명시 (아래) |

## 부록 I. Codex 9차 리뷰(조건부 GO) 반영

| 조건·지적 | 반영 |
|---|---|
| `starving` 건수는 §0.1·G5와 충돌(진입 전이) | T1-0 굶주림 = 3일 창 `Σ hungerZeroTicks` 증가분 ≥ 1440, 굶주림 fixture 5/5 |
| C-3 참석 의미 불일치(§0.7 집계 루프 vs §0.8 행동 완료) | 집계 루프에서만 emit으로 단일화 |
| C-2 fallback 충돌 | top-level fallback 폐기, `names` → registry → `#simId`; `NAME_BEARING_EVENT_TYPES` |
| T2-3 variant·reply 카운터 없음 | 키에 variant, reply 별도 카운터, 각각 측정 |
| `startAction()`이 상태를 통째로 재생성 → inputId 소실 | 인자 전달; 거부·stale 경로 전수 테스트 |
| G2-1 위치 | G2-0 → G2-1 → T2-4 |
| T0-3 폭, T0-9 kind별, G1-3 manifest, T2-2 통제군, T3-1 fixture | 반영 |
| 20k tick/s 전 성능 9 주장 불가 | 유지(조건부) |

## 9. 범위 경계 (Codex 10차의 확장 요구에 대한 답)

10차 리뷰는 PLAN §0.2의 프로젝트 대목표(폐쇄경제 지표 G1·인구 200 soak·다중 정착지 G3·가구 구조 G4)와 20,000 tick/s 근거를 이 제안서의
완료 게이트에 넣으라고 했다. **넣지 않는다.** 이유:
- 이 문서의 목적은 "5인 테스터 평가 평균 5.5 → 9"이지 PLAN 대목표 달성이 아니다. G3·G4는 평가표 8항목 어디에도 점수로 걸리지 않고,
  3차 플레이테스트의 감점 사유에도 없다. 게이트에 넣으면 9점과 무관한 일이 9점의 조건이 된다.
- G1 폐쇄경제 지표는 이미 §22.4·§22.22·§22.23으로 진행 중인 별도 트랙이고 그 계약(§0.1)은 본 제안이 존중하도록 §0.7·§0.8에 박아 두었다.
- 20k tick/s는 v8부터 **조건부 목표**로 명시했고 "통과 전 성능 9 주장 불가"는 이미 문서의 입장이다. 근거를 더 요구하는 것은 계측 후에나 답할 수
  있는 일이며, 계측은 구현 단계(G1-3)의 산출물이다.
따라서 최종 판정은 사용자 몫이다: Codex는 9차에서 조건부 GO, 10차에서 새 항목을 더해 NO-GO를 냈고, 10회에 걸쳐 남은 지적은 구현 계약의
세부(이 버전에서 8건 반영)와 범위 확장뿐이다. 남은 검토는 구현하는 Opus가 코드와 함께 하는 편이 정확하다.

## 부록 J. Codex 10차 리뷰 반영

| 지적 | 반영 |
|---|---|
| `vacancy`가 `EVENT_TYPES`·§0.8에 없음 | 행 추가, append 규약, payload 명시 |
| announce → `invitedTo.partyId` 경로 없음(현재 초대는 동석 초대) | `invite_to_party` 단계 정의, 동석 초대는 `partyId: null` |
| 스냅샷이 `pendingEvents` 미포함 | 스냅샷 직전 `flushLive()` + 동기 구간 읽기 |
| `done` vs `doneTick` | `doneTick` 통일 |
| 3일 창 정의 | day 경계 비중첩 |
| `NAME_BEARING_EVENT_TYPES` 미열거 | 문서에 열거 |
| reply payload 미정, `replyLine()`이 `t` 사용 | `{speakerSeq, replySeq}`, variant별 표본 ≥ 200 |
| BFS·공간 캐시 무효화 없음 | `world.map.version` + 캐시 on/off 해시 동일 |
| 결과 카드 영속성 없음 | `GET /api/inputs/:uuid/events`로 재구성 |
| T3-3a 창 모호 | 30분 후 마지막 1,000프레임 |
| G1~G4 대목표·20k 근거를 게이트로 | **§9: 범위 밖** |
