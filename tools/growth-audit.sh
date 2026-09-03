#!/usr/bin/env bash
# growth-audit.sh — 인구 성장 병목 측정 (읽기 전용)
#
# 코드를 고치지 않고 세계를 굴려 성장 경로를 계측한다. DB·파일을 건드리지 않는다
# (sim/ 모듈만 import, 서버·저장소 미사용). 파라미터 변경은 메모리 안의 world.logic
# 한 필드에만 적용되고 프로세스가 끝나면 사라진다.
#
# 사용:
#   tools/growth-audit.sh                                  # 기본: 3시드 60일 전체
#   tools/growth-audit.sh --days 120 --seeds 111           # 장기 곡선
#   tools/growth-audit.sh --mode ab                        # A/B만
#   tools/growth-audit.sh --mode funnel --seeds 111,2024   # 출생 깔때기만
#   tools/growth-audit.sh --mode density --days 180 --seeds 111  # 밀도 반사실 실험
#   tools/growth-audit.sh --mode baseline --days 180 --seeds 111 --json
#
# --mode: baseline | ab | funnel | density | all(기본)
# --seeds: 콤마 구분 (기본 20260903,111,2024)
# --days:  하루=1440틱 (기본 60)
# --json:  표 대신 JSON 라인 출력
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEEDS="20260903,111,2024"
DAYS=60
MODE=all
JSON=0
while [ $# -gt 0 ]; do
  case "$1" in
    --seeds) SEEDS="$2"; shift 2 ;;
    --days)  DAYS="$2";  shift 2 ;;
    --mode)  MODE="$2";  shift 2 ;;
    --json)  JSON=1;     shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

SEEDS="$SEEDS" DAYS="$DAYS" MODE="$MODE" JSON="$JSON" ROOT="$ROOT" \
node --input-type=module <<'JS'
const ROOT = process.env.ROOT;
const { createWorld } = await import(`${ROOT}/sim/world.js`);
const { advance }     = await import(`${ROOT}/sim/tick.js`);
const { isResidence, plotBuildable, zoneFootprint } = await import(`${ROOT}/sim/map.js`);

const SEEDS = process.env.SEEDS.split(',').map(Number);
const DAYS  = Number(process.env.DAYS);
const MODE  = process.env.MODE;
const JSON_OUT = process.env.JSON === '1';

const beds = (w) => w.map.facilities.filter(isResidence).reduce((n, f) => n + f.resources.length, 0);

// 하루 단위로 굴리며 곡선·이벤트를 남긴다. tweak는 world.logic 한 필드만 만진다.
function run(seed, days, tweak) {
  const w = createWorld(seed);
  if (tweak) tweak(w);
  const ev = [];
  const curve = [];
  for (let d = 0; d < days; d++) {
    ev.push(...advance(w, {}, 1440));
    curve.push({ day: d + 1, pop: w.sims.length, beds: beds(w), treasury: w.treasury, rep: w.reputation });
  }
  const c = (t) => ev.filter((e) => e.type === t).length;
  return { w, ev, curve, c };
}

const at = (r, d) => (r.curve[d - 1] ?? r.curve[r.curve.length - 1]).pop;
const marksOf = (r, days) => [10, 20, 40, 60, 90, 120, 180].filter((d) => d <= days).map((d) => at(r, d));
const pad = (s, n) => String(s).padStart(n);

// ---------- ① 기준선 ----------
function baseline() {
  console.log(`\n== ① 기준선 (${DAYS}일) ==`);
  const cols = [10, 20, 40, 60, 90, 120, 180].filter((d) => d <= DAYS);
  console.log(`seed      ${cols.map((d) => pad(`d${d}`, 5)).join('')}  beds  집  이민  출생  사망  결혼  국고     평판 티어`);
  for (const seed of SEEDS) {
    const r = run(seed, DAYS, null);
    const houses = r.w.map.facilities.filter(isResidence).length;
    if (JSON_OUT) { console.log(JSON.stringify({ seed, curve: r.curve, immig: r.c('immigrated'), born: r.c('child_settled') })); continue; }
    console.log(`${pad(seed, 9)} ${cols.map((d) => pad(at(r, d), 5)).join('')}  ${pad(beds(r.w), 4)} ${pad(houses, 3)} ${pad(r.c('immigrated'), 5)} ${pad(r.c('child_settled'), 5)} ${pad(r.c('died'), 5)} ${pad(r.c('married'), 5)} ${pad(r.w.treasury, 8)} ${pad(r.w.reputation, 4)} ${pad(r.w.cityTier, 4)}`);
    // 침대 대비 인구 — 침대가 상한이면 두 수가 붙어 다닌다
    const tight = r.curve.filter((p) => p.beds <= p.pop).length;
    console.log(`          침대<=인구인 날: ${tight}/${DAYS}일  (침대가 상한이면 100%에 가깝다)`);
  }
}

