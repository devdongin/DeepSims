#!/bin/zsh
# §23.30 질병 재보정 측정기 (이슈 #163 ①).
# 연간 1인당 발병 수를 축으로, 전염 확률 후보를 20시드로 잰다.
# 3시드로는 시드 편차가 파라미터 효과를 삼킨다 — PLAN §0.1.1.
#
# 사용: ./tools/disease-calibration.sh [시드수] [일수]
set -e
cd "$(dirname "$0")/.."
SEEDS=${1:-20}
DAYS=${2:-120}
OUT="logs/disease-calibration-$(date +%Y%m%d-%H%M).md"
cat > /tmp/dc.mjs <<JS
import { createWorld, advance } from './sim/index.js';
const SEEDS = Array.from({length: ${SEEDS}}, (_, i) => 1000 + i * 37);
const DAYS = ${DAYS};
const YEAR = 120; // 이 세계의 한 해 (society.yearDays)
const st = (a) => { const m = a.reduce((x,y)=>x+y,0)/a.length;
  const sd = Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length);
  return { m: Math.round(m*100)/100, sd: Math.round(sd*100)/100 }; };
console.log('| 전염 ‰ | 발병/년 | 유병률 % | 진료/년 | 전염 비중 % |');
console.log('|---:|---|---|---|---|');
for (const c of [40, 25, 15, 10, 6]) {
  const inc = [], prev = [], visits = [], share = [];
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    w.logic.disease.contagionPermille = c;
    const ev = advance(w, {}, DAYS * 1440);
    const pop = Math.max(1, w.sims.length);
    const fell = ev.filter(e => e.type === 'fell_sick').length;
    inc.push((fell / pop) * (YEAR / DAYS));
    prev.push(100 * w.sims.filter(s => s.sick).length / pop);
    const v = ev.filter(e => e.type === 'medical_visit_paid').length;
    visits.push((v / pop) * (YEAR / DAYS));
    // 전염 경로 비중: 감염 시점에 다른 아픈 사람과 짝이었는지는 이벤트에 없다.
    // 대신 일일 판정만 남긴 대조군과의 차이로 추정한다 (같은 시드, contagion 0).
    const w0 = createWorld(seed);
    w0.logic.disease.contagionPermille = 0;
    const ev0 = advance(w0, {}, DAYS * 1440);
    const base = ev0.filter(e => e.type === 'fell_sick').length / Math.max(1, w0.sims.length);
    share.push(fell / pop > 0 ? Math.max(0, 100 * (1 - base / (fell / pop))) : 0);
  }
  const f = (s) => \`\${s.m} ± \${s.sd}\`;
  console.log(\`| \${c} | \${f(st(inc))} | \${f(st(prev))} | \${f(st(visits))} | \${f(st(share))} |\`);
}
console.log();
console.log('현실 기준: 성인 연 2~3회 (CDC). 병원이 죽은 콘텐츠가 아니려면 진료/년 > 0이어야 한다.');
JS
cp /tmp/dc.mjs ./dc.mjs
{
  echo "# 질병 재보정 — 시드 ${SEEDS}개 × ${DAYS}일"
  echo
  node dc.mjs
} | tee "$OUT"
rm -f dc.mjs
echo
echo "→ $OUT"
