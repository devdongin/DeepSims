# DeepSims 기획서 v3.0 — 2D 쿼터뷰 심즈라이크 (오프라인 진행 세계)

## #173 확장 이벤트 등록 누락 수정

실제 emit되던 12개 이름을 EVENT_TYPES 끝에 추가했다. 전수 리터럴 emit/localEmit
등록 검사, 원자 저장 커밋/조회 및 unknown 거부 검사, 실제 역 개통→승차→하차의
이벤트 커밋/세계 재로드 동일성3/3 통과. 시뮬 결과/입력/필드/파라미터는 불변이라
스키마75·로직98을 유지한다. storage 16c가 드러낸 사무실 계획 저장 중단과 동일 부류의
철도/마을 확장 저장 중단을 함께 해결하며, 전체/교차 리뷰/CI 검증 후 병합한다.

## 진행 중: 외부 사건 입력 UI

codex/32-world-event-ui에서 기존 허용목록/검증기를 공유하는 입력창과 서버 기반
활성 목록/남은 시간을 연결했다. 불확실한 응답은 동일 ID로 재시도하며 값 변경을 잠근다.
단위2/2, 빌드, 실제 Chrome의 온보딩/저장/응답 유실 재시도/필드 잠금/Escape/재접속 통과.
스크린샷 확인 완료. 전체 회귀 및 독립 리뷰 진행 중. localhost:3000은 수정하지 않았다.

## 진행 중: 기분 충격 외부 사건 (schema75/logic95)

후속 리뷰 P1 수면 회고 덮어쓰기와 P2 포화 후 교체의 허위 차감을 수정했다.
주민별 실제 적용량을 사건에 저장하고 회고/기상에도 갱신한다. 동일 연장 비누적,
부분 포화·상/하한·과거 이벤트 불변·저장 재개를 포함한 집중13/13 통과.
수정 전 전체694/694 결과와 이번 수정의 최종 전체 검증은 구분한다. 재리뷰/전체 재실행 중.

codex/32-event-mood에서 signed delta/최초 충격/기간 내 회복 기준점/만료를 연결한다.
동일 채널 교체는 차액만 적용하며 pendingMood도 함께 반영해 기상 시 충격이 유실되지
않도록 한다. 저장 재개/경계/중복 갱신2개 테스트 통과. 실제 행동 영향/전체 회귀/리뷰
미완료이며 localhost:3000/root/saves는 수정하지 않았다.

## 진행 중: 대화 주제 외부 사건 (schema75/logic94)

PR166 검증 브랜치와 별도인 codex/32-event-topics에서 허용 주제10종의 가중치를
기존 실제 문맥 필터 뒤에 조정한다. 초대 우선/반복 방지/빈 후보 weather 폴백 보존.
실제 발화 변화·만료·저장/재개·문맥 차단·초대2개 집중 테스트 통과.
전체 회귀/상태 해시 갱신/리뷰는 아직 남아 있으며 localhost:3000 미반영이다.

## 진행 중: #32 R-D 외부 사건 (schema75/logic93)

별도 codex/32-world-events에서 질병/이민의 허용목록·유한 기간·교체·만료를 구현한다.
world.logic은 수정하지 않고 소비 지점에서 활성 사건만 적용한다. 입력/DB/저장/재개,
기존 면역과 난수 수, 이민의 빈집·유입 회계 조건을 회귀 검증한다. 단위·통합6개 통과,
전체 회귀 실행 중. 원격 리뷰/병합 및 나머지 R-D 효과·R-F는 아직 완료되지 않았다.
root localhost:3000에는 적용하지 않았으며 사용자/Claude의 로컬 변경을 보존한다.
입력/전송/회귀 집중13/13, 빌드/diff 검사 통과. 독립 Codex 리뷰의 현재 버전 저장에서
누락/null 사건 목록 보정 P2를 수정하고 회귀를 추가했다. Claude 승인을 주장하지 않는다.
사건 없는32/4242/9001 각4320틱은 부모e1ae1ed와 이벤트 및 버전/빈 사건 목록 제외
전체 상태 동일. 후보/선택/이벤트 오라클은 보존하고 새 저장 상태 해시만 갱신했다.
초기 전체 회귀는 옛 상태 해시3개 실패를 발견했으며 아직 최종 전체 통과를 주장하지 않는다.

> **현재 좌표 (2026-09-02, Day 151)**
> 인구 51 · 등급 1(읍) · 시설 53동/16종 · 직업 13종 · 공터 62 · 정착지 1 · 역 0
> 세이브 v36 · 로직 v35 · 테스트 153 · `sim/` 4,710줄/18파일 · 벤치 15,665 tick/s
>
> Phase 1~4는 2026-08-31에 끝났고, 그 뒤로는 **§14 이슈 루프**를 통한 연속 진화 체제다
> (관측 → 이슈 → 로드맵 → 설계 합의 → A/B 소크 → Codex 교차 리뷰 → 머지 → 재관측).
> §17~§21이 그 결과다. 이 문서는 계속 설계의 단일 권위다.
>
> **다음 목적지는 §0.2 대목표 v1.0 — "스스로 굴러가는 도시".**

로컬 전용: Node 서버 + SQLite 파일 + 브라우저 클라이언트(Phaser 3). GitHub(devdongin/DeepSims)로
배포하며, 누구나 집에서 클론 후 실행할 수 있게 한다.
세계는 24시간 프로세스가 아니라 **결정적 따라잡기 시뮬레이션**(시간의 지연 평가)으로 흘러간다.

## 0. 핵심 계약 (모든 설계의 기준)