// ---------- ② A/B: 파라미터 하나만 ----------
const TWEAKS = [
  ['대조군(무변경)',            null],
  ['growth.headroomBeds 2→20',  (w) => { w.logic.growth.headroomBeds = 20; }],
  ['growth.maxProjectSlots 3→12', (w) => { w.logic.growth.maxProjectSlots = 12; }],
  ['growth.slotPerTreasury 150k→1k', (w) => { w.logic.growth.slotPerTreasury = 1000; }],
  ['construct.house 5000→1000', (w) => { w.logic.construct.requiredByType.house = 1000; }],
  ['growth.immigWaveMax 3→30',  (w) => { w.logic.growth.immigWaveMax = 30; }],
  ['growth.immigPerExtra 80→1', (w) => { w.logic.growth.immigPerExtra = 1; }],
  ['growth.repDecayPct 95→100', (w) => { w.logic.growth.repDecayPct = 100; }],
  ['growth.repCap 500→100000',  (w) => { w.logic.growth.repCap = 100000; }],
  ['society.immigrationIntervalDays 3→1', (w) => { w.logic.society.immigrationIntervalDays = 1; }],
  ['treasury 초기 2k→3,000,000', (w) => { w.treasury = 3000000; }],
  ['build.maxExtraBeds 2→2 (증축)', (w) => { w.logic.build.maxExtraBeds = 2; }],
  ['family.childPermille 300→1000', (w) => { w.logic.family.childPermille = 1000; }],
  ['society.childCheckDays 30→3', (w) => { w.logic.society.childCheckDays = 3; }],
  ['romance.marryInteractions 120→20', (w) => { w.logic.romance.marryInteractions = 20; }],
  ['romance.marryMin 7500→5000', (w) => { w.logic.romance.marryMin = 5000; }],
  // [진단] 연애 게이트를 직접 완화 — 처방이 아니라 **병목이 아님을 보이는** 대조 실험이다(§0.1).
  ['[진단] romance.datingMin 4500→1500', (w) => { w.logic.romance.datingMin = 1500; }],
  ['[진단] affinity.deltaMin -20→-5', (w) => { w.logic.affinity.deltaMin = -5; }],
];

function ab() {
  console.log(`\n== ② A/B (파라미터 1개만, ${DAYS}일) ==`);
  console.log(`변경                                 ${SEEDS.map((s) => pad(`s${String(s).slice(-4)}`, 7)).join('')}   평균   이민  출생  침대  커플`);
  for (const [label, tweak] of TWEAKS) {
    const pops = []; let im = 0; let bo = 0; let bd = 0; let dt = 0;
    for (const seed of SEEDS) {
      const r = run(seed, DAYS, tweak);
      pops.push(r.w.sims.length); im += r.c('immigrated'); bo += r.c('child_settled'); bd += beds(r.w); dt += r.c('started_dating');
    }
    const avg = Math.round(pops.reduce((a, b) => a + b, 0) / pops.length);
    console.log(`${label.padEnd(36)} ${pops.map((p) => pad(p, 7)).join('')} ${pad(avg, 6)} ${pad(im, 6)} ${pad(bo, 5)} ${pad(Math.round(bd / SEEDS.length), 5)} ${pad(dt, 5)}`);
  }
}

