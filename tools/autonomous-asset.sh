#!/bin/zsh
# Codex 자율 에셋 사이클 — **OS 스케줄러가 직접 부른다** (사용자 지시 2026-09-03:
# "너가 Cron으로 프롬프트를 던지는게 아니라 Codex CLI가 스스로 예약을 걸게끔 해야지").
#
# 예전에는 Claude 세션의 크론이 프롬프트를 던져야 돌았다 — 세션이 끊기면 멈췄다.
# 이제 launchd가 이 스크립트를 부르고, 스크립트가 Codex를 부르고, **측정까지 스스로** 한다.
# Claude는 나중에 리포트만 읽고 판정한다.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
cd "$(dirname "$0")/.."
REPORT="logs/autonomous-report.md"
mkdir -p logs
say() { echo "$1" | tee -a "$REPORT" >/dev/null; }

# 중복 실행 방지 — 5분 주기라 겹칠 수 있다
if pgrep -f "tools/asset-agent.sh" >/dev/null; then exit 0; fi

# 사용량 가드 (남은 20% 미만이면 이번 회차 건너뜀 — 고속 모드 종료 조건)
USAGE=$(./tools/codex-usage.sh 2>/dev/null || echo "-1 -1")
REMAIN=${USAGE##* }
if [ "${REMAIN%%.*}" != "-1" ] && [ "${REMAIN%%.*}" -lt 20 ]; then
  say "$(date '+%m-%d %H:%M') 사용량 잔여 ${REMAIN}% — 회차 건너뜀(고속 모드 종료 조건)"
  exit 0
fi

# 작업트리에 PNG 아닌 변경이 있으면 건너뛴다 — 남의 작업을 밟지 않는다
if [ -n "$(git status --porcelain | grep -v '\.png$')" ]; then
  say "$(date '+%m-%d %H:%M') 작업트리에 PNG 아닌 변경 있음 — 회차 건너뜀"
  exit 0
fi

BEFORE=$(git rev-parse HEAD)
./tools/asset-agent.sh > "logs/asset-auto-$(date +%Y%m%d-%H%M).log" 2>&1 || true
AFTER=$(git rev-parse HEAD)
[ "$BEFORE" = "$AFTER" ] && { say "$(date '+%m-%d %H:%M') 커밋 없음"; exit 0; }

# **스스로 측정한다** — Codex 보고를 믿지 않는다는 규칙을 스크립트가 대신 지킨다
for F in $(git show --name-only --format="" "$AFTER" | grep '\.png$'); do
  node -e "
const {PNG}=require('pngjs');const fs=require('fs');const cp=require('child_process');
const cur=PNG.sync.read(fs.readFileSync('$F'));
let prev;try{prev=PNG.sync.read(cp.execSync('git show $AFTER~1:$F',{maxBuffer:1e9}));}catch(e){console.log('| $F | 신규 파일 | '+cur.width+'x'+cur.height+' |');process.exit(0);}
const purple=p=>p[3]>0&&p[0]>=p[1]*1.4&&p[2]>=p[1]*1.4;
let spa=0,spb=0,chg=0,rgb=0,newOp=0,nonT=0;
for(let i=0;i<prev.width*prev.height;i++){const a=prev.data.subarray(i*4,i*4+4),b=cur.data.subarray(i*4,i*4+4);
 if(purple(a)&&a[3]<128)spa++; if(purple(b)&&b[3]<128)spb++;
 if(a[3]===0&&b[3]>0)newOp++;
 if(a[0]!=b[0]||a[1]!=b[1]||a[2]!=b[2]||a[3]!=b[3]){chg++;if(a[0]!=b[0]||a[1]!=b[1]||a[2]!=b[2])rgb++;if(!purple(a))nonT++;}}
const size=prev.width===cur.width&&prev.height===cur.height?'유지':'**변경**';
const flag=(newOp>0||rgb>0||nonT>chg*0.5)?' ⚠️ 검토필요':'';
console.log('| $F | 치수 '+size+' | 반투명보라 '+spa+'→'+spb+' | 변경 '+chg+' | RGB '+rgb+' | 새불투명 '+newOp+' |'+flag);
" >> "$REPORT" 2>/dev/null || say "| $F | 측정 실패 |"
done
say ""
