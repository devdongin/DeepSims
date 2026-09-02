#!/bin/zsh
# 열린 이슈 Codex 리뷰 에이전트 (사용자 지시: "열려있는 이슈에 대해선 Codex도 리뷰하고 코멘트 달아야지")
#
# 각 열린 이슈를 현재 세계 상태·코드와 대조해 Codex가 직접 판정을 코멘트로 남긴다:
#   - 이슈 주장이 지금도 유효한가 (수치가 바뀌었는지)
#   - 이미 해결됐다면 닫을 근거
#   - 우선순위 재평가와 구체적 다음 행동
#
# 사용: ./tools/issue-review-agent.sh [최대개수]   (기본 6개, 오래된 것부터)
set -e
cd "$(dirname "$0")/.."
LIMIT="${1:-6}"
mkdir -p logs

# 세계 상태 (이슈 주장 검증의 근거)
./tools/export-world-snapshot.sh >/dev/null 2>&1 || true
WORLD=$(cat logs/world-snapshot.json 2>/dev/null || echo '{}')

# 이번 회차에 리뷰할 이슈: Codex 리뷰 코멘트가 아직 없는 것 우선, 오래된 순
ISSUES=$(gh issue list --state open --limit 40 --json number,title,createdAt \
  --jq 'sort_by(.createdAt) | .[] | "\(.number)\t\(.title)"')

REVIEWED=0
while IFS=$'\t' read -r NUM TITLE; do
  if [ -z "$NUM" ]; then continue; fi
  if [ "$REVIEWED" -ge "$LIMIT" ]; then break; fi

  # 이미 Codex 정식 리뷰가 달린 이슈는 건너뛴다 (푸터 마커로 식별 — 안내 코멘트와 구분)
  if gh issue view "$NUM" --json comments --jq '.comments[].body' 2>/dev/null | grep -q "자동 리뷰 · 세계 상태와 코드 대조"; then
    continue
  fi

  BODY=$(gh issue view "$NUM" --json body --jq .body 2>/dev/null | head -c 4000)
  echo "리뷰 중: #$NUM $TITLE"

  OUT=$(codex exec -m gpt-5.6-luna --sandbox read-only "너는 DeepSims(결정적 심즈라이크 + 도시 타이쿤)의 이슈 리뷰어다.
아래 열린 이슈를 **현재 살아 있는 세계 상태**와 저장소 코드에 비추어 검토하라.

## 이슈 #$NUM: $TITLE
$BODY

## 현재 세계 상태 (logs/world-snapshot.json)
$WORLD

## 요구 출력 (마크다운, 250단어 이내)
1. **유효성**: 이슈가 주장하는 문제가 지금도 실재하는가? 세계 수치로 근거를 대라. 이미 해결됐다면 '닫기 권고'와 그 근거.
2. **정확성**: 진단이나 처방에 오류·오진이 있는가? (예: 원인을 잘못 지목, 이미 다른 이슈가 다루는 중복)
3. **우선순위**: P1/P2/P3 중 하나와 이유. 다른 열린 이슈와의 선후 관계.
4. **다음 행동**: 구현자가 바로 착수할 수 있는 구체적 한 걸음.

규칙: (0) **지표를 누르는 처방 금지** — 오류 수치(no_path·lonely·불만·starving)를 낮추려 파라미터를 튜닝하거나 실패를 억제하는 제안은 하지 마라. 대신 **사람이 할 법한 행동을 하나 더 추가**해 세계가 스스로 풀게 하고, 그렇게 풀리는지 관찰할 지표를 함께 제시하라. 단 계약 위반(결정성·오버플로·리플레이 불일치)과 명백한 구현 결함은 그대로 고친다. 인구를 직접 조작하는 제안 금지. 결정적 tick·내구 입력·드로우 순서 계약을 깨는 제안 금지. 코드를 읽어 확인한 사실과 추측을 구분해 표기하라." </dev/null 2>&1 | awk '/^codex$/{buf=""; f=1; next} /^(exec|thinking|web search)/{f=0} f{buf=buf $0 "\n"} END{printf "%s", buf}' | head -c 5500)

  if [ -n "$OUT" ]; then
    printf '## 🔍 Codex 이슈 리뷰\n\n%s\n\n---\n<sub>`tools/issue-review-agent.sh` 자동 리뷰 · 세계 상태와 코드 대조</sub>\n' "$OUT" \
      | gh issue comment "$NUM" --body-file - >/dev/null 2>&1 && echo "  → 코멘트 게시 완료"
    REVIEWED=$((REVIEWED + 1))
  else
    echo "  → Codex 응답 없음, 건너뜀"
  fi
done <<< "$ISSUES"

echo "이슈 리뷰 회차 종료 (${REVIEWED}건)"
