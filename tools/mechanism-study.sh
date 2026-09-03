#!/bin/zsh
# 시티즈 스카이라인·Anno 차용 연구 (사용자 지시 2026-09-03: "시티즈 스카이라인, anno시리즈가
# 시뮬레이션을 돌리는 방식을 차용해서 이 프로젝트에 붙일만한것들을 계속붙이고").
# Codex가 저장소를 읽고 후보를 골라 logs/citybuilder-mechanisms.md에 쓴다.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")/.."
mkdir -p logs
PLAN=$(head -60 PLAN.md 2>/dev/null)
ISSUES=$(gh issue list --state open --limit 30 --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null | head -25)
GROWTH=$(head -40 logs/growth-audit.md 2>/dev/null || echo '(없음)')

codex exec -m gpt-5.6-luna -c model_reasoning_effort="high" --sandbox read-only "너는 DeepSims(결정적 심즈라이크 + 도시 타이쿤)의 설계 파트너다.
**시티즈 스카이라인·Anno 시리즈의 시뮬레이션 방식 중 이 프로젝트에 붙일 만한 것**을 골라 설계안을 써라.

## 반드시 지킬 제약 (어기는 제안은 쓰지 마라)
- PLAN §0.1: 지표를 직접 누르지 않는다. 상수를 조정해 결과를 만드는 처방 금지. **행동·구조를 더한다.**
- 결정성: 새 RNG를 쓰지 않거나, 쓰면 기존 rngSim 소비 순서를 바꾸지 않는다(dayHash·pairHash 방식).
- §22.4 폐쇄 회계: 통화 총량 보존. 새 돈 흐름은 어느 항에서 어느 항으로 가는지 명시.
- 인구를 직접 조작하지 않는다.

## 프로젝트 상태
$PLAN

## 최근 진단으로 밝혀진 병목
$GROWTH

## 열린 이슈 (중복 금지 — 겹치면 그 번호를 인용해라)
$ISSUES

## 다룰 축 (최소 6개)
1. 수요 사슬(Anno) — 계층 수요가 다음 산업을 언락. 이 프로젝트의 §22.18 수요 원장·§18 승급 티어가 반쯤 그 구조다. 무엇이 빠졌나?
2. 자원·생산 사슬(Anno) — 원료→중간재→소비재. 지금 소비는 추상적이다. 어디까지가 현실적인가?
3. 서비스 커버리지 반경(CS) — 병원·소방·경찰이 반경으로 덮고 못 덮인 곳에서 문제가 난다. §20.3 사회적 중력·거리 점수와 어떻게 맞물리나?
4. 토지 가치·구역제(CS) — 지가가 밀도·서비스로 정해지고 건축을 유도한다.
5. 교통 용량·혼잡(CS) — 도로 용량과 우회. 지금은 맨해튼 거리 + BFS다. 결정성이 유지되나?
6. 행복·불만 되먹임 — 만족이 이주·세수·성장에 되먹임된다.

## 각 후보에 반드시 쓸 것
① 원작이 실제로 어떻게 하는가(확실하지 않으면 '확실하지 않음'이라고 써라 — 추측을 사실처럼 쓰지 마라)
② 이 프로젝트에 무엇으로 번역되는가(파일:줄로 붙일 자리)
③ 왜 지금 필요한가(위 병목·이슈와 연결)
④ 결정적으로 구현 가능한가
⑤ §0.1 준수 근거
⑥ 단계별 완료 기준(테스트로 쓸 수 있는 문장)

## 마지막에
후보를 **지금 붙일 것 3 / 다음 / 나중**으로 나누고, '지금' 3개는 이슈로 바로 등록할 수 있을 만큼 구체적으로 써라." > logs/citybuilder-mechanisms.md 2>&1

echo "$(date '+%m-%d %H:%M') 차용 연구 완료 — logs/citybuilder-mechanisms.md ($(wc -l < logs/citybuilder-mechanisms.md) 줄). Claude 검증 후 이슈 등록 필요." >> logs/autonomous-report.md
