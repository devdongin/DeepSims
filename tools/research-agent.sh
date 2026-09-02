#!/bin/zsh
# 상시 문헌 연구 에이전트 (사용자 지시: "참고 문헌을 확대해서 계속해서 research 하는 서브에이전트를 생성한다")
#
# 로드맵 에이전트가 "다음에 무엇을 만들까"를 묻는다면, 이 에이전트는
# **"그걸 만들 근거가 어디 있나"** 를 묻는다.
#
# 살아있는 세계에서 아직 풀리지 않은 문제(열린 이슈·심들의 불만)를 보고,
# 그걸 다루는 **새 학술 문헌**을 찾아 라이선스까지 확인해 docs/REFERENCES.md 후보로 제시한다.
# 이미 문서에 있는 문헌은 다시 제안하지 않는다.
#
# 사용: ./tools/research-agent.sh [주제개수]   (기본 3)
set -e
cd "$(dirname "$0")/.."
TOPICS="${1:-3}"
OUT_DIR="logs"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M)

./tools/export-world-snapshot.sh >/dev/null 2>&1 || true
WORLD=$(cat logs/world-snapshot.json 2>/dev/null || echo '{}')
ISSUES=$(gh issue list --state open --limit 30 --json number,title,labels 2>/dev/null || echo '[]')
# 이미 인용한 문헌 — 중복 제안을 막는다
HAVE=$(grep -oE "10\.[0-9]{4,}/[^ )|]+|arXiv:[0-9.]+|PMC[0-9]+" docs/REFERENCES.md 2>/dev/null | sort -u | tr '\n' ' ')

codex exec -m gpt-5.6-luna --sandbox read-only "너는 DeepSims(결정적 심즈라이크 + 도시 타이쿤)의 **문헌 연구 담당**이다.
로드맵 담당이 '무엇을 만들까'를 묻는다면, 너는 **'그걸 만들 근거가 어디 있나'** 를 묻는다.

## 살아있는 세계의 현재 상태
$WORLD

## 아직 풀리지 않은 문제 (열린 이슈)
$ISSUES

## 이미 인용한 문헌 (다시 제안하지 마라)
$HAVE

## 할 일
위 세계 상태와 열린 이슈에서 **아직 근거 문헌이 없거나 빈약한 주제**를 ${TOPICS}개 고르고,
각 주제마다 **새 문헌 1~2편**을 찾아 아래 형식으로 제시하라.

주제를 고르는 기준:
- 심들이 실제로 겪고 있는 문제여야 한다 (불만·굶주림·외로움·빈곤 수치에서 출발)
- 이미 구현된 것의 재탕이 아니라 **다음에 만들 것**의 근거여야 한다
- 게임 디자인 팁이 아니라 **사람의 행동·사회·경제에 관한 실증 연구**를 찾아라

각 문헌마다 반드시:
1. **정확한 서지정보** — 제목 / 저자 / 연도 / 저널·학회 / DOI 또는 arXiv ID
2. **라이선스** — 공식 페이지에서 직접 확인하라. CC BY / CC BY-NC / All rights reserved / Public Domain / OGL 등.
   확인 못 했으면 '확인 불가'라고 쓰고 추측하지 마라.
   **주의**: Unpaywall·OpenAlex 같은 자동 OA 지표는 오탐이 있다(실제로 Granovetter 1978이
   세 곳 모두에서 CC BY로 잘못 표시된다). 반드시 출판사 1차 출처를 확인하라.
3. **이 문헌이 말하는 것** — 3줄 이내, 네 문장으로 재서술 (원문 복사 금지)
4. **DeepSims에 어떻게 적용하나** — 어느 이슈·어느 로직에, 어떤 규칙으로. 구체적으로.
5. **관찰 지표** — 적용했을 때 무엇이 어떻게 달라져야 하는가

## 규칙
- **지표를 누르는 처방 금지** (PLAN §0.1): 오류 수치를 낮추려 파라미터를 튜닝하는 근거로 문헌을 쓰지 마라.
  사람이 할 법한 **행동을 하나 더 추가**하는 근거를 찾아라.
- 인구를 직접 조작하는 제안 금지. 결정적 tick·내구 입력·드로우 순서 계약을 깨는 제안 금지.
- **전문 PDF를 저장소에 올리는 제안은 하지 마라** — 이 프로젝트는 링크로만 참조한다.
- 문헌을 못 찾으면 솔직히 '못 찾음'이라고 써라. 억지로 만들지 마라.
- 확인한 사실과 추측을 명시적으로 구분하라.

출력은 마크다운. 주제별로 소제목을 달아라." </dev/null > "$OUT_DIR/research-$STAMP.md" 2>&1 || echo "codex 실패" >> "$OUT_DIR/research-$STAMP.md"

echo "$OUT_DIR/research-$STAMP.md"
