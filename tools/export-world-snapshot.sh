#!/bin/zsh
# 살아있는 세계의 요약을 logs/world-snapshot.json 으로 내보낸다.
# GitHub Actions(world-review.yml)가 PR·이슈 코멘트에 이 요약을 붙여, 다음 작업자가
# "지금 세계가 어떤 상태인지"를 보고 이어받을 수 있게 한다. (사용자 지시)
set -e
cd "$(dirname "$0")/.."
mkdir -p logs
node --input-type=module -e "
import Database from 'better-sqlite3';
import fs from 'node:fs';
const db = new Database('deepsims.db', { readonly: true });
const w = JSON.parse(db.prepare('SELECT state FROM snapshot ORDER BY tick DESC LIMIT 1').get().state);
const day = Math.floor(w.worldTick / 1440);
const facilities = {};
for (const f of w.map.facilities) facilities[f.type] = (facilities[f.type] ?? 0) + 1;
const since = Math.max(0, w.worldTick - 7 * 1440);
const topFails7d = db.prepare(
  \"SELECT payload, COUNT(*) n FROM events WHERE type='action_failed' AND tick > ? GROUP BY payload ORDER BY n DESC LIMIT 5\"
).all(since);
const events7d = db.prepare(
  'SELECT type, COUNT(*) n FROM events WHERE tick > ? GROUP BY type ORDER BY n DESC LIMIT 12'
).all(since);
fs.writeFileSync('logs/world-snapshot.json', JSON.stringify({
  exportedAtTick: w.worldTick, day, pop: w.sims.length, tier: w.cityTier,
  treasury: w.treasury, reputation: w.reputation, policy: w.policy,
  facilities, plotsFree: w.plots.filter((p) => !p.used).length,
  incidents: w.incidents.length,
  // §19.10 (73차 ②): 원인 분화 이전에 쌓인 no_facility 항목은 오라벨일 수 있어
  // 외부(로드맵 에이전트) 노출에서 legacy로 표시한다. 감쇠로 자연 소멸한다.
  complaints: (w.complaints ?? []).slice(-20).map((c) => (
    c.kind === 'no_facility' && c.sinceDay < (w.complaintReasonDay ?? 0)
      ? { ...c, kind: 'no_facility(legacy-오라벨가능)' } : c)),
  stats14: (w.statsHistory ?? []).slice(-14),
  events7d, topFails7d,
}, null, 1) + '\n');
console.log('logs/world-snapshot.json 갱신: Day ' + day + ' 인구 ' + w.sims.length);
"
