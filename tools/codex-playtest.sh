#!/bin/zsh
# Codex 자율 플레이테스트 (사용자 지시 2026-09-03: "codex는 1시간에 한 번 0일부터 플레이해서
# 리뷰 이슈 작성해서 개선하도록 한다").
#
# day 0부터 헤드리스로 N일 굴린 뒤, 그 세계에서 실제로 무슨 일이 일어났는지를 Codex가 읽고
# **플레이어 관점의 결함**을 이슈 초안으로 쓴다. 라이브 세계(deepsims.db)는 건드리지 않는다.
#
# 사용: ./tools/codex-playtest.sh [일수]   (기본 20일)
set -e
cd "$(dirname "$0")/.."
DAYS="${1:-20}"
SEED=$(date +%Y%m%d%H)          # 회차마다 다른 마을, 같은 시각이면 재현 가능
STAMP=$(date +%Y%m%d-%H%M)
OUT="logs/playtest-$STAMP.md"
mkdir -p logs

echo "▶ day 0부터 ${DAYS}일 (시드 $SEED) 헤드리스 진행"
SUMMARY=$(node -e "
import('./sim/index.js').then(async (S) => {
  const w = S.createWorld($SEED);
  const N = $DAYS * 1440;
  const ev = S.advance(w, {}, N);
  const byType = {}, byDay = {};
  for (const e of ev) { byType[e.type] = (byType[e.type] ?? 0) + 1;
    const d = Math.floor(e.tick / 1440); (byDay[d] ??= {})[e.type] = (byDay[d][e.type] ?? 0) + 1; }
  const first = (t) => ev.find((e) => e.type === t)?.tick ?? null;
  const conv = ev.filter((e) => e.type === 'conversation').slice(-40)
    .map((e) => ({ topic: e.payload.topic, detail: e.payload.detail }));
  const acts = {};
  for (const e of ev) if (e.type === 'action_completed') acts[e.payload.action] = (acts[e.payload.action] ?? 0) + 1;
  console.log(JSON.stringify({
    seed: $SEED, days: $DAYS, endTick: w.worldTick,
    population: w.sims.length, treasury: w.treasury, cityTier: w.cityTier,
    mayor: w.mayorId, couples: Object.keys(w.partners ?? {}).length / 2,
    facilities: w.map.facilities.length, projects: (w.projects ?? []).length,
    eventTotals: byType, actionTotals: acts,
    firstOf: { election: first('election'), married: first('married'), child_born: first('child_born'),
               died: first('died'), facility_built: first('facility_built'), city_promoted: first('city_promoted'),
               treasury_debt: first('treasury_debt'), starving: first('starving'), fire_started: first('fire_started') },
    lastConversations: conv,
  }, null, 1));
});
" 2>&1)

echo "$SUMMARY" | head -3
CONSTRAINTS=$(head -60 PLAN.md 2>/dev/null || echo '')
OPEN_ISSUES=$(gh issue list --state open --limit 40 --json number,title --jq '.[] | "#\(.number) \(.title)"' 2>/dev/null || echo '')

codex exec -m gpt-5.6-luna --sandbox read-only "너는 DeepSims(결정적 심즈라이크 + 도시 타이쿤)를 **처음부터 플레이한 리뷰어**다.
방금 day 0부터 ${DAYS}일을 굴린 결과가 아래에 있다. 이 마을에서 **플레이어가 겪었을 문제**를 찾아라.

## 이번 플레이 결과 (시드 $SEED)
\`\`\`json
$SUMMARY
\`\`\`

## 이미 열려 있는 이슈 (중복 금지)
$OPEN_ISSUES

## 네가 할 일
코드를 직접 읽어 근거를 잡고(sim/·client/·server/), **새로운 결함 1~3건**만 골라 이슈 초안을 써라.
- 이미 열린 이슈와 겹치면 쓰지 마라. 겹치는지 애매하면 쓰지 마라.
- '느낌'이 아니라 **위 수치나 코드 줄**로 뒷받침해라. 파일:줄 표기를 넣어라.
- 지표를 눌러 고치는 처방은 금지다(PLAN §0.1) — 행동·구조를 더하는 쪽으로 써라.
- 인구를 직접 조작하는 처방도 금지다.

## 출력 형식 (이 형식만, 다른 말 금지)
각 이슈를 아래 블록으로:
---ISSUE---
TITLE: [카테고리] 한 줄 제목 [P1|P2|P3]
LABELS: P1,G1-경제
BODY:
(마크다운 본문 — 증상 / 근거(파일:줄, 수치) / 고칠 방향 / 완료 기준)
---END---
결함을 못 찾았으면 아무것도 출력하지 마라." > "$OUT" 2>&1

echo "▶ Codex 리뷰: $OUT"
# 이슈 등록
python3 - "$OUT" <<'PY' > logs/playtest-issues.tsv
import re,sys
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
seen=set()
for m in re.finditer(r'---ISSUE---\s*TITLE:\s*(.+?)\n\s*LABELS:\s*(.*?)\n\s*BODY:\s*(.*?)---END---', t, re.S):
    title=m.group(1).strip(); labels=m.group(2).strip(); body=m.group(3).strip()
    # 프롬프트에 적어 둔 형식 예시가 그대로 잡히던 문제 — 자리표시자는 버린다
    if '카테고리' in title or 'P1|P2|P3' in title: continue
    if title in seen: continue          # 로그에 같은 블록이 두 번 찍히는 경우가 있다
    seen.add(title)
    print('\t'.join([title, labels, body.replace('\t',' ').replace('\n','\\n')]))
PY
COUNT=$(wc -l < logs/playtest-issues.tsv | tr -d ' ')
echo "▶ 이슈 초안 ${COUNT}건 (logs/playtest-issues.tsv)"