이름 입력 계약(#103): 새 온보딩은 `create_player`에 `nameMode: 'full'`을 보낸다.
`name`을 전체 표시 이름으로 보존하고 `surname`은 빈 문자열로 둔다. 이름 길이로 성을
추정하지 않는다. `nameMode`가 없거나 `given`인 과거 입력은 명시한 성 또는 기존 시드 성을
사용하므로 리플레이 의미가 바뀌지 않는다. 기존 세이브와 과거 사건의 이름은 소급 변경하지 않는다.

### 계획 중심지 (#119, 2026-09-03)

- 공터 메뉴의 중심지 지정은 `/api/input`의 `plan_center {x,y}` 내구 입력이다.
  통행 가능한 지도 내부 정수 좌표만 허용하고 중복·국고 부족은 거부한다.
- `zone.plannedCenterCost`를 국고에서 차감하고 `externalOutflow`에 같은 금액을 기록한다.
  `world.centers`와 `center_planned` 이벤트에 좌표·시점을 남긴다. 입력 단계에서 적용한다.
- 일일 단계에서 선거 → 재정 리뷰 → 공공사업 → NPC 시장 중심지 검토 순서다.
  재정 리뷰 주기에 국고가 주민 현금 × `election.hoardRatioPct / 100`보다 중심지 비용만큼 더
  남아야 투자한다. 플레이어 시장은 직접 지정한다.
- NPC 후보는 사용·공사 중이 아닌 건축 가능 공터다. 시청·시장·기존 계획 중심에서
  `zone.centerRadius` 이상 떨어지고, 같은 도달 영역의 반경 내 거주 주민이
  `zone.centerMinResidents` 이상인 곳을 주민 수 내림차순·plotId 오름차순으로 선택한다.
- 자동 건설은 가장 가까운 중심까지 맨해튼 거리 오름차순, 동점 plotId 오름차순이다.
  중심이 없으면 plotId만 사용한다. RNG 추가 소비 없음. 로직 v46 이관이 새 비용/반경을 채운다.

```
state[t] = simulate(state[t-1], inputs[t])        // 틱 t로의 전이는 틱 t를 target으로 하는 입력을 소비
```

- 관례(Option B): 입력의 target tick, 이벤트의 tick, 결과 상태의 tick은 모두 **도착 틱 t**로 같다.
  새 입력의 target은 항상 `worldTick + 1`.
- 라이브 플레이와 오프라인 따라잡기는 같은 `tick()` 함수의 두 실행 모드다. 별도 배치 알고리즘 없음.
- `advance(world, inputsByTick, n)` = `tick()` n회 호출 루프. world를 **mutate**한다.
- 영속화 단위: (상태 체크포인트, 입력 소비 마킹, 이벤트, meta)를 **하나의 SQLite 트랜잭션**으로 커밋.
  리포트·클라이언트는 커밋된 틱만 관측한다.

### 0.1 문제 해결 규칙 — 지표를 누르지 말고 행동을 준다 (사용자 지시)
> "의도적으로 오류를 낮추기 보다 사람들의 행동패턴을 추가하여 세계에서 스스로 해결할 수
> 있게끔 관찰하고 진행하는것으로 한다."

- **오류는 신호다.** `no_path`·`lonely`·불만·`starving`·`wage_shortfall`은 버그가 아니라
  **세계가 무엇을 못 하고 있는지 알려주는 계기판**이다. 계기판 바늘을 손으로 눌러 내리는 처방
  — 파라미터를 안전한 쪽으로 튜닝하기, 상한을 조여 실패를 못 하게 막기, 실패 이벤트를 억제하기 —
  은 신호만 지우고 원인을 남긴다.
- **대신 사람이 실제로 할 법한 행동을 하나 더 준다.** 그 행동이 문제를 스스로 풀게 한다.
  - 굶는다 → 복지 캡을 올리는 게 아니라, 남는 음식을 나누거나 이웃에게 빌리는 행동을 준다
  - 갈 곳이 없다 → 후보에서 빼는 게 아니라, 길을 내거나 다리를 놓는 행동을 준다
  - 외롭다 → 끌림 계수를 키우는 게 아니라, 약속을 잡고 초대하는 행동을 준다
- **그리고 관찰한다.** 고쳤다고 선언하기 전에, 세계가 **실제로 그 행동으로** 풀어내는지 본다.
  지표가 내려갔다는 것만으로는 부족하다 — 어떤 행동이 늘어서 내려갔는지 사건 로그로 확인한다.
- **예외**: 계약 위반(결정성 파괴, 정수 오버플로, 리플레이 불일치)과 명백한 구현 결함은
  그대로 고친다. 이 규칙은 *세계의 고통*에 관한 것이지 *코드의 버그*에 관한 것이 아니다.
- **자기 점검**: §20.3에서 `gravityPullPct`를 절벽에서 떨어뜨리려 60으로 고른 것은
  이 규칙에 어긋나는 튜닝이었다. 도달 영역 방어(구조적 수정)는 옳았지만, 계수 선택은
  "지표가 예뻐 보이는 값"이었다. 앞으로는 계수를 고르기 전에 **행동을 하나 더 줄 수 있는지**
  먼저 묻는다.

### 0.1.1 표본이 모자란 측정은 측정이 아니다 (§23.25에서 배움)

§0.1은 *무엇을 재지 말 것인가*를 말한다. 이건 *어떻게 재야 하는가*다.

기분 바닥선(§23.25)을 넣고 5시드로 A/B를 돌려 **"인구가 12% 줄었다"**고 커밋 메시지에
적고 이슈까지 냈다. 시드를 20개로 늘리자 차이는 **+0.6명, t = 0.25** — 없는 차이였다.
1인당 활동이 전부 늘어 보이던 것도 인구가 우연히 작은 시드를 본 착시였다. 있지도 않은
기제를 한참 쫓았다.

이 저장소의 인구는 60일 기준 **시드 간 표준편차가 6~9명**이다. 그러므로:

- 10% 수준의 차이를 주장하려면 **최소 20시드**가 필요하다. 5시드로는 표준오차가 그 차이만 하다.
- A/B 결과를 적을 때는 평균만이 아니라 **표준편차와 표본 수**를 함께 적는다.
- 한 시드의 시계열은 기제를 *설명*할 때만 쓰고, 효과의 *유무*를 판정하는 데는 쓰지 않는다.
- 효과 크기가 표준편차보다 훨씬 크면(예: 기분 302 → 1,366, 편차 400) 적은 표본으로도 말할 수 있다.
  판정 기준은 표본 수가 아니라 **차이 ÷ 표준오차**다.

### 0.2 대목표 v1.0 — "스스로 굴러가는 도시" (사용자 지시, 88차 합의)

기능 목록이 아니라 **세계에서 관측 가능한 성질**로 정의한다. 각 게이트는 라이브 스냅샷에서
바로 잴 수 있어야 하고, 재는 축은 §0.1대로 *지표를 누르는* 방향이 아니라 *행동이 만든 결과*다.

#### 지금 무엇이 문제인가 — 통화 분포가 한 줄로 말해준다
```
심 지갑    122,932  (13%)
국고       526,962  (55%)
시설 매출  309,262  (32%)
--------------------------
총         959,156
```
**87%가 잠겨 있고 시민 손엔 13%뿐이다.** 임금은 무에서 나고(기반 부문), 소비는 시설 원장에
고이며, 국고는 세금만 받고 거의 쓰지 않는다. 이게 v1.0이 풀어야 할 중심 문제다.

#### G1. 돈이 돈다 — **폐쇄 회계** (88차 ①로 정의 교정)
"무에서 생성 0"이 아니라 **경계를 명시한 보존**이다. 마을 밖에서 벌어오는 기반 부문 소득은
`external_inflow`라는 **경계 유입**으로 드러내고, 그 경계 안(시민·시설·국고·미지급금)에서는
생성도 소멸도 0이어야 한다.
- 보존식: `Σ심 + Σ시설매출 + 국고 + 미지급금 = 이전 총액 + external_inflow − external_outflow`
- 시민 보유 비중 13% → **40% 이상**
- **보유율만으로는 게임된다** (국고·시설을 비우면 달성됨) → 다음을 함께 잰다:
  30일 화폐 이동률(velocity), 1인당 실질 소비, **빈곤 지속시간**
- 관련 이슈: **#43(P1)**, #57

#### G2. 스스로 자란다
사람 개입 없이 **인구 200 · 등급 3(대도시)** 도달. 인구를 직접 조작하는 경로는 영구 금지이므로
이민·출생·건설·고용의 창발 고리만으로 도달해야 한다.
- 관련 이슈: #51, **#63(P1)**

#### G3. 세계가 하나가 아니다 — **현재 범위에서 가장 큰 미구현 축** (88차 ③)
**정착지 2개 이상 + 30일 내 양방향 왕래.** 다중 정착지·정기 왕래·교통 계층을 **하나의 최소
수직 슬라이스**로 정의해 한 번에 세운다(따로 만들면 서로를 기다리다 멈춘다).
- 관련 이슈: #32, #48(계측 선행), #52(역 언락)

#### G4. 사람처럼 산다
`householdId`와 **세대 구조**가 있고, 결혼·자녀·이사·전직이 모두 행동으로 창발한다.
지금은 `homeId`뿐이라 **가구와 건물을 혼동**한다(88차 ④) — 한집에 사는 것과 한 가구인 것은 다르다.
- 관측 지표: 가구별 거주자·총소득·고용자·침대 여유, 분가 성공/실패 사유, 세대 간 이전
- 관련 이슈: #51, #58, #14

#### G5. 고통이 보인다
굶음·빈곤·외로움·질병·과밀을 **상태에 머문 틱 수**로 집계한다. 전이 이벤트는 **보조 지표**로만 둔다.
> 근거: §21.2에서 `starving` 이벤트 카운트가 방향을 **거꾸로** 읽게 만들었다. 자주 먹을수록
> 이벤트가 더 찍혀서, 은퇴자의 굶은 시간을 절반으로 줄인 행동을 되돌릴 뻔했다.

#### G6. 버틴다 — **G2보다 먼저** (88차 ②)
인구 200에서 **20k tick/s**. G2와 충돌하므로 **순서를 고정한다**:
1. 인구 100 / 150 / 200 **고정 인구 full-workload 벤치**를 먼저 통과시킨다
2. 그다음에 인구 200 성장 soak을 돌린다
- **20k를 낮추지 않는다.** 알고리즘 최적화로 달성한다. 현재 51명에서 15,665 tick/s이고
  비용이 인구에 초선형이므로 단순 외삽이 불가능하다.
- 관련 이슈: **#17**

#### v1.1로 미루는 것 (88차 ⑥)
외교·전쟁·문화. G3의 최소 교통·다중 마을이 서기 전에는 얹을 바닥이 없다.
정치(선거·시장)와 재난(화재·질병)은 이미 충분히 구현돼 있어 별도 게이트로 세지 않는다.

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

## 8. 진행 방식 — Phase 체제에서 **연속 진화 체제**로

초기 Phase 1~4(스캐폴드 → sim 코어 → DB·복구 → 서버 → 클라 → 인지 아키텍처)는 2026-08-31에
끝났다. 그 뒤로는 정해진 단계표가 아니라 **세계가 스스로 다음 할 일을 지목하는 순환**으로 간다:

```
살아있는 세계 관측 (스냅샷·이벤트 로그)
    ↓
심들이 겪는 문제 → 이슈 등록          ← 로드맵 에이전트(주기적) · 이슈 리뷰 에이전트(--recheck)
    ↓
설계 스케치 → **Codex와 합의**(단계 전환은 합의 필수)
    ↓
브랜치 → 구현 → 테스트(회귀 코드에서 실패하는지 확인) → PLAN·BEHAVIOR 갱신
    ↓
**고정 스냅샷 A/B 소크** — 지표뿐 아니라 *어떤 행동이 늘어서* 그리 됐는지 함께 본다 (§0.1)
    ↓
PR → Codex 교차 리뷰(회차 번호) → NO-GO면 반영 → 머지 → 서버 재시작 → 재관측
```

- 거동이 바뀌면 **세이브·로직 버전을 올린다**. 구 로그 재생 불일치를 "버그"가 아니라
  "행동 버전 차이"로 식별하기 위해서다.
- 가설이 반증되면 **되돌리고 그 사실을 사이클의 산출물로 기록한다**
  (§19.1 사회적 중력은 세 번 반증된 뒤 네 번째에 형태를 바꿔 통했다).
- 새 건물이 필요하면 **에셋 5종 세트**(4방향 회전 + 내부 컷어웨이)를 Codex에 먼저 요청한다.

## 9. 명시적 비목표 — **v3.0에서 갱신**

MVP 시절 비목표 중 **여럿은 이미 목표가 되어 구현됐다.** 낡은 목록을 그대로 두면
"안 하기로 한 것"과 "아직 안 한 것"이 뒤섞이므로 갈라 적는다.

**이제는 목표이고, 구현됐다** (옛 비목표에서 승격):
| 옛 비목표 | 지금 |
|---|---|
| 프로시저럴 맵 | §19 R-A 지형 생성 (강·산·바다·다리, 512×512) |
| 심 출생 | `child_settled` — 부모의 관계·침대 여유에서 창발 |
| 가구 배치 | 건물 4방향 회전 + 내부 컷어웨이, 시설별 자원 배치 |
| 경제 밸런스 | §20.2 시설 매출 원장, §21.1 능력치 임금, §21.3 전직 |
| 저장 마이그레이션 | v36까지 실제 마이그레이션 체인 |
| LLM 런타임 호출 | 외부 제안자로 한정해 도입 (아래 단서 참조) |

**여전히 비목표** (88차 합의로 유지):
- **심 사망** — 생애의 끝을 넣으면 세계의 성격이 완전히 달라진다. v1.0 범위 밖.
- **멀티플레이어 / 멀티 월드 서버** — 로컬 단일 세계가 이 프로젝트의 전제다.
- **모바일**
- **LLM의 tick 내부 실행** — LLM은 **영원히 외부 제안자**다. 검증된 내구 입력만 제출하며,
  tick 안에서 호출되는 일은 없다. 그래야 결정성과 리플레이가 성립한다.
- 오프라인 클라 명령, 델타 재전송

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
  → 언락 **판정**은 §19.12에서 섰다 (이슈 #52). 건설 레시피·운행은 그다음이다.

### 19.3 라운드 24 — 동시 건설 슬롯 (구조 변경, Codex 66차 GO)
- world.project(단수) → world.projects(배열), 세이브 v27. 마이그레이션은 legacy가 있고 배열이
  비었을 때만 이관(66차 ④ — `??=`는 이미 존재하는 빈 배열 때문에 놓친다).
- 동시 슬롯 = clamp(1 + floor(treasury / slotPerTreasury 15만), 1, maxProjectSlots **6**) — 계획 단계
  (§23.26에서 3 → 6. 상한 3이면 국고 45만을 넘는 순간부터 돈이 시공 능력을 못 산다.
   수요 계산은 **착공 중인 예정 수용량도 뺀다** — §23.28, 안 그러면 한 채 수요에 여섯 채가 올라간다.)
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

### 19.12 기차역 언락 판정 — stationDemand가 파라미터에서 판정이 된다 (이슈 #52)
- **문제**: `transport.stationDemand=300`은 §19 R-B부터 파라미터로만 존재했다. Σ longTrips와
  비교하는 코드가 없어 "911 > 300"은 사람이 수동으로 더한 값이었지 세계의 판정이 아니었다.
- **원칙**: 건물을 미리 짓지 않는다(§22.18 — 산업은 필요에서 자란다). 이 라운드는 **언락
  판정과 계측만** 세운다. 건설 레시피(ZONEABLE·비용·footprint)·열차 운행은 후속 라운드.
- **판정** (`evalStationDemand`, 일일 평가 맨 끝 — 일일 통계 다음 서브순서 고정, RNG 0):
  - `weightedTrips = Σ (hasCar ? floorDiv(longTrips × stationCarOwnerPct 50, 100) : longTrips)`
    — 차 보유 심의 이동은 할인해 센다(4단계 모델의 수단 선택: 경쟁이지 소멸이 아니다).
    심별 항이 독립인 floorDiv라 순회 순서 무관.
  - `distFactorPct = avgTripTiles ≥ stationDistBoostMin 60 ? 125 : 100` — 평균 장거리 칸수가
    문턱을 넘으면 철도의 경쟁 구간(수단 분담 대 거리). 이를 위해 startAction의 longTrips++
    자리에서 **칸수(longTripTiles)도 함께 누적**한다 (세이브 v49, 소급 없음 — 과거 경로
    길이는 기록에 없고 지어내면 가중이 허구 위에 선다).
  - `demand = floorDiv(weightedTrips × distFactorPct, 100)`, `demand ≥ stationDemand → 언락`.
  - **충족도 %를 상태로 남긴다**: `world.transit.fulfillmentPct = floorDiv(demand×100, stationDemand)`
    — 이분 컷이 아니라 %가 관측 가능해야 "언락까지 얼마나 왔나"를 세계가 말할 수 있다.
- **언락**: 비가역(cityTier 승급과 같은 계약). 1회성 `station_unlocked` 이벤트(수요·문턱·
  구성 요소 전부 payload로). `zoneAllowedTypes`에 train_station 추가 — 단 ZONEABLE 레시피가
  없으므로 zone 주문은 기존 **bad_type(언락됐지만 레시피 미구현, §18.T3와 같은 대기)** 분기로
  결정적으로 거부된다. 클라 zone 모달은 언락 전 충족도 %를, 언락 후 '착공은 후속 라운드'를
  보여주고 지시 버튼을 잠근다(거부될 주문을 보내 놓고 '지시했습니다'라 말하지 않는다).
- **관측**: `world.transit` {stationUnlocked, unlockedDay, fulfillmentPct, demand, totalLongTrips,
  weightedTrips, carsOwned, avgTripTiles} — 스냅샷·tickBatch·export-world-snapshot에 노출.
  `/api/industry` H(운수·창고업)에 `transit` 블록 — **directUnmet과 다른 축**이다: 심은 '역이
  없어서 못 갔다'고 좌절한 적이 없지만(걷거나 차로 갔다), 이동의 누적 자체가 산업의 근거다.
- **제약 (Duranton & Turner, 로드맵 회차)**: 역이 혼잡을 풀어준다고 가정하지 않는다 — 도로
  공급 확대가 통행량도 늘리듯 유발 수요는 **측정** 대상이고, 그 계측(#48)은 동반 과제다.
  여기서는 수요 관측과 언락 판정까지만.
- 참고 (이슈 #52 코멘트): OpenTTD 역 등급 — 역이 수요를 만드는 게 아니라 수요가 역의
  성과를 결정하는 방향. cargodist — 다중 마을(G3) 왕래가 서면 '어디로 가려는 수요인가'를
  세는 틀로 이어진다.
- 버전: 세이브 v49(world.transit·sim.longTripTiles) · 로직 v44(stationCarOwnerPct 50,
  stationDistBoostMin 60, stationDistBoostPct 25 — validateLogic 범위 포함. 반영률 상한 100:
  차가 수요를 부풀리면 안 된다). 테스트 test/station.test.js ST-1~16 (299/300 경계, 차 할인
  경계, 거리 가중 경계, 비가역, 왕복 고정점, 결정성 해시, 마이그레이션, zone 계약,
  손상 세이브 정규화, 이동 0회, 파라미터 극단값 0/100·0/1000).
- Codex 교차 리뷰: **조건부 GO → 조건 이행**. 지적 ①: `??=`는 부분 객체·NaN 누적값을 못
  고친다(§22.18 v45가 industryDemand에서 배운 그 함정) → v49 마이그레이션이 transit을
  기본 모양과 **필드 단위로 병합**하고(불리언은 true만 true, 카운터는 유한 safe integer
  ≥ 0만 보존, unlockedDay만 -1 허용), longTrips·longTripTiles도 유한 정수로 정규화.
  잠긴 세계에는 언락일이 남지 않는다. 실측 30일 soak(시드 4242): day 25 언락, 수요
  320/300, 이벤트 1회, 왕복 고정점 유지, findNonFinite 0건.

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
- **의도된 거동 변경 기록 (82차 ①)**: 졸업의 가중 풀은 `rngInt` **호출 횟수**를 바꾸지 않지만
  상한 인자(`weighted.length`)가 달라져 **선택 결과는 달라진다**. 로직 v33의 의도된 변경이다.
- **seed 폴백 (82차 ②)**: seed가 없는 아주 오래된 세이브에서 `undefined + 1 = NaN`,
  `Math.imul(NaN, x) = 0`이 되어 **다른 시드의 세계가 같은 능력치를 갖는** 조용한 오류가 난다.
  `FALLBACK_SEED`로 막았다(마이그레이션을 실패시키지는 않는다). S-67이 회귀를 막는다.
- **임금 부족 계측 (82차 ④)**: 능력치로 민간 임금이 오르면 시설 매출 부족이 잦아질 수 있어
  스냅샷에 `wageShortfall7d`(건수·총액)를 노출했다. 라이브 첫 관측 4건·2,440원.
- **다음**: §21.2 산업 다양화(#63)의 선행 조건이다 — 새 업종이 생겨도 그걸 할 역량이 없으면
  배정이 무의미하다. workshop·lab·warehouse 에셋 5종 세트는 준비됐다.

### 수요 기반 산업 발전 (#63, Draft · 세이브57·로직52)

인구 등급과 별도로 실제 세계 증거가 새 생산 업종을 비가역적으로 연다. 공방은 주택·공원·연못을
제외한 도시 시설20곳(누적 건설 활동), 연구소는 주민 전체의 실제 학업3000틱, 창고는 기차역과
같은 장거리 이동 수요300이 문턱이다. 단위가 다른 신호를 합산하지 않으며 definition 순서로
하루 한 번 판정하고 `unlockedIndustries`에 추가한다. RNG를 소비하거나 주민을 만들지 않는다.
언락 뒤 국고가 비용을 감당하면 기존 공터·건설 노동 경로로 시설 하나를 착공한다. 진행 중 주문과
프로젝트가 있으면 중복하지 않는다. 장인/연구원/물류 담당자는 생성 풀에 넣지 않고, 완공된 업종이
실제 수요 근거를 가진 뒤 기존 적성 기반 전직으로만 생긴다. 이 셋은 외부에 산출을 파는 기반
산업으로 기존 외부소득 임금 경로를 사용하고, 식당·시장처럼 지역 소비 매출을 선행 조건으로 삼지 않는다.
문턱은 `industryDevelopment.workshop/lab/warehouse`로 직렬화·검증된다. #96/#57 위에 통합하며,
19세 미만/최종 학위 미완료 학생은 새 업종으로도 전직하지 못한다. 실제 교육 부족을 먼저 계획하고
남는 계획 슬롯으로 산업 시설을 추진한다. 학교·산업 모두 실제8×6 공터를 확인한 뒤 비용을 지출한다.

### 21.2 라운드 34 — 나눔: 가까운 사람이 곤경이면 돕는다 (사용자 규칙 §0.1 첫 적용)
- **관찰이 먼저였다.** 빈곤층 10명 중 **8명이 은퇴자**였다. `retired`는 `wagePct: 0`이라
  소득 경로가 아예 없고, 저축을 쓰면 굶는다. 복지는 하루 5명 캡이라 은퇴자 11명을 못 받친다.
  | 직업 | 중위 잔고 |
  |---|---|
  | retired (11명) | **187** |
  | teacher (5) | 667 |
  | office_worker (5) | 2,799 |
  | doctor (2) | 8,794 |
- **규칙 §0.1대로 복지 캡을 올리지 않았다.** 그건 계기판을 손으로 누르는 것이다.
  대신 사람이 실제로 하는 행동을 줬다 — **만나서, 곤경에 처한 가까운 사람에게 나눠준다.**
- **행동의 제약이 자연스럽다**: 사교 페어링 안에서만 일어난다. 관계가 있어야 하고, 만나야 한다.
  §20.3 사회적 중력으로 만남이 늘어난 것이 여기로 연결된다. 관계가 가까울수록 잘 돕는다
  (한집 55% + 기본 5% > 친구 35% > 지인 > 낯선 5%, 라이벌은 돕지 않는다 — 이분 컷이 아니라 가중).
  주는 쪽은 `giverKeepMin`(1,500) 아래로 내려가지 않는다 — 나눔이 새 빈곤을 만들면 안 된다.
- `dayHash` 의사확률이라 **rngSim 미소비**, 드로우 순서 계약 불변. 심 사이 이전이라 **통화 총량 보존**.
- **A/B 소크 (같은 스냅샷 Day148, 14일·21일 두 창)**:
  | 지표 | 나눔 없음 | 나눔 있음 |
  |---|---|---|
  | 나눔 발생 (21일) | 0 | **85건 · 34,000원** |
  | 관계별 (21일) | — | 친구 58 · 한집 12 · 지인 11 · 낯선 4 |
  | 은퇴자 중위 잔고 (14일) | 223 | **366** |
  | 은퇴자 중위 잔고 (21일) | 191 | **250** |
  | 은퇴자 굶주림 (14일) | 13 | 19 |
  | 은퇴자 굶주림 (21일) | 21 | 29 |
- **`starving` 이벤트가 늘어 처음엔 실패로 읽었으나, 지표가 틀린 것이었다 (83차 ① 실험).**
  Codex가 지목한 대로 주는 쪽·받는 쪽을 갈라 재보니 굶주림 88건 중 **62건이 받는 쪽**이었다.
  즉 나눔이 굶주림을 만든 게 아니라 **원래 굶던 사람들에게 정확히 도달**하고 있었다.
  결정적 단서는 이벤트 정의였다 — `starving`은 배고픔이 **0으로 떨어지는 전이**에서만 발생한다
  (`before > 0 && now === 0`). 계속 0에 머물면 **1회**, 먹었다가 다시 떨어지면 **또 1회**.
  **더 자주 먹을수록 이벤트가 더 많이 찍힌다.** 진짜 고통은 전이 횟수가 아니라 *굶은 채 보낸 시간*이다.
  | 21일 지표 | 나눔 없음 | 나눔 있음 |
  |---|---|---|
  | **은퇴자가 굶은 채 보낸 틱** | 177,475 | **83,437 (−53%)** |
  | 은퇴자 식사 완료 | 142 | **231 (+63%)** |
  | 전체 식사 완료 | 1,361 | **1,711** |
  | 전체 굶은 시간 | 215,250 | **187,424** |
  | `starving` 이벤트 | 54 | 88 ← **전이 카운터, 복지 지표가 아니다** |
  | 인구 | 60 | 70 |
- **교훈**: 이벤트 카운트를 복지 지표로 쓰면 방향을 거꾸로 읽는다. `starving` 건수만 봤다면
  은퇴자의 굶은 시간을 절반으로 줄인 행동을 되돌릴 뻔했다. 스냅샷에 `hungerZeroTicks`를 추가해
  앞으로는 **머문 시간**으로 본다.
- **틀렸던 추론을 기록해 둔다**: 은퇴자가 14일간 사교 1,233회 대 식사 151회라 "사교가 식사를
  밀어낸다"고 봤으나 **오독이었다**. ① `starving`은 배고픔이 **0에 도달**할 때만 발생한다
  (위급 문턱 2,000을 지나 5.5시간을 더 못 먹은 경우). ② 위급 상태에서는 `collectCandidates`가
  **위급 행동만** 후보로 모으므로 사교는 애초에 경쟁하지 않는다. ③ 하루 0.9끼는 배고픔 감쇠율
  (6/틱, 10000→2000이 약 0.93일)에서 나오는 정상값이다.
- 세이브 v35 · 로직 v34. 인구 직접 조작 없음.
- **파라미터 전문 상한 8KB → 16KB**: 세계가 시스템을 얻으며 자란 결과 8,286 bytes로 넘었다.
  이건 세계의 지표가 아니라 **저장 계약의 상한**이라 §0.1의 대상이 아니다.

### 21.3 도구 — 이슈 재리뷰 모드 + §20.3 핫패스 컷 순서
- **재리뷰 모드**: `tools/issue-review-agent.sh [n] --recheck`. 예전엔 이슈당 리뷰가 한 번뿐이라
  세계가 바뀌어도 낡은 수치·처방이 그대로 남았다(모든 열린 이슈가 이미 리뷰돼 회차당 1건만
  돌던 상태). `--recheck`는 **가장 오래 손대지 않은 이슈부터** 다시 보고, 프롬프트에 최근 머지
  목록을 실어 무엇이 달라졌는지 알려준다. 헤더도 '🔁 재리뷰'로 구분된다.
- **성능 계측 (이슈 #17)**: 벤치가 19,223 → 15,665 tick/s로 떨어져 원인을 갈랐다.
  | 구성 | tick/s | 인구 |
  |---|---|---|
  | 전부 켬 | 16,217 | 29 |
  | §20.3 중력 끔 | 23,806 | 26 |
  | §21.2 나눔 끔 | 26,294 | 26 |
  | 둘 다 끔 | 27,680 | 26 |
  sim-tick당으로 정규화하면 1.39 → 2.13 µs(+53%)다. 인구 증가(26→29)로 설명되지 않는 몫이
  있지만, 사교가 2.3배로 늘어 페어링·대화·기억 쓰기가 그만큼 늘어난 것이 주된 몫으로 보인다 —
  **낭비가 아니라 세계가 더 많은 일을 하는 비용**이다. 성능 예산이 성공에 잠식되고 있어
  #17은 덜 급한 게 아니라 더 급하다.
- **적용한 최적화 (거동 불변)**: `socialPullPct`의 컷을 비용 순으로 재배치 — 끌림 0이면 즉시
  반환, 빈자리는 **첫 개에서 중단**(개수를 세지 않는다), 가장 비싼 `sameRegion`을 맨 뒤로.
  효과는 **+1.3%로 미미**했고, 이는 병목이 이 경로가 아니라는 증거다. 추측으로 더 손대지 않는다.

### 21.4 라운드 35 — 전직: 손님은 있는데 일할 사람이 없다 (이슈 #63 1단계)
- **관찰**: §20.2 매출 원장이 문제를 드러냈다. restaurant 24,400원 · market 4,200원 ·
  **hospital 126,400원**이 쌓이는데 근무자가 없다. 민간 임금 직군이 `barista` 하나뿐이었다.
- **규칙 §0.1대로** 시설을 더 짓거나 매출을 재분배하지 않고, **행동**을 줬다 —
  손님이 몰린 가게에 누군가 그 일을 하러 간다.
- **아무도 셰프로 태어나지 않는다**: `chef`·`clerk`는 `SWITCH_ONLY_OCCUPATIONS`라 생성 풀에서
  빠진다. 그래서 `eligible` 길이가 예전과 같고 **worldgen·이민의 rngInt 결과가 바이트 단위로
  동일**하다 — 이 변경으로 인한 리플레이 퍼터베이션이 0이다(S-74). 수요가 직업을 만든다.
- 적성 높은 순(동점 id asc)으로 고르고, 지금 일보다 `minAptGain`만큼 더 잘해야 옮긴다.
  확률은 적성에 비례(이분 컷 아님). `dayHash`라 **rngSim 미소비**.
- **A/B가 드러낸 것 — 성장이 꺾였다. 그리고 기전이 있다.**
  | 21일 | 전직 없음 | 전직 있음 |
  |---|---|---|
  | 전직 | 0 | 2 (chef 1 · clerk 1, 둘 다 office_worker 출신) |
  | **건설(시설·침대)** | **20** | **8** |
  | **이민** | **19** | **6** |
  | 인구 | 70 | 57 |
  | 빈곤층 | 21 | **15** |
  | 굶은 시간 | 202,323 | **172,250** |
  | 임금 부족 | 17 | 39 |
  | 시설 매출 총액 | 1,121,489 | 1,087,716 (hospital 832,800이 대부분) |
- **읽기 (86차 ③ 반영해 표현을 낮춘다)**: 관측은 전직이 유발한 궤적 변화와 **일치하지만**,
  인과로 단정하기엔 이르다. 전직자/비전직 대조군별 매출·요구임금·실지급액·빈곤 지속시간·
  건설 기여를 추적해야 확정된다(후속 과제). 아래는 정합한 **가설**이다:
  전직 2건이라는 극소 섭동이 **성장 되먹임 고리**를 타고 증폭됐다.
  기반 부문(office, 무에서 나는 임금)에서 서비스 부문(매출에 묶인 임금)으로 사람이 옮기면
  소득이 불안정해지고(임금 부족 17→39), 집을 덜 짓게 되고(20→8), 빈 침대가 없어
  이민이 막힌다(19→6). **경제적으로 일관된 창발**이지 버그가 아니다.
- **그래서 이 슬라이스만으로는 부족하다**: 매출 1위 hospital(832,800원)은 의사·간호사가
  공공 직군이라 여전히 아무도 못 받는다. 순환을 닫으려면 §20.2가 남긴 과제 —
  매출을 실제로 유통에 푸는 일 — 이 필요하다.
- 세이브 v36 · 로직 v35. 인구 직접 조작 없음.
- **86차 ① 결정성 수정**: `Object.keys(I.openings)`는 params 삽입 순서를 따르므로,
  로직 파일에서 키 순서가 바뀌면 같은 날 후보가 달라진다. canonical hash가 키 순서를
  무시한다면 '같은 로직 해시인데 다른 결과'가 된다. **정렬로 고정**했다(S-75).
- **86차 ② 교차 검증**: 일자리를 여는 직업은 ① 존재하는 직업이고 ② `privateWageOccupations`에
  있어야 하며(매출에서 임금이 나온다) ③ `workplace[occ]`가 시설 타입과 일치해야 한다.
  핫스왑 로직이 하나라도 빠뜨리면 '손님은 있는데 임금이 안 나오는' 조용한 고장이 된다(S-76).

### 22.1 라운드 36 — 시간 가속: 실시간 1시간 = 게임 1년 (사용자 지시, 89차 합의)
사용자 지시: "게임 속도를 그럼 좀 더 빠르게 해야겠다. 1시간에 1년정도로 설정하게끔 한다."
- **달력은 건드리지 않는다.** 1년 = 120일, 1일 = 1440분 그대로다. 바뀌는 건 **관람 속도**뿐이다.
  `yearDays`를 줄이는 안은 달력의 의미를 바꾸므로 피했다(89차 ①).
- 1년 = 120 × 1440 = **172,800틱**. 실시간 1시간(3,600초)에 그만큼 진행하려면 **48틱/초**,
  즉 **속도 ×48**이다. §20 배속 상한을 3 → **48**로 올렸다.
- 프리셋: **×1**(1년=48시간) · **×3**(16시간) · **×12**(4시간) · **×48**(1시간).
- **따라잡기 클램프를 함께 올렸다** — 이게 없으면 가속이 무의미하다.
  `MAX_CATCHUP_TICKS`가 게임 30일이었는데, ×48에서는 **실시간 15분**만 자리를 비워도
  세계가 잘렸다(43,200틱 ÷ 48틱/초 = 900초). 관람 배속이 오를수록 클램프가 실질적으로
  조여지는 구조였다. 게임 **2년치(240일)** 로 올려 ×48에서 **실시간 2시간 부재**까지 버틴다.
  계산 비용은 345,600틱 ≈ 22초이고, `catchUp`이 1일 배치마다 yield하므로 이벤트 루프를 막지 않는다.
- **결정성 불변**: 배속은 서버 런타임 설정이라 시뮬 상태가 아니다. 같은 틱 수를 돌리면
  같은 세계가 나온다(스모크로 확인). T-10·T-11이 배율과 클램프 경계를 못박는다.
- 성능 여유: 48틱/초는 벤치 15,665틱/초의 **0.3%**다.
- **1년치 스모크**: 172,800틱을 돌려 `new_year` 1회, 노화 정상 작동(89세 → **90세 상한 도달**).
  이 상한이 다음 슬라이스(§22.2 사망·출생)가 풀어야 할 문제다.

### 22.2 라운드 37 — 생애 주기: 사망과 출생 (사용자 지시, 89차 합의)
사용자 지시: "사람의 능력치나 외부 요인등으로 사망하는 시나리오가 들어가야 실제 인간세계에
가깝게 구현이 될 거잖아" / (아기가 자라는 시간을 묻고) "경제순환과 사망 모두 진행"
- **고치기 전 세계**: 사망 코드가 한 줄도 없었고 나이는 `Math.min(90, age+1)`로 90에서 멈췄다.
  즉 **죽지 않는 90세가 무한 누적**되는 구조였다. 출생도 `traits.age = 15`로
  **15세 청소년이 즉시** 나타나 자라는 시간이 없었다.
- **출생**: 0세 `child`로 태어나 `schoolAge`(15세)에 `student`가 된다(`grew_up`).
  `child`는 일하지 않는다(wagePct 0, 근무시간 없음) — 먹고 자고 놀고 어울리며 자란다.
  생성 풀에서 제외해 **worldgen·이민 RNG가 불변**이다(`BIRTH_STAGE_OCCUPATIONS`).
- **사망은 이분 컷이 아니라 위험도의 가중 합**이다. 하루 단위, 10만분율:
  - 노화 `(나이 - 40)³ / 750` — 50세 ≈ 0.16%/년, 60세 ≈ 1.3%/년, 90세 ≈ 20%/년
  - **능력치**: 체력이 낮을수록 위험 ↑ (기울기, ±40%)
  - 외부 요인: 질병(2.5배 + 기본 위험), **굶은 채 머문 시간**(§21.2에서 배운 축)
  - 상한 3%/일 — 아무리 나빠도 즉사하지 않는다
  - `riskHash`(0..99,999)라 **rngSim 미소비**. 일일 평가에서 선거·수당·이민보다 **먼저**.
- **정리 목록 (89차 ③)**: 예약 해제, 배우자 사별(`bereaved` + 기분 타격), 시장직 공석,
  분실물 보관 해제, `parents` 삭제. 행렬(`affinity`/`interactions`/`lastGreetDay`)은
  **묘비로 남긴다** — 행을 지우면 id 인덱싱이 무너진다.
- **id 재사용 금지**: 예전엔 `sims[sims.length-1].id + 1`이라 마지막 심이 죽으면 **이미 쓰인
  id를 재발급**했다. `world.nextSimId` 전용 카운터로 바꾸고, 행렬 확장도 `sims.length`가 아니라
  **id 공간 크기** 기준으로 고쳤다(`growIdMatrices`).
- **3년 소크 (사망 없음 vs 있음)**:
  | 3년 | 사망 없음 | 사망 있음 |
  |---|---|---|
  | 인구 | 123 | 118 |
  | 사망 | 0 | **16** (전부 질병 계기) |
  | 사별 | 0 | 12 |
  | 출생 | 42 | 42 |
  | 은퇴자 | 14 | **8** |
  | 최고령 | 92 | 92 |
- **소크가 드러낸 것 — 부양 부담이 폭증한다**: 3년간 출생 42건인데 **성장 0건**이다
  (0세가 학생이 되려면 15년이 걸린다). 인구 118명 중 **35명(30%)이 일 못 하는 영유아**다.
  사용자가 지적한 "인구가 폭증하면 사회비용이 폭증한다"가 그대로 관측됐다 → #71로 등록.
- **사망 원인이 전부 질병으로 찍혔다**: 질병이 위험을 2.5배로 키우므로 죽는 순간 아픈 경우가
  대부분이다. 노화 단독 사망이 드문 건 3년이라는 짧은 창 탓일 수 있다 — 더 긴 소크로 확인해야 한다.
- 세이브 v37 · 로직 v36. 인구 직접 조작 없음.
- **91차 ① 정리 누락 보강**: `removeSim`이 자녀의 `world.parents`, 동아리 명단(`world.clubs`),
  §21.2 나눔의 `sharedTo`에서 사망자 id를 빼지 않았다. 특히 `interaction.js`의 `family_talk`가
  **죽은 부모를 계속 언급**할 수 있었다(S-80이 회귀를 막는다).
- **91차 ② 아동 제약**: 아이가 어른의 노동·대처·공적 임무를 하고 있었다.
  `CHILD_BLOCKED`(work·construct·build·respond_fire·patrol·drink·binge_eat·shop·see_doctor·fish)를
  `too_young`으로 막고, 연애에서도 제외했다(본인도, 상대로도). 아이는 먹고 자고 놀고
  어울리고 배운다(S-81·S-82).
- **행렬 압축은 하지 않는다 (91차 ③)**: 묘비 방식은 id 인덱싱 계약상 안전하다.
  인구 200 수준에서는 압축하지 말고, churn이 커지면 별도 dense-index 계층을 새 버전으로 설계한다.
- **`cause` 라벨의 한계 (91차 ④)**: 지금은 기여도 최대 요인이 아니라 `sick` 우선의 근접 라벨이다.
  유지 가능하지만, 장기적으로 위험 구성요소를 이벤트 payload에 함께 기록하는 편이 정확하다.

### 22.4 라운드 38 — 공공 부문 회계 폐쇄 (이슈 #43, 대목표 G1)
- **관찰**: 통화의 87%가 잠겨 있었고 가장 큰 웅덩이가 hospital이었다. 시민이 병원·시청·학교에
  낸 돈이 시설 원장에 고이는데, **의사·간호사는 공공 직군이라 아무도 그 돈을 받지 못했다.**
- **회계를 닫았다**: 공공 시설(hospital·city_hall·school·police_station·fire_station) 매출은
  **국고로 귀속**되고, 공공 직군(doctor·nurse·teacher·civil_servant·politician·police·firefighter)
  임금은 **국고에서 나간다**. 소비 → 국고 → 공공 임금 → 시민 → 소비.
  정산 순서는 **매출 귀속이 먼저**다(오늘 쓸 재원을 먼저 채운다).
- **77차 판단을 번복했다**: 그때는 '공공 임금을 국고가 대면 순유출로 무너진다'며 뺐었다.
  달라진 건 §20.2 매출 원장이 생겨 **공공 시설 매출이 국고로 들어온다**는 점이다(89차 ④ 승인).
- **임금 재원이 셋으로 갈린다**: 민간 서비스 → 그 시설의 매출 / 공공 → 국고 /
  나머지(기반 부문) → **경계 유입**으로 명시 기록. 어느 쪽이든 **없는 돈은 지급되지 않는다**.
  국고는 절대 음수가 되지 않는다.
- **경계 유입을 전부 찾아 기록했다 (G1 폐쇄 회계)**: 기반 부문 임금뿐 아니라
  **낚시·주운 돈·귀속된 분실물·이민자의 초기 자금**도 마을 밖에서 온 돈이다.
  S-84가 "경계 유입을 빼면 내부에서 돈이 생기지 않는다"를 못박는다 — 이 테스트가
  숨어 있던 네 개의 화폐 생성 경로를 찾아냈다.
- **A/B 소크 (같은 스냅샷 Day157 → 21일)**:
  | 지표 | 닫기 전 | 닫은 뒤 |
  |---|---|---|
  | 시설 매출 비중 | 58% | **19%** |
  | 국고 비중 | 36% | 73% |
  | 시민 보유 비중 | 6% | **9%** |
  | 국고로 귀속된 매출 | 0 | **1,100,800** |
  | 총통화 | 2,476,376 | **1,786,314** |
  | 국고 최저치 | 598,391 | 582,977 (음수 없음) |
- **가장 중요한 수치는 총통화 차이 690,062원이다.** 이건 21일간 **무에서 생기던 공공 임금**이다.
  이제 국고에서 나가므로 통화량이 그만큼 덜 늘어난다 — **G1의 핵심이 실제로 닫혔다.**
- **정직한 한계 — 시민 보유는 6% → 9%뿐이다.** 돈이 시설 웅덩이에서 **국고 웅덩이로 옮겨졌을 뿐**
  시민 손에는 거의 가지 않았다. 국고는 오히려 36% → 73%로 늘었다(매출 유입 1,100,800 >
  공공 임금 690,062). 빈곤층 수·굶은 시간·사망은 **한 자리도 달라지지 않았다**.
  **국고를 실제로 쓰는 지출처가 없기 때문이다** → #71(육아·건강 정책)이 다음 슬라이스다.
- **93차 ② — 소멸 경로가 남아 있었다**: 유입만 세고 **유출을 안 셌다**. 건설비(존 지시·자재값)와
  자동차 구매가(취득세를 뺀 나머지)는 마을 밖 시공사·제조사로 나가는 돈인데 그냥 사라지고 있었다.
  `externalOutflow`로 명시하고, S-84의 불변식을 부등식에서 **등식**으로 강화했다:
  ```
  끝 = 시작 + 경계유입 − 경계유출
  ```
  10일·30일·60일 모두 등식이 성립한다. **경계 밖 이동을 전부 세면 내부에서는 돈이 생기지도
  사라지지도 않는다** — G1의 폐쇄 회계가 이 시점에 실제로 완성됐다.
- **93차 ⑤ 근무지 교차 검증**: 공공 임금 직군의 `workplace`가 실제로 공공 시설이어야 한다.
  어긋나면 '민간 시설에서 일하는데 국고가 임금을 대는' 모순이 된다.
- 세이브 v38 · 로직 v37. 인구 직접 조작 없음.

### 22.6 라운드 39 — 먼저 말 걸기 (이슈 #69)
- **관찰**: 카페·공원이 16곳인데도 외로움이 쌓인다. §20.3 사회적 중력이 **모으는 데는** 성공했지만
  (헛걸음 46.8%→16%), 사교는 여전히 **수동**이다 — 같은 시설에서 socialize 중인 심끼리
  id 순으로 자동 페어링될 뿐이라, **옆에서 밥 먹거나 책 읽는 사람은 영원히 남**이다.
  홀수로 남은 한 명은 아무도 말을 걸지 않아 혼자 끝난다.
- **행동을 줬다**: 혼자 남은 심이 같은 시설의 다른 사람에게 **먼저 다가가 청한다**.
  상대는 관계(친구>지인>낯선, 라이벌은 제외)와 **자기 사교 욕구의 결핍**에 따라 응하거나 거절한다.
  **거절도 결과다** — `lonely` 수치를 직접 깎지 않는다(§0.1).
  응하면 그 자리로 **마음이 기울 뿐**(사교 점수 ×2.2), 하던 일을 강제로 끊지 않는다.
  자는 사람은 깨우지 않고, 아이에게는 말 걸지 않는다.
- **첫 소크에서 구현 결함이 드러났다**: 수락률이 **2%**였고 거절이 **5,924건**이었다.
  `pairHash`는 (쌍, 날짜) 상수인데 **매 틱 평가**해서 같은 거절이 하루 종일 반복된 것이다.
  이건 세계의 결과가 아니라 버그이므로 §0.1의 예외로 고쳤다 — **하루에 같은 사람에게 한 번만**
  청한다(`approachedDay`/`approachedTo`). 고친 뒤 수락률 **33%**, 거절 346건으로 정상화됐다.
- **A/B 소크 (같은 스냅샷 → 14일)**:
  | 지표 | 없음 | 있음 |
  |---|---|---|
  | 청 수락 / 거절 | 0 / 0 | **168 / 346** (수락률 33%) |
  | **관계 변화** | 532 | **663 (+25%)** |
  | 대화 | 7,442 | 7,652 |
  | 헛걸음 비율 | 16.9% | 18.5% |
  | 외로운 상태로 머문 틱 | 17,138 | 17,717 |
  | 인구 | 61 | 70 |
- **정직한 결과 — 관계는 늘었지만 외로움 지표는 개선되지 않았다.**
  행동 자체는 작동한다(168번 성사, 관계 변화 +25%). 그러나 헛걸음 비율과 **외로운 상태로 머문
  시간**은 거의 그대로다. 인구 61→70 차이는 궤적일 수 있어 인과로 읽지 않는다.
- **내 가설은 반증됐다 (95차 ② 계측)**. "청을 받아들인 심이 향하는 사이 초대한 쪽이 떠나
  혼자 도착한다"고 봤으나, 전환율을 재보니 **초대 171건 중 125건(73%)이 실제 만남으로 성사**됐고
  만료는 34건(20%)뿐이다. 초대 → 페어링 경로는 **잘 작동한다**.
  | 전환 지표 (14일) | 값 |
  |---|---|
  | 청함 → 수락 | 524 → 171 (33%) |
  | 수락 → **실제 만남 성사** | 171 → **125 (73%)** |
  | 만료 | 34 (20%) |
- **진짜 이유는 규모다**: 14일간 성사된 만남이 **125건**인데 같은 기간 사교 완료는 **4,117건**이다.
  전체의 3%다. 행동은 잘 작동하지만 **외로움 총량을 움직이기엔 너무 드물다.**
  더 자주 일어나게 하려면 계수를 올려야 하는데 그건 §0.1이 금지하는 튜닝이다.
  대신 **말 걸 대상이 옆에 있어야 한다**는 구조적 제약(시설이 흩어져 있고, 자는 사람·아이는 제외)이
  빈도의 상한이다 — 다음 슬라이스에서 볼 지점은 그쪽이다.
- **95차 ③ 핫패스 수정**: 이미 청을 받은 상대를 건너뛸 때 시도 목록에 기록하지 않아
  **매 틱 재검사**하고 있었다. 건너뛰는 경우도 기록하도록 고쳤다.
- 세이브 v39 · 로직 v38. `pairHash`라 rngSim 미소비. 인구 직접 조작 없음.

### 22.7 라운드 40 — 각자의 마을: 첫 실행 시드 추첨 (사용자 지시)
사용자 지시: "모든 사용자가 최초에 프로젝트를 시작하면 같은 환경일테니 시드를 적용하자"
- **문제**: 기본 시드가 `20260831`로 **고정**이라, 누가 클론하든 **똑같은 마을**이 나왔다 —
  같은 지형, 같은 열 명, 같은 성격·능력치, 같은 이름 순서.
- **첫 실행에서만 시드를 무작위로 뽑는다**(`randomInt(1, 2^31-1)`). 시드는 세계 생성에만 쓰이고
  DB `meta`와 `world.seed`에 박히므로, **한 번 만들어진 마을은 이후 실행에서 그대로**다.
  `DEEPSIMS_SEED`를 주면 그 값을 쓴다 — 친구와 같은 마을을 만들거나 버그를 재현할 때.
- **결정성 계약은 그대로다**: "같은 시드 + 같은 입력 = 같은 세계"는 변하지 않는다.
  바뀐 건 *처음에 어떤 시드를 고르느냐*뿐이고, 그 추첨은 **시뮬 밖**에서 한 번 일어난다.
- **이름도 시드로 섞는다**: 지형·성격이 달라도 '민수·지연·하준'이 늘 같은 자리에 서 있으면
  다른 마을처럼 느껴지지 않는다. Fisher–Yates로 섞되 **전용 임시 rng**를 써서
  `rngWorldgen`/`rngSim` 스트림을 건드리지 않는다(드로우 순서 계약 불변).
  ```
  시드  372919280 → 준호, 민수, 지연, 태호, 서연
  시드 1833831102 → 하준, 예린, 도윤, 수아, 은지
  ```
- **부팅 로그로 시드를 알려준다**: 새 마을이면 "🌱 당신만의 마을이 생겼습니다 — 시드 N"과
  재현 명령을, 이어가는 마을이면 "시드 N (이어가는 중)"을 출력한다.
- **검증**: 서로 다른 두 사용자가 다른 마을을 받고, 같은 시드로는 재현되며,
  **기존 DB는 시드 인자와 무관하게 유지**된다(세 경우 모두 실측). S-89가 이를 못박는다.
- **97차 ③ 시드 입력 검증**: `Number()`만 쓰면 `NaN`·소수·범위 밖 값이 그대로 통과해
  `makeRng`가 **조용히 이상한 스트림**을 만든다. 안전 정수 1~2^31-1만 받고, 아니면
  즉시 알리고 멈춘다(`"abc"`·`"3.7"`·`"0"`·`"99999999999"` 모두 거부 확인).
- **97차 ④ 생성 버전 표식**: 이름 섞기가 **새 세계의 생성 결과**를 바꾸므로 세이브 v40으로 올렸다.
  기존 세계 데이터는 그대로다(이름은 이미 스냅샷에 박혀 있다) — 구 로그 재생이 어긋났을 때
  '버그'가 아니라 '생성 버전 차이'로 식별하기 위한 표식이다.

### 22.8 라운드 41 — 전송 낭비: 화면이 안 쓰는 데이터를 71배 보내고 있었다 (사용자 지시)
사용자 지시: "이쯤에서 렌더링에서의 낭비가 없는지 세계가 흘러가는 로직 말고 게임 자체의 성능평가를 한다."
- **발견**: `tickBatch`와 `snapshot`이 **심 객체 전체**를 보내고 있었다. 라이브 실측(인구 57):
  | | 크기 | 심당 |
  |---|---|---|
  | 보내던 것 | 1,748KB | 31,401B |
  | 화면이 쓰는 것 | 25KB | **445B** |
  차이는 **71배**다. 심당 31KB 중 대부분이 `memories`(약 35KB 상당 문자열)인데,
  클라이언트는 기억을 **한 곳도 렌더링하지 않는다.**
- **클라이언트가 실제로 읽는 심 필드는 12개뿐**이다(`client/main.js` 전수 확인):
  `id · name · x · y · state · needs · mood · money · sick · hasCar · isPlayer · traits`.
  `memories`·`relTiers`·`habit`·`plan`·`knownTokens`·`abilities`·`complaintDays`·`noPathCool`·
  `sharedTo`·`approachedTo`·`hungerZeroTicks`·`groceries`·`patrolIdx`·`invitedTo`·`homeId`은
  **한 곳도 쓰지 않는다**. (`longTrips`는 이벤트 페이로드, `partnerStage`는 월드 레벨이라 무관.)
- **`server/view.js`의 `simsView()`로 투영해 보낸다.** 전송 계층만의 변화라
  시뮬 상태·결정성·리플레이는 그대로다. 새 필드가 화면에 필요해지면 한 줄 추가하면 된다.
- **실측 (배속 ×48, 인구 57)**:
  | | 배치당 | 대역폭 |
  |---|---|---|
  | 고치기 전 (추정) | ~1,780KB | ~7.1MB/s |
  | 고친 뒤 (실측) | **32KB** | **130KB/s** |
- **대목표 관점**: 인구 200(G2)·배속 ×48에서 고치기 전이면 **24MB/s**였다.
  G2와 G6이 시뮬 성능이 아니라 **전송에서 먼저 무너질 뻔했다.**
- 화면 회귀 없음 — 브라우저에서 지도·심·이벤트 로그·상세 패널 모두 정상 확인.
- **남은 것**: 스냅샷 581KB는 대부분 `map.tiles`(262,144칸)다. 접속당 1회라 당장 문제는 아니지만,
  다중 마을(G3)로 가면 재검토 대상이다.

### 22.9 도구 — 참고 문헌 방침과 상시 연구 에이전트 (사용자 지시)
사용자 지시: "사람의 행동패턴에 관한 참고 문서는 라이센스 확인 이후 git에 올려둔다" →
확인 결과를 보고 **"링크로 가는게 나을거 같음"** 으로 방침 확정 →
"참고 문헌을 확대해서 계속해서 research 하는 서브에이전트를 생성한다"
- **`docs/REFERENCES.md`** — 인용한 14편의 서지정보·라이선스·DeepSims 적용 지점.
  **전문 파일은 저장소에 두지 않는다**(라이선스상 가능한 7편도 마찬가지) — 논문 PDF는 게임
  저장소를 무겁게 만들고 DOI·공식 링크가 영구적이다. 표 ①은 "올려도 되는 것" 목록이지
  "올린 것" 목록이 아니다.
- **재배포 가능 7편**: CC BY 4.0 4편 · Public Domain 1편(미 공중보건국장) · OGL v3 1편(영국 DfT) ·
  CC BY 1편(OECD). **불가 7편**: ACM(Generative Agents) · 시카고대(Granovetter) ·
  Taylor & Francis(Schelling·Meen) · AEA(Duranton & Turner) · CC BY-**NC**(삼각 폐쇄) · IEEE.
- **자동 OA 지표를 단독 근거로 쓰지 않는다**: Unpaywall·OpenAlex·Semantic Scholar **세 곳 모두**
  Granovetter 1978을 `license="cc-by"`로 표시하는데 **오탐**이다. HAL의 다른 논문(2025년 프랑스
  ROADEF 발표)이 그 DOI를 잘못 달아둔 탓이다. 이 경고를 §4.1에 박아뒀다 — 후속 파이프라인이
  플래그만 보고 재배포 가능으로 오판하지 않도록.
- **`tools/research-agent.sh`** — 4시간마다 도는 문헌 연구 에이전트.
  로드맵 에이전트가 "다음에 무엇을 만들까"를 묻는다면, 이쪽은 **"그걸 만들 근거가 어디 있나"** 를 묻는다.
  세계의 미해결 수치에서 출발해 새 문헌을 찾고, **출판사 1차 출처로 라이선스를 확인**하며,
  이미 인용한 것(DOI·arXiv·PMC 대조)은 다시 제안하지 않는다.
  §0.1을 프롬프트에 박아 **지표를 누르는 처방의 근거로 문헌을 쓰지 못하게** 했다.
- **첫 실행이 값진 것을 찾았다**: 저소득 가구의 식량 획득 연구(FoodAPS)에서
  "사회적 네트워크에서 받은 식량은 식량 안정성과 유의한 연관이 없었다"는 결과가 나왔는데,
  이는 §21.2 나눔이 **잔고는 올렸지만 굶주림은 줄이지 못한** 우리 소크 결과와 정확히 일치한다.
  실증이 우리 관측을 뒷받침한 첫 사례다.

## §22.10 렌더링 성능 감사 — 화면이 무엇을 낭비하고 있었나

시뮬 로직이 아니라 **게임 클라이언트 자체**를 감사했다. 67개 에이전트가 60건을 제기했고
적대적 검증에서 **28건만 살아남았다**. 기각된 32건에는 그럴듯한 최적화가 대거 포함된다 —
아틀라스 도입(CANVAS엔 텍스처 배칭이 없어 드로우콜 이득 0), 타일 텍스처 프리베이크
(캔버스 축소는 destination-driven이라 비용 모델이 틀렸다), 화면 밖 스프라이트 컬링
(주장 76% → 실측 31%/12.8%). **측정 없이 최적화했다면 셋 다 헛수고였다.**

### 확증된 상위 항목
1. **grassBg 541MB 캔버스** — 월드 전체를 덮는 16,448×8,224 TileSprite. 6.42ms/frame. → 고침
2. **mapLayer 22,027 다각형 매 프레임 재래스터화** — 9.9ms/frame. 화면에 실제로 보이는 건 **2.9%**
3. **타일 1칸 변경이 월드 전면 재빌드를 부름** — 배속 48에서 약 6초마다 2,218 스프라이트 + 61 Text 재생성
4. **스냅샷 599KB 중 map이 542KB(90%)** — tiles는 값이 12가지뿐인데 엔트리당 2.0B로 보낸다
5. **워크 스프라이트 180장이 렌더 크기의 9~13배 해상도로 상주** — 70.5MB RGBA

### 이 감사가 뒤집은 전제
1위·2위는 **인구와 무관한 상수 비용**이고 합계 약 16.3ms로 60fps 예산 16.7ms를 이미 소진한다.
심 0명짜리 빈 월드에서도 동일하다. 즉 "인구를 못 늘려서 못 고치는" 항목이 아니라
**G2(인구 200) 이전에 지금 고쳐야 하는 항목**이다.

### G2에서 무너지는 순서 (1·2위를 고친 뒤)
Text 재생성(pop 200 → 4초마다 261개 캔버스) → resync 스냅샷(15.6초 → 4~5초 주기, 0.85MB)
→ affinity O(pop²)(클라가 한 번도 안 읽는데 573KB @ pop400) → 이벤트 스트림 → 트윈 → 유령 스프라이트

## §22.11 가상 플레이어가 찾은 것 — 간판 기능 세 개가 조용히 죽어 있었다

가상 플레이어 3인(게임 초보 / 심즈·Anno 팬 / 개발자)에게 `git clone`부터 시켰다.
셋 다 설치는 성공했고 셋 다 시뮬 코어는 진짜라고 인정했다. 그런데 계속하겠다는
답은 3명 중 2명이었고, **그 2명조차 게임으로서가 아니었다** — "관찰 대상으로서",
"포크할 만한 뼈대라서". 유일한 순수 플레이어 관점(비게이머)은 떠났다.

공통 진단: **잘 만든 시뮬레이션 위에 아직 게임이 없고, 그나마 있는 간판 기능
세 개가 전부 조용히 죽어 있다.**

### 고친 것 (블로커 2건)
- **A. 배속을 누르면 재시작 후 세계 영구 정지** (2인 독립 목격). epoch는 저장되는데
  speed는 안 됐다 — 둘은 한 쌍이다. 역행 클램프가 재고정을 안 해 스스로 회복 못 함.
- **B. 커밋된 `logic/params.json`이 자기 검증기를 통과 못 함** — 새 클론은 핫스왑이
  처음부터 죽어 있다. **실제 배포 파일을 검증하는 테스트가 하나도 없어서** 168개가
  전부 놓쳤다.

두 버그의 공통점은 고장이 아니라 **침묵**이다. 로그는 "따라잡기 완료"라고 말하고,
파일을 고쳐 본 사람에게는 아무 일도 안 일어난다. 그래서 이번 수정은 동작을 고치는
것과 함께 **말을 하게 만드는 것**을 같은 무게로 다뤘다(ops_log 구분, 부팅 경고).

### 남은 리스크 (Codex 101차 ③)
따라잡기 중 배속 변경은 메모리에만 두고 완료 후 재기준화 시점에 저장한다. 세계와
저장 쌍은 항상 안전하지만, 따라잡기가 긴 상태에서 프로세스가 죽으면 사용자의 배속
변경이 유실된다. 의도된 트레이드오프다 — 짝이 어긋난 시계보다 잃은 설정이 낫다.

### 아직 안 고친 것 (플레이어가 지적한 순서대로)
1. **한 명을 따라갈 수 없다** — 2인이 topThreeAsks에 넣었다. "'이 심만 보기' 필터
   하나면 게임이 완전히 달라질 것 같다."
2. **공공부문 임금이 구조적으로 0으로 수렴한다** — 국고 < 임금 구간에서 매 지급마다
   국고가 세율 배로 줄어드는 등비수열. 실측 지급률 11.2%. 세율을 30%로 올려도
   감쇠 속도만 늦출 뿐 수렴점은 0이다. **이건 §0.1이 말하는 "행동을 하나 더 주는"
   문제다** — 무급 공무원이 실제로 할 법한 일(퇴직·전직·부업·항의)이 없다.
3. **타이쿤 레버가 전부 같은 빈 국고에 잠겨 있다** — "시장이라면서 예산 편성권도,
   감원권도, 임금 못 준다고 알려주는 경고창도 없다."
4. **심 패널에 판단 사유가 없는데 README는 있다고 한다.**
5. **부재중 리포트가 이야기가 아니다** — 74줄 중 61줄이 식사 횟수, highlights 50칸 중
   48칸을 `lonely`가 먹는다.
6. **나이·직업 규칙이 플레이어에게만 적용된다** — 15세 공무원, 85세 주민이 사는데
   지표는 "고용률 100%"를 자랑한다.
7. README에 `PORT` 설명이 없다 (3/3 전원 지적).

## §22.18 산업은 건물이 아니라 개념으로 먼저 존재한다

사용자 지시: "산업 대분류에 따른건 모두 구현되어야 함" → 그리고 곧이어
**"산업은 개념만 일단 존재하고 사람들이 필요에 의해 발전하게 해야 돼"**.

### 병렬 검증 3인이 15채 신설안을 전원 NO-GO 했다
- 건물 15채를 더해도 **플레이어의 새 동사는 0개**다. 명령은 6종(assign·create_player·
  logic_update·announce·policy·zone)뿐이고, 바뀌는 건 zone 모달 버튼 8개→23개다.
- **희소성이 없다**: 국고 116만 / 미사용 공터 51개 / 최고가 zone 10,000원 →
  115채를 살 돈과 51채를 놓을 땅이 있다. 23개짜리 메뉴는 선택이 아니라 체크리스트다.
- 신규 22직업 중 4개(librarian·lineman·sanitation_worker·developer)는 **도달 경로가
  아예 없다**. traits.occupation에 값을 쓰는 곳은 6군데뿐이다.
- 1단계 추천 4개(bartender·trainer·fisher·builder)가 구조적으로 죽어 있다:
  최근 7일 drink **0회**, exercise **1회**, bar 매출 0원 → 채용 문턱 5,000원을
  영원히 못 넘는다.
- 공급망을 넣을 자리가 없다: 세계의 유일한 재고 변수는 `sim.groceries`뿐이고
  **시설에 재고 필드가 없다**.

### 그래서 첫 슬라이스는 분류 + 수요 원장이다 (Codex 108차 조건부 GO)
Codex가 내 순서에서 하나를 뒤집었다 — 나는 희소성(시설 유지비)을 먼저 넣으려 했는데,
**유지비를 먼저 넣으면 국고 감소가 다른 성장 지표를 교란하고 수취자 없는 화폐 소멸
경로가 생긴다**(§22.4 폐쇄 회계 위반). 후속 슬라이스로 미뤘다.

`sim/industry.js`가 하는 일은 셋뿐이다: 21개 대분류를 이름 붙여 두고, 지금 세계의
시설·직업이 어디에 속하는지 알려주고, **무엇이 없어서 아쉬웠는지**를 분류별로 센다.
건물 0채, 에셋 0장, 새 직업 0개.

### 원장이 첫날부터 값진 것을 말했다
살아 있는 마을(Day 172, 인구 63)의 실제 신호:
- **`no_facility` 불만 0건**
- **`no_money@eat` 불만 415건** (severity 100)

이 마을에 부족한 것은 **건물이 아니라 사람 손에 가는 돈**이다. 국고가 73%를 쥐고 있고
심 현금은 10.3%다. 둘을 한 지표로 섞었다면 "식당을 더 지어라"는 정반대 처방이
나왔을 것이다 — §19.10에서 같은 이유로 불만 원인을 분화했고, 이번엔 그 분화가
곧바로 값을 했다.

### 21개 현황 (Day 172)
활성 6 (G·I·M·O·P·Q) / 맹아 6 (A·C·F·L·R·T) / 부재 9 (B·D·E·H·J·K·N·S·U)

"구현됨"의 기준은 건물이 서 있느냐가 아니라 **분류·수요 원인·활성화 조건·도달 경로가
다 있느냐**로 잡았다. 인구 63명에서 9개가 '부재'인 것은 정직한 상태다.

## §22.27 인구 스케일 계측 — 절벽은 실재하고, 범인은 기록과 달랐다 (이슈 #17, G6)
<!-- 절 번호 정정: §22.26은 공공사업이 선점 (병렬 에이전트 번호 충돌) -->

Codex 재리뷰(#17)의 지적대로 성장 soak 수치는 인구가 함께 변해서 교란된다.
"세계가 더 많은 일을 해서 느려졌다"는 해석이 자기변호가 되지 않으려면 **고정 인구
계측**이 필요했다. 시뮬 로직은 한 줄도 바꾸지 않았다 — 이 절은 계측과 프루닝만이다.

### 방법 — 합성 인구 fixture

- `bench/synthpop.js`: createWorld 위에 **실제 이민 경로(maybeImmigration)를 반복**해
  목표 인구까지 결정적으로 불린다. 심을 손으로 만들면 §22.16 단일 창구와 언젠가
  어긋나므로, 기존 공개 함수만 쌓았다. 같은 (seed, target)이면 hashWorld까지 동일 확인.
- 시설은 §17.21 도시계획 트리거의 **수요 판정 그대로** 채운다 (선제 주택 → 일자리 →
  카페 → 공원). 주거만 아파트다 — 인구 400을 집(침대 2)으로 받으면 공터 96곳이 모자란다.
- `bench/popscale.js`: 워밍업 1일 후 3일 측정, `--reps N`은 best-of-N. BFS는
  pathfind.js의 기존 pfStats 훅으로 분리 계측 — 호출 수·누적 ms·방문 칸.
- 병목 순위는 `node --cpu-prof` 프로파일의 self time으로 지목했다. 절대 ms는 기계
  부하에 흔들리지만(공유 머신 — 측정 중 다른 에이전트들이 돌고 있었다) **비중은
  전 함수가 같이 느려지므로 안정적**이고, 카운트 열(결정·BFS 호출·방문칸)은 결정적이라
  실행 간 완전히 일치했다.
- **이 수치는 "인구 P 고정 조건의 결정·경로 부하"이지 성장 월드 P명의 대표값이
  아니다** (Codex 교차 리뷰 ③). 전원 tick 0 일괄 생성이라 기억·관계·재정 이력이
  얕고(기억 만재 비용은 bench.js 최악 케이스가 따로 잰다), 주거가 전부 아파트이며,
  건설 이력이 없다. 그래서 이 표는 **전후 비교와 스케일 곡선의 모양**에 쓰고,
  살아 있는 세계의 절대 비용 예측에는 쓰지 않는다. 시설 도달성은 테스트로 고정했다
  (bench.test.js B2 — 인구 400 격자 스캔 배치 포함 전 시설 문이 구시가와 같은 영역).

### 수치 (시드 20260831, 워밍업 1일·측정 3일, 1분 부하 ~14에서 best-of-2)

| 인구(시작→끝) | 시설 | ms/일 | tick/s | µs/sim-tick | 결정/일 | BFS 호출/일 | BFS ms/일 (비중) | 방문칸/호출 |
|---|---|---|---|---|---|---|---|---|
| 10→11 | 22 | 79 | 18,179 | 5.2 | 92 | 92 | 13 (16%) | 1,017 |
| 50→52 | 39 | 376 | 3,828 | 5.1 | 451 | 451 | 63 (17%) | 1,278 |
| 100→102 | 61 | 1,386 | 1,039 | 9.5 | 936 | 936 | 202 (15%) | 2,001 |
| 200→201 | 108 | 9,100 | 158 | 31.5 | 1,550 | 1,550 | 3,122 (34%) | 10,755 |
| 400→401 | 203 | 18,581 | 77 | 32.2 | 3,347 | 3,347 | 2,366 (13%) | 6,564 |

(인구 200 행은 실행 간 편차가 가장 컸다 — 다른 실행에서 최저 5,179ms/일(278 tick/s)
관측. 공유 머신 편차이며, 어느 값으로 읽어도 아래 결론은 같다. BFS 비중 34%는
독립 프로파일의 34.1%와 일치 — 두 계측이 서로를 검증한다.)

읽는 법:
- **G6 예산(인구 200에서 20k tick/s)은 70~127배 미달이다** (158~278 tick/s).
  인구 10에서도 18.2k로 이미 살짝 밑돌고, 50이면 5분의 1이다(전 인지 활성 기준).
  성장 soak의 "인구 69에서 22.5s/일"(#17 본문)은 과장이 아니었다 — 고정 인구 200에서
  5~9s/일, 400에서 19s/일.
- µs/sim-tick(인구 정규화)이 인구 40배에 약 6배로 오른다 — **초선형 항이 실재한다.**
  인구가 늘면 시설도 늘고(§17.21 수요 판정), 결정당 스캔 비용이 시설 수에 비례해서다.
- 결정/일 = BFS 호출/일이 전 구간 정확히 일치한다. **BFS는 행동 시작당 정확히 1회**
  (sim/tick.js startAction의 단일 호출 지점) — 이슈 본문의 "idle 결정마다 실행"이
  거짓임을 계수로 재확증했다.
- 인구 200 행의 방문칸/호출 10,755는 원거리 시설 선택의 증거다 — 후보 점수는 맨해튼이라
  512² 밴드 공터의 먼 시설이 뽑히면 BFS가 넓게 퍼진다.

### 병목 상위 5 (--cpu-prof self time)

| 순위 | 함수 | 인구 200 | 인구 400 | 스케일 원인 |
|---|---|---|---|---|
| 1 | collectCandidates (sim/tick.js:241) | 32.0% | **49.1%** | idle 결정 × 시설 × 자원 전수 루프 — 시설 수 ∝ 인구 → O(인구²) |
| 2 | BFS 계열 (bfsPathInner+isWalkable+래퍼) | **34.1%** | 17.1% | 호출당 prev.fill 262,144칸 + 원거리 플러드 |
| 3 | tick 본문 인라인 (sim/tick.js:682) | 12.8% | 9.7% | 틱마다 전 심 순회 루프 다수 (§22.19 수요, 페어링, 감쇠) |
| 4 | memoryModFast (sim/cognition.js:97) | 6.4% | 8.5% | 결정 × (action\|시설) 쌍 — 시설 수 비례 |
| 5 | processGreetings (sim/interaction.js:172) | 1.2% | 1.8% | 근접 쌍 스캔 O(인구²) |

(프로파일: 인구 200은 2일 측정 21.1s, 인구 400은 1일 측정 130s. 나머지는 GC ~2%,
pickBest·scoreCandidate 각 ~1%.)

### 이 계측이 기록을 어떻게 고치나

- §17.22의 "BFS 0.2%, 주범은 retrieval"은 **그 시점 인구(~30)에서만 참**이었다.
  시설이 512² 밴드 공터로 퍼진 뒤에는 BFS가 2위로 올라온다. 과거 계측을 현재 세계에
  외삽하지 말 것 — Codex가 요구한 재계측이 정확히 이 함정을 잡았다.
- 이슈 본문의 원인 추정("BFS가 idle 결정마다 실행")은 여전히 거짓이고, 본문 정정의
  잔여 후보(prev.fill 전맵 초기화)는 실측으로 확증됐다. A* 보류 합의는 유지한다.
- 최적화는 이 절의 범위가 아니다 (§0.1: 알고리즘으로 달성하되, 계측이 먼저).
  후속 이슈에 근거 수치와 함께 등록했다 — 후보 스캔 / BFS / 3~5위 묶음.
  전부 결과 해시·고정 회귀 테스트 선행 계약이다.

### §22.12 실행 — 라이브 프루닝

pruneEvents가 **부팅 때 한 번만** 불려서 켜 둔 세션에서 events가 무한 증가했다
(QA 실측 107게임일 205,092행·53.8MB, 시간당 +31MB). 이제 일 경계를 지난 **첫 커밋
뒤**에 프루닝한다 (Engine.pruneAfterCommit):

- 따라잡기 배치(=1일)와 라이브 flushLive 양쪽 — 긴 부재도, 긴 라이브도 상한 안.
- 커밋 트랜잭션과 **분리된 후행 트랜잭션**이다. cutoff(30일 전)는 pendingEvents 범위
  (최근 ≤30틱)와 절대 겹치지 않으므로 커밋 순서와 충돌하지 않는다.
- DB 정리일 뿐 world를 읽지도 쓰지도 않는다 — 결정성 계약 무관.
- 보관 정책은 기존 그대로 30게임일 + 일 집계 축약. 실제 삭제가 있으면 ops_log에
  `events_pruned`를 남긴다 (하루 1행).
- 회귀: storage.test.js 16c — 따라잡기 32일 + 라이브 2일에서 30일 이전 행 0 확인.
  16d — 타입·심별 총량과 money delta 합이 집계로 정확히 이월됨.

Codex 교차 리뷰(조건부 GO) 이행: ① getReport의 두 해상도(원본 30일 vs 일 집계) 의미
계약을 주석으로 명문화 — 합산하지 않는 것은 의도다. ② lastPruneDay를 프루닝 **성공
후** 갱신 — 실패 시 다음 커밋에 재시도, 오류는 삼키지 않음(§4 안전 정지). ③ 위의
대표성 한계 문서화. ④ 합성 세계 결정성(B1)·도달성(B2)·프루닝 보존(16d) 테스트 추가.

## §22.28 상호 자기 공개 — 그리고 대사 테이블에서 반복된 배선 누락

**연구 근거**: Brummelman, Bos, de Boer, Nevicka & Sedikides (2024),
*Developmental Science* 27(6), e13516, **CC BY**. 218쌍이 9분간 번갈아 질문을
주고받은 실험에서, 깊은 자기 공개 조건의 아이가 잡담 조건보다 **그 순간** 더
사랑받는다고 느꼈다. 핵심은 *번갈아*다 — 한쪽이 듣기만 해서는 그 효과가 없다.

**적용**: 호감 있는 청자는 맞장구가 아니라 자기 얘기로 되받는다.
호감이 없으면 되받지 않고 인정만 한다 — 실험의 비상호 조건을 대조군 그대로 남겼다.
관계 온도가 문장 **형태**로 드러나므로 플레이어가 수치를 안 봐도 읽을 수 있다.

**정적 읽기로는 못 본 것.** 처음엔 코드만 보고 "memory_share 13종 중 11종이 고정
문장 1개"를 고쳤다. 배포 후 라이브를 다시 재니 진짜 문제는 따로 있었다 —
세계는 **38종**(logic/params.json의 memory.importance)을 기록하는데 대사 테이블은
13종만 알았고, 실제 발생 분포는 코드가 아는 것과 어긋나 있었다:

| | 라이브 4000건 중 memory_share 635건 |
|---|---|
| 대사 있고 자주 발생 | party_info 132 · starving 48 · meal 42 · relationship_changed 19 |
| **대사 없는데 자주 발생** | **sick 138 · unmet 85 · was_helped 32 · new_neighbor 30 · welfare 28 · small_talk 28** |
| 대사 있는데 발생 0 | drank · workout · argument · found_item · built_bed |

**376건(59%)이 "오늘 ○○에서 별일이 다 있었어" 하나로 뭉개지고 있었다.**
가장 자주 기억되는 일일수록 할 말이 없었다. 주제 단위로만 세면 안 보인다 —
§22.15도 이 절의 첫 커밋도 그래서 놓쳤다.

배선 없는 키는 조용히 죽는다. car·smoke가 PROP_KEYS 누락으로 안 보이던 §22.10과
같은 부류이고, 이번엔 대사 테이블에서 일어났다. **QA-13**이 그 재발을 막는다 —
params.json의 모든 기억 종류에 대사가 있는지 검사하고, 없으면 깨진다.

곁가지로 나온 것: `unmet` 기억의 `placeId`는 **장소가 아니라 행동 이름**이었다
(라이브 확인: `'eat'`). placeKo에 넣으면 "eat 하려는데"가 그대로 찍힌다.
대사용 동사형 `ACTION_TRY_KO`를 따로 뒀다 — 기존 `ACTION_KO`는 UI 라벨용
명사형('식사')이라 문장에 못 쓴다.

**한계(정직하게)**: `listenerWarmth`가 라이브 635건 중 632건이 1이라 비상호(냉담)
분기는 거의 안 뜬다. 사이가 나쁜 쌍은 애초에 대화를 잘 안 하기 때문으로 보인다.
지표를 건드려 억지로 띄우지 않는다 (§0.1) — 관계가 식는 경로가 생기면 그때 보인다.

문장 수: 발화 15 → 137종, 응답 0 → 87종. 시뮬 로직 무관(sim/ 미변경).

## §22.29 후속 질문 — 소식을 맞장구로만 받고 있었다

**연구 근거**: Huang, Yeomans, Brooks, Minson & Gino (2017),
*Journal of Personality and Social Psychology* 113(3), 430–452. **All rights reserved**
(APA — 링크만, 표 ②). 실제 2인 대화 3건에서 질문을, 특히 **앞말을 받아 묻는 후속
질문**을 많이 한 사람이 상대에게 더 호감을 샀다. 기제는 반응성(responsiveness) —
듣고 있고, 이해했고, 관심이 있다는 신호다. 스피드데이팅 데이터에서는 후속 질문율이
높은 쪽이 두 번째 만남 승낙을 더 받아냈다.

**관찰**: 최근 대화 3000건의 주제 분포에서 `couple_news`가 **642건(21%)으로 2위**인데
`replyLine`에 분기가 아예 없었다. `sweet_talk`(65건)도 마찬가지다. 둘 다 일반 맞장구
("응응!"·"완전 공감해"·"ㅋㅋㅋ 맞아")로 받고 있었는데, **소식은 원래 되묻는 자리다.**

**적용**: 되묻는 말이 반응성이 되려면 앞말의 *실제 내용*을 가리켜야 한다. 그래서
payload에 이미 있는 `aboutSimId`·`detail.otherId`·`detail.kind`를 문장에 넣는다:

> "이서현이랑 박나윤 사귄대!" → **"누가 먼저 좋아했대?"**
> "이서현이랑 박나윤 결혼했대!! 대박" → **"식은 어디서 했대?"**

연인끼리(`sweet_talk`)는 되묻는 방향이 다르다 — 소식을 캐는 게 아니라 상대 쪽으로
돌린다("당신은 오늘 어땠는데?"). 호감이 없으면 되묻지 않고 화제를 닫는다
("본인들 일이지 뭐") — 질문하지 않는 것이 곧 반응성 없음이라는 논문의 대조 그대로다.

§22.28의 상호 자기 공개와 다른 동작이다. 거기서는 청자가 **자기 얘기**를 내놓고,
여기서는 **상대 얘기를 더 캐낸다**. 자기 공개에는 공개로, 소식에는 질문으로 받는다.

논문의 주장이 소식에 국한되지 않으므로 기존 warm 응답 배열 6곳
(gossip·work_gripe·weather·food·family_talk·party_invite)에도 후속 질문을 섞었다 —
`pick()`은 tick 기반 결정적 선택이라 **배열 추가로만** 넓혔다(§22.12 (b)).

문장 수: couple_news 발화 8 → 18종·응답 0 → 12종, sweet_talk 응답 0 → 10종,
기존 6개 주제 응답 +17종. 시뮬 로직 무관(sim/ 미변경).

**한계(정직하게)**: `listenerWarmth`가 couple_news 1212건 중 1194건이 1이라 화제를
닫는 냉담 분기는 거의 안 뜬다 — §22.28에서 적어 둔 것과 같은 한계이고, 원인도 같다
(사이가 나쁜 쌍은 애초에 대화를 잘 안 한다). 지표를 건드리지 않는다 (§0.1).

## §22.30 죽어 있던 프롭 셋 배선 — 그리고 에셋 스크립트가 내 작업을 지웠다

**감사 결과**: `PROP_KEYS` 54개 중 **3개(`fence_wood`·`bench2`·`street_tree_lit`)가
로드만 되고 `put()`이 한 번도 없었다** — 매 세션 텍스처를 올리면서 영원히 안 보이는
상태였다. `car`·`smoke`가 `PROP_KEYS` 누락으로 죽어 있던 §22.10과 같은 부류인데,
이번엔 **키는 있는데 그리는 자리가 없는** 반대 방향이다.

Codex의 배선 요청("fence_wood를 공원·화단 경계에 배치 필요")을 받아 셋을 다 살렸다.
울타리는 목업의 "구획 경계는 낮은 석벽·나무 울타리" 문법을 그대로 따라 공원 둘레
도로 줄(y-1, y+h)에 놓는다.

**Codex 리뷰 NO-GO 2건**, 둘 다 실제 결함이었다:
- **폭이 홀수인 공원에서 마지막 울타리가 경계를 한 칸 넘는다.** 이 마을 공원은
  16×10 하나와 7×5 열 개다. `fx < x+w`로 돌면 7칸짜리에서 마지막 칸이 이웃 도로를
  가로막는다. 2타일이 온전히 들어갈 때만 놓고, 홀수면 안쪽에서 한 칸 겹쳐 채운다.
  폭 1·2·3·4·5·7·16 전부에 대해 덮는 범위가 `[x, x+w-1]`을 벗어나지 않음을 검산했다.
- **원화 해상도가 표시 크기와 안 맞는다.** 193×148을 h=24로 그리면 6배 축소라
  픽셋이 뭉개져 말뚝처럼 보인다(화면 캡처로 확인). 코드에서 h를 키우는 건 오답이다 —
  폭이 같이 늘어 2타일 간격이 깨진다. Codex가 **32×24 실사용 해상도로 다시 그렸고**,
  이제 1:1로 표시돼 기둥과 가로대가 그대로 읽힌다.

기존 `put('fountain', fac.x+8, ...)`·`put('flowerbed', fac.x+13, ...)`는 7×5 공원에서
이미 공원 밖으로 벗어난다. 이번엔 손대지 않았다 — 별도 판단이 필요한 자리다.

### 도구 결함: 에셋 에이전트가 사람의 미커밋 작업을 지웠다

이 절의 배선 작업을 커밋하기 전에 에셋 회차를 한 번 더 돌렸더니 **통째로 사라졌다.**
`tools/asset-agent.sh`는 실행이 끝난 뒤 `git status`를 읽어 "PNG가 아닌 변경 =
Codex가 건드린 코드"로 보고 `git checkout --`로 되돌린다. 그 귀속은 **깨끗한
baseline에서만** 참인데 검사가 없었고, 되돌리기가 사본도 남기지 않았다.

두 겹으로 막았다: ① 시작 전 트리가 더러우면 Codex를 부르기도 전에 거부(exit 1),
② 그래도 되돌릴 때는 `logs/reverted-<timestamp>/`에 사본을 먼저 남긴다.
더러운 트리에서 거부되는 것과 깨끗한 트리에서 정상 동작하는 것을 모두 확인했다.

## §22.31 험담은 대부분 험담이 아니다

**관찰**: 라이브 3000건 중 `gossip`이 **780건(26%)으로 1위**인데, 놀랍게도
`sentiment`가 **780건 전부 양수**였다 — 부정 분기(7줄)는 한 번도 안 뜬다.
`tier`는 friend 727 · acquaintance 53인데 `tier`를 보는 줄이 8개 중 1개뿐이었다.
결국 **26%의 대화가 8개 문장을 돌려쓰고 있었다.**

**연구 근거**: Robbins & Karan (2020), *Social Psychological and Personality Science*
11(2), 185–195. 467명에게 EAR(자연 관찰 녹음기)를 채워 모은 험담 **4,003건 중 거의
4분의 3이 중립**이었다(부정 604 · 긍정 376). 내용은 대개 '사회적 정보'였다.
즉 사람들은 남 얘기를 **평가하려고가 아니라 전하려고** 한다.
(SAGE 구독 저널 — 링크만, 표 ②. 출판사 페이지가 403이라 라이선스를 육안 확인하지
못했고 **보수적으로 전량 유보로 분류**했다. 수치는 저자 소속기관 UC Riverside의
공식 보도 페이지에서 직접 확인했다. §4.2에 한계를 적어 두었다.)

**이 세계의 대사는 정반대였다** — gossip 8줄이 전부 평가였다("좋은 사람이야",
"정 많더라", "진짜 베프야"). 연구가 말하는 4분의 3, 즉 **그냥 전하는 말**이 통째로
없었다. 그래서 평가하지 않고 정보만 옮기는 문장을 넣었다:

> "김보라 요새 통 안 보이네" · "김보라가 일 바꿨다던데, 들었어?" ·
> "어제 시청 앞에서 김보라를 봤어" · "김보라가 이번에 뭐 하나 해냈다더라"

**tier도 제대로 쓴다.** 친구 얘기와 얼굴만 아는 사람 얘기는 거리가 다르다.
acquaintance(53건)는 단정하지 않고 물러선다 — "이름은 아는데 얘기는 잘 안 해봤어",
"어디 사는지는 나도 몰라". 예전에는 두 tier가 같은 문장 풀을 썼다.

받는 말도 같이 넓혔다. 남 얘기의 대부분이 정보라면 응답도 동의("그니까 말이야")만이
아니라 **정보를 주고받는 말**이어야 한다 — "그 얘긴 처음 듣네", "나도 몇 번 봤어",
"어디서 봤는데?".

문장 수: friend 8 → 18종, acquaintance 8종(전용 풀 신설), 응답 8 → 14종.

**부정 분기는 그대로 둔다.** 7줄이 살아 있지만 `sentiment`가 늘 양수라 안 뜬다.
이건 클라이언트가 고칠 수 있는 게 아니다 — `sentiment`는 `sim/`에서 온다. 안 뜬다고
지우지도, 뜨게 하려고 시뮬을 건드리지도 않는다 (§0.1). 관계가 상하는 경로가 생기면
그때 저 7줄이 제 자리를 찾는다. 참고로 연구에서도 부정은 15%로 소수였다.

시뮬 로직 무관(sim/ 미변경).

## §22.32 바닥이 잔디에서 석재 광장으로 — 목업에 크게 다가섰고, 도로를 잠깐 잃었다

Codex가 자율 회차에서 `tile_grass.png`를 **석재 광장 텍스처로 교체**했다. 이건 질감
손질이 아니라 **의미 변경**이다 — 이 타일은 맵 262,144칸 중 **236,976칸(90.4%)**의
바탕이라, 마을 전체의 지면이 초록에서 회갈색 석재로 바뀌었다.

목업의 첫 문장("마을 전체가 따뜻한 회갈색 석재 포장 광장")에 처음으로 제대로
다가섰다. **직전 회차에 내가 "타일을 다시 칠해서는 이 간극을 못 닫는다"고 적었는데,
그 판단은 틀렸다.** 나는 "어느 칸이 포장이고 어느 칸이 잔디인가"를 맵 데이터 문제로
봤지만, 바탕 자체를 포장으로 바꾸면 그 질문을 우회할 수 있었다.

### 대가: 도로가 사라졌다

바탕이 도로와 같은 색이 되면서 도로망이 화면에서 지워졌다. 평균 RGB 색거리로 재면:

| | 예전(초록 바탕) | 직후(석재 바탕) | 수정 후 |
|---|---|---|---|
| `tile_road` vs 바탕 | 79 | **18** | **52** |
| `tile_pavement` vs 바탕 | 100 | **5** | **54** |
| `tile_road` vs `tile_pavement` | — | — | **83** |

미관 문제가 아니었다. **§22.26 공공사업의 시각적 성과가 통째로 사라지는** 문제였다 —
정부가 사람들이 많이 걸은 길을 포장하는 게 이 기능의 핵심 피드백인데, 포장 후
색이 5만큼 변하면 아무도 알아채지 못한다. 맵에 도로 5,269칸·광장 포장 976칸이
실재하므로 둘 다 읽혀야 한다.

측정 가능한 합격 기준(바탕 대비 ≥45, 도로↔포장 ≥20)을 주고 Codex에게 두 타일을
다시 그리게 했다. **Codex가 보고한 수치를 그대로 믿지 않고 직접 재서 확인했다** —
road-grass 52.4 · pavement-grass 54.0 · road-pavement 83.0으로 모두 통과.
목업의 "가장자리에 흙·꽃 테두리" 문법대로 밝기가 아니라 **가장자리 처리**로
구분되게 했다.

### 남은 이름 지뢰

`tile_grass.png`의 내용물이 석재인데 키 이름은 `tile_grass`이고, 코드에는
`grass_cell`·`grassBg`·`ensureTerrain`이 그대로다. 누군가 "잔디가 왜 회색이지?"
하고 되돌리면 마을 전체가 다시 잔디밭이 된다. `ensureTerrain`에 경고 주석을 달았다.
이름 변경은 렌더 코드 수술이라 별도 회차로 미룬다.

### 아직 남은 목업 간극

목업은 "잔디는 정원·화단 구획 안에만" 있다. 지금은 **잔디 텍스처가 아예 없어서**
초록이 남은 곳은 나무 타일(46칸)뿐이다. 즉 '전부 잔디'에서 '전부 석재'로 건너뛴
상태이고, 가운데(구획 안의 초록)가 비어 있다. 이건 텍스처만으로는 안 되고 구획
데이터가 필요하다 — Codex도 다음 회차 과제로 같은 것을 지목했다.

## §22.33 간호사도 공장 노동자도 시장도 아이도 똑같은 말을 하고 있었다

**관찰**: `work_gripe`가 라이브 3000건 중 358건(4위)인데, 세계에는 직업이 **16개**
(`sim/traits.js`의 `OCCUPATIONS`)인 반면 대사 테이블은 **10개**만 알고 있었다.
빠진 직업이 곧 흔한 직업이었다:

| 대사 없는 직업 | 라이브 건수 |
|---|---|
| `worker` (공장) | 34 |
| `child` | 22 |
| `nurse` | 20 |
| `civil_servant` | 15 |
| `politician` | 15 |
| `retired` | 0 (아직 은퇴자 없음) |

**106건(30%)이 `['일이 너무 많아…', '오늘은 좀 고된 날이었어', '일이 손에 안 잡히는
날도 있지']` 세 줄로 나오고 있었다.** 반대로 `police`는 대사가 있는데 표본에 한 번도
안 나왔다. §22.28(기억 종류)·§22.31(gossip)과 **정확히 같은 부류**의 결함이 세 번째로
나온 것이다 — 세계가 내보내는 값의 집합과 클라가 아는 집합이 어긋나 있다.

**연구 근거**: **O*NET 31.0 Database** (USDOL/ETA), **CC BY 4.0** —
O*NET Resource Center 라이선스 페이지에서 직접 확인했다. 911개 직업의 Work Context를
실측한 데이터라, "무엇을 힘들다고 말하는가"가 직업마다 다르다는 것을 짐작이 아니라
수치로 확인할 수 있다. 실제로 읽은 값:

- **간호사**(29-1141.00): 타인의 건강·안전 책임 '매우 높음' **66%**, 감염 노출 매일
  **61%**, 오류의 결과 '매우 심각' **57%**, 화난 사람 상대 매일 **42%**, 보호장구 **51%**
  → 핵심은 '일이 많다'가 아니라 **책임의 무게와 접촉**이다.
- **조립생산직**(51-2092.00): 손 사용 **85%**, 반복 동작 **48%**, 보호장구 매일 **91%**,
  소음 매일 **52%**, 정확성 '매우 중요' **77%** → 몸과 반복과 정확성.
- **입법직**(11-1031.00): 리더십 100·청렴 98, 주 업무가 **상충하는 이해의 조정**
  → 갈등이 부작용이 아니라 일 그 자체다.

그래서 간호사는 "내 실수 하나가 어떻게 되는지 아니까 늘 긴장이야"라고 하고,
공장 노동자는 "기계 소리가 퇴근하고도 귀에 남아"라고 하고, 시장은 "결정하고 나면
꼭 누군가는 서운해해"라고 한다.

**받는 말도 직업을 탄다.** 예전에는 전부 "그래도 오늘 끝났잖아"였는데 아이에게도
은퇴한 사람에게도 말이 안 된다 — 둘 다 끝낼 근무가 없다. 남의 생명을 쥔 직업
(간호사·의사·소방관·경찰·시장)에 "한잔 하러 갈까?"도 어긋난다. 세 갈래로 나눴다.

**QA-14**가 재발을 막는다 — `OCCUPATIONS`의 모든 직업에 대사가 있는지 검사하고,
없으면 깨진다. `nurse` 분기를 임시로 지워 실패하는 것을 확인하고 복구했다.

문장 수: 직업 10 → **16종**(발화 +30), 응답 7 → 22종(직업 3갈래).
시뮬 로직 무관(sim/ 미변경 — `OCCUPATIONS`는 읽기만 한다).

## §22.34 정치 얘기는 의견을 말하는 자리가 아니라 의견을 감추는 자리다

**관찰**: 선거철이 되면서 `politics`가 라이브 3000건 중 **293건(10%, 5위)**으로 올라왔다.
그런데 detail 조합이 **단 하나**(`{phase:'campaign', mayorId:33}`)라 유세 분기의 문장
6개가 293건을 전부 감당하고 있었고, `replyLine`에는 분기가 **아예 없어** "완전 공감해"·
"ㅋㅋㅋ 맞아" 같은 일반 맞장구로 받고 있었다. 정치 얘기를 그렇게 시원하게 받는
사람은 드물다.

**연구 근거**: Schmitt-Beck & Schnaudt (2023), *Politische Vierteljahresschrift*
64(3), 499–523, **CC BY 4.0**. 본문 515쪽 그대로:

> "participants of such talks tend to avoid clear opinion statements if they entail
> the prospect of open disagreement"

그리고 초록의 핵심 발견은 낯선 사이의 정치 대화가 이론의 예상("낯섦 = 차이")과 달리
**오히려 화기애애하다**는 것이다. 참여를 가르는 것도 정치적 성향이 아니라 **사회적
신뢰와 갈등 성향**이었다. 즉 사람들은 정치 얘기에서 **의견을 내는 게 아니라 관리한다.**

**적용** — 유세 대사를 네 갈래로 넓혔다:
1. **유보** — "나는 아직 마음을 못 정했어", "뽑아놓고 봐야 아는 거지 뭐"
2. **떠보기**(내 패를 안 보이고 상대를 먼저 묻는다) — "너는 누구 생각하고 있어?"
3. **이념 대신 눈에 보이는 동네 일** — "공약보다 길이 언제 포장되는지가 궁금해"
4. **그래도 말하는 소수** — "이번엔 투표 꼭 하자"

받는 말도 같이 유보한다("나도 아직 잘 모르겠어", "그러게, 두고 봐야지"). **양쪽이
다 물러서기 때문에** 대화가 화기애애하게 끝나는 것이고, 그게 논문이 관측한 역설이다.
호감이 없으면 화제를 닫는다("그 얘긴 그만하자") — 정치는 이 세계에서 **닫는 것이
자연스러운 유일한 주제**다.

문장 수: 유세 6 → **16종**, 임기 중 6 → 10종, 응답 0 → **14종**(유보 10 · 차단 4).

**라이선스 확인 경위(§4.1 준수)**: Springer 페이지는 쿠키 벽이라 "open access" 배지만
보이고 CC 문구·저작권 줄이 렌더되지 않았다. **배지만으로 판정하지 않고** EconStor에
올라온 출판사 조판본 PDF에서 라이선스 문단과 "© The Author(s) 2023"을 직접 추출해
CC BY 4.0을 확인했다.

시뮬 로직 무관(sim/ 미변경).

**한계**: `listenerWarmth`가 293건 중 287건이 1이라 화제를 닫는 분기는 거의 안 뜬다 —
§22.28·§22.29·§22.31에 적은 것과 같은 한계이고 원인도 같다.

## §22.35 가족 얘기가 전부 따뜻했다 — 그리고 발화·응답이 어긋날 자리를 없앴다

**관찰**: `family_talk`이 라이브 3000건 중 **272건(6위)**인데 문장이 11줄뿐이고,
**11줄이 전부 화목한 얘기**였다("목소리 들으면 마음이 놓여", "밥 먹는 것만 봐도
배부르다"). 가족 관계가 그렇게만 생기지는 않는다.

**연구 근거**: Silverstein, Gans, Lowenstein, Giarrusso & Bengtson (2010),
*Journal of Marriage and Family* 72(4), 1006–1021. 6개국 노년 부모–성인 자녀 관계를
**애정과 갈등 두 축**의 잠재계층분석으로 나누면 네 부류가 나온다:

| 부류 | 애정 | 갈등 | 비율 |
|---|---|---|---|
| amicable (화목) | ↑ | ↓ | ~61% |
| detached (소원) | ↓ | ↓ | ~23% |
| disharmonious (불화) | ↓ | ↑ | ~9% |
| **ambivalent (양가)** | **↑** | **↑** | **~8%** |

**가족 관계의 약 40%는 그냥 따뜻하지 않다.** 특히 양가 부류는 애정과 갈등을
*동시에* 갖는다 — 어느 한쪽으로 정리되지 않는 것이 그 관계의 성질이다.
(구독 저널. PMC 사본은 NIH 저자 원고이고 OA 서브셋이 아니라 CC가 아니다 — 링크만, 표 ②.)

payload에 애정·갈등 신호가 없어 계층을 판정할 수는 없으므로 **배열 안의 비율로**
분포를 근사했다(각 13줄 = 화목 8 · 소원 3 · 불화 1 · 양가 1).

> 소원: "연락은 하는데 할 말이 길지가 않아"
> 불화: "또 언성이 높아졌어"
> 양가: "걱정하는 마음인 건 아는데, 그게 또 부담이야"

### 구조 변경: 발화와 응답을 짝으로 묶었다

불화·양가를 넣자마자 새 결함이 보였다 — "또 언성이 높아졌어"에 **"가족이 최고지"**가
돌아간다. 발화 배열과 응답 배열이 따로 있고 `pick()`이 각각 뽑기 때문이다. 게다가
한쪽 배열에만 줄을 더하면 **조용히** 어긋난다.

`pick(arr, t)`는 `t % arr.length`라 배열 길이가 같으면 같은 인덱스가 나온다는 점을
이용해 `[발화, 응답]` 한 줄을 최소 단위로 만들었다. 짝이 어긋날 자리가 **구조적으로**
없어진다 — 테스트로 막는 것보다 낫다. QA-15는 표가 그 모양을 유지하는지만 본다
(응답 칸을 지워 실패하는 것을 확인하고 복구했다).

문장 수: 11 → **26줄(발화 26 · 짝 응답 26)**. 시뮬 로직 무관(sim/ 미변경).

## §22.36 여자가 남자 모습으로, 87세가 청년 모습으로 (사용자 지적)

**증상**: 여성 심이 남성 스프라이트로, 그 반대도. 나이가 들었는데 젊은 모습.

**원인**: `archOf()`가 **직업만** 봤다.

```js
const m = ARCH_OF_OCCUPATION[sim.traits?.occupation];
return m !== undefined ? m : sim.id % 10;
```

`traits.gender`도 `traits.age`도 읽지 않는다. **서버는 그 둘을 이미 보내고 있었다**
(`server/view.js`가 `gender`·`age`·`occupation`·`mbti`를 추려 보낸다) — 클라가 안 쓴 것이다.
§22.10의 car·smoke, §22.30의 fence_wood와 같은 부류다: **데이터는 와 있는데 쓰는 쪽이 없다.**

제복 스프라이트는 성별이 하나씩뿐이라(경찰·의사·간호사·교사·요리사는 **여성만**,
소방관·점원·노동자·바리스타는 **남성만**) 직업만 보면 **반드시 절반이 어긋난다**.
게다가 `freelancer`는 `ARCH_OF_OCCUPATION`에 아예 없어서 `id % 10`으로 떨어졌다 —
11명이 성별·나이와 무관한 무작위 원형을 받고 있었다.

**측정** (라이브 인구 기준, 성별은 F↔M 정면 모순만 계산 — X는 모순 대상이 아니다):

| | 수정 전 | 수정 후 |
|---|---|---|
| 성별 모순 | 39명 (36%) | **11명 (10%)** |
| 나이대 불일치 | 10명 (9%) | **0명** |

48/112명의 스프라이트가 바뀌었다.

**고친 방법** — 우선순위를 **나이대 → 성별 → 직업**으로 뒀다. 87세를 청년으로 그리는
어긋남이 제복을 잃는 것보다 크고, 성별이 틀린 것은 그보다 더 크다. 제복은 성별이
맞을 때만 입힌다. 나이 경계는 시뮬 상수를 따랐다(`child` 직업 `age < 15`,
`society.retireAge = 65`).

**중간에 데이터가 내 가정을 뒤집었다.** 처음엔 성별을 M/F 둘로 보고 `'F'가 아니면 M`으로
짰는데, 측정하니 불일치가 30%→37%로 **늘었다**. 이 세계의 성별은 셋이다 —
`sim/traits.js`의 `GENDERS = ['F','M','X']`, 각 1/3 균등, 라이브 28명이 X다.
X를 남성으로 몰면 그것대로 4분의 1이 어긋난다. X는 '지정 없음'이고(정보판도 이미
`'-'`로 표시한다) 어떤 스프라이트와도 모순되지 않으므로, 제복도 평상복도 양쪽을 다 쓴다.

**QA-16**이 영구 불변식을 고정한다: 나이대는 언제나 맞고, 성인은 성별이 모순되지 않는다.
직업 조건을 예전 동작으로 되돌려 96건이 잡히는 것을 확인하고 복구했다.

### 남은 것은 에셋 부족이다 — 코드로는 못 고친다

남은 10%는 전부 **없는 그림**이다:

| 없는 원형 | 해당 인원 | 지금 어떻게 그려지나 |
|---|---|---|
| 노년 **여성** | 7명 | 노년 남성(원형 4)으로 — 나이는 맞고 성별이 틀리다 |
| **여아** | 4명 | 남아(원형 10)로 |

평상복 원형도 여성이 하나뿐(원형 0)이라 제복 없는 여성이 서로 비슷해 보인다.
Codex에게 원형 14(노년 여성)·15(여아)를 의뢰했고, 오면 `WALK_ARCHETYPES`를 16으로
올리고 `ARCH_LOOK`에 등록하는 것이 배선 작업이다(원형당 walk·walkup·pose 4프레임씩 12장).

## §22.37 시장의 정책 발표가 한 번도 화면에 나온 적이 없다

§22.36 스프라이트 작업을 배포하고 브라우저 콘솔을 보다가 발견했다. 사용자가 지적한
증상과는 별개인데, 같은 성질의 결함이다 — **화면이 데이터를 잘못 다루고 있었다.**

```
Uncaught TypeError: Cannot read properties of undefined (reading 'welfareThreshold')
```

`policy_changed`를 렌더하는 곳이 `e.payload.before[k]`를 무조건 읽는다. 그런데
**시장 경로만 `before`를 안 싣고 있었다.** 플레이어 경로(`sim/tick.js:633`)는 처음부터
넣는데, §22.22에서 추가한 시장의 재정 검토(`sim/society.js`)에서 빠졌다.
라이브 DB의 `policy_changed` 6건이 **전부** `before`가 없었다.

결과가 작지 않다. 예외가 나면 그 이벤트 한 줄이 아니라 **피드 렌더 전체가 멈춘다.**
즉 §22.22를 넣은 이래로 **시장이 정책을 바꿀 때마다 피드가 죽었고, "🏛️ 시정 발표"가
화면에 나온 적이 한 번도 없다.** 사용자가 "수장이 된 사람이 하는 행동이 아무것도
없다"고 지적해서 만든 기능인데, 정작 그 행동이 보이지 않고 있었다.

**두 군데를 고쳤다.**
- `sim/society.js`: 시장 경로도 `before`를 싣는다. `cur`가 곧 변경 전 값이라 바로 쓸 수 있었다.
- `client/main.js`: `before`가 없어도 죽지 않는다. **이미 쌓인 과거 이벤트가 그렇기 때문에**
  시뮬만 고치면 옛 이벤트에서 계속 죽는다. 없으면 "세율 10%로"처럼 after만 쓴다.

**F-6**이 계약을 고정한다: `policy_changed`는 어느 경로에서 나오든 `before`를 싣고,
바뀐 키마다 before가 있어야 하며 after와 달라야 한다. 기존 F-1~F-5는 `changes`와
`reason`만 봤기 때문에 이걸 못 잡았다 — **페이로드가 화면과 맺은 계약**을 아무도
검사하지 않고 있었던 것이다. 시장 경로의 `before`를 지워 실패하는 것을 확인하고 복구했다.

확인: 재시작 후 새로 나온 이벤트 두 건이 `before {"taxPct":13} → changes {"taxPct":10}`로
제대로 실렸고, 브라우저에서 40초간 새 예외가 없었다.

## §22.38 날씨 얘기는 날씨에 관한 얘기가 아니다

**관찰**: `weather`가 라이브 3000건 중 **330건(5위)**인데 detail 조합이 **하나뿐**이다
(전부 `sunny` — 지금 이 세계가 맑다). 그 8줄이 330건을 다 감당하고 있었다.

더 근본적인 문제는 수가 아니었다. **이 세계의 날씨 대사는 전부 날씨를 서술한다.**
"하늘색 봐라", "바람이 선선해서" — 정보를 전달하는 말뿐이고, 정작 이 주제의 본령인
**접촉을 만드는 말**이 없었다.

**연구 근거**: Malinowski의 **교감적 언어사용(phatic communion)**.
Senft, "Phatic communion" (*Handbook of Pragmatics*, John Benjamins). 인용된
Malinowski(1936: 314–316)의 요지:

> "Are words in Phatic Communion used primarily to convey meaning …? **Certainly not!**
> They fulfil a social function and that is their principal aim"
> "phatic communion serves to establish bonds of personal union … and **does not serve
> any purpose of communicating ideas**"

Malinowski가 이 개념을 만들며 든 예가 **바로 날씨였다** — "inquiries about health,
comments on weather", 그리고 `'Nice day to-day'`. 그런 말이 필요한 이유는
**마주 서서 침묵할 때의 낯설고 불편한 긴장을 넘기기 위해서**다. 첫 마디 뒤에는
"purposeless expressions of preference or aversion … **comments on what is [obvious]**"가
이어진다.

**적용** — 세 갈래를 더했다:
1. **침묵 깨기** — "어, 안녕. 날씨 좋네" · "여기서 다 보네" · "오늘은 날씨 얘기밖에 할 게 없네"
2. **뻔한 것에 대한 논평**(Malinowski의 표현 그대로) — "해가 밝다" → "밝지" · "덥긴 덥다"
3. **동조 요구** — "좋은 날이지? 안 그래?" · "이런 날 싫어하는 사람은 없지"

응답은 **동의가 기본**이다. 날씨를 두고 반박하는 사람은 드물고, 그 무해함이야말로
이 주제가 접촉의 도구로 쓰이는 이유다.

### 그러다 내가 만든 어긋남을 찾았다

§22.29에서 후속 질문을 넓히며 공용 날씨 응답 풀에 `'우산은 챙겼어?'`를 넣었다.
그런데 그 풀은 `kind`를 안 보므로 **맑은 날 대사에도 우산 응답이 돌아가고 있었다.**
§22.35의 짝 표 구조를 날씨에도 적용해 구조적으로 막았다 — `sunny`·`cloudy`·`rain`
각각이 `[발화, 응답]` 쌍의 목록이다. QA-15를 확장해 두 표를 모두 검사하고,
**맑은 날 짝에 '우산'이 들어 있으면 실패**하게 했다.

문장 수: 21 → **33쌍**(발화 33 · 짝 응답 33). 시뮬 로직 무관(sim/ 미변경).

## §22.39 가중 응답과 질문–응답 사슬 (사용자 지시)

> "10분주기 구어체로 다양한 대화 질문 응답을 연결시켜서 가중치로 다르게 답변할 수
> 있게 대화 테이블을 계속 만들어낸다"

**문제**: `pick(arr, t)`는 `t % len`이라 **모든 문장이 똑같이 자주 나온다.** 실제
구어는 그렇지 않다 — "덥다 진짜"는 흔하고 "난 괜찮은데"는 가끔이다. 빈도가 곧 그 말의
성격이라, 균등 분포는 말투 자체를 어색하게 만든다.

**`pickW(rows, t)`** — `[무게, 문장]` 행을 누적합으로 펼쳐 `t`를 대응시킨다.
rng를 쓰지 않으므로 같은 이벤트는 여전히 같은 문장이고 드로우 순서 계약과 무관하다
(클라 전용). 음수 tick도 감싼다.

**`QA_CHAINS`** — 키가 **실제로 뱉은 문장 그대로**다. `replyLine`은 `conversationLine`과
같은 이벤트를 받으므로 상대가 무슨 말을 했는지 정확히 안다. 덕분에 주제·분기 로직을
전혀 건드리지 않고 **이 표만 늘리면** 대화가 넓어진다 — 10분 사이클이 매 회차 여기에
줄을 더한다.

> "많이 온다, 그치?" → 많이 오네(5) · 엄청 와(3) · 금방 그치겠지(2) · 난 비 좋아(1)

일반 폴백 응답에도 무게를 줬다 — 어느 분기에도 안 걸리는 가장 흔한 자리다.

**QA-17**이 두 가지를 고정한다:
① `pickW`가 무게대로 뽑는가(1000회에 500/300/200 정확히).
② **모든 `QA_CHAINS` 키가 실제로 나올 수 있는 문장인가.** 키가 한 글자라도 다르면 그
사슬은 영원히 안 걸린다 — §22.28(기억 종류)·§22.30(프롭)·§22.33(직업)에서 **세 번**
반복된 "등록은 됐는데 도달 불가" 결함과 같은 부류다. 사이클이 매 회차 표를 늘리므로
여기서 막지 않으면 죽은 줄이 조용히 쌓인다. 가짜 키를 넣어 실제로 잡히는 것을 확인했다.

테스트를 쓰다가 **내 스윕이 부족해 멀쩡한 키를 오판**하기도 했다 — `work_gripe`는
`occupation`으로, `memory_share`는 `kind`로 갈리는데 그 조합을 안 훑고 있었다.
`OCCUPATIONS`와 `memory.importance`를 읽어 훑도록 고쳤다.

### 경로 탐색 세대 스탬프 (#98, 2026-09-03)

BFS의 북→동→남→서 방문 및 부모 좌표 선택 순서를 유지한다. 방문 표시는
`Uint32Array` 세대 스탬프를 쓰며, 호출마다 전맵 `prev.fill`을 하지 않는다.
세대 번호가 32비트에서 순환할 때만 방문 배열을 지운다. 지도 크기가 커지면 작업 배열을
다시 할당하고 작은 지도나 다른 지도로 바뀌면 새 세대로 분리한다. FIFO도 고정 typed array로
재사용한다. 캐시는 월드에 저장하지 않으며 지형 변경 후에도 이전 탐색의 표시를 사용하지 않는다.

71f1be2 기준 시드 20260831, 1,440틱 해시가 변경 전후 `30dbb19d`로 동일했다.
`node bench/popscale.js --pops 200 --days 3 --reps 2`: BFS 1,337→1,138ms/일,
전체 4,308→3,673ms/일, 호출 1,569/일·방문 10,148칸/호출 동일. 같은 머신의 best-of-2
측정이며 실행 부하에 따른 편차가 있다. 원거리 플러드의 방문 수 자체는 이번에 줄이지 않는다.

### 인도·차도 보호 계약 (#117)

보행 마모는 SIDEWALK(12)를 만들고 클라이언트는 포장 텍스처와 `sidewalk_formed` 증분
이벤트로 표시한다. 차도(ROAD=1)는 공공사업이 만든다. 공공사업은 모든 시설 footprint와
문 좌표에서 맨해튼 거리 1 이내를 제외한다. 보행 마모도 건물 footprint·문 주변에서는
길을 만들지 않지만 공원·연못의 열린 공간은 인도를 허용한다. 문 방향은 좌표로 판정한다.
보호 검사는 마모가 임계에 도달할 때만 수행한다. 기존 ROAD는 주민의 계획 이력을 알 수
없으므로 소급 변환하지 않는다. 타일 번호와 세이브 구조는 그대로이고 새 마이그레이션은 없다.

### 반복 우회 민원과 연결로 (#118, 세이브52·로직47)

이동 시작에 `state.journey={x,y,walked:0}`를 저장하고 2a 전진 칸마다 증가시킨다.
도착 시에만 맨해튼 직선 대비 `transport.detourMinExtra`(8)칸 이상, `detourRatioPct`(150%)
이상인 실제 이동을 기록한다. 차량도 이동 칸으로 센다. 취소 이동은 버리며, v51에서 이동
중이던 심은 출발점을 추정하지 않고 다음 새 이동부터 관측한다. RNG 드로우는 추가하지 않는다.
양 끝 타일 인덱스의 (min,max)가 양방향 경로 키다. `roadReports`는 최근 불만 기간 안의
심별 반복 횟수(상한 `detourRepeat`=3)를 저장한다. 같은 심의 세 번째 관측부터 `road_detour`
민원·`complaintDays`에 반영한다. 사람 수 청원 규칙은 그대로다. 원장 상한은 complaints.cap이고
공사 계획을 제외한 오래된 경로부터 퇴출한다. 진행 중이 아닌 보고는 windowDays 이후 만료한다.

NPC 공공사업의 기존 선거·유세·재정 리뷰·여유 국고 가드를 통과한 후, 마모 포장보다
반복 우회 보고를 먼저 검토한다. 진행 계획 → 최근 제보자 수 → 우회 초과 칸 → 시작/끝
인덱스 순으로 정렬한다. 현재 BFS로 우회가 아직 있는지 확인하고 수평/수직 우선 두 L자
경로 중 비용이 싼 연결로를 선택한다(동률 수평 우선). 시설·문 주변과 산·벽·바다는
변경하지 않는다. 시설 밖 TREE만 SIDEWALK로, RIVER만 BRIDGE로 연결하며 변경 칸 수는
기존 paveMaxPerDay 이하, 다리 칸 비용은 bridgeCostPerTile(500)이다. 임의 지형 전체
정비나 모든 우회 해소를 약속하지 않는다. 유효한 연결로가 없으면 민원은 해결되지 않는다.

첫 리뷰에서 `road_work_planned`만 발행한다. `routeWorkDays`(2일) 이후 재정 리뷰에서
현 지형·시설 보호·예산을 다시 확인하여 전체 연결로를 완공한다(기본 리뷰 간격에서는
5일 이상). 재정 부족 시 보류한다. 완공까지 타일·국고는 그대로이며 완공 비용은 국고에서
externalOutflow로 정확히 이동한다. map.reachVersion을 증가시키고 해당 wear를 제거한다.
`public_works` kind=route는 변경 타일 종류·실제 전후 거리·비용을 포함하며 클라이언트가
증분 반영한다. 공사 민원만 지우고 다른 민원은 보존한다. 도로 낀 부지의 zone 철거도
footprint wear를 초기화하고 철거 tileChanges/비용을 사건 기록·화면에 즉시 반영한다.

검증: 실제 22칸 이동 세 번 → 민원 → 계획 → 세이브/복원 → 다리 한 칸 → 다음 BFS 4칸.
동일 실행 해시·이벤트 일치, 비용 보존, 보호 시설/산/재정 부족/플레이어 시장/만료 보고는
무변경, v51 마이그레이션 멱등성을 검사한다.

### 능력의 현재치와 잠재치 (#96 1단계, 세이브53·로직48)

`potential`은 기존 `(seed,id,ability)` 해시 그대로다. `abilities`는 현재치로 유지해 기존
임금·적성·건강 소비자가 실제 능력을 읽는다. 새 심의 초기 현재치는 잠재치의 birthPct(10%)에서
matureAge(25세)의 adultPct(70%)까지 나이로 보간한다. 기존 v52 이하 세이브는 현재치를
그대로 보존하고 경험을 0으로 시작한다. 이미 잠재치에 도달한 기존 심은 추가로 성장하지
않는다. 과거 학업/경력을 추정하여 지급하지 않는다.

2c 수행 틱(완료 정산 전)에 독서·학생 근무는 studyTicks, 그 외 근무는 occupation별
careerTicks를 한 번 올린다(이동은 제외, 상한 1e9). 운동은 체력을 연습한다. 굶주림·피로가
위급하거나 아프면 경험 관측은 남지만 성장 진척은 쌓이지 않는다. 해당 능력의 진척
ticksPerPoint(7200틱)에 현재치 1점, 잠재치 상한으로 제한한다. 중단/저장 시 남은 진척을
보존한다. 직업을 바꿔도 이전 직업 경험을 다른 직업으로 복제하지 않는다.

새해 age+1 직후 졸업 적성 평가 전에 성장·노화를 적용한다. 성장기 자연 증가분은 나이별
누적 정수값의 차로 계산해 낮은 잠재치도 매년 버림 때문에 영구 정지하지 않게 한다.
건강·영양이 부족한 해는 자연 증가를 건너뛴다. physicalDeclineAge(60) 이후 체력/손재주,
mentalDeclineAge(75) 이후 지능/사교성이 declinePctPerYear(1%)씩 잠재치 기준으로 낮아지며
노화 비율 하한은 minAgePct(40)이다. 현재치 0 미만은 불가. 새 RNG 드로우 없음.
모든 튜너블은 `development.*`이며 기존 도시 `growth.*`와 별개다.

현재치 변화만 `ability_changed` 이벤트를 낸다. 서버는 현재치/잠재치만 추가 전송하며
경험 원장 전체는 보내지 않는다. 심 패널과 사건 기록에 현재/잠재치 표시.
학제 분리·대학 선택·천재 출생은 이 단계에 포함하지 않으므로 #96은 열린 상태다.

### 출생 천재 (#96 2단계, 세이브54·로직49)

자녀 생성 직후·sims.push 전에 출생 직전 인구 N으로 1/(N×10) 판정한다. 같은 일자의
다음 출생은 먼저 태어난 아이도 인구에 포함한다. seed/id/day와 고정 salt로 만든 독립
mulberry32 스트림에서 uint32를 얻고, floor(2^32/(N×10))×(N×10) 이상의 표본은 다시
뽑아 나머지 편향 없이 0을 선택한다. 이는 출생 전용 의사확률이며 world.rngSim과
rngWorldgen을 읽거나 전진시키지 않는다. 기존 §17.8 출생 드로우 위치·횟수는 그대로다.

천재는 기존 잠재치 중 가장 높은 분야 하나(동률 ABILITIES 순서)에만
development.geniusMin(120)..geniusMax(150)의 상한을 갖는다. 일반 분야의 0..99 해시는
그대로다. 신생아 현재치는 새 잠재치의 birthPct일 뿐이며 성장은 동일한 경험·영양·질병
규칙을 따른다. 즉 재능이 성취를 보장하지 않는다. isGenius와 geniusBirth(출생 인구,
분모, 날짜, 분야, 상한)를 저장하고 genius_born 사건을 남긴다. 초기 주민·이민·플레이어는
출생 사건이 아니므로 판정하지 않는다. 옛 세이브 주민은 소급 추첨 없이 false/null이다.

지도 이름표 및 패널에서 주인공은 ◆, 천재는 ⭐로 독립 표시한다. 서버 투영도 두 bool을
독립 전달한다. 학제 분리/진학 선택은 다음 단계이며 #96 전체 완료가 아니다.

### 학제·진학·실제 출석 (#96 3단계, 세이브55·로직50, Draft)

초7~12/중13~15/고16~18세는 별도 primary_school/middle_school/high_school로 등교한다.
19~22세는 해마다 한 번 대학 진학을 평가한다. 최초 선택은 현재 지능·SN·JP 가중
정수 확률과 seed/id/year riskHash로 정한다(rngSim 미소비). 취업 선택은 재추첨하지 않는다.
재학생은 진학을 계속 원하며, 통학 가능한 대학과 본인+동거 부모의 학비가 있어야 등록한다.
본인→부모id 순서로 연간 education.annualTuition(2000)을 원자 차감, 전액 국고 입금.
돈/대학/통학로가 없으면 보류, 다음 해 재검토. 기존 가구 자금 외 지원금을 만들지 않는다.
2026-09-04 사용자 추가 지시: 비진학자는19세부터, 진학자는 최종 선택 과정 졸업 후 근무한다.
학부(bachelorYears=4)·석사(mastersYears=2)·박사(doctorateYears=4)는 최소 수학 기간과
각 과정 실제 출석(degreeStudyTicks=20000/mastersStudyTicks=10000/doctorateStudyTicks=20000)을
모두 채워야 졸업한다. 나이만으로 졸업시키지 않는다. 학부/석사 졸업 시 다음 과정 선택을
독립 salt의 riskHash와 진학 확률×postgraduatePctFactor(50%)로 결정한다. 박사 이후 취업.
학업 기록은 과정별로 분리하며 이전 과정 출석을 다음 과정에 복제하지 않는다. 학비 미납으로
등록을 보류한 재학생도 근무/채용/무급 이직으로 학생 제한을 우회하지 못한다.

일일 이민 이후, 새해에는 age+1·자연 능력 변화 이후 전원 학제를 평가한다. 학교/직업이
바뀌면 기존 행동·예약을 해제한다. 위 과정 이수 조건을 충족해야만 학위 자격을 얻는다.
이전 student/child가 최종 졸업 또는19세 비진학으로 실제 취업할 때에만 적성 가중 직업 풀에서
rngSim 1드로우한다(대학 건물 존재만으로 확장 풀에 넣던 26세 졸업 폐지).
초기 생성/이민의 직업 추첨 드로우 수는 같지만 15~18세 후보가 student로 제한되어 결과는 달라진다.

study는 평일 education.startMinute(540)~endMinute(900), 하루 dailyStudyTicks(240)까지만 가능.
행동 지속시간60틱, 원하는 단계의 실제 학교 자원을 예약하고 이동한 뒤 수행한다. 2c에서
단계·시간·일일 상한을 재검증하고 출석+development.studyTicks를 기록한다. 임금 없음.
배움 적성은 studyDeficit(6500)로 후보 점수에 들어가지만 기존 위급 욕구 우선 규칙을 따른다.
옛 학생 work는 새 후보/수행 정산 모두에서 거부한다. study로 현재 지능 성장, 가짜 학업 소급 없음.

학교 건설은 일일 도시계획에서 단계별 실제 학령 인구/대학 진학 희망자 수가 교실 자원 수를
넘을 때 기존 공터에 착공한다. 같은 타입 진행 주문·프로젝트가 있으면 중복하지 않는다.
대학은 기존 tier3 게이트 유지. zone 비용을 국고에서 지출/externalOutflow에 기록하고 노동량을
채운 뒤 완공한다. 교실은 공용 자원이며 교사의 점유로 일시 부족할 수도 있다.
옛 school은 시설 id/좌표/자원 보존하며 primary_school로 이관, 로직의 옛 시설 참조도 번역한다.
모든 주민의 education 원장은 0에서 출발한다. 옛19세 이상 student는 학부 재학을 보존하되
과거 입학 시점/출석이 불명이므로 현재 나이부터 기록한다. 학위나 경력을 소급 생성하지 않는다.
신규 학교4방향+내부 에셋15종과 로더 연결 완료(2026-09-04). 실제 PNG 알파·중복·로더 검사와 독립 브라우저 투명 합성을 검증했다.
학생/19세 미만은 work뿐 아니라 construct/build/respond_fire/patrol도 금지하며, 옛 수행은 진척·정산 전에 취소한다.

고정 스냅샷 A/B는 docs/education-implementation.md 참조. 유급 학생 근무 제거 후 허기가
악화한 실험을 확인했고 #57 식사 지원 연계 후 같은 배치30일 A/B와 전체332개 검증을 마쳤다.
최종 수치는 docs/food-aid-validation.md의 마지막 표를 따른다. Claude 리뷰 요청·PR 병합 확인 후 종료한다.

## #57 공공 식사를 요청하는 행동 — #96 무소득 학생 회귀의 의존 작업

복지 현금 지급 캡은 그대로 둔다. 돈이 식사값보다 적고 장바구니가 비었으며 hunger가
needCritical 미만인 주민은 시청/시장의 실제 자원을 예약해 seek_food_aid를 선택할 수 있다.
기존 거리·성향·욕구 점수/위급 후보/경로 찾기를 그대로 쓰며 ACTIONS 끝에 append한다.
학생·아동·은퇴자도 요청할 수 있다. 이동이나 수행 도중에는 허기를 회복하지 않는다.
30틱 요청을 완료한 뒤 실제 자원 좌표·자격·국고를 재확인하고 식사를 제공한다.
국고200원을 외부 식재료 구입(externalOutflow)으로 지출하고 hunger를9000 회복한다.
이는 현재 게임의 일반 식사30×300과 같은 양이며 actions.seek_food_aid의 조정 가능한 기본값이다.
주민 현금을 만들지 않고 시청 매출로 국고에 재입금하지 않는다. 국고 부족/취소/잘못된 현장은
음식·지출 없이 실패한다. 단일 틱 동시 요청도 id순 정산하여 국고를 음수로 만들지 않는다.
public_meal_taken에는 시설·실제 회복·비용·남은 국고를 기록한다. RNG 드로우 추가 없음.
schema56/logic51로 구 궤적과 구분하며 기존 상태는 보존하고 신규 행동 기본값만 이관한다.
검증 및 고정 스냅샷 결과는 docs/food-aid-validation.md에 기록한다.

## #97 후보 수집 결과 불변 최적화

자기집 ID 조회, 결정 내 예약/쿨다운 가용 자원 공유, 유효 자원 발견 후 계획/기억 계산,
행동별 거리 외 점수 성분 공유, 일반 후보의 명시적 객체 필드 생성으로 반복 작업을 줄인다.
후보 순서·전수 점수화·정수 계산 순서·RNG·세계 상태는 그대로다. 최적화 전 커밋에
인구10/50/200 후보 전체/선택/이벤트/세계 해시 오라클을 먼저 고정했다.
인구200 best-of-3 벤치3527→2563ms/일(408→562tick/s), 결정/BFS 호출1494 동일.
검증 범위와 측정 한계: docs/candidate-scan-validation.md. G6 전체 목표 달성은 아니다.

## #98 BFS 후속: 중복 통행 검사와 목표 확정 후 탐색 제거

방문 검사 전에 좌표 경계를 확인하고, 이미 방문한 칸의 isWalkable을 반복하지 않는다.
N/E/S/W 순회는 유지하며 목적지 최초 발견 후 탐색을 중단한다. prev는 최초 발견 때
고정되므로 경로 좌표열 불변이다. 대표 경로 SHA와 3×3 모든 장애물/출발/도착 조합을
원본 BFS와 대조한다. RNG·저장 상태·스키마 변경 없음. 검증/한계는 docs/pathfinding-validation.md.
장거리 플러드 자체와 거리장/A* 검토까지 완료했다고 보지 않으며 #98은 후속 검토를 남긴다.

## #143 숨은 탭의 전송·할당 중지

클라이언트는 Page Visibility 상태를 WebSocket으로 알린다. 숨은 소켓에는 `tickBatch`를
직렬화·전송하지 않되 엔진과 다른 보이는 소켓은 계속 진행한다. 다시 보이는 순간 해당
소켓의 다음 연속 seq로 최신 전체 snapshot 하나를 보내므로, 숨은 동안의 화면 연출 사건은
재생하지 않고 현재 세계 상태로 즉시 복귀한다. 입력·틱·RNG·저장·리싱크 계약은 바꾸지 않는다.
`?diag=1&stream=paused`는 실제 숨김을 제공하지 않는 자동 브라우저에서 같은 프로토콜과
`window.__diag()`를 장시간 계측하기 위한 진단 전용 옵션이며 일반 플레이에는 동작하지 않는다.

## #51 명시적 가구와 성인 자녀 분가 의도

모든 주민은 저장되는 `householdId`를 가지며 구 세이브는 현재 `homeId`에서 결정적으로
초기화한다. 결혼한 두 주민은 안정 정렬한 결혼 가구 ID를 공유하고, 출생자는 부모 가구를
상속한다. 성인 자녀는 실제 부모와 동거하고, 학생·아동이 아니며, 유급 직업·준비금·빈집이
7일 연속 유지될 때만 분가 의도를 만든다. 의도는 다음 tick에 부모 동거·직업·준비금·빈집을
다시 확인해 적용하거나 사유를 기록하고 폐기한다. 인구·돈·침대를 새로 만들지 않으며 RNG를
소비하지 않는다. 일일 관측은 가구별 주민/부모/파트너/집, 현금, 예상 총소득, 고용자,
전체·남은 침대와 실패 사유를 기록한다. 상세 검증은 `docs/household-validation.md`를 따른다.

## #93 정수 지가·임대 폐쇄 회계·임대 부담 이사

주택 지가는 서비스 종류별 가장 가까운 실제 시설의 맨해튼 거리와 전날 완료된 실제 이용
횟수로 계산하는 정수 순수 함수다. 호가는 지가·침대 수에서 계산하고 공가도 같은 식으로
관측한다. 입주 가구들은 한 집의 임대료를 균등 분담하며 가구 구성원의 현재 현금에서만 낸다.
실제 생존 소유자가 있으면 그 주민에게, 소유자가 없는 공공 주택이면 국고로 정확히 이전한다.
부분 지급은 부족액을 그대로 기록하며 돈을 만들거나 없애지 않는다. 임대료/예상 소득 부담이
3일 지속되면 더 싸고 전원이 들어갈 빈집을 ID 순으로 선점해 내구 의도를 만들고, 다음 tick에
구성원·집·공실·가격을 재검증해 가구 전체가 이동하거나 실패한다. RNG는 소비하지 않는다.
검증은 `docs/housing-validation.md`를 따른다.

## #48 교통 관측 계약

교통 통계는 경로·행동·차량 속도·RNG가 읽지 않는 관측 전용 상태다. 실제 출발 성공 후 목적,
32칸 격자 OD, 차량 보유, 경로 길이·장거리를 집계한다. 경로 0은 출발과 별도다. 전진한 칸과
실제 전진 tick 수(차량은 여러 칸을 가도 한 tick), 도착·취소, 차도/인도 이용과 형성 이벤트를
기록한다. 자정 tick 전에 전날 상세 통계를 확정해 14일 링에 보존한다. 일일 `statsHistory`는
중첩된 날짜가 명시된 전날 요약을 싣는다. 구 세이브의 이미 이동 중인 사람은 부분 관측 도착으로
표시해 알 수 없는 출발·전체 소요시간을 만들어내지 않는다. 혼잡·주차·유발 수요의 인과 모델은
이번 통계에 존재하지 않으며, 0으로 측정됐다고 해석해서는 안 된다.

## #89 일일 사건 디렉터

일일 서브순서의 질병 → 화재 드로우는 종전과 같은 수·순서로 모두 소비한다. 적용 대신
로컬 후보를 모은 뒤 `seed/day/kind/target`의 FNV 해시·문자열 타이브레이크로 하나를 고른다.
최소 2일 간격·최근 7일 최대3회·직전 대상 미회복이면 보류한다. 건강·돈·인구를 보정하지
않으며 전염·진료·소방·자연 회복 경로는 바꾸지 않는다. 후보 콜백은 로컬에만 존재하고
저장에는 마지막 사건, 최근 배치, 14일 결정 이력만 남는다. `storyteller_decision`은 사건
배치 후 기존 선거/재정 평가 전에 emit한다. 신규 RNG draw는 없지만 실제 사건의 선택은
달라지므로 이후 세계가 기존 버전과 같은 행동을 한다고 주장하지 않는다.

## #76 식료품 생산·재입고·운반

`groceries` 한 품목에 재고를 도입한다. 시장/상가의 초기 재고12개는 신규 세계·구 저장 이관
시점의 유한 개장 재고로 `openingUnits`에 남긴다. 신축 매장은 재고0이며 국고에서 실제로
이전한 `targetStock×unitPrice` 한도의 운전자금으로 공급자에게 구매한다. 소비가 stock을
소모하며, 낮은 재고는 tick 후단에서 단일 주문을 만든다. 구매 예산은 시설 매출 안에 용도
지정해 임금으로 먼저 지출되지 않게 한다. 별도 잔고에 중복 합산하지 않는다.

성인에게 `grow_groceries`(주문이 있을 때 자기 집에서120tick 재배), `supply_groceries`
(시장까지 이동 후30tick 공급)를 append한다. 둘 다 `canWork`와 아동 제약을 통과해야 한다.
공급은 개인 비축3개를 남기며, 완료 시 주문·남은 현금·재고 공간을 재검증해 부분 거래 또는
실패한다. 실제 이동 없이 즉시 원거리 이전하지 않는다. 재배만 물건을 생산하고 공급/구매는
각각 개인↔시설 사이의 보존 이전이다. 돈은 시설→공급자 또는 소비자→시설로 같은 금액만
이전한다. RNG draw를 추가하지 않는다. 검증은 `docs/food-supply-validation.md`를 따른다.

## #90 부재중 연대기 최신 통합

Claude의 §22.24 원본·3차 교차 리뷰 반영 커밋을 보존해 현재 main에 통합한다. 보고서는
커밋 이벤트의 읽기 전용 투영이며 새 시뮬 상태·입력·난수를 만들지 않는다. 최근 원본 집계와
오래된 일 집계는 서로 다른 해상도이므로 합치지 않는다. 종류별8·전체48건 상한, 우선순위
선별 후 tick/ordinal 시간순 표시. 학생의 실제 학사/석사/박사 졸업은 현재
`education_decided` 이벤트로 선별하며 연대기가 취업을 지어내지 않는다.

최신 피드 필터·전체 직업 라벨·한국어 조사·식사 횟수 미표시 요구를 보존한다. 원본 Claude
워크트리와 localhost:3000은 수정하지 않는다. `test/chronicle.test.js`는 선별·커서·사망자
이름 보존 창·집계·현재 학위 졸업을 검증한다. 브라우저 스킬 파일이 없어 실제 화면 테스트는
별도 확인이 필요하며 코드/HTTP 검사와 혼동하지 않는다.

## #92 계절과 겨울 비축

`seasonAt`은 달력의 순수 정수 함수이며 RNG를 소비하지 않는다. 기본120일 년의 각30일이
봄/여름/가을/겨울이다. 비정수 분기는 올림 경계로 전환한다. 계절 상태는 하루 한 번 갱신하고
전환 때만 `season_changed`를 보낸다. 저장 이관은 현재 달력에서 도출하며 과거 사건을 만들지 않는다.

가을의 겨울10일 전부터 겨울 끝까지 `stock_food` 후보를 추가한다. 목표 비축은6개(개인
최대 재고 이하)이고 긴급 한 끼 현금200을 남겨야 한다. 시장까지 실제 이동해15tick 뒤
실재 재고를 구매한다. 부족한 개인 공간만큼 비례 결제하고, 완료 시 잔액·재고를 재검증한다.
이는 장보기이지 근무가 아니므로 학생도 가능하되 기존 아동 장보기 제한은 유지한다.
공급/상업 재배는 여전히19세 이상이며 최종 학위 과정을 졸업한 사람만 할 수 있다.

겨울에는 재배·여가 텃밭 수확과 낚시 수입을 정수50%로 내림한다. 낚시 RNG draw 수는 기존과
같다. 야외 이동/여가에는 energy 소모1을 더하고 실내 휴식에는 더하지 않는다. 기본 압박이
같은 상태에서 비축만 끈 대조군과 비교한다. 재현 명령은 `node bench/season-stocking.js 9200`.
사망·굶주림 시간·비축·학생 노동을 함께 보고, 재고 증가만으로 안전하다고 판단하지 않는다.

## #91 정착민/시민 생활 단계

`needsTier`는 공통 심 생성 경로에서 level0·실적0으로 시작한다. 이전 저장에도 과거 충족
실적을 만들어주지 않는다. 매 tick 욕구 감쇠 후 네 욕구가 모두4000 이상이면 실적+1,
기본 생존 욕구(hunger/energy)가1000 미만이면 실적−1(하한0)이다. 누적7200에서 level1.
level1에서는 생존 결핍 연속720tick일 때 level0으로 강등하고 승급 실적을 초기화한다.
전환 이벤트만 `needs_tier_changed`로 저장한다. RNG·직업·학위·임금·인구의 직접 변경 없음.

level1 문화 충족값은10000에서 tick마다1씩 줄어든다. append 행동 `visit_culture`의 점수는
이 결핍으로 계산하지만 기존 생존 위급 후보가 우선한다. 도서관/영화관 일반 좌석으로 이동,
40tick 완료 시 시설 존속·화재·현금(서비스100+한끼200)을 다시 검사한다. 성공 때만100을
시설로 이전하고 문화값10000, fun+2000(상한10000), 방문 횟수+1이다. 이동/수행 도중에는
효과나 비용이 생기지 않는다. 문화 부재/만석 수요는 기존 일상 원장R로 연결하고, 무자금은
시설 증설 수요가 아니다. 긴급 원장에는 문화 욕구를 넣지 않는다.

문화 욕구 결핍은 사치 욕구이므로 그 자체로 강등·사망·임금 감소를 만들지 않는다. 학생은
문화 소비자일 수 있으나 근로자가 아니다. 화면은 생활 단계와 전환·행동을 표시한다.
재현: `node bench/needs-tiers.js 9100`(자연120일). 결정성·이관·실물 서비스·정수 경계는
`test/needs-tiers.test.js`, 기존 노동 제한은 교육/공급 회귀가 보호한다.

## #32 R-C 1단계: 마을 저장 구조

schema66/logic62. `world.villages=[{id:'village:0',name:'해솔',foundedTick:0,center}]`와
`nextVillageId=1`을 도입한다. 기존 시청 문이 중심이며 없으면(0,0). 과거 이관에서 모든
기존 시설은 기본 마을에 귀속하고 주민은 자기 집 소속으로 귀속한다. 과거 개척·이주 사건은
발명하지 않는다. 공통 심 생성자에 villageId, 신축 시설에 공터의 villageId(기본 해솔)를
전달한다. 실제 모든 거주지 변경 경로에서 소속을 동기화한다. 임시 방문은 거주를 바꾸지 않는다.

`villageSummary`는 현재 주민·시설·주택·침대·점유 침대 수의 순수 투영이며 snapshot에서
읽을 수 있다. 국고·평판·시장 상태는 여전히 기존 세계 단위가 권위다. 분리하지 않은 돈이나
정치를 마을 객체에 복제해 두 권위를 만들지 않는다. 이 단계는 행동·난수·인구·현금 변경0을
계약으로 하며 #32 전체 완료가 아니다. 다음 단계는 실제 포화/서비스 권역에서 나오는 개척
청원, 승인·거부와 이주, 그 후 양방향 방문/교통이다.

seed3200, 직전 #91 구현과4320tick 비교: 이벤트 전부 동일, 마을 필드와 스키마만 제외한
전체 상태 해시가 양쪽925a8908로 동일했다. 신규 이관/생성/건설/방문 소속/저장 재개는
`test/villages.test.js`로 검증한다. localhost:3000과 사용자 저장은 수정하지 않는다.

### #32 개척 경로 구현 중 — 청원과 승인/거부

schema68/logic65의 `founding`은 일일 주거 부족 증거와 청원을 영속화한다. 마을 주민 수가
실제 침대 수 이상이고 빈집·지역 건축 가능 공터·예정 주택이 없으며 근무 가능한 성인이
`founding.minSettlers`(2)명 이상일 때만 부족일을 센다. 기존 `zone.centerRadius`가 지역
범위다. 공사/주문 중인 주택은 중복 plotId를 제거해 예정 용량으로 센다. 잘못된 plotId는
용량으로 인정하지 않는다. 학생·미졸업 학위 과정·19세 미만은 노동 파견 후보가 아니다.

`founding.petitionDays`(3)일 연속일 때 청원을 한 번 낸다. 같은 날 재평가와 활성 청원 중복은
금지하며 날짜를 건너뛰어도 과거 부족일을 만들어주지 않는다. 여건이 개선되면 대기 청원은
철회되고 종료 이력은32개만 보존한다. 이 과정은 인구·돈·건물·난수를 바꾸지 않는다.

**아직 미완료인 경로**: 새 마을의 자체 정부·독립 재정, 양방향 왕래 및 자연 포화 상황 검증.
청원·건설 단계만으로 #32를 닫거나
이 브랜치의 개척 기능 전체가 완료됐다고 선언하지 않는다.

승인 사전 검증 `quoteFoundingSites`는 파견 최소 인원에 맞춰 2침대 주택 부지를 요구한다.
모든 부지는 기존 마을 중심에서 지역 반경의2배 이상 떨어져 있고 새 중심 반경 안에 모여야
한다. 실제 건설 가능 타일, 부지끼리/예약된 공사와의 겹침, 연결된 보행 영역, 전체 주택 비용,
현재도 남아 있는 포화 조건과 도달 가능한 성인 후보를 검사한다. 복사한 지도에 주택을 모두
배치해, 빈 땅에서는 연결되어도 완공 후 출입문이 서로 막히는 배치를 거부한다.
비용 차감·부지 예약·인구 이동은 하지 않는 순수 견적이다. 원문의 '자체 시장'은
행정 책임자를 뜻하므로 상점(market) 신축을 개척 필수 조건으로 요구하지 않는다.

`found_village`는 기존 내구 입력 큐에서 sequence 순으로 적용한다. 승인 payload는
`{petitionId,decision:'approve',name,homePlotIds}`, 거부는
`{petitionId,decision:'reject',reason?}`다. 거부 사유는 not_now/site_unsuitable/budget_priority
중 하나이며 기본 not_now. 알 수 없는 필드, 잘못된 이름/부지, 이미 결정된 청원을 거부한다.
HTTP와 시뮬레이션이 같은 형식 검증을 쓰며, 현재 조건과 비용은 실제 적용 tick에서 검증한다.
승인은 이름·파견 후보·부지·견적 비용을 plan에 저장한다. 이것은 지출/부지 예약/신규 마을
생성이 아니다. 승인 계획은 활성 상태로 보존하여 청원 중복과
이력 정리로 소실되지 않도록 한다. 거부 후에는 새로운 부족일3일이 쌓여야 다시 청원한다.
SQLite 입력 중복 억제와 적용 전/후 엔진 재구성은 test/founding.test.js가 검증한다.

승인 다음 tick에 부지·기존 지정 인력·현재 비용을 재검증한다. 비용이 승인 견적보다 올랐거나
학생 전환/사망/다른 마을 이동 등으로 인력이 달라지면 대체 인원을 몰래 넣지 않고 취소한다.
통과 시 국고에서 건설비를 1회 지급하고 기존 유상 zone과 같이 externalOutflow에 기록한다.
부지의 foundingPetitionId와 유상 건설 주문이 예약의 권위이며 기존 동시 공사 슬롯을 따른다.
동일/겹치는 부지를 다른 zone이나 자동 계획이 차지할 수 없다. 공정은 선택된 성인이 실제
현장 작업점에서 construct할 때만 전진한다. 현장 점은 완공 후 벽이 아닌 내부 바닥으로 잡는다.

공사 인력이 부적격해지거나 착공 재검증이 실패하면 미완공 주문/공사만 취소·환불한다.
환불은 외부 시공사가 돌려주는 금액으로 externalInflow에 기록한다. 완공 건물은 지우지 않고
공공 주택으로 남긴다. 성공한 개척 주택은 실제 정착 전까지 foundingPetitionId를 유지하여
이민·독립/임대 이사·플레이어 생성·자동 과밀 이사의 빈집 후보가 되지 않는다. 건설 완료는
awaiting_settlement이지 새 마을의 성립이나 주민의 이사 완료가 아니다.

`node bench/founding-construction.js 32`는 포화/평탄 지형을 만든 **통제 fixture**다.
이후 assign이나 공정 단축 없이 기존 성인의 자율 행동으로 건설하고, 인구/거주지 즉시 변경이
없음을 검사한다. 자연 월드에서 포화가 발생했다는 증거나 다중 마을 전체 완료 증거는 아니다.
seed32 실행 결과: tick3000→11975(6.2326게임일), construct 시작84회, 완공1채,
파견 인력0·1, 부적격 노동0, 인구10 유지. main의 기분 바닥선을 통합한 logic65의 정착 대기
해시는6648c01e이다(가족 정착 추가 전 logic65:42bf7fe7). 공사 이동 중 저장·재개는
집중 테스트에서 이벤트·최종 해시·중복 지출 없음으로 별도 검증한다.

### #32 가족 단위 실제 정착 (PR161, 구현 중)

승인 시 노동 가능 성인과 함께 이주할 기존 가족을 구분해 저장한다. 가족 2명까지 주택,
그 이상은 8인 아파트를 견적·유상 공정에 포함한다. 이 명시적 개척 승인의 주거는 일반
도시 등급 해금과 별개이며 무료 건물이 아니다. 대가족은 각 집에 성인 보호자가 있어야 한다.
가족 신분/거주지가 바뀌면 기존 계획을 취소하며 새 주민으로 조용히 대체하지 않는다.

완공 후 gathering → travelling → settled 단계를 저장한다. 기존 집 앞에 모이고,
실제 경로 길이에 맞는 배고픔·기력 여유가 있으면 전원이 도보로 출발한다. 자동차 보유자도
한 칸/tick으로 움직이며 이동 중 일반 강제 행동·자동 이사·동거가 이주를 덮어쓰지 않는다.
최종 집 문에 전원이 실제 도착해야 village_founded를 한 번 내고 소속과 집을 변경한다.
이 단계의 기록은 schema68/logic65 기준이다. 아래의 행정·재정 분리를 이어서 적용하며,
평판/도로/성장/왕래 경로가 남아 있으므로 R-C 전체 완료를 주장하지 않는다.

`node bench/founding-construction.js 32 --settle`: 통제 지형에서 assign/공정 단축 없이
tick3000→12745, 6.7674게임일, 공사 시작84회, 집1채, 두 번째 마을1개, 인구10 유지,
부적격 노동0, hash0a8da960. gathering/travelling에서 각각 저장·복원하여 이후 이벤트와
최종 전체 해시가 일치하고 이동이 한 칸/tick 이하임을 검사한다. 자연 포화·30일 양방향
왕래·브라우저 시각 검증의 증거는 아니다. 별도 회귀 테스트는 학생/자녀 포함 가족 배정,
대가족 보호자, 경로 단절 취소(완공 집 보존·환불0), 실제 도착 전 소속 불변을 검사한다.

`--settle --family`는 기존 주민 중 두 성인과 12세 학생을 같은 가구로 배치하는 통제 fixture다.
인구 생성·공사 단축 없이 실제 아파트 공사234회, tick27437(16.9701일)에 세 명이 정착한다.
hash420b9930, 노동 부적격0. 이 확장 검증에서 학생 직업의 12세가 결혼하던 기존 오류를
발견했다. 연애/결혼의 주체와 상대 모두 19세 이상이어야 하도록 나이 검사를 추가했다.
기존의 잘못된 미성년 관계를 임의 삭제하지는 않지만 결혼/합가로 진행시키지 않는다.

### #32 지역 행정·재정 권위 연결 (schema69/logic66, 구현 중)

원래 마을은 기존 world.treasury/policy/mayorId를 권위로 유지한다. 새 마을은 별도의
government를 소유하고 잔액0에서 시작한다. 이관은 자금이나 과거 수입을 복제하지 않는다.
publicBalance는 이 잔고들의 합일 뿐 새 지갑이 아니다. WebSocket snapshot의 publicTreasury와
마을 요약의 government는 관측 값이고, 요약 정책 객체도 원본과 분리한다.

정착 후 다음 일일 평가에서 새 마을은 최초 선거를 치른다. 지역의 19세 이상 유권자와
근무 가능한 성인 후보만 참여한다. 재정 정책·수당·복지·육아 지원은 각 정부의 권위와
해당 주민 참조를 사용하는 문맥에서 실행한다. 집계 불만에는 simId가 없으므로 지역
주민의 complaintDays 증거로 필터한다. 다른 마을 불만이 재정 정책을 바꾸지 않는다.

소득세/취득세와 의료·식사 지원은 거주지 귀속, 공공 임금/등록금/공공 임대료/매출 정산은
실제 시설 소재지 귀속이다. 시설 개장 자본, 구획별 유상 건설과 개척 승인/환불도 해당
관할 잔고에서 처리한다. 전역 externalInflow/Outflow는 세계 경계 거래만 계속 집계한다.
테스트는 실제 work 완료의 관할별 급여/세금과 전체 통화 보존, 타 마을 예산 오사용 차단,
선거/정책 분리, 저장 재개 동일성을 검사한다.

**남은 경로 (아래 후속 구현 전)**: 평판 효과·지역별 추세 통계·도로/중심지 자동 계획·도시 성장·산업/학교 수요,
정책 입력의 마을 선택, 지역 행정 UI, 양방향 왕래. 아직 독립 행정 전체나 R-C 완료가 아니다.
schema69/logic66 통제 benchmark: 건설만 hashf805e374(t11975), 성인 정착 hashd5bc588a
(t12745), 자녀 포함 정착 hash44496de2(t27466,234회 공사,학생 노동0). 학생 시장 수당도
근무 금지에 맞춰 차단하므로 자녀 fixture의 자금/행동 경로는 이전 버전과 달라졌다.

`--settle --family --government`는 실제 정착 이후 2일을 추가로 진행한다. t30346에 새 마을
주민3명, 시장0, 자체 국고122를 관측했고 양쪽 정부를 포함한 폐쇄 회계115063 및 저장/재개
전체 해시2cb0f49b가 일치했다. 그 사이 기존 시스템의 정상 이민으로 전체 인구는12가 되었다.
직접 인구 조작이나 지원금 주입은 하지 않는다. 이는 2일 행정 확인이며 30일 왕래 증거가 아니다.

### #32 지역 평판·관측 추세 (schema70/logic67)

봉사·방치 화재·공장 공해는 실제 시설 소재지, 순찰은 소속 마을에 반영한다. 사건 보상은
명시된 villageId → 시설/집/장소 → 당사자 거주지 순서로 귀속한다. 특정 마을이 없는 기존
전역 축제/승급은 기존 마을 경로를 유지하며, 지역 성장/이민의 후속 연결은 아직 필요하다.
지역마다 평판을 감쇠하고 청원을 별도 재무장한다. 한 마을 청원이 이웃의 평판이나 청원
상태를 건드리지 않는다. 상한/감쇠/보상량은 기존 logic 수치를 그대로 사용한다.

전역 statsHistory는 전체 인구/모든 국고의 합계를 기록한다. 지역 관측은 기존 마을의
village.statsHistory 및 새 마을의 government.statsHistory에 분리한다. 180개 상한,
같은 날 대체, 관측한 날만 저장하며 과거 전역 자료를 임의의 지역 추세로 복제하지 않는다.
지역 재정 검토는 이 이력만 사용하므로 원래 마을 잔고가 회복 중일 때 이웃 적자 때문에
잘못 긴축하지 않는다. 최초 분리/이관 시 지역 추세는 미관측(빈 배열)부터 시작한다.
요약에서 반환하는 정책·이력은 복사본이며 권위를 수정할 수 없다.

검증은 실제 봉사 완료·방치 화재·일일 공해, 사건 귀속, 지역 청원 격리, 서로 반대인
재정 추세에 따른 정책 선택, 180일 상한/같은 날 재관측, 이관/저장 재개를 포함한다.
통제 가족 정착 후2일 benchmark의 시각/인구/국고/폐쇄 회계는 앞 단계와 같고
새 기록을 포함한 전체 해시는d664db32이다. 30일 왕래/자연 포화/지역 성장 완료 증거가 아니다.

### #32 마을 지정 내구 정책·시정 패널 (schema70/logic68)

기존 policy payload `{taxPct:20}`은 원래 마을을 대상으로 유지한다. 새 평면 payload
`{villageId:"village:1",taxPct:20}`은 선택한 마을의 정책/입력 보호기간에만 적용된다.
마을 ID는 경제 파라미터가 아니므로 changes에서 분리하며 알 수 없는 마을, 빈 변경,
허용되지 않은 키/범위는 거부한다. `constructor`/`__proto__` 같은 상속 속성은 허용 목록에
속하지 않는다. HTTP와 tick이 동일 검증을 수행하므로 접수 후 대상이 사라져도 다른 마을에
대신 적용하지 않는다. SQLite 중복 억제와 적용 전/후 엔진 재구성으로 정확히1회 적용을 검증한다.

시정 패널은 실제 마을 선택·해당 국고·정책을 보여주며 미지정 수치는 현재 서버 logic의
policyDefaults에서 읽는다. 실시간 국고 갱신이 사용자의 편집 중 슬라이더 값을 덮지 않는다.
제출 중에는 대상/시행을 잠그고, 닫았다 다시 열어도 중복 제출을 허용하지 않는다. 접수 응답은
정책 시행 완료가 아니라 내구 기록 완료로 표시한다. 네트워크 오류는 상태를 낙관적으로
변경하지 않고 표시한다. 정책 피드/기록에는 명시적으로 선택한 마을을 표시한다.

검증: 순수 검증/무효 입력 원자성, 대상별 보호기간, 마을 간 같은 tick 입력 순서, SQLite
중복/재시작, 실제 패널 초기화 코드의 DOM 이벤트 계약(대상 선택·기본값·미저장 편집 보존·
중복 잠금·오류·대상 소멸)을 검사한다. DOM 계약 테스트는 실제 브라우저 스크린샷 검증이 아니다.
남은 범위는 도로/중심지, 지역 성장·이민·산업/학교 수요, 행정 UI 확장과 실제 양방향 왕래다.

### #32 마을별 계획 중심지 (schema70/logic69)

`plan_center`는 선택적 villageId를 받으며 생략하면 기존 마을이다. 잘못된 마을은
대체하지 않고 거부한다. 선택한 마을 국고만 차감하며 경계 유출·중심지 목록·ID는
공유 월드에 한 번 기록한다. 기존 중심지는 소속 생략=기존 마을로 읽어 과거 기록을 보존한다.
NPC 시장은 자기 주민의 외곽 주거 수요, 자기 소속 공터와 기존 중심지, 자기 국고로
투자를 판단한다. 학생/미완료 학위 과정은 투자 결정을 하는 근무 시장에서도 제외한다.
개척 예약 부지는 후보에서 제외하며 건설 위치 점수도 같은 마을 중심지만 참조한다.
다만 건설 종류/슬롯·성장 수요의 지역 분리는 후속 작업이다. 도로·지역 성장/이민·
산업/학교 수요·양방향 왕래와 상위 로드맵은 미완료다.

검증은 선택 국고/경계 유출 보존·저장 재개·주민/공터/중심지 관할 격리·학생/미졸업
시장 차단을 포함한다. 임시 DB와 임의 포트의 실제 HTTP→WebSocket→재동기화 snapshot에서
기존 입력과 villageId 입력의 중심지 소속/잔액을 확인한다. 사용자 3000 서버는 사용하지 않는다.

### #32 마을별 도로 투자 (schema71/logic70)

실제 보행에서 생긴 우회 보고는 거주 마을별 키/소속을 갖는다(원래 마을 키와 과거 기록은 유지).
공공사업은 전체 선거·재정 평가 뒤 마을 순서로 실행하고, 각 마을은 지역 주민 반복 보행·
국고·lastPublicWorksDay를 쓴다. 이미 계획된 책임은 보고자가 이주하더라도 원래 정부에 남는다.
완공 전 공유 지도의 경로·보호 시설·비용을 재검사한다. 이웃이 이미 같은 다리를 만들었다면
보고/불만만 정리하고 재지출하지 않는다. local view의 복제된 지도 버전·숫자 필드에 쓰지 않고
원본 reachVersion·externalOutflow·roadReports·complaints에 기록해 저장과 길찾기 캐시가 일치한다.

마모 포장은 이미 누적된 wear만 사용한다. 타일에서 창건 마을 중심까지 맨해튼 거리 최소,
동률이면 마을 ID 오름차순으로 관리 주체를 정한다. 계획 중심지 추가로 관리 경계를 바꾸지 않는다.
시설 보호는 소유 마을과 무관하게 전 지도를 검사한다. 학생/미완료 학위 시장은 투자하지 않는다.
v70 이하 이관은 새 정부의 투자 일일 가드만 -1로 추가하며 기존 국고·보고·승인 책임을 보존한다.

검증: 실제 반복22칸 보행→계획→4칸 다리, 지역 국고/폐쇄 회계/공유 지도 버전, 저장 재개,
동일 구간 두 마을 청원 중복 지출 없음, 마모 구역/동률 결정성/타 마을 시설 보호, 학생·박사
미졸업 시장 차단, 기존 저장의 보고/잔액/일일 가드 보존. 지역 성장·이민·산업/학교 수요와
실제 양방향 방문 및 상위 교통·세계 이벤트·외교 범위는 여전히 미완료다.

도로 구현 전체530/530 통과 후 마지막 불만 관할 격리까지 도로/정부 집중26/26 통과했다.
build는 기존 큰 번들 경고만 남는다. 통제 지형 가족 건설/정착 후2일 benchmark는 새 마을
주민3·시장0·국고122·총 공공잔고136545·폐쇄 회계115063을 유지하며 저장 재개 해시882ea044다.
이는 자연 포화나30일 양방향 방문 완료 증거가 아니다.

### #32 마을별 승급·외부 이민 (schema72/logic71)

기존 이민 주기와 wave=min(immigWaveMax+cityTier,1+floor(reputation/immigPerExtra))를
마을 생성 순서대로 각 정부에 적용한다. 각 도착 직전에 자기 마을의 인구/빈 침대를 다시
확인한다. 다중 마을에서는 지도 입구(2,23)→집 문 연결도 필요하며, 도달 불가면 RNG/ID/자금
유입 없이 건너뛴다. 단일 마을의 기존 드로우/입구 계약은 유지한다. 실제 입주는 기존
외부 이민 경로의 생성과 도보 생활을 사용하며 신규 마을 집에 인구를 주입하지 않는다.
RNG/immigrantCounter/ID/관계 행렬/경계 유입은 root에만 기록하고 입국 공공 정원·이웃 기억은
거주 마을 기준이다. 외부 이민과 마을 간 기존 주민 이동은 별개이며 후자는 아직 미완료다.

승급은 이민 후 각 마을의 인구로 평가한다. cityTier는 기존 정부 world 권위를 유지하고
추가 정부는0에서 시작한다. 이관 시 기존 승급 이력을 강등하거나 이웃 등급을 복제하지 않는다.
평판 보너스/축하 기억과 구획 허용 등급은 지역 소유이며 자동 주택 타입과 대학 부지도
현지 등급을 따른다. 수요량 자체와 건설 슬롯·산업/학교 수요 분리는 여전히 후속이다.

실시간 연결 점검에서 engine→WebSocket 전달부가 villages/publicTreasury/policyDefaults를
누락하던 문제도 수정했다. 실제 임시 HTTP/WS 테스트로 재접속 전 tickBatch의 잔액·등급·
공공 합계·정책 기본값을 검사한다. 새 마을 승급은 기존 마을 배지를 덮지 않으며 피드에
대상 마을 이름을 쓴다. 지도 구획 메뉴 등 확장 행정 UI는 후속이다.

최종 전체537/537 통과, 집중24/24 통과, build 통과(기존 큰 번들 경고). 기존 가족 정착
벤치마크는 새 마을 빈 침대에 실제 이민 이벤트1건이 추가되어 정착 후2일 주민4명·전체13명,
시장0·국고122·폐쇄 회계115063·저장 재개 해시1a49d2b3이다. 과거 주민3명 고정 fixture는
실제 이민 이벤트/ID를 함께 요구하도록 갱신했다. 인구를 억제해 옛 값에 맞추지 않았다.
이는 통제 지형/수용량 검증이며 자연 포화·마을 간 중력 이주/30일 양방향 왕래의 완료 증거가 아니다.

### #32 실제 정착 이후 미배정 공터 귀속 (schema72/logic72)

실제 정착 완료 직후와 일일 사망 평가 뒤, 기존 미배정/미사용/buildable 공터만 확인한다.
주민이 남아 있는 추가 마을의 창건 중심까지 맨해튼 거리<=zone.centerRadius이며 보행 연결이
있으면 후보가 된다. 기존 마을 중심 반경은 보존한다. 선택은 거리→마을 ID, 처리/이벤트의
plotIds는 plotId 오름차순이다. 명시적 소속은 변경하지 않고 새 공터/타일/돈/주민은 만들지 않는다.
구획 주문·공사·승인 개척의 부지/footprint/문·유상 개척 예약·타 정부의 유상 계획 중심지 반경은
보존한다. 이후 취소나 도로 연결로 실제 조건이 바뀌면 다음 일일 평가가 재검토한다.

기존 plot.villageId 저장 필드를 사용하므로 저장 스키마는72를 유지하며 로직만72로 올린다.
이관 로딩 때 과거 소속을 다시 쓰지 않는다. village_land_assigned는 실제 변경된 plotIds만
보내며 클라이언트의 기존 공터 메타데이터를 갱신한다. 다음 스냅샷에도 같은 소속이 남는다.
지역 청원의 공터 수와 지역 중심지/구획 재정은 기존 소속 필드를 바로 소비한다.
건설 수요량/슬롯·산업/학교 배분 및 실제 마을 간 이동/방문은 여전히 미완료다.

전체542/542 통과, 정착/부지 집중14/14 및 이후 추가된 인접 개척 문 보호/실제 클라이언트
이벤트 처리까지 부지 집중7/7 통과, build 통과(기존 번들 경고). 실제 정착 전에는 부지를
배정하지 않고 도착 이후 귀속한다. 클라이언트 코드 테스트는 브라우저 시각 검증이 아니다.

### #32 지역 건설 및 사용자 중심지/대학 피드백 (logic73, schema72)

다중 지자체 자동 건설은 주민·시설·최근 인구 기록·학교 수요·산업 증거·국고를 지역별로
판정한다. 실제 근무 가능한 주민만 사무실 수요를 만든다. 진행/주문 용량은 계획에만
반영하며 완공 전 침대는 만들지 않는다. 건설 슬롯과 주문 FIFO는 지자체별이며 개척
주문은 출발 지자체 책임이다. 산업 개념의 전역 해금은 지역 수요 증거를 대신하지 않는다.

localhost:3000 읽기 전용 관측: 중심지(186,120), 부지73/74/75는 x192 도로 한 줄과
겹쳐 기본7×5 건설 검사를 실패했다. 진행 공사/주문은 없고 국고는 약500만원이었다.
계획 중심지 반경의 도로만 겹친 미사용·미예약 부지를 하루 계획 시 최대8칸 이내의
잔디 부지로 결정적으로 조정한다. 도로·지형·주민·자금은 변경하지 않으며 기존 소속,
사용/주문/개척 예약과 다른 부지·시설을 보호한다. plot_relocated 이벤트가 클라이언트
부지 좌표를 갱신한다. 수요 없는 중심지가 무조건 건물을 생성하는 기능은 아니다.

대학 신축은12×10(고등학교8×6)이며 기존 스프라이트도 실제 footprint에 맞춰 커진다.
교육 슬롯 수는4를 유지하고 좌표만 넓어진 내부로 분산한다. 회전 축조는 최종 footprint만
찍어 회전 전 영역의 도로를 지우지 않는다. 대학과 다른 대기 공사의 겹침을 방지한다.
기존 완공 대학은 자동 철거/확장하지 않는다. 이전8×6 대학 공사는 넓은 부지가 없으면
기존 크기로 완공한다. 실행 중인 localhost:3000 서버/저장은 아직 수정하지 않았다.

검증: 전체555/555, 마지막 중심지/지역 건설 집중17/17, 교육 포함 집중32/32,
build 통과(기존 번들 크기 경고). 최신 라이브 스냅샷의 오프라인 복사본에서 부지73이
(186,120)→(180,120)으로 바뀌며 모든 맵 타일이 보존됨을 확인했다. 대학 부지가 없는
좁은7×5 부지에서도 실제 주택 수요는 아파트 착공으로 진행됨을 확인했다.
실행 중 저장의 기존 대학 확대/배포와 #32의 마을 간 이동·방문, 광역 로드맵은 미완료다.

### #32 건설 창의 소속 일치

건설 모달이 기본 마을 cityTier만 보고 plan_center에 villageId를 보내지 않던 경로를
수정했다. 선택 부지 소속의 정부 등급·국고·마을 이름을 표시하고 중심지 요청도 해당
마을에 귀속한다. 기본 마을은 여전히 root world를 권위로 쓴다. 공사·주문·개척 예약
부지는 드롭다운에서 제외하며 잠긴 타입/정부 누락/미구현 역 제출은 차단한다.
실제 모달 소스를 VM의 DOM/fetch 대역에서 실행한3개 테스트와 중심지6개 테스트 통과.
시뮬레이션·저장 스키마 변경 없음. 브라우저 시각 검증이나 라이브 배포는 아니다.

### #32 마을 간 실제 서비스 방문의 관측 (logic74, schema72)

기존 후보 생성은 시설 소속 마을을 장벽으로 삼지 않는다. 그러나 교통 원장의32칸 OD는
마을 식별자가 없어서 방문 검증에 충분하지 않았다. 관측한 출발의 pending에 거주 마을과
목적 시설 마을/목적을 저장하고, 실제 목표 자원 좌표 도착 때 municipalVisits의 목적별
횟수/전체 보행 틱을 기록한다. 거주 변경, 시설 소속 변경, 취소, 귀가/개척, 과거 불명확한
출발은 제외한다. 국경 통과 수나 고유 방문자가 아니라 거주지 밖 서비스 도착 수다.
경로/선택/난수는 그대로다. 기존 교통 원장의 선택적 관측 필드라 저장 스키마72를 유지하고
로직74로 판독/재생 기준을 갱신한다. 필드 없는 과거 통계를 허위0으로 채우지 않는다.

bench/municipal-visits.js는 기존 주민과 시설/좌표를 유지한 채 원래 마을을 두 행정 구역으로
나누는 통제 fixture다.30일 기준 본마을→관측구역402회, 반대275회, no_path0을 관측했다.
이는 실제 시설 도착 경로가 양방향 작동한다는 근거이지 원거리 자연 개척·중력 모델·가족
이주 구현 완료 근거가 아니다. 실제 원거리 개척 후30일 왕래 및 중력 기반 이주/방문은
여전히 검증/구현해야 한다. 기존 완공 주택의 자동 이사와 혼인 동거는 즉시 homeId를
바꾸는 경로가 남아 있어, 마을 간 이주는 기존 가족 이동/도착 확정 규칙과 연결해야 한다.

실제 도착/예외/날짜 경계/저장 재개 및 후보 계약 집중19/19 통과. population10/50/200의
후보·선택·이벤트 해시는 동일하고 world 해시만 logic74로 갱신했다.30일 연속 실행과
15일 저장·복원 후 실행의 출력 전체가 동일하며 최종 해시는b249a6d7이다.
build 통과(기존 번들 경고). 실행 중 localhost:3000과 플레이 저장은 수정하지 않았다.

### #32 임대료 압박에 의한 실제 가족 이주 (logic75, schema72)

기존 rent_move 의도가 다른 마을 집을 고른 경우에만 household-migration 경로로 간다.
기존 householdIntents 안에 relocation/migrationResidents/fromVillageId/toVillageId를
저장하며 목적 주택은 migrationIntentId로 예약한다. isAvailableResidence가 이를 제외해
이민·혼인·다른 주거 선택과 중복되지 않는다. 같은 마을 rent_move는 종전 규칙 그대로다.
연결 가족 계산은 기존 개척 household planner를 재사용한다. 배우자 가구 ID가 달라도
함께 포함하며 목적 집이 가족 전체를 수용하지 못하면 실패한다. 모임·여행 에너지/허기
예산·동일 속도·일반 행동 제한은 기존 정착 경로와 공유한다. 가족/목적지/경로 변경에
취소 및 예약 해제, 중단된 이동 재시작, 전원 도착 뒤 주거·소속 일괄 확정을 구현했다.
출발지 시장이 포함되면 도착 확정 때 source mayorId만 null로 한다(정규 선거 유지).
원장·인구·시설·지형·도착지 정부는 생성하지 않는다. 미완료 학위가 있는 주민은 가구
독립/임대료의 예상 근로소득에서도 canWork 규칙을 따라0으로 계산한다.

실제 임대료 평가→의도→출발→가족 도착 회귀, 연결 배우자·미성년자, 부분 도착 차단,
부족한 여력/목적지 용량, 가족/점유/화재/경로 변경 취소, 이중 가족 예약 차단, 시장직
해제, 이동 중 저장 고정점과 재개, 실제 클라이언트 예약 이벤트 처리를 검증한다.
모든 기본 인구10/50/200 후보·선택·이벤트 해시는 동일하고 logic75 world 해시만 바뀐다.
일반30일 구역 분할 벤치는 이번 임대료 이주0건(방문402/275, no_path0)이므로 자연 이주
빈도의 완료 증거로 쓰지 않는다. 그 벤치의 연속/중간 저장 재개 출력은 일치(hash b924a254).
임대료 원인 외의 이주, 중력 기반 목적지 선택, 원거리 자연 개척 후 왕래와 상위 로드맵은
여전히 미완료다. 라이브 localhost:3000/사용자 저장은 변경하지 않았다.

후속 중력 선택의 문헌 확인(아직 로직에 적용하지 않은 설계 근거): #32의 PMC10011601은
PNAS가 아니라 [Scientific Reports의 DYNAMO-M 연구(2023)](https://www.nature.com/articles/s41598-023-31351-y)다.
가구 ABM과 지역 간 중력 흐름을 결합하며 인구만이 아니라 소득·거리 등도 고려하므로,
그 연구의 추정 계수를 게임의 타일/화폐 단위에 그대로 복사하면 안 된다.
[JASSS 23(3)10(2020)](https://www.jasss.org/23/3/10.html)은 정착지 간 **교역** 연구이며,
목적지 중요도/거리 형태의 상호작용 가중치를 사용한다. 이민자의 목적지 확률로 사용하려면
실제 도달 가능성·빈집·가족 수용량 검사를 먼저 하고 마을 단위로 정규화해야 한다는 것은
우리 설계상의 추론이다. 집마다 같은 마을 질량을 반복해 세면 빈집 수가 중복 가중된다.
[Nature Communications의 이동 모델 연구(2025)](https://www.nature.com/articles/s41467-025-56495-5)는
자료로 학습한 중력 유사식을 다루므로 고전 중력식 하나를 보편 법칙처럼 단정하지 않는다.
현재 요구의 sourcePopulation×destinationPopulation/distance를 조건부 목적지 선택으로
옮길 때 동일 출발지 인구 항은 정규화 과정에서 상쇄된다(대수적 추론). 이주 **발생 여부**와
이주자의 **목적지 선택**을 분리하고, 기존 결핍/의도가 없는 인구를 강제로 움직이지 않는
방향으로 다음 구현을 검증해야 한다.

최종 고정 소스 전체572/572 통과, 가족 이주 단독9/9 및 가구/임대/정착 집중33/33,
기존 마을 소속 회귀5/5, build 통과(기존 번들 경고). 기존 즉시 주소 변경 회귀1개는
새 계약에 맞춰 모임→실제 이동→도착 후 전원 소속 변경을 검사하도록 갱신했다.

### #32 기존 임대료 이주의 조건부 중력 목적지 선택 (logic76, schema72)

기존 임대료 압박이 먼저 발생한 경우에만 목적지를 고른다. 빈집·저렴한 임대료·도달
가능성·연결 가족 전체 수용량을 먼저 검사하고, 마을마다 가장 저렴한 후보 집 하나로
묶는다. 실제 소속 인구/그 집까지의 BFS 경로 길이를 가중치로 사용한다. 출발지 인구는
조건부 정규화에서 상쇄된다. 1,000,000배 고정소수점 정수와 BigInt 누적 비교는 표현
정밀도이며 실증 추정 계수가 아니다. 실제 선택 근거와 RNG draw를 의도에 저장한다.
단일 마을은 기존 경제 선택/RNG를 보존한다. 후보 하나 또는 양의 질량 하나는 무추첨,
모든 후보 인구가 0이면 가장 저렴한 집으로 되돌아간다. 빈집 수로 도시 질량을 중복하지
않으며 이주 발생 빈도를 강제로 높이지 않는다. 다른 원인의 이주와 방문 선택은 미완료다.

전체578/578, 새 선택 회귀6/6, build 통과. 실제 임대료 평가→두 유인 마을 사이 선택→
연결 가족 도착 및 저장 재개를 검증했다. 일반30일 구역 분할은 인구10→35, 방문378/288,
no_path0, 임대료 가족 이주0건이다. 연속/중간 저장 재개 출력 전체 일치(hash9ff88fd2).
따라서 이 벤치를 자연 개척/도시 간 이주 발생 증거로 해석하지 않는다. 기존 단일 마을
후보·선택·이벤트 해시 유지, world 해시만 logic76 반영. localhost:3000은 변경하지 않았다.

### main 0c0c5ad 통합 (logic77, schema72)

PR의 충돌4개 파일을 통합했다. main의 자금 여력 기반 기분·건설 슬롯6·착공 중 침대/
카페/공원/사무실 공급 계산·사망 주민 관계 정리·클라이언트 일대기/목표·에셋 변경을
보존했다. #32 예약 주택 제외와 지역별 건설 수요는 유지한다. 10/50/200의 후보·선택·
이벤트는 main과 동일하며 world 해시만 통합 schema/logic으로 갱신했다.
통합본30일 구역 분할: 인구10→24, 방문340/212, no_path0, 가족 이주0. 연속 실행과
중간 저장 재개 출력 전체 일치(hash cbe7752e). 기존 logic76 측정과 혼동하지 않는다.

통합 최종 전체578/578 및 행정/건설 집중21/21 통과, build 통과(기존 번들 경고).
초기 통합 회귀2건은 기본 슬롯3을 가정한 큐 fixture와 고정 이민자1명 기대였다.
큐는 상한3 경계를 명시하고, 정착 행정은 모든 개척 가족 유지와 실제 관측 이민자 수로
인구를 검증한다. 기분 변경 이후 정착 시점이 바뀐 이틀 창에 이민을 강제로 만들지 않는다.
실제 가족 정착 벤치는 학생 근무0, 신규 마을1, 시장0, 국고291 및 닫힌 회계/재개 일치다.

### #32 성인 자녀의 실제 독립 이주 (logic78, schema72)

기존 separate 의도가 다른 마을 빈집을 선택할 때도 가구 이주 경로를 사용한다. 출발
가구는 부모 가구 전체가 아니라 성인 본인·배우자·같이 사는 미성년 자손으로 계산한다.
부모·형제는 남는다. 마을이 이미 갈라진 부부는 이 경로로 강제 합치지 않는다. 다른 마을
목적지는 실제 경로와 가족 전체 수용량을 검사하며 기존 주택 ID 순 선택을 유지한다.
임대료 목적지의 중력 추첨은 이 독립 선택에는 아직 적용하지 않았다.

예약→모임→보행을 재사용하고 전원 도착 때만 주소/마을/독립 가구 ID를 확정한다. 모임 중
소득/학생 신분/예비금을 재확인하고, 가족·목적지·경로 변경 시 취소/예약 해제한다. 다른
이주가 같은 가족을 중복 예약하지 못한다. 같은 마을 독립과 기존 임대료 이동 규칙은
유지한다. 기존 optional householdIntents 확장이므로 새 root 저장 필드는 없다.

집중27/27: 실제 독립 평가→가족 이주→전원 도착, 혼자 독립, 부모/형제 잔류, 부족한 집
건너뛰기, 학생/예비금·가족/점유/길 변경 취소, 부분 도착 방지, 중복 예약과 저장 재개.
30일 구역 분할은 인구10→24, 방문340/212, no_path0, 가족 이주0이다. 연속/중간 저장
재개 출력 전체 일치(hash1df5853b); 실제 자연 개척이나 이주 발생 빈도의 증거는 아니다.
10/50/200 기본 후보/선택/이벤트 해시는 이전과 동일하고 world 해시만 logic78 반영.

최종 고정 소스 전체587/587 및 집중27/27 통과, build 통과(기존 번들 경고).
작은 집 우선 순회 fixture는 주택 ID를 명시해 이름별 정렬로 큰 집이 먼저 선택되는
우연을 제거했다. 혼인 합가·신축 배정·자연 원거리 개척/교통 왕래는 여전히 후속이다.
localhost:3000과 플레이 저장은 수정하지 않았다.

### #32 마을 간 혼인 합가의 실제 가족 이동 (logic79, schema72)

결혼식/혼인 관계의 시점은 그대로 두고 마을 간 합가는 marriage_move 내구 의도로 남겨
다음 틱에 재검증한다. 부부와 함께 사는 미성년 자손을 계산하되 목적지에 이미 사는
가족은 출발자에서 제외한다. 기존 거주자 수와 들어올 가족 수를 합해 용량을 확인하고
목적지를 예약한다. 기존 배우자 집에 들어갈 수 없으면 별거 재시도에서 다른 주택도
검사한다. 부모·룸메이트를 새 가구에 흡수하지 않고, 출발자가 모두 실제 도착해야 주소/
마을 및 자녀의 혼인 가구 ID를 확정한다. 실제로 마을을 떠나는 시장의 원래 직만 비운다.

예약 후 배우자·자녀·목적지 기존 주민·길 변경은 취소한다. 반복 회고가 같은 가족의
의도를 중복 생성하지 않으며, 예약 중인 배우자 집에 지역 내 합가가 끼어들 수도 없다.
이주 이벤트와30일 벤치는 원인별 rent_move/separate/marriage_move를 구분한다. 새 난수
추첨이나 이주 발생 강제는 없다. 기본 인구10/50/200 후보·선택·이벤트 해시는 동일하다.

점검 중 예약된 **유인** 주택의 현재 주민 침대까지 건설 공급에서 빠지는 결함을 재현했다.
현재 주민이 실제 쓰는 침대만 자원 수 이내로 계속 세며 예약된 여유 침대는 풀지 않는다.
실제 침대가 모자라면 여전히 착공한다는 회귀와 함께 수정했다. 초기597/597 전체 통과 후
이 회귀를 추가했고, 최종 집중43/43과 build가 통과했다(기존 번들 경고).

30일 기존 마을 구역 분할: 인구10→25, 양방향 서비스 방문336/235, no_path0. 강제로
혼인/이주를 명령하지 않은 실행에서 marriage_move1건이 모임·출발·도착까지 완료됐고
실패0이다. 연속/중간 저장 재개 출력 전체 일치(hash163aed7d). 이는 해당 구역 분할의
실제 합가 증거이며 자연 원거리 개척이나 통계적 인구 증가 효과의 증거로 확대하지 않는다.
일반 신축 배정·독립 목적지 중력 선택·일반 방문 선택·원거리 자연 개척과 교통 계층은
여전히 미완료다. localhost:3000과 플레이 저장은 수정하지 않았다.

최종 고정 소스 전체598/598 및 집중43/43 통과. 기존 거주 침대 회귀를 포함한 최종 소스로
build와30일 연속/저장 재개 비교도 재실행해 통과했다.

### #32 일반 신축 주택의 실제 가족 배정 (logic80, schema72)

완공 처리의 마을 간 한 명 즉시 주소 변경을 construction_move로 바꿨다. 과밀도 내림차순,
주택 ID 오름차순, 주민 ID 내림차순의 우선순위로 가능한 가구를 찾는다. 선택 주민이
자녀여도 부모·배우자를 포함한 연결 가구 전체를 계산한다. 수용량·실제 도달 영역·이미
진행 중인 가구/개척 이주를 검사하고, 들어갈 수 없는 가구를 건너뛰어 다음 후보를 본다.

완공 때 바로 예약하고 모임 상태를 저장해 같은 틱의 이민/다중 완공 중복 배정을 막는다.
실제 모임/보행은 다음 틱의 기존 단계에서 진행한다. 전원 도착 때 주소/마을/새집 기억을
확정하고 가구 ID는 보존한다. 모임 중 과밀 해소, 가족/목적지/경로 변화는 취소한다.
불가능한 배정은 construction_relocation_deferred에 사유를 남긴다. 개척용 예약 건물은
일반 배정에서 제외하고, 지역 내 완공 틱 즉시 이사 계약(§16.5)은 유지한다.

집중37/37: 실제 완공 핸들러→예약→가족 도착/기억, 과소 용량의 집에 자녀 단독 배정
금지, 덜 과밀하지만 가능한 가구 선택, 같은 틱 이민·다중 완공 경쟁, 과밀 해소/가족/길/
화재 취소, 부분 도착 차단 및 저장 재개를 검증했다. 이 fixture의 프로젝트는 완공 상태를
준 것이므로 자율 건설 빈도의 증거로 부풀리지 않는다. build 통과(기존 번들 경고).

30일 구역 분할은 인구10→25, 방문336/235, no_path0, 혼인 이주1건 완료이며 신축 원인
마을 간 이주는0건이다. 연속/중간 저장 재개 출력 전체 일치(hash ebed53f5). 기본 인구
10/50/200 후보·선택·이벤트 해시 유지, world 해시만 logic80 반영. 자연 원거리 개척 및
교통 계층, 임대료 외 목적지의 중력 선택/일반 방문 선택 등 상위 로드맵은 미완료다.
localhost:3000과 플레이 저장은 수정하지 않았다.

최종 고정 소스 전체607/607 통과. 기존 지역 내 완공 이사 회귀도 유지됐고,
임대료·독립·혼인 이주 회귀와 함께 통과했다.

### #32 실제 개척 이후30일 성장·왕래 관측 (관측기만 변경, logic80/schema72 유지)

> 아래 최초 수치는 기존 건물까지 지운 지형 fixture에서 나온 역사적 결과이며,
> 정상 건물 보존 검증으로 대체한다. 경로 실패23건은 게임 경로 탐색의 결함 증거가 아니다.

`node bench/founding-construction.js 32 --settle --family --traffic`는 기존 주민의 실제
건설→모임→보행→새 마을 도착 뒤30일을 추가 관측한다. 하루 중간에 시작하므로 기존
당일 방문 누계를 기준선으로 빼고 새 도착만 센다. 14일 저장 링과 무관하게30일 합계를
유지하며 매 틱 닫힌 회계를 검증한다. `--resume-traffic`는 관측 중간에 저장·복원한다.
마을별 인구/시설/미사용·건설 가능 공터, 방문 방향·목적, 행동, 실제 완공/가구 이주와
교통 상태를 출력한다. 관측기를 쓰지 않은 동일 tick 실행과 상태가 같다는 회귀도 있다.

기존 fixture는 청원을 만들기 위해 공터를 지우고 개척용 한 필지만 남겼다. 그 상태의
관측은 양 마을의 미사용 공터0, 새 마을 아파트1동 유지, 새→기존 방문766/반대0,
추가 완공0이다(hash32646c79). 따라서 이를 지역 건설 로직의 성장 실패 증거로 쓰면 안 된다.

`--retain-native-plots` 비교에서는 원래 시드의 미사용 공터95개를 보존한다(개척용 ID1의
원래 위치만 제외). 새 공터·주민·시설을 주입하거나 확률/비용/노동량을 바꾸지 않는다.
초기 포화·지형 및 승인 설정은 여전히 통제된 것이므로 자연 포화 도달 증거는 아니다.
실제 개척 직후 새 마을은3명/아파트1/건설 가능 공터5이며, 이후30일 동안 사무실·카페·
공원·주택·초등학교를 스스로 완공한다. 종료 인구는 기존31/새10, 양방향 도착170/679,
혼인 이주1건 완료다. no_path는 기존13/새10으로 **23건**이며 숨기거나0으로 처리하지 않는다.
자가용24대, 역 수요975/해금true지만 실제 역0개다. 성장 및 역방향 방문은 관측됐지만
철도 이동/교통 계층은 미구현 상태다. 한 시드의 기제 확인이지 인구 성장 효과 추정이 아니다.

양쪽 비교 모두 연속 실행과 중간 저장 재개 출력 전체가 일치하며, 공터 보존 비교의
최종 해시는006fe0a8이다. 초기10명은 실제 개척까지 유지되며 이후 증가는 기존 출생/이민
동작에서 나온다. 별도 과밀 조절이나 이동 명령은 추가하지 않았다. localhost:3000 미변경.

최종 전체611/611 통과(`node --test --test-concurrency=4 test/`). 최초 전체 병렬 실행은
추가 장기 관측의 subprocess60초 제한만 초과했다(610통과/1타임아웃). 관측 테스트의
실행 상한을180초로 늘리고 전체 재검증했으며 해당 사례는18.6초에 완료됐다. 시뮬레이션
시간·규칙·파라미터는 바꾸지 않았다. 생산 코드 변경이 없으므로 logic/schema 버전도 유지한다.

### #32 개척 benchmark 지형 보존 정정 (logic80/schema72 유지)

실패 시점의 출발점/대상 자원과 보행 가능 여부를 최대50건까지 기록한다(총 실패 수는
제한하지 않는다). 기존23건 모두 restaurant:seat1/seat3였으며 첫 실패는 주택13 완공
2틱 뒤다. 기존 `tiles.fill(GRASS)`가 식당 구조를 지워 원래 건설 불가인 plot9를
허용했고, 그 위의 주택 오른쪽 벽이 좌석 두 개를 덮었다. 같은 덮어쓰기를 단위 테스트로
재현했다. 생산 경로·건설 규칙을 변경하거나 실패를 숨기지 않고, 통제 지형 초기화가
모든 기존 시설 footprint·문·자원·추가 침상 타일을 보존하도록 수정했다.

수정된 공터95개 보존 실행은 tick26961에 실제 개척 완료 후70161까지30일 관측한다.
기존/새 마을 인구7/3→34/12, 기존→새 방문32/새→기존759, no_path0이다.
새 마을은 사무실·카페·주택2채·초등학교를 완공한다. 자가용26대, 역 수요1239,
해금true/실제 역0개다. 완료된 marriage_move1건은 같은 지자체 안의 가구 이동이므로
지자체 간 이주 실적으로 세지 않는다. 연속 실행/중간 저장 재개 출력 전체 일치,
hash e11998db. 회계 보존과 부적격 학생 노동0도 유지된다.

공터를 복원하지 않은 수정 fixture는 추가 완공0, 기존→새0/새→기존726,
no_path0, hash fd0f5c92다. 공터 부족이라는 비교 조건은 동일하게 유지된다.

이 결과는 초기 포화·지형·승인을 통제한 한 시드의 기제 검증이다. 자연 포화/원격 개척이나
교통 계층 완성, 통계적 성장 효과를 입증하지 않는다. localhost:3000/세이브 미변경.

검증: 전체613개 중612개 통과, 유일 실패는 이전 fixture의 시장ID0 고정 기대값이었다.
건물 보존 후 실제 개척 tick26961/2일 뒤 시장ID1·주민3·금고122를 별도 재현하고 기대값을
정정했다. 이후 관련 government/founding-fixture/settlement-traffic 22개 모두 통과했다.
전체613개를 정정 후 다시 실행한 결과로 표기하지 않는다. 두 공터 조건 모두 연속/중간
저장 재개 JSON 전체 일치. 생산 코드·logic/schema 변경 없음.

### #32 R-B 기차역 실제 건설 연결 (logic81/schema72)

수요 해금 후에도 항상 `bad_type`으로 거부되던 기차역 주문에 실제 레시피를 연결한다.
8×6/비용8000/노동20000은 기존 동급 factory의 초기 규모·비용·공기와 맞춘 설계값이며
통계로 추정한 최적값이 아니다. 기존 수요 문턱·가중치·일일 판정·RNG 순서는 변경하지
않는다. 해당 공터 지자체 국고에서 지출하고 경계 유출로 기록하며, 일반 FIFO·착공
재검증·시장 노동 할인·성인 노동·완공 루프를 그대로 쓴다. 자동 계획에는 역 수요를
추가하지 않았다(이슈의 시장 지시 계약). 플랫폼은 직장/여가/침대로 세지 않는다.

역은 네 방향 회전하며 홀수 방향의 폭6에서는 오른쪽 작업점을4로 배치해 완공 벽이
작업자를 덮지 않게 한다. 다른 건물/개척 현장의 후보 좌표나 RNG는 변경하지 않는다.
클라이언트는 해금 후 지시를 허용하고 해당 지자체·서버의 현재 비용을 표시한다.
새 snapshot/tickBatch의 zoneCosts로 logic 변경 이후에도 표시 가격을 갱신한다.
전용 타일 색·이름으로 표시하며 건설 메뉴/시설 이름에 **열차 운행 미지원**을 명시한다.

기존 world/facility/project 구조를 그대로 사용해 schema72 유지, logic81로 올린다.
기존 이관기의 기본값 보충으로 구 logic80에 역 비용/노동량을 추가하고 타 설정과 진행
중 프로젝트 required·돈·지형·RNG는 보존한다. 역 없는 세계에 건물이나 자원을 주입하지 않는다.

무조작 시드32 benchmark에서 실제17일차 해금→tick24481 시장 주문(8000원, 잔고2675)
→정상 required18000 착공→tick29502 완공. 인구16, 전체 건설 시작1005(역 전용 아님),
부적격 노동0/no_path0, 매 tick 회계17063 유지. 연속/중간 저장 재개 JSON 전체 일치
(fd25034f). 자세한 조건은 docs/transport-validation.md. 이 결과는 운행 증거가 아니다.
남은 R-B 역 간 경로·운행·수단 선택·관측과 G3 다중 마을 교통 검증을 계속해야 한다.
localhost:3000/플레이 세이브는 변경하지 않았다.

역 주문 없는 기본 인구10/50/200의240틱 후보·선택·이벤트 오라클은 그대로다.
직전 d6e16ac를 별도 임시 체크아웃해 각 인구240틱을 직접 대조했으며, 매 tick 이벤트와
logic 파라미터를 제외한 직렬화 전체 상태가 일치했다. 월드 해시만 logic81의 새 필드를
포함한 값(e1177a84/0eff605d/9c20fc94)으로 갱신했다.

최종 전체621/621 통과(`node --test --test-concurrency=4 test/`,275초), 빌드 성공
(기존 번들 크기 경고만). 최초 전체 실행의618/621은 이전 logic80 월드 해시 기대값3개만
달랐고, 위의 실제 이전 커밋 대조 뒤 기대값을 갱신하여 전체를 다시 통과했다.
seed7777도 추가 검증: tick44433 주문→슬롯 대기→44462 착공→49811 완공,
부적격 노동0/no_path0이며 연속/중간 저장 재개 JSON 전체 일치(hash125e6d9b).

### #32 main5522024 통합 및 저장 버전 충돌 해소 (schema73/logic82)

PR 충돌 발생 후 최신 main의 이벤트 문장/능력 변화 이전값/관계·습관 집계 최적화와
에셋·README 변경을 통합한다. 마을 승격 문장은 해당 마을 이름과 main의 조사 헬퍼를
함께 유지한다. main의 탐색 스크립트도 임의로 삭제하지 않는다.

main의 schema68은 관계·습관 카운터, 이 브랜치의 schema68은 개척 필드였다. 숫자만
비교하면 실제 main68 세이브에 founding이 생기지 않고, 브랜치68..72에는 카운터가
생기지 않는다. 통합 schema73에서 없는 founding만 초기화하고 기존 지자체 이관을
유지하며,73 미만 세이브의 카운터를 실제 사전에서 한 번 다시 센다. 사전·돈·프로젝트·
RNG는 보존한다. 기본 생성의 새 카운터와 실제 전이 시 갱신은 main 구현을 유지한다.

카운터 도입에 따른 경계도 보강했다: 유효한 logic_update로 club.habitMin이 바뀔 때만
한 번 다시 계산하고, 회고의 habitCap 하향 교차는 감소를 반영한다. 문턱0에서 새 키가
생기는 경우도 정확히1개 센다. 매 tick 기분 함수는 여전히 O(1) 집계를 사용한다.
동일한 사건·행동식을 보존하는 통합 계약을 logic82에 기록했다.

실제 main5522024를 별도 체크아웃하여 시드32를3일 돌린 schema68 저장(인구11)을
직접 이관했다. 인구·국고·RNG 보존, 이관 멱등성, 이후1일 연속/저장 재개 동일성 및
유한성 확인(hash c0010be0). 별도 회귀는 branch72, 기준값 변경/거부, 상한 하락/0 문턱,
실제3일의 관계·습관 집계를 매 tick 사전 합계와 대조한다.

통합 후 역 seed32의 해금·주문·착공·완공 시점은 그대로이며 no_path0/부적격 노동0,
연속/중간 저장 재개 JSON 전체 일치(hash61940781). 후보·선택·이벤트 오라클은 인구
10/50/200 모두 동일하고 새 전체 상태 해시는1a0811fe/088102e3/8734b22d다.
빌드 성공(기존 번들 크기 경고). localhost:3000/실제 플레이 세이브는 미변경.

통합 최종 전체625/625 통과(`node --test --test-concurrency=4 test/`,263초).
충돌 해결 및 counter 경계 보강을 포함한 최종 소스에서 재검증했다.

## #32 R-B 최소 공공 셔틀 (schema74/logic83)

이전 역 건설만 지원하던 단계에 실제 연결 경로·왕복 열차·도보 접근/이탈·시간표 대기·
유한 정원·승하차·도보/차와의 예상 시간 선택을 추가했다. 시설/공터/회전 예약은 보존하고
물은 기존 다리를 통해서만 지난다. 새 다리가 연결한 기존 노선 그룹도 연결한다.
운행 차단 시 시간표와 위치를 함께 정지하고 현재 위치에서 목적지 경로를 재탐색한다.
가족 이주·아동 진료 동행·공공 작업은 기존 이동 계약을 유지한다. 지도는 선로와 승객 수가
붙은 열차를 표시하고 탑승한 사람/차를 중복 표시하지 않는다. 브라우저 실화면 QA는 별도다.

무료 공공 기반시설이며 건설에 포함된 것으로 취급한다. 속도4/정차10/정원8은 개통 시
고정한다. 환승·신호·충돌·혼잡·운임·운영비·연료/직원은 미구현이다. 모든 단계의 상태와
열차 시간표를 저장한다. 하차 경로 공유 배열 때문에 생긴 저장 재생 차이를 회귀로 찾아
복사 처리했다. 기존 역 없는 인구10/50/200 후보·선택·이벤트 불변, 새 상태 해시는
d57b75dd/761bc8e4/222b2aeb다.

원본 seed32 두 번의 유료 시장 주문 후 실제 공사→30일 자율 이용 관측:
완공29520/34619, 개통 후77819까지 승차/하차1회(한 방향만), no_path0/운행 취소0,
매 tick 폐쇄계 돈17063 보존, 최종 인구40. 중간 저장 재개 보고서 동일27b47482.
상세 조건/통계 의미/한계는 docs/transport-validation.md. 근거리 역의 낮은 이용을
그대로 기록한다. 실제 개척한 두 마을의 교통 포함30일 양방향 왕래 검증과 G3는 남아 있다.
localhost:3000 및 플레이 저장 파일은 변경하지 않았다. Claude 리뷰 후속 요청 대상이다.

최종 소스 전체635/635(221초), 집중29/29, 빌드 통과(기존 번들 경고). 단일 역 건설
중간 저장 재개도 완공29502/부적격 노동0/no_path0을 유지(hash19bad70d).
검증 도중 main에 추가된 e8d93b3 공터 포장 보호는 다음 통합 대상으로 확인했다.

## §23.33 공터 포장 보호 통합 (schema74/logic84)

main e8d93b3를 병합한다. 지방 공공사업의 root-world 지형 보호와 main의 미사용 공터
보호를 모두 유지한다. 일반 부지는8×6으로 보호하되, 실제 예약/진행 중 프로젝트는
회전 footprint를 추가 검사한다. 대학12×10/10×12의 기본 공터 밖도 도로로 덮지 않는다.
기존 선로 overlay도 보호한다. 같은 규칙을 보행 마모, 시장 포장, 우회 신고에 따른
연결 도로의 계획/재검증 경로에 적용한다. 다른 지자체가 소유한 예약도 root에서 확인한다.
기존 도로/세이브를 잔디로 일괄 초기화하지 않는다. main의 plotcheck.mjs는 원본 보존한다.

회귀는 네 방향 대학 예약 경계, 사용/미사용 공터, 실제 보행 마모의 인도 전환과
차단, 이웃 지자체 대학 예약의 포장 금지, 보호하지 않은 타일의 정상 포장과 정확한
지방 지출, 저장 재생, 연결 도로의 공터 보호를 검증한다. 인구10/50/200 초기240틱의
후보·선택·이벤트는 변하지 않으며 전체 상태 해시는77f083d0/936285f1/a58e6d90이다.
장기적으로는 건설 부지가 보존되어 성장/선택이 달라질 수 있으므로 이전 장기 관측값을
새 통합본 결과라고 재사용하지 않는다. 플레이 서버와 저장 파일은 변경하지 않는다.

통합본 실제 재실행: 원본 seed32 두 역30일 결과(주문·완공·1회 이용·no_path0·폐쇄계
돈17063)는 동일, 연속/중간 재개99fc2773. 기존 통제 가족 개척+30일도 실제 재실행하여
26961 정착,70161 종료, 인구7/3→34/12, 서비스 왕래32/759/no_path0/돈115063,
연속/중간 재개729f51d9를 확인했다. 개척 fixture의 역은0이며 G3 미완료는 그대로다.

최종 통합 전체638/638 통과(130초, concurrency4), 빌드 성공(기존 번들 경고),
충돌 마커와 diff 공백 검사 통과. 지형 보존·지방 회계·저장 재생 회귀를 포함한 결과다.

## §23.34~36 main 통합 (schema74/logic85)

main c03532c의 새 연애 나이/격차 조건, 작은 주택 부지 허용, 기본40일 달력 및 계절
경계 회귀를 통합한다. 기존 성인19세 하한과 가족 이주 계약을 유지한다. 새 달력 기본은
1년40일/계절10일이며 기존 저장의 yearDays120/60 등 튜닝은 이관으로 강제 변경하지 않는다.
기존 저장에 빠진 연애 파라미터만 보충하고, 자금·부지·공사·난수를 보존한다.

주택6×5를 후보의 최소 발자국으로 사용하며 본마을/지방 계획 모두 선택한 타입의 실제
발자국과 개척/대학 예약을 재검증한다. 아파트를 지을 자리가 없으면 집을 선택한다.
학교/산업 비용을 내기 전에 최종 부지를 정하므로 지불 뒤 다른 땅으로 바뀌지 않는다.
main의 growth.mjs 추가와 yearsweep.mjs 삭제도 그대로 반영한다(삭제 스크립트는 Git
이력에서 복구 가능). 실제 플레이 checkout/서버/저장 파일에는 적용하지 않았다.

초기 통합 전체641/641은 통과했지만 별도 원본 seed32 철도 관측의 매 tick 통화 검사가
실패했다. tick76320, 주민28이 질병으로 사망하며 잔액267원이 제거되어 폐쇄계17063이
16796으로 줄었다. 사망/이민의 removeSim이 현금을 지우되 externalOutflow를 기록하지
않는 기존 결함이다. 검사를 완화하지 않고 경계 유출을 기록하고 제거 이벤트에 cashOutflow를
추가했다. 새로운 상속/수혜자 지급은 만들지 않는다. 제거 판정·생존자 현금·공공 자금·RNG는
그대로다. 사망/이민, 잔액0/267/10000,200회 반복의 단일 유출 및 저장 재생 회귀로 검증한다.

수정 후 두 역 실험을 연속/중간 저장 재개로 다시 실행했다. 주문25921/31102, 각8000원,
완공32411/37667,80867까지30일 관측. 승차/하차2회(한 방향),40승객칸/10이동tick,
no_path0/취소0, 매 tick 폐쇄계17063 보존, 최종 인구52, 보고서 객체 동일c1c61d5b.
기존 logic84 관측과 다른 것은 달력/연애/건설 규칙이 실제로 바뀐 결과이며 성장 효과의
인과 추정으로 주장하지 않는다. G3(개척한 두 마을+실제 교통 포함 왕래)는 여전히 남아 있다.

추가 개척30일 재생 감사에서 tick57600 새해에 차이를 재현했다. publicPosts 객체 삽입
순서로 채용해, canonical 저장 후 키 정렬이 채용 우선순위를 바꿨다. 연속 실행은16번을
교사,23번을 의사로 채용했지만 재개는23번 의사,16번 소방관이었다. 공공직 채용/감원의
순서를 기본 우선순위(공무원→교사→의사→경찰→간호사→소방관→정치인)로 명시했다.
추가 키가 있다면 그 뒤 사전순이다. 키 순서·역순·저장 재개의 채용/감원 이벤트와 전체
상태가 같고 RNG 불변임을 별도 회귀로 검증했다. 기본 신규 세계의 기존 우선순위는 유지한다.

진단 도구 --audit-traffic은 중간 저장 전 원본도 유지해 이후 매 tick 이벤트 및 일일/재개
직후 상태의 첫 차이를 보고한다. 전체 맵을 매 tick 정렬 비교하던 첫 감사는 의도적으로
중단하고 배열 비교/이벤트 중심 감사로 바꿨다. 수정 후 감사 실행이 통과했고30일 보고서가
연속 실행과 전체 일치했다:26961 정착→70161, 인구7/3→30/12, 왕래85/691,
no_path0/폐쇄계115063, hash b8a17fd1, 역0/가구이주0. 고장 났던 재개4e87ccb5는 폐기한다.

제거 회계 후 전체643 중642 통과/1실패는 인구200 오라클의 사망 관측 추가였다. tick1의
146번 현금1000 유출과 cashOutflow만 제거하면 이전 이벤트2179523f/세계d932c483가
정확히 복원됨을 독립 실행으로 확인했다. 후보/선택은 불변, 새 이벤트b42f7c4b/세계b96ace48로
고정했다. 인구10/50의 이벤트는 동일하고 전체 상태0ac150d5/c041ba1c다.

최종 회계/채용 순서 수정 포함 전체645/645 통과(132초, concurrency4), 빌드 통과
(기존 번들 경고), diff 검사 통과. 최종 소스의 철도30일 연속/재개도 다시 실행하여
c1c61d5b와 전체 보고서 동일성을 확인했다. localhost:3000/플레이 저장 파일 미변경.

## 유료 중심지의 즉시 부지 배정 및 개척·교통 통합 검증 (schema74/logic86)

유료 중심지가 창건 반경 밖의 기존 미배정 공터를 받지 못하는 결함을 수정했다.
창건/자기 정부 유료 중심까지 최소 거리로 배정하되 창건 중심과 보행 연결을 요구하며,
기존 소유권·원래 마을 핵심 반경·타 정부 중심지·개척/공사/주문 보호를 유지한다.
배정을 다음 일일 자동 계획까지 미루면 새 부지와 국고를 자동 계획이 먼저 소비하므로,
유료 중심지 입력 직후 동일 보호 배정을 실행한다. 한 입력 묶음의 중심지→역 지시도
순서대로 소속을 받고 자기 국고를 정상 지출한다. 새 지형/돈/부지 생성은 없다.

중심 투자 없는60일은 새 마을 국고43967/빈 부지0으로 철도가 생기지 않았다(a92131a2,
연속/재개 동일). 수정 후 통제 개척26961→90일156561, 일반 유료 중심지77317 및
역40321/77318 지시→주민 노동으로48458/83223 완공. 개통 후30일 실제 양방향 승차
23/20회, 목적지 도착231/1600회. 전체 승차/하차101, 취소/no_path0, 폐쇄계115063
매 tick 보존. 연속/중간 재개 보고서 전체 동일10991314이며 매 tick 이벤트/일일 상태
감사도 통과했다. 자세한 명령/관측/한계는 docs/transport-validation.md에 기록한다.

G3 최소 통합 동작의 통제 시나리오 증거가 생겼지만 자연 개척·자동 투자 빈도나
다중 시드 일반성은 입증하지 않는다. G3 전체 승인/#32 종결을 이 관측만으로 선언하지 않는다.
후보·선택·이벤트 오라클은 그대로며 logic86 번호에 따른 전체 세계 해시는
02ffc72a/500c0173/f597d211이다. 유료 반경·보호 조건·동일 배치 회귀3개를 추가했다.

최종 시뮬 소스 전체648/648 통과(151.6초, concurrency4), 빌드 통과(기존 번들 경고),
diff 검사 통과. 이후 main7565c39의 도서관/역 이미지2개만 통합했다.
사용자 localhost:3000 및 플레이 저장 파일은 변경하지 않았다.

## 통합 회귀와 병합 검사 실패 전파

통제 개척 후70일 동안 유료 중심지/역, 정상 노동 완공, 개통 후30일 양방향 실제
승차·목적지 도착과 중간 재개 동일성을 자동 테스트로 고정했다. 단독 실행73.2초 통과.
생산 규칙/파라미터는 바꾸지 않는다. BEHAVIOR 상단의 오래된 버전도74/86으로 맞췄다.

world-review 워크플로는 테스트 실패를 댓글로만 보고하고 성공 종료할 수 있었다.
댓글 작성 뒤 always 단계가 테스트 종료 코드0만 성공으로 인정하도록 수정한다.
실제 workflow 셸을 실행해0/1/137/누락/잘못된 값의 종료 상태를 검증한다.

전체650/650 통과(160.8초, concurrency4), diff 검사 통과. 생산 JS/에셋은 직전 빌드
검증본과 동일하다. Claude CLI를 읽기 도구만 허용해 별도 리뷰 요청했으나 OAuth 만료로
종료1 실패했다. 리뷰 승인으로 취급하지 않으며 GitHub review:claude 요청은 유지한다.

## #32 분가 목적지의 조건부 중력 선택 (schema74/logic87)

성인 자녀의 기존 분가 의도가 적용될 때 자격·준비금·부모 동거를 재검사한 뒤,
기존 빈집/가족 수용량/예약/보행 연결 조건을 만족한 집에 임대료 이주의 기존
chooseMigrationHome을 적용한다. 마을별 한 집만 후보가 되며 관측 인구/실제 BFS 거리로
가중한다. 집이 많다는 이유로 그 마을 표가 중복 증가하지 않는다. 분가를 새로 유발하거나
자금·주민·집을 생성하지 않는다. 로컬 기존 분가의 적용 경로도 그대로 유지한다.

분가의 마을 내 집 선택은 기존 ID 순서이며 임대료 이주는 기존 최저 임대료 순서다.
선택기는 preference=id를 명시적으로 받으며 관측 rent에는 실제 호가를 보존한다.
영 인구 fallback도 ID 순서를 유지한다. 단일 마을은 기존 ID 선택으로 RNG 추가 소비0.
복수 양수 목적지가 있을 때만 의도 적용 순서(intentId 오름차순, tick의 가구 의도 적용
단계)에서 rngSim을 정확히1회 소비한다. 선택 근거는 migrationChoice로 저장하고
gathering 이벤트에 남긴다. 이미 이동 중인 의도는 재선택하지 않는다. 기존 저장 구조의
선택 필드를 재사용하므로 schema 변경 없이 logic87로 이관한다.

3개 마을 분가 회귀에서 동일 실제 인구·거리 가중치, 추첨1회, 아직 주소 미변경,
의도/이벤트 저장 재개 동일성, 집결 중 추가 추첨0을 검증한다. 단일/영 인구 ID 선호
회귀는 실제 임대료 관측이0으로 위장되지 않음도 검사한다. 일반 방문·결혼 목적지 선택은
여전히 후속이다. 초기 단일 마을 후보/선택/이벤트 오라클은 불변, 버전87 세계 해시는
fcad06bf/619f2fce/61bba04e다.

분가/선택/오라클 집중23/23, 개척 후70일 철도 통합을 포함한 전체652/652 통과
(155.6초, concurrency4). 빌드 통과(기존 번들 경고), diff 검사 통과. localhost:3000과
플레이 저장 파일 미변경. 이전 logic86의90일 해시10991314는 역사적 관측으로 유지하고,
현재 logic87에서 같은90일 해시를 다시 확인했다고 주장하지 않는다.

## main §23.37~39 전송 최적화 통합 (12d2c23)

스냅샷의 미사용 affinity/transportStats, 주민 state의 경로 배열을 전송에서 제외하고,
주민 정적/변동 필드를 분리한다. 마을별 국고/정책/학교·산업 비용·철도 배치 및 지도 표시를
보존해 통합한다. 현재 클라이언트가 읽지 않는 homeId/householdId는 제외하되 실제 쓰는
villageId는 유지한다. 화면 밖 주민 스프라이트 컬링을 유지하며 철도 표시는 따로 갱신한다.

실패 회귀로 검증한 통합 결함2개:
- staticKey의 별도 필드 목록이 villageId/MBTI/potential/학위 완료·등록·수업료·lastStage를
  빠뜨렸다. 실제 정적 전송 투영의 JSON 문자열을 비교해 변화가 누락되지 않게 한다.
- state 축약이 rail 접근/하차 보행 여부를 없애 자가용 보유자의 도보를 차로 그릴 수 있었다.
  경로는 보내지 않고 rail 여부 boolean만 유지한다.

클라이언트 배치 조합을 sim-stream.js로 분리해 실제 wire JSON을 거친 스냅샷+변경 배치가
전체 simView와 같음을 검사한다. 주민 사망/이민 이후 정적 캐시를 제거하고 재스냅샷 때
교체한다. 전송층만 변경하므로 schema74/logic87, 시뮬·RNG·저장 규칙은 그대로다.
집중 회귀는 수정 전9/11(두 새 회귀 실패), 수정 후12/12. 브라우저 픽셀 검증 주장은 없다.

기존에 열린 화면은 분리 배치를 모르므로 연결별 opt-in도 추가한다. 새 클라이언트는
visibility 메시지에 simStatics:true를 보내며 서버는 그 연결에만 분리 배치를 적용한다.
미협상 구버전 연결은 simsView 전체 투영을 계속 받는다. 같은 테스트 서버의 두 실제
WebSocket에서 구버전 전체 투영/신버전 분리 배치, 숨김·재스냅샷, 내부 simRefs/statKeys
미전송과 마을/정책/철도 필드 보존을 검증한다. 임시 DB/임의 포트만 사용한다.

합성 인구200의 주민 JSON만 비교한 단일 표본: 전체154570B, 정적 변경 없는 변동분
58473B. 완전한 정적 키를200명에 대해 계산하는 비용은500회 평균0.72ms/배치였다.
전체 WebSocket 트래픽·브라우저 FPS·G6 tick/s 개선을 이 표본으로 주장하지 않는다.

협상까지 포함한 최종 전체655/655 통과(134.4초, concurrency4), 실제 HTTP/WS와
배치 조합 집중4/4, 빌드 및 diff 검사 통과. 이전 협상 전 전체655/655도129.1초에
통과했으나 최종 근거는 협상 후 실행이다. localhost:3000/플레이 저장은 변경하지 않았다.

## 카메라 따라가기의 주민 ID0

followSelected의 부정값 검사가 ID0을 미선택으로 처리했다. null/undefined만 미선택으로
판정하도록 수정한다. 실제 메서드를 VM에서 실행하는 회귀는 수정 전1/3 통과(두 ID0
경로 실패), 수정 후 스프라이트 위치 추적·화면 밖 좌표 fallback·퇴장 시 선택 해제·
미선택 시 카메라 불변을 검사한다. 시뮬/서버/저장 규칙은 바꾸지 않는다.
카메라/배치/건설 UI 집중10/10과 빌드/diff 검사 통과. 이번 한 줄 UI 수정에서는
전체 시뮬 회귀를 다시 실행했다고 주장하지 않는다. 직전 전체655/655는9078fcc 기준이다.

## 철도 탑승 중 생애 변경의 물리적 연속성 (schema74/logic89)

독립 Codex 리뷰가12→13세 진학 시 이동 중 열차에서 활동 초기화로 빠지는 P2를
재현했다. 진학/공공직 변경과 기존 예약 해제는 즉시 처리하되 riding 상태에 저장되는
cancelOnAlight로 취소를 보류한다. 목적 역에서 실제 rail_alighted를 기록한 다음
옛 활동을 lifecycle_changed로 종료하고 다시 결정한다. 옛 근무/하차 후 경로는 실행하지
않는다. 운행 중단은 기존 현재 위치 취소 규칙을 유지하며 다른 주민의 새 예약을 건드리지 않는다.
logic88은 stacked PR165 재취업 변경이 사용하므로89로 구분했다. 별도 재취업 변경은
이 PR에 아직 포함하지 않았다. 초기 후보/선택/이벤트 벡터는 불변, 전체 해시만 버전으로
fc8ded11/89c870d8/04d229a4가 된다.

생일과 공공직 감축 경계의 저장 전후 재개/하차 회귀를 추가했다. 수정 전 생일 테스트
실패를 확인했고 최종 전체660/660(149.8초), 빌드 통과. 독립 읽기 전용 재검토도53개
집중 테스트 및 하차/운행 중단 메모리 검증2개를 실행해 추가 P0–P3 지적 없음으로
기록했다. 이는 Claude 승인이 아니며 review:claude 요청은 유지한다. localhost:3000과
플레이 저장은 변경하지 않았다.

## #151 무직 재취업과 이직 문턱 (schema74/logic88)

maybeJobSwitch는 무직의 중립 적성50에도 minAptGain10을 더해 직무 적성60 미만인
무직자를 후보에서 제외했다. 이는 기존 직장을 유지할 이유가 없는 사람에게 이직 방지
규칙을 적용한 결과다. 무직자만 gain 비교를 생략한다. 기존 근로자의 이직 문턱,
실제 서비스 매출/언락 생산 수요, 정원, 학생·학위·나이 자격, 적성 순위와 적성에 비례한
dayHash 채용 확률은 유지한다. 일자리/돈/인구를 생성하거나 채용 확률을 올리지 않는다.

통제 채용 fixture: 평균 적성50, 실제 식당 매출 문턱과 빈자리, 100일 평가에도 변경 전
계속 jobless였다. 변경 후 chef로1회 전환하며 RNG/현금 불변, 저장 재개 결과 동일.
매출 없음/정원 충원/학생/미완료 학위/18세/동일 적성의 기존 근로자는 새 채용 없음.
집중33개 중30개가 통과하고3개는 버전88의 세계 해시만 달랐다. 후보/선택/이벤트는
불변임을 확인했고 세계 해시6affbeb4/119f09b5/f70fea6f로 갱신했다.

무입력 원본seed9001의60일 전후 비교(기준9e2e73d): 인구66→67, 무직 출신 채용7→7,
첫 채용 양쪽tick30240(적성63 점원), 근무 가능한 무직의 일일 합246→234,
종료 무직6→6. 매 tick 폐쇄계17509 보존. 해시2e44abc0/6d0b47be. 단일 시드의
다른 궤적이며 총 무직 감소·전체 개선의 증거로 일반화하지 않는다.

이 수정은 재취업 후보 누락 한 원인만 해결한다. 무직의 수요 원장/민간 건설 연결,
일반 사무실 재취업 경로와 장기 관측은 남아 #151을 닫지 않는다. PR161의9e2e73d에
의존한 별도 워크트리/브랜치codex/151-reemployment로 검증하며 플레이 서버는 변경하지 않는다.

최종 전체661/661(156.1초, concurrency4), 재취업/오라클 집중9/9, 빌드 및 diff 검사
통과. 실제 개척 후 유료 철도 양방향 왕래/저장 재개 통합 회귀도 유지됐다.

### PR161 철도 생애 수정 통합 (schema74/logic90)

74c70df를 병합해 재취업과 탑승 중 생애 취소를 함께 보존한다. 두 독립 행동 버전88/89와
구분하기 위해90으로 올린다. 두 버전에서 이관 시 사용자 minAptGain17을 포함한 세계
상태가 버전 외에 그대로 보존됨을 직렬화 비교로 확인했다. 초기 후보/선택/이벤트는
동일하며 전체 해시는cd26d1a3/ebf33812/ca1c27b2다. 기존 두 독립 리뷰의 구현을 그대로
통합했으며 추가 행동 변경은 없다. #151의 산업 원장·건설 연결은 여전히 남아 있다.
통합본 전체663/663(152.9초), 집중21/21, 빌드·diff 검사 통과. localhost:3000과 저장
파일은 변경하지 않았으며 Claude 재리뷰 요청을 유지한다.

### #151 채용 경로와 시설 부족의 분리 계측

sim/employment.js와 /api/industry.employment는 읽기 전용 지역별 노동 증거를 반환한다.
근무 가능 무직자와 부적격 무직자, 기존 용량/거주 근로자/빈자리, 매출·생산 언락,
채용 경로 유무, 공터별 중복 제거한 착공/주문 수를 구분한다. 기존 office의 slot도
신축 desk와 함께 센다. 직장 배정이 없어 거주 직업 수는 지역 계획용 근사이며 현재
전역 채용 결과나 통근 좌석 점유를 보장하지 않는다. 수요 원장·건설 동작은 아직 미연결이다.

원본seed9001 무입력60일(schema74/logic90): 근무 가능 무직6명, 사무실4개/자리18개/
사무직19명/채용 경로 없음. 식당·작업장·연구소·창고는 기존 직종 정원 충원, 시장은
점원0명이나 매출1920으로5000 채용 문턱 미달이다. 이 표본에서 단순 적성 문턱 수정으로
6명을 추가 채용할 수 없는 이유가 분리됐다. 기존 자리 우선 채용과 실제 부족분의
건설 연결을 다음 구현에서 검증해야 한다. 이 관측으로 #151을 닫지 않는다.

집중31/31(25.1초): 지역 분리·자격 제외·매출/정원·주문 중복·기존 slot·직렬화 불변 및
별도 임시 DB/임의 포트 실제 HTTP API 검증. 전체663회귀는 직전 cfaa86b 결과이며
이번 읽기 전용 추가에서 전체 재실행으로 주장하지 않는다. 저장/행동 변경이 없으므로
버전90 유지, localhost:3000/플레이 저장은 변경하지 않았다.

### #151 기존 사무실 빈자리의 실제 재취업 (schema74/logic91)

서비스 채용 뒤·체불 퇴직 전에 지자체 ID순으로 기존 사무실에 무직자를 하루 최대1명
채용한다. 나이/학위 자격과 은퇴 연령, 해당 지역의 접근 가능한 비사건 자리, 지역 거주
사무직 수와 전역 용량을 함께 제한한다. 적성 내림차순·ID 동률순과 기존 dayHash53
확률을 사용해 rngSim을 소비하지 않는다. 기존 근로자는 이 경로로 이직하지 않는다.
사무직은 기존 기반 부문의 외부 임금 모델이다. 채용 시 돈을 주지 않으며 실제 근무 뒤
기존 경계 유입/임금/세금 정산이 일어난다. 고용주 배정은 #112로 여전히 미구현이다.

평균 적성 무직의 채용·실제 근무 임금·매 틱 폐쇄 회계·근무 도중 저장 재개를 검증했다.
학생/미완료 학위/18세/65세/기존 근로자와 부재/도달 불가/사건/만석/다른 지역 사무실은
채용하지 않고, 경쟁자는 적성/ID순과 한 자리 제한을 따른다. 기존 서비스 테스트는
서비스만 검증하도록 사무실을 fixture에서 제외했다. 기존 기준을 완화한 것은 아니다.

독립 리뷰는 사건 중 사무실이 계측의 채용 가능 자리에 포함되는 P2를 발견했다.
physical capacity와 recruitmentCapacity를 분리하고 회귀를 추가했다. 첫 전체 실행은
670/671로, seed4242 tick27257의 house5 화재가 집밥 산업T 시설 부재로 오분류되는
기존 문제가 새 궤적에서 드러났다. 일시 사용 불가(unavailable)를 분리해 신축 수요로
적립하지 않도록 고쳤다. 원래40,000틱 회귀를 포함한 산업25/25가 이후 통과했다.
독립 재검토는43개 집중 테스트와 혼합 사건/사용 가능 시설 검증 후 추가 P0–P3 지적 없음.

사무직 채용 구현 직후(시설부족 분류 수정 전) 원본seed9001 무입력60일: 신규 사무직
채용2건(tick10080/72000, 적성35/51), 인구65, 종료 근무 가능 무직1, 매 틱 폐쇄계17509.
이전 logic90의 무직6과 다른 단일 궤적이며 일반적 실업 감소의 증거로 확대하지 않는다.
초기 후보/선택/이벤트는 동일하고 버전 전체 해시만f46c218e/8c923f87/abef0125다.
logic90→91은 사용자 채용 확률23을 포함한 전체 상태가 버전 외에 동일함을 확인했다.
실업자의 부족분을 유료 건설로 연결하는 작업은 아직 남았으며 #151을 닫지 않는다.
최종 전체673/673(193.7초), 사건 계측/API/실근무 집중10/10, 빌드와 diff 검사 통과.
Claude 리뷰는 별도 요청하며 localhost:3000 및 플레이 저장은 변경하지 않았다.

### #151 노동 수요 → 유료 사무실 착공 (schema74/logic92)

officeConstructionDemand는 소비시설 부족 원장과 분리해 현재 노동 증거를 읽는다.
기존 사무직과 근무 가능한 무직자의 부족분에서 기존 사무실 자리, 서비스 채용 여력,
공터별 중복 제거한 사무실 착공/주문 자리(신축당4)를 뺀다. 서비스 여력은 실제 채용의
전역 직업 보유자 정원과 지역 수요/자리를 함께 제한하고, 같은 구직자·전역 자리를
직종순·적성/ID순으로 한 번만 배정한다. 이것은 가능성의 예약이며 채용 확정이 아니다.
나이/학위/학생 제외, 채용 확률0의 서비스 후보 제외, 지역 예산 분리는 유지한다.

두 건설 계획기가 같은 근거를 사용하고 모든 자동 사무실을 기존 구역 비용(기본3000)으로
해당 지자체가 지불한다. 종전 자동 사무실은 무료였으므로 의도된 행동 변경이다.
비용은 외부 유출에 기록하고 기존 기본 노동량8000을 줄이지 않는다. 학교/주거 우선순위,
공터 적합성/예약 보호와 프로젝트 슬롯 제한을 유지한다. 실제 채용은 완공 뒤에만 가능하다.
/api/industry.employment의 officeConstruction과 employment_construction_planned 이벤트에
결정 근거를 노출한다. 세계 입력/상태에서 계산되는 증거여서 별도 가짜 누적 소비 수요는 없다.

회귀는 단일/다중 마을의 실제 유료 착공, 자금 부족 시 이웃 국고 미사용, 학생/학위/연령,
기존·착공·주문 수용량, 서로 다른 직종의 동일 구직자 중복 차감 방지를 확인한다.
기본8000 노동량으로 무입력 실제 건설 진행 중 저장→완공→채용된 당사자의 사무실 근무
완료/임금까지 연속·재개 이벤트/해시와 매 틱 폐쇄 회계를 검증했다. 주거/학교 전용 fixture는
기존 사무실 자리를 제공해 새로운 노동 부족이 다른 검증에 섞이지 않게 했다.

독립 리뷰가 지역 식당의 요리사가 다른 마을에 살 때 이미 찬 전역 정원을 지역 빈자리로
차감하는 P2를 발견했다. 전역 자리 예산과 공유 후보 집합으로 수정하고 두 마을에서
한 자리를 중복 차감하지 않는 회귀를 추가했다. 재검토는13/13 통과 및 잔여 지적 없음.
초기 후보/선택/이벤트는 동일, 버전 전체 해시는8c104409/5fb695a0/e72c212c다.
logic91→92 이관은 사용자 사무실 비용4100과 전체 상태가 버전 외에 그대로 보존됐다.

6fac3ba를 별도 임시 체크아웃에 고정하고 원본 무입력 두 시드60일을 비교했다. 아래는
전역 자리 중복 차감 수정 후 재실행한 최종 수치다. 두 세계 모두 매 틱 폐쇄계 보존:

| seed | 인구 전→후 | 근무 가능 무직 전→후 | 사무직 채용된 주민 전→후 | 신규 완공 사무실 전→후 | 유료 사무실 비용 전→후 |
| --- | --- | --- | --- | --- | --- |
| 9001 | 65→62 | 1→7 | 2→3 | 4→3 | 0→12000 |
| 4242 | 64→63 | 5→2 | 4→1 | 3→3 | 0→12000 |

첫 유료 착공은 각각tick12960/7200이며 구직 부족4/1이 근거였다. 최종 해시는
c8fb4853/ef14b786(기준08b137c8/523736be), 폐쇄계17509/13550이다. 각 새 세계에서
유료 착공4건 중3건이 완공됐다. 사무직 채용 경험자의 근무 임금 지급은56→155와131→43이며
이후 다른 직업으로 바뀐 임금도 포함할 수 있어 사무실 전용 생산량으로 보지 않는다.
한 시드는 무직이 늘고 다른 시드는 줄었다. 정책의 전체 고용 개선을 입증한 것이 아니라,
노동 수요가 실제 예산·착공·노동·완공·채용 경로를 탄다는 증거다. 숫자를 낮추기 위해
공공 정원/채용 확률을 높이지 않았다. 비교용 체크아웃만 정리했고 기준 커밋은 Git에 남았다.

최종 전체678/678(246.0초, concurrency4), 실제 HTTP1/1, 건설/지자체 집중13/13,
독립 재검토 통과. 전역 배정 수정 전 전체677/677(328.3초)은 최종 검증과 구분한다.
빌드/diff 검사도 통과했다. PR161 기반에서의 검증이며 플레이용 main의 이후 변경 통합과
Claude 리뷰/병합은 별도 단계다. localhost:3000과 root의 미커밋 변경은 건드리지 않았다.

## main45ef524 통합: 정적 가구 정보·압축 투영·관람 속도

main의417ms/틱(하루 약10분), 최대×20 및 ×1/4/10/20 버튼, 새 에셋과 시간/저장 테스트를
보존한다. 시뮬레이션 tick 규칙/로직89는 바꾸지 않는다. server/view 충돌은 실제 정적
투영 전체를 비교하는 키를 유지하고 homeId/householdId를 정적 전송에 복원해 해결했다.
마을 소속과 rail 표시는 유지하며 sick은 true/null, needsTier는level만 전송한다.
접속 스냅샷의 transportStats.today/history도 main대로 복원한다. 문서의 현재 배속
안내만 갱신하고 과거 측정 기록은 보존한다.

집중43/43에는 실제 임시 DB/임의 포트 HTTP/WebSocket, 시간/저장/가구/전송 검증이
포함된다. 독립 읽기 전용 통합 리뷰는13개 집중 검사 후 P0–P3 지적 없음이었다.
가구 변경의 정적 키 갱신, 압축 투영에서 내부 카운터 비노출과 원본 불변 회귀를 추가했다.
플레이용 root의 미커밋 변경은 건드리지 않았다. 이 통합에는 별도 PR165의 고용 변경은
아직 포함하지 않는다.
최종 전체661/661(218.8초, concurrency4), 집중43/43, 빌드/diff 검사 통과.

## PR165 최신 main 통합 검증 (schema74/logic92)

부모07f99b2를 고용 브랜치에 통합했다. PLAN의 양쪽 기록과 HTTP 테스트의 고용/교통
검증을 모두 보존했다. 고용 구현은 변경하지 않았으며 전체679/679(235.1초),
집중28/28, 빌드가 통과했다. 부모와 고용 변경의 기존 독립 리뷰와 별개로 이번
통합에 새 독립 리뷰를 수행했다고 주장하지 않는다. localhost:3000과 root 변경은 보존했다.

## #32 혼인 합가의 조건부 중력 선택 (schema75/logic96)

기존 queueMarriageMigration의 첫 적합 집 선택을 chooseMigrationHome의 마을별 인구/실제
경로 거리 선택에 연결한다. 낮은 ID 배우자 집으로 높은 ID 배우자가 이동하던 기존 기준을
따라 높은 ID 배우자의 집이 출발 anchor다. 이는 두 출발지의 총 이동 비용 최소화가 아니다.
동일 마을 기존 합가·결혼 당일 후보 범위는 유지하고, 별거 재시도의 적합 주거를 마을마다
ID 순으로 대표화한다. 임대료는 실제 askingRent를 근거에 기록하지만 이 합가는 저렴한 집
탐색이 아니므로 ID 선호를 쓴다. 가족 수용/도달 가능성/사고/예약/선행 신청을 먼저 걸러낸다.

§17.8 회고→applyRomance→queueMarriageMigration의 선택 지점에서 두 개 이상 양의 마을
가중치가 있을 때만 rngSim 1회. 단일 후보/전부0/이미 진행 중인 의도는 추가 드로우 없음.
migrationChoice는 기존 의도의 선택적 근거 필드이므로 세이브 형식 변경은 없고 로직만96.
3마을 실제 선택→자녀 동반 이동→중간 재개, 매 tick 회계 보존과 신청 부지 제외를 테스트했다.
독립 읽기 전용 Codex 리뷰는 관련37/37 집중 검사 후 P0–P3 지적 없음이었다(Claude 승인이
아니다). 부모 logic95와3시드(32/9001/4242)×4320 tick의 사건 및 로직 버전 제외 전체 상태가
정확히 동일했다. 전체 회귀는 실행 중이며 #32 전체 완료로 간주하지 않는다.

## #32 일반 방문 목적지 선택 (logic98/schema75, 검증 중)

선택된 행동의 비위급 일반 방문 후보만 마을별로 묶어 기존 점수/동점 최선의 도달 가능한
자원 하나를 대표로 삼는다. 현재 마을 인구/실제 도보 경로 길이(최소1)를 고정소수점으로
정규화한다. 같은 출발 심의 source population은 조건부 선택에서 상쇄된다. 시설/좌석 수가
인구 가중치를 배수로 늘리지 않는다. 단일 마을 경로와 긴급/고정 목적지는 보존한다.

§17.8 tick 단계5의 idle 행동 선택 직후, 양의 목적지 마을 가중치가 둘 이상이면 rngSim1회.
선택 경로는 바로 startAction으로 전달해 중복 BFS를 피한다. 선택 증거는 시작 이벤트의
reason.visitChoice에 보존하며 실제 이동과 도착 계측을 기존 코드가 처리한다. 공항/R-F와
자연 개척·인구 효과의 완료를 주장하지 않는다. 집중 검사와 실제 외부 마을 도착/재개를
추가했으며 단일 마을 불변·전체 회귀·장기 양방향 방문·성능 및 독립 리뷰를 검증 중이다.

초기 독립 리뷰 P2(반복 조회표/BFS 비용)에 따라 마을·시설·인구 조회표를 idle 단계 한 번만
만들고 마을별 선택 경로를 실제 시작에 재사용한다. 집중 검사는 100개 좌석을 추가해도
도달 가능한2마을에 BFS2회만 호출하고 단일 마을 후보에서는0회임을 확인한다. 후속 리뷰는
P2 정확성 결함 없음, 집중12/12였다. 성능 개선 완료는 주장하지 않는다: 인구200 합성
2구역 워밍업1일+측정1일에서2649 BFS/766 추첨, 전체7.9~11.0초와BFS4.1~5.6초였다.
서로 같은 작업을 한 최적화 전후 비교가 아니며 실제 방문이 달라지는 기능 변경이다.

초기 logic97 통제 구역 분할30일에서는1975 추첨/경로 실패0, 중간 재개 출력 전체 동일을
확인했다. 자연 개척/인구 개선 증거가 아니다. 부모와3시드×4320tick 단일 마을 사건과 전체
상태(로직 버전 제외)도 같았다. main/혼인 통합은logic98로 구분하고 집중9/9를 통과했다.
통합본 전체·장기 재개를 다시 검증한 후에만 병합한다. #32의 공항/R-F 등은 계속 남아 있다.

### 일반 방문 이후 철도 관측 기간 검증

기존70일 관측은start26961/end127761인데 둘째 역이96967에 열려30일 서비스 종료140167
전에 중단됐다. 실제 양방향 승차16/8·하차24·취소0·noPath0였으며 자금/부지 확보 지연이
관측 구간을 줄였다. completeServiceWindow 옵션은70일 내 개통 기한을 유지하고 그 안에
개통한 경우에만 개통 후30일을 관측한다(전체100일 상한). 미개통이면 원래 기한에 종료한다.
독립 리뷰는 기한·회계·재개·실제 운행 검사를 약화시키지 않는다고 확인했고, 보강 관측의
장기6/6(268.6초)이 통과했다. 후속으로 두 역의 project_started, 양의 누적 진행량,
실제 현장 이동과 근로 가능한 주민 수 상한을 관측에 연결했다. 이 후속 노동 관측의 장기
재검증/리뷰는 진행 중이며 시뮬 세계나 자금/인구는 변경하지 않는다.

### PR170 main17eedbc 통합 (logic97)

혼인 변경의 전체698/698(282.1초) 통과 후 main의 사건 UI, 아파트 출산 수용 계산,
기본×4/이야기 필터, 저장 SQL 회전/커밋 주기와 에셋 변경을 그대로 통합했다. main도96을
사용하므로 통합 로직을97로 올렸다. 충돌은 버전과 양쪽 문서/파라미터 서식을 보존해 해결했다.
숨김 HTTP 테스트는 opt-in ACK 전 legacy 배치와 이후 split 배치를 모두 엄격히 검증한다.
독립 프로토콜 리뷰 지적 없음(리뷰 환경의 임시 폴더 제한으로 실행은 불가); 실제 단독 검사와
수정 후 전체 검사는 통과했다. 이번 main 통합은 집중15/15 후 전체/통합 리뷰를 별도 진행한다.

통합 리뷰 P2: 신규 세계도 Storage가speed1을 반환해 main의 기본×4 의도가 무효였다.
신규 생성 트랜잭션에서 epoch와speed4를 함께 저장하고 반환한다. 기존 저장값과 배속 없는
legacy의×1은 그대로다. 첫 tick/배속 명령 전 재접속, 실제 시간 목표40tick, 저장된 배속
보존을 회귀로 추가했다. 기존×1→×3/최고 배속 테스트는 시작×1을 명시하며 32게임일
프루닝 지평은 실제 배속으로 환산했다. 집중14/14 통과; 후속 리뷰/전체 검증은 진행 중이다.

### #112 고용주 배정 (schema76 / logic99, 구현 검증 중)

사용자 결정: 고용된 시설로 출근하며 최초 근무지는 집 가까운 곳의 확률이 높다.
직업/채용은 기존 노동시장 규칙에 두고 `employment={facilityId,occupation,assignedTick,
homeId}`를 저장한다. 배정 후보는 업종이 맞고 집 문에서 시설 문과 작업 자원까지 도달
가능한 시설이다. 시설ID 정렬, 각 시설 문까지 실제 BFS 거리 d로
`floor(1000000/(d+1))`를 계산한다. 후보가 둘 이상이면 rngNext 한 번으로 정수 가중
구간을 선택하며 하나면 무드로우다. 좌석 중복·현재 위치·형제 가게 매출은 선택을 바꾸지 않는다.

틱 순서: logic_update와 일반 입력을 먼저 처리한다. 명시적 work 입력은 대상 주민의
첫 고용만 그 입력 단계에서 배정한다. 일반 고용은 가구 이동 적용 뒤 id 오름차순으로
검증하고 그 뒤 실제 보행/근무한다. 유효 고용은 반복 검사에서
재추첨하지 않는다. 전직·학생 전환·시설 소멸·통행 단절은 고용 해제이며, 실패한 탐색은
날짜/집/직업/지도 reachVersion/시설 수 변화 시 재시도한다. 이전 근무는 보행/급여 전에
취소한다. 열차 안이면 teleport 없이 하차 후 취소한다. 만석/화재는 일시 사용 불가이지
자동 이직 이유가 아니다. 이사해도 도달 가능한 기존 고용은 유지한다.

work 후보/시설 부족 관측을 해당 고용주로 제한한다. 경찰은 소속 경찰서 마을에서 순찰,
공공 급여는 고용 시설 관할에서 낸다. 민간 매출·임금·세금은 기존 정산으로 실제 근무 후만
발생한다. 학생/미완료 학위/19세 미만은 고용 불가. 화면 정적 투영에 고용 관계와 근무지
라벨을 제공한다. 마이그레이션은 null 필드만 초기화하며 RNG를 쓰지 않는다.

집중7/7: 거리 가중·시설/좌석 순서 불변·고용 유지·학생/나이/단절·실제 근무 완료/임금·
재개 전체 동등성·최초 tick 근무 명령을 검증했다. 교육/철도27/27도 통과했다.
전체 회귀, 장기 경제 계측, 실제 화면, 교차 리뷰 및 Claude 요청은 완료 전 게이트다.

리뷰 후속: 일일 전직/퇴직/교육 전환 뒤, 같은 tick의 idle 결정 전에 다시 고용을 검증해
저장/전송에 이전 직업의 고용주가 남지 않게 했다(실제 일일 체불 퇴사 회귀). 같은 집의
배정은 함수 호출 내 거리 관측만 공유하고 즉시 버린다. 20명/동일 집/2가게도 BFS2회,
유효 고용은 다음 날·reachVersion 변경에도 재탐색0회임을 확인했다. 최초 근무 명령도
워밍업 tick 없이 처리한다. 집중9/9 통과. 잔여 리뷰 P2: 노동시장/건설 증거의 기존
resident-local-capacity-proxy는 실제 고용 사업장/관할 인원 집계로 바꾸었다. 거주지 직업
인원은 residentWorkers로 별도 표시하고, 외부 출근자는 거주지의 자리를 차지하지 않는다.
실제 배정 없는 직업 보유자는 unassignedWorkers로 구분해 사무실 수요에서 누락하지 않는다.
사업장별 초과 인원이 형제 사업장 빈자리를 숨기지 않게 하고, 공공직 시설 정원을 좌석수로
새로 발명하지 않는다. 현재 사업장별 정원은 기존 사무실/industry 규칙의 관측값이며,
기존 직업 채용 규칙 자체를 이번 집계 수정으로 바꾸지는 않는다.

초기 전체717/721에서 입력 이벤트 순서2개, schema 고정 기대1개, 저장 이벤트 미등록1개를
발견했다. 입력 단계에서 전체 고용을 먼저 배정하지 않도록 고쳤고 schema 기대는 현재
상수를 참조한다. 저장 미등록은 #173/PR174 긴급 별도 수정으로 분리했다. 고용 시작 이벤트도
시설102곳 조건에서 모든 후보를 유지하되 선택 거리/가중치·총 가중치·후보 수·draw만
기록하여 1KB 저장 한도를 지킨다. 은퇴자는 고용 대상에서 제외한다. 집중18/18, 실제
건설→채용→급여 포함5/5 통과. 실제 Chrome의 근무지 라벨/새로고침 유지/페이지 오류0 확인.

## §23.48 저장 계층이 거부하던 이벤트 12종 등록 (schema 유지)

`db/storage.js:153`은 커밋 트랜잭션 안에서 `EVENT_TYPES`에 없는 타입을 만나면 던진다.
병렬 작업이 들여온 §117 이주·§118 철도·#151 고용유발 건설이 emit하는 12종
(`plot_relocated`, `construction_relocation_deferred`, `household_migration_gathering`,
`household_migration_departed`, `employment_construction_planned`, `village_land_assigned`,
`rail_opened`, `rail_cancelled`, `rail_suspended`, `rail_resumed`, `rail_boarded`,
`rail_alighted`)이 등록에서 빠져 있었다 — **그 코드 경로가 라이브에서 처음 실행되는
순간 커밋이 죽는 상태**였다.

16c(라이브 프루닝)가 잡아주기 전까지 조용했던 것은 안전해서가 아니라 테스트 궤적이
거기 닿지 않았기 때문이다. 실제로 이번에 §23.47로 궤적이 밀리자마자
`employment_construction_planned`가 튀어나왔다. §22.91에서 `sidewalk_formed`로
똑같은 사고를 겪었는데 재발했다 — **emit을 추가할 때 등록을 함께 하지 않으면
테스트가 우연히 그 경로를 밟기 전까지 아무도 모른다.** append-only 규약대로 끝에 붙였다.

## #32 공항 유상 건설 연결 (schema77 / logic100, Draft)

수요·비용·운항 계약은 docs/airport-service-plan.md와 BEHAVIOR의 공항 절에 기록한다.
입력 처리 전에 rollTransportDay가 오늘을 정하므로 수요 창도 그 날짜를 따른다.
최초 공항 건설 허용은 관할 tier3, 다른 주민 마을, 최근14일 장거리 마을 간 실제 도착
12건이다. 완전 단절 마을의 초기 수요 문제는 미해결이며 성공 수요를 생성하지 않는다.
기본 유상30000/노동60000/부지20×12를 적용하고, 공사 완료 뒤 공항과 제한된 기체를
등록한다. 구버전 마이그레이션은 빈 air 상태만 만들고 시설·기체·RNG를 만들지 않는다.
통제된 두 마을/기존 이동기록 fixture에서 기본 노동의 두 유상 공항 완공, 한 기체의 실제
시간표 이동, 매tick폐쇄회계 및 공사 중 저장재개 동등성6/6을 검증했다.
위 문단은 logic100 시점 기록이다. logic103의 실제 여행·UI·30일 통합 검증과 잔여
자연 수요/최초 투자 문제는 docs/airport-service-plan.md의 최신 갱신을 따른다.

## 공항/생존과 main §23.47~53 통합 (schema78 / logic104)

양쪽 schema77을78로 통합한다. 기존 contacts/recentConflicts와 유상 air 이력을 보존하며,
없는 air는 빈 망, 없는 contacts는 기존 interactions 복사로 이관한다. 새 갈등/거절
가중치와 항공 파라미터를 함께 유지하고 생존 우선권도 보존한다. 초기 인구10/50/200의
후보·선택·이벤트는 main1572cf2와 동일하고 버전/air 추가 세계 해시만 갱신했다.

## #32 실제 미충족 이동으로 첫 공항 투자 연결 (logic105)

돈/자격/자원을 통과한 실제 일반 이동 선택이 지상·현행 항공 경로가 없어 실패하면
미충족 의도로 별도 기록한다. 출발 주거 영역과 목적 시설 내부가 연결된 경우만 해당한다.
주민·방향 있는 마을쌍·하루당1건,14일 창을 적용하며 완료 방문/출발/승객 수에 섞지 않는다.
기존 완료 방문 또는 미충족 의도 중 하나가 독립적으로 airportTripsMin을 넘어야 유상
공항 주문을 허용한다. 둘을 더하지 않는다. 상세 계약과 통제 조건/검증은
docs/airport-service-plan.md의 logic105 항목을 따른다.

## §23.47 거절이 호감도·기억·상호작용에 닿는다 (logic99)

### 무엇이 죽어 있었나

이 세계에서 호감도는 **사실상 내려갈 수 없었다.** 20시드 × 100일 실측: 121명 마을에서
가장 나쁜 사이가 −59.5 ± 16.1이었다. 앙숙 문턱은 −2000이다. 그래서 아래가 전부
도달 불가 코드였다 — 앙숙 0명, 말다툼 0건, 이별 0건, `moodBaseline.perRival` 0회,
험담의 부정 분기 0회.

그런데 세계는 그 사건을 **이미 매일 만들고 있었다.** 초대 거절이 100일에 1,941건인데
`emit` 한 줄뿐이었고 호감도·기억·기분 어디에도 닿지 않았다. `recordFact`조차 없었다.

### 두 개의 잠금

거절에 감점을 붙이는 것만으로는 안 됐다. 고정 −150을 붙인 결과(20시드):
최저 호감도 −59.5 → −576.4 (t = −33.1), 음수 관계 쌍 49.5 → 773.6 (t = +55.3).
**호감도는 10배 내려갔는데 앙숙·말다툼·이별은 여전히 전부 0이었다.** 이유가 둘이었다.

**① `argument`는 대화 중 임계 교차에서만 검사됐다.** `argumentThreshold`가 tick.js
안에 숨어 있어서, 거절로 내려간 호감은 그 문턱을 조용히 지나갔다. cognition.js로 옮겨
두 경로가 같은 판단을 쓰게 했다.

**② 앙숙 티어는 `호감 ≤ −2000` AND `상호작용 ≥ 30`인데, `상호작용`은 마주 앉은
대화에서만 올랐다.** 호감이 내려가는 유일한 길이 거절이고 거절은 대화가 아니므로
**두 조건이 서로 배타적이었다.** 호감이 −2250까지 내려간 쌍이 나와도 앙숙은 0명이었다.
마흔 번 청하고 마흔 번 거절당한 사이를 '서로 모르는 사이'로 세는 것이 틀렸다 —
거절도 접촉이다. 게이트 진단(시드1000, 100일): 호감 ≤ −2000인 쌍 13개 중
상호작용 30을 넘긴 3개만 앙숙이 됐다. 두 조건이 **함께** 걸러낸다.

### 크기를 어떻게 정했나

`declineAffinity = 300`은 바로 위 `helpGratitudeAffinity = 300`과 **대칭**이다:
챙김이 얹는 만큼 거절이 덜어낸다. 임의의 숫자가 아니라 이 세계가 이미 쓰던 눈금이다.
반복 거절은 같은 상대에 대한 'rejected' 기억 수만큼 가중된다(최대 6배) — 한 번은
사정이고 다섯 번은 사이다. 기억 상한(256)에 밀려 옛 서운함이 잊히면 앙금도 옅어진다.

### 측정 (20시드 × 100일, 페어드 t)

|                | base   | §23.47  | t      |
|----------------|--------|---------|--------|
| 앙숙           | 0.0    | 1.4 ± 1.2 | +5.44 |
| 말다툼         | 0.0    | 3.9 ± 2.8 | +6.30 |
| 최저 호감도    | −59.5  | −3411 ± 872 | −17.17 |
| 음수 관계 쌍   | 49.5   | 964.5   | +32.68 |
| 친구           | 804.2  | 692.7   | −5.32 |
| 결혼           | 18.7   | 17.0    | −2.10 |
| 인구           | 120.9  | 123.2   | +0.98 |
| 이별           | 0      | 0       | —     |

기각한 대안(전부 §0.1.1대로 20시드 급으로 재고 버렸다):
- **친구 티어에만 감점** — n=16에서 효과 없음 (최저 호감도 Δ=−10.4, t=−1.67).
  친구끼리는 애초에 잘 거절하지 않는다.
- **고정 −150** — 최저 −576까지만 가고 앙숙·말다툼 여전히 0.
- **가중 −150** — 앙숙 0.1 ± 0.2, 말다툼 0.2 ± 0.5로 사실상 여전히 죽어 있다.

대가는 친구 −14%, 결혼 −9%다. 친구가 1인당 6.6명 → 5.7명이 됐고, **대신 그 관계가
끝날 수 있게 됐다.** 인구는 무변(t=+0.98)이라 세계가 쪼그라든 것이 아니다.
이별은 여전히 0인데, 연인은 서로 거절을 잘 안 하기 때문이다 — 억지로 열지 않고
드문 경로로 둔다.

### 결정성

거절 감산은 rng를 소비하지 않는다. 골든 벡터(#97) 인구10에서 후보·선택·이벤트 해시가
240틱 동안 한 글자도 안 바뀌고 **세계 해시만** 움직인 것이 그 증거다(affinity·interactions
행렬이 실제로 변했기 때문). 인구50·200에서는 선택·이벤트도 갈리는데, 사람이 많으면
240틱 안에도 거절이 쌓여 기분(말다툼 −800)과 호감이 결정에 닿기 때문이다.
새로 넣은 `continue`(내가 앙숙으로 여기는 사람에게는 청하지 않는다)는 `pairHash`
호출보다 앞이지만 pairHash는 rngSim을 소비하지 않고, `approachedTo.push`보다는
뒤라서 매 틱 재평가도 생기지 않는다.

전체 717/717 통과.


## §23.52 갈등에 목격자를 준다 (logic101)

3회차 리뷰에서 스토리와 장르가 같은 곳을 가리켰다: **앙숙 22건 전부, 지속 기간
평균 14.5일 동안 그 두 사람 사이에 일어난 사건이 경계의 티어 변화뿐이다(22/22).**
`rival` 티어를 소비하는 곳이 다섯인데 다섯 다 억제(회피·안 도움·안 청함·안 응함·기분)라
결과를 만드는 소비자가 하나도 없었다. **사건은 생겼는데 이야기가 아니었다.**

그런데 이 세계에는 두 사람 사이의 일을 **제3자의 입으로 옮기는 채널이 이미 있다** —
`recentCouples` 링과 `couple_news` 주제가 60일에 1,531발화를 만든다. 40줄이 안 되는
코드다. 갈등에만 대응물이 없었다.

같은 모양으로 만들었다. `recentConflicts` 링(최대 8, 7일 창)에 말다툼과 앙숙 전이를
밀어 넣고, `conflict_news` 주제를 `couple_news`와 **같은 무게(25)**로 둔다. 화자는
**자기가 덜 좋아하는 쪽의 흉을 본다** — 이래야 마을이 편으로 갈린다. 그리고
`applyGossipInfluence`가 이미 배선돼 있어 듣는 사람의 그 사람에 대한 호감이 실제로 내려간다.
당사자가 그 자리에 있으면 그 얘기는 나오지 않는다(자기 얘기는 소문이 아니다).

### 측정 (20시드 × 100일, 페어드 t) — 기대한 것의 절반만 나왔다

|                | §23.47만 | +§23.52 | t |
|----------------|---------|---------|---|
| 갈등 발화      | 0       | 3,783.8 ± 1,177.5 | **+14.37** |
| 음수 관계 쌍   | 880.5   | 1,142.3 ± 154.2 | **+9.09** |
| 앙숙           | 3.2     | 3.4     | +0.25 |
| **상호 앙숙**  | 0.0     | **0.0** | — |
| **허브(최대 피앙숙 수)** | 1.4 | **1.4** | +0.19 |
| 최저 호감도    | −3962   | −3768   | +0.51 |
| 평균 기분      | 815.1   | 806.1   | −0.30 |
| 친구           | 682.1   | 672.4   | −0.80 |
| 결혼           | 17.3    | 16.6    | −1.86 |

**얻은 것**: 침묵이 채워졌다. 앙숙 기간 동안 마을이 그 얘기를 한다(100일에 3,784발화).
옅은 앙금이 넓게 퍼진다(음수 쌍 +30%). 대가는 전부 잡음 안이다.

**못 얻은 것**: **파벌이 생기지 않았다.** 허브가 1.4 → 1.4로 꿈쩍하지 않는다.
중간에 시드 3개를 보고 "허브가 3까지 올랐다"고 판단했는데 20시드로 재니 §23.47만
있어도 허브 3인 시드가 있었다 — 잡음을 골라 본 것이다(§0.1.1의 재발).
원인은 장르 리뷰가 먼저 말한 그대로다: `influence.gossipDelta`가 30으로
`declineAffinity` 300의 10분의 1이라 남의 말로는 편이 갈리지 않는다.

**여기서 gossipDelta를 올리지 않는다.** 결과를 보고 노브를 돌리는 것이기 때문이다(§0.1).
이 측정이 말하는 것은 다음 레버가 구조라는 것이다 — 상호 앙숙이 불가능한 것
(거절이 청한 쪽만 깎고, 앙숙이 되면 반대 방향의 거절 기회가 영영 막힌다)과
결핍에 이름이 없는 것.

전체 737/737 통과.

## §23.55 상호 앙숙을 시도했고, 실패했다 — 그리고 왜인지 알아냈다 (logic102)

3회차 리뷰에서 스토리·장르·경제가 각각 **상호 앙숙 0/22 · 0/17 · 0/24**를 쟀다.
이 세계의 앙금은 언제나 한 방향이다 — 한 사람이 혼자 서운해하고 상대는 그런 게
있는 줄도 모른다. 장르 리뷰의 표현으로 "원수가 아니라 짝사랑의 반대말"이다.

두 군데를 고쳤다. 둘 다 노브가 아니라 **앞뒤가 안 맞던 자리**다.

**① 싸움은 쌍방이다.** 말다툼은 이미 양쪽 다 기분이 상하고 양쪽 다 그 일을 기억하는데
호감도만 한쪽으로 움직였다 — 싸운 걸 기억하고 기분도 나쁜데 상대를 여전히 똑같이
좋아하는 상태였다. `argumentAffinity`(거절과 같은 눈금 300)를 양방향에 적용한다.

**② 거절당하는 일 자체가 없어지던 자리.** `else if (tier === 'rival') continue` —
상대가 나를 앙숙으로 보면 청을 아예 안 했다. 청이 없으니 거절도 없고, **상대가 나를
싫어한다는 사실이 나에게 도달할 길이 없었다.** 게다가 그 검사가 보는
`target.relTiers[sim.id]`는 상대의 사적인 감정이다 — 그걸로 내 행동을 막는 것은
내가 알 수 없는 것을 아는 셈이다. 나는 모르니까 청하고, 상대가 거절한다.
(내가 앙숙으로 여기는 사람에게 청하지 않는 것은 그대로 뒀다. 그건 내 감정이다.)

### 측정 (20시드 × 100일, 페어드) — 목표 미달성

|                | §23.52까지 | +§23.55 | t |
|----------------|-----------|---------|---|
| **상호 앙숙**  | 0.0       | **0.0** | — |
| 최저 호감도    | −3768     | −4405 ± 1207 | **−2.38** |
| 앙숙           | 3.4       | 3.1     | −0.66 |
| 평균 기분      | 806.1     | 828.2   | +1.34 |
| 친구/결혼/인구 | | | 전부 잡음 안 |

**왜 안 되는가 — 회피가 제대로 작동하기 때문이다.** A가 B를 앙숙으로 여기면
`stateModFor`가 B가 있는 시설 점수를 −2e11로 눌러 A가 그 자리를 피한다. 그래서 둘이
마주치지 않고, 마주치지 않으니 B가 A에게 청할 일이 없고, 청이 없으니 B의 앙금이
생길 재료가 없다. **거절이라는 사건원으로는 상호 앙숙을 구조적으로 만들 수 없다 —
미워지면 피하고, 피하면 접촉이 끊긴다.**

상호 반목은 **사람이 피할 수 없는 자리에서 부딪혀야** 생긴다. 같은 카페 자리,
같은 침대, 같은 복지 정원은 싫어도 매일 다시 걸린다. 장르 리뷰의 "결핍이 이름을
갖게 하라"가 이 문제의 전제이지 별개 항목이 아니었다 —
**"상호 앙숙"을 먼저 하겠다고 한 내 순서 판단이 틀렸다.**

두 변경은 남긴다. 목표는 달성 못 했지만 각각 독립적으로 옳고(싸움의 앞뒤가 맞고,
남의 사적 상태로 내 행동을 정하지 않는다) 측정 가능한 대가가 없다.
남는 효과는 한쪽 앙금이 더 깊어지는 것뿐이다(최저 호감도 −636, t=−2.38).