// ---------- ③ 출생 깔때기 ----------
function funnel() {
  console.log(`\n== ③ 출생 깔때기 (${DAYS}일) ==`);
  for (const seed of SEEDS) {
    const r = run(seed, DAYS, null);
    const w = r.w;
    const pairs = [];
    for (const [aStr, b] of Object.entries(w.partners)) {
      const a = Number(aStr);
      if (a < b) pairs.push([a, b, w.partnerStage[a]]);
    }
    const married = pairs.filter((p) => p[2] === 'married');
    let cohab = 0; let roomy = 0;
    for (const [a, b] of married) {
      const pa = w.sims.find((s) => s.id === a); const pb = w.sims.find((s) => s.id === b);
      if (!pa || !pb || pa.homeId !== pb.homeId) continue;
      cohab++;
      const home = w.map.facilities.find((f) => f.id === pa.homeId);
      const residents = w.sims.filter((s) => s.homeId === pa.homeId).length;
      const extraLeft = Math.min(home.extraBedSlots?.length ?? 0, w.logic.build.maxExtraBeds) - (home.resources.length - 2);
      if (home.resources.length > residents || extraLeft > 0) roomy++;
    }
    const checkDays = w.logic.society.childCheckDays;
    const opportunities = Math.floor(DAYS / checkDays);
    const adults = w.sims.filter((s) => s.traits.occupation !== 'child').length;
    console.log(`seed ${seed}: 인구 ${w.sims.length} (성인 ${adults}) → 커플 ${pairs.length}쌍 → 결혼 ${married.length}쌍 → 동거 ${cohab}쌍 → 정원여유 ${roomy}쌍`);
    console.log(`   출산 평가일: ${checkDays}일마다 = ${DAYS}일에 ${opportunities}회 | 확률 ${w.logic.family.childPermille}‰`);
    console.log(`   기대 출생 ≈ 결혼쌍 × 평가횟수 × 확률 = ${married.length} × ${opportunities} × ${(w.logic.family.childPermille / 1000).toFixed(2)} ≈ ${(married.length * opportunities * w.logic.family.childPermille / 1000).toFixed(1)}  | 실측 ${r.c('child_settled')}`);
    console.log(`   started_dating ${r.c('started_dating')} / married ${r.c('married')} / broke_up ${r.c('broke_up')} / 사망 ${r.c('died')}`);
  }
}


// ---------- ④ 밀도 반사실: 성장 드라이브가 house 대신 apartment를 골랐다면 ----------
// 코드를 고치지 않고 **플레이어 zone 주문 통로**(world.zoneOrders)로 같은 효과를 만든다.
// 주문 비용도 정상대로 국고에서 차감한다 — 공짜 건물이 아니다.
function density() {
  console.log(`\n== ④ 밀도 반사실 (같은 7x5 공터: house 침대2 vs apartment 침대8, ${DAYS}일) ==`);
  for (const seed of SEEDS) {
    for (const mode of ['대조군(house만)', '반사실(apartment 우선)']) {
      const w = createWorld(seed);
      const marks = {};
      for (let d = 0; d < DAYS; d++) {
        if (mode !== '대조군(house만)' && w.cityTier >= 1 && w.zoneOrders.length === 0) {
          // 성장 드라이브와 **같은 수요 조건**(pop + headroom > beds)을 쓰되 타입만 apartment로.
          const b = beds(w);
          if (w.sims.length + w.logic.growth.headroomBeds > b) {
            const busy = new Set(w.projects.map((p) => p.plotId));
            const fp = zoneFootprint('apartment', 0);
            const plot = w.plots.find((p) => !p.used && !busy.has(p.plotId) && plotBuildable(w.map, p, fp.w, fp.h));
            if (plot) { w.treasury -= w.logic.zone.costs.apartment; w.zoneOrders.push({ plotId: plot.plotId, type: 'apartment', dir: 0 }); }
          }
        }
        advance(w, {}, 1440);
        if ([20, 60, 90, 120, 150, 180].includes(d + 1)) marks[d + 1] = w.sims.length;
      }
      const free = w.plots.filter((p) => !p.used && plotBuildable(w.map, p)).length;
      const apts = w.map.facilities.filter((f) => f.type === 'apartment').length;
      console.log(`seed ${seed} ${mode.padEnd(22)} pop ${JSON.stringify(marks)} | beds ${beds(w)} 아파트 ${apts} 남은공터 ${free} 국고 ${w.treasury} 티어 ${w.cityTier}`);
    }
  }
}

if (MODE === 'baseline' || MODE === 'all') baseline();
if (MODE === 'funnel'   || MODE === 'all') funnel();
if (MODE === 'ab'       || MODE === 'all') ab();
if (MODE === 'density') density();
JS
