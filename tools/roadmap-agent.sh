#!/bin/zsh
# §19 상시 로드맵 에이전트 — 세계의 축적된 이슈를 종합해 Codex와 함께 다음 로드맵을 제시한다.
# 사용자 지시: "이슈들이 어느 정도 종합됐을 때 한 번씩" (주기 ≥ 1시간).
# 이 스크립트는 관찰·제안만 한다 (코드 수정·머지는 하지 않음).
set -e
cd "$(dirname "$0")/.."
OUT_DIR="logs"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M)

# 1) 세계 상태 요약 (라이브 DB — 읽기 전용)
WORLD=$(node --input-type=module -e "
import Database from 'better-sqlite3';
const db = new Database('deepsims.db', { readonly: true });
const w = JSON.parse(db.prepare('SELECT state FROM snapshot ORDER BY tick DESC LIMIT 1').get().state);
const day = Math.floor(w.worldTick / 1440);
const byType = {};
for (const f of w.map.facilities) byType[f.type] = (byType[f.type] ?? 0) + 1;
const occ = {};
for (const s of w.sims) occ[s.traits.occupation] = (occ[s.traits.occupation] ?? 0) + 1;
const since = Math.max(0, w.worldTick - 7 * 1440);
const evs = db.prepare('SELECT type, COUNT(*) n FROM events WHERE tick > ? GROUP BY type ORDER BY n DESC LIMIT 14').all(since);
const fails = db.prepare(\"SELECT payload, COUNT(*) n FROM events WHERE type='action_failed' AND tick > ? GROUP BY payload ORDER BY n DESC LIMIT 5\").all(since);
console.log(JSON.stringify({
  day, pop: w.sims.length, tier: w.cityTier, treasury: w.treasury, reputation: w.reputation,
  policy: w.policy, facilities: byType, occupations: occ, plotsFree: w.plots.filter(p => !p.used).length,
  incidents: w.incidents.length, lostAndFound: w.lostAndFound?.length ?? 0,
  complaints: (w.complaints ?? []).slice(-40),
  stats14: (w.statsHistory ?? []).slice(-14),
  events7d: evs, topFails7d: fails,
}, null, 1));
" 2>/dev/null || echo '{"error":"world read failed"}')

# 2) 저장소 상태 (열린 이슈 = 아직 세계가 해결하지 못한 문제)
ISSUES=$(gh issue list --state open --limit 30 --json number,title,labels 2>/dev/null || echo '[]')
RECENT=$(git log --oneline -15 2>/dev/null || echo '')

PROMPT_FILE="$OUT_DIR/roadmap-input-$STAMP.json"
cat > "$PROMPT_FILE" <<EOF
{"world": $WORLD, "openIssues": $ISSUES, "recentCommits": "$(echo "$RECENT" | tr '\n' ';' | sed 's/"/\\"/g')"}
EOF

# 3) Codex에게 종합 로드맵 제안 요청 (읽기 전용 세션 — 별도 스레드)
codex exec -m gpt-5.6-luna --sandbox read-only "너는 DeepSims(결정적 심즈라이크+도시 타이쿤)의 로드맵 파트너다.
아래는 살아 있는 세계의 현재 상태·심들의 불만(complaints)·열린 이슈·최근 커밋이다.

$(cat "$PROMPT_FILE")

이 세계가 '실세계에 더 가까워지도록' 다음 사이클에 무엇을 해야 하는지 **3~5개 항목**의 로드맵을 제시하라. 각 항목은:
- 제목(한 줄) / 근거(세계 데이터의 어떤 수치·불만에서 도출됐는지) / 설계 스케치(결정성·드로우 계약 고려) / 우선순위(P1~P3)
규칙: (1) 인구를 직접 조작하는 제안 금지 — 창발 경로만. (2) 기존 §17/§18 계약(결정적 tick, 내구 입력, 드로우 순서)을 깨지 않을 것. (3) 이미 열린 이슈와 중복되면 '기존 #N 확장'으로 표기. (4) 가능하면 실제 논문·게임(Anno1800/문명/시티즈) 사례를 근거로 인용.
출력은 마크다운 목록만." > "$OUT_DIR/roadmap-$STAMP.md" 2>&1 || echo "codex 실패" >> "$OUT_DIR/roadmap-$STAMP.md"

echo "$OUT_DIR/roadmap-$STAMP.md"
