#!/bin/zsh
# Codex 자율 플레이테스트 — OS 스케줄러가 직접 부른다 (사용자 지시 2026-09-03).
# day 0부터 헤드리스로 굴려 Codex가 이슈 초안을 쓰고, **초안은 등록하지 않고 대기**한다.
# 등록 전 근거 확인은 Claude가 한다 — 4회차까지 초안의 대표 사례·규모가 자주 틀렸기 때문이다.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")/.."
mkdir -p logs
if pgrep -f "tools/codex-playtest.sh" >/dev/null; then exit 0; fi
./tools/codex-playtest.sh 20 > "logs/playtest-auto-$(date +%Y%m%d-%H%M).log" 2>&1 || true
N=$(wc -l < logs/playtest-issues.tsv 2>/dev/null | tr -d ' ')
echo "$(date '+%m-%d %H:%M') 플레이테스트 완료 — 초안 ${N:-0}건 대기(logs/playtest-issues.tsv). 등록 전 Claude 검증 필요." >> logs/autonomous-report.md
