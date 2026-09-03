#!/bin/zsh
# 시간당 자가평가 루프 — 평균 9점까지 (사용자 지시 2026-09-03: "한시간마다 도는
# 리뷰에서 평균 9점이상을 받을때가지 계속 자가개선 루프를 진행").
#
# docs/REVIEW_RUBRIC.md의 8항목을 **근거와 함께** 점수화하고 logs/review-scores.md에 적는다.
# 평균이 9 미만이면 "가장 점수를 올릴 한 가지"를 함께 남긴다 — 다음 회차의 작업 후보다.
# 점수는 구현 완료가 아니라 **관측된 상태**로만 매긴다(§6.5 정신).
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")/.."
mkdir -p logs
pgrep -f "tools/autonomous-review.sh" | grep -v $$ >/dev/null && exit 0

# 근거 수집: 헤드리스 20일 + 테스트 + 안정성 + 열린 이슈
SUMMARY=$(node -e "
import('./sim/index.js').then(async (S)=>{
  const w=S.createWorld(Number(process.argv[1]||20260903));
  const ev=S.advance(w,{},20*1440);
  const c={};for(const e of ev)c[e.type]=(c[e.type]??0)+1;
  const acts={};for(const e of ev)if(e.type==='action_completed')acts[e.payload.action]=(acts[e.payload.action]??0)+1;
  console.log(JSON.stringify({pop:w.sims.length,treasury:w.treasury,tier:w.cityTier,
    facilities:w.map.facilities.length,eventTotals:c,actionTotals:acts},null,1));
});" $(date +%d) 2>&1 | head -60)
TESTS=$(npm test 2>&1 | grep -E "^# (tests|pass|fail)" | tr '\n' ' ')
ISSUES=$(gh issue list --state open --limit 40 --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null | head -25)
RUBRIC=$(cat docs/REVIEW_RUBRIC.md 2>/dev/null | head -40)

OUT=$(codex exec -m gpt-5.6-luna -c model_reasoning_effort="high" --sandbox read-only "너는 DeepSims를 평가표로 채점하는 리뷰어다. **점수는 관측된 상태로만 매긴다** — 구현이 있다는 사실이 아니라 실제로 작동하는 증거가 있어야 점수를 준다.

## 평가표
$RUBRIC

## 이번 회차 근거 (헤드리스 20일)
\`\`\`json
$SUMMARY
\`\`\`
테스트: $TESTS

## 열린 이슈 (해결되지 않은 결함들 — 점수에 반영해라)
$ISSUES

## 출력 형식 (이 형식만)
SCORES: 재미=N 버그안정성=N 이해도=N 조작UI=N 그럴듯함=N 보는재미=N 성능=N 문서=N
AVG: N.N
WHY: (각 항목 중 7점 미만인 것만, 한 줄씩 — 무엇이 근거인가)
NEXT: (평균을 가장 크게 올릴 **한 가지**. 이미 열린 이슈면 번호를 쓰고, 새것이면 한 줄 제안. §0.1 준수 — 지표를 누르는 처방 금지)
" 2>&1 | tail -20)

{
  echo "## $(date '+%Y-%m-%d %H:%M') 자가평가"
  echo "$OUT" | grep -E "^SCORES:|^AVG:|^WHY:|^NEXT:|^-" || echo "$OUT" | tail -8
  echo ""
} >> logs/review-scores.md

AVG=$(echo "$OUT" | grep "^AVG:" | head -1 | sed 's/AVG: *//')
echo "$(date '+%m-%d %H:%M') 자가평가 평균 ${AVG:-?} — 목표 9.0 (logs/review-scores.md)" >> logs/autonomous-report.md
