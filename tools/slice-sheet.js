// 걷기 시트 슬라이서 (1회성 도구): 코너 플러드필 배경 제거 → 알파 열-투영으로 프레임 분리
// (균등 격자 가정 없음 — imagegen 간격 오차 흡수) → 프레임별 bbox를 공통 셀에
// 하단-중앙 정렬(발끝 기준선 고정, 보행 지터 방지) → walk{N}_{0..3}.png 출력.
// 사용: node tools/slice-sheet.js <시트.png> <출력디렉토리> <키이름(walk0)> [셀높이=96]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , sheetPath, outDir, keyName, cellHArg] = process.argv;
if (!sheetPath || !outDir || !keyName) {
  console.error('사용: node tools/slice-sheet.js <시트.png> <출력디렉토리> <키이름> [셀높이]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const png = PNG.sync.read(fs.readFileSync(sheetPath));
const { width, height, data } = png;
const idx = (x, y) => (y * width + x) * 4;

// 1) 배경 제거 — chromakey.js와 동일 규칙 (네 코너 평균색, 플러드필)
const TOL = 42;
const corners = [idx(0, 0), idx(width - 1, 0), idx(0, height - 1), idx(width - 1, height - 1)];
const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((a, i) => a + data[i + c], 0) / 4));
const isBg = (i) => Math.abs(data[i] - bg[0]) < TOL
  && Math.abs(data[i + 1] - bg[1]) < TOL && Math.abs(data[i + 2] - bg[2]) < TOL;
const visited = new Uint8Array(width * height);
const queue = [];
for (const [sx, sy] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) queue.push(sx, sy);
while (queue.length) {
  const y = queue.pop(); const x = queue.pop();
  if (x < 0 || y < 0 || x >= width || y >= height) continue;
  const v = y * width + x;
  if (visited[v]) continue;
  visited[v] = 1;
  const i = idx(x, y);
  if (!isBg(i)) continue;
  data[i + 3] = 0;
  queue.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}
// 잔여 마젠타 헤일로 억제: 외곽선 밖 반투명 핑크 픽셀 정리
for (let p = 0; p < width * height; p++) {
  const i = p * 4;
  if (data[i + 3] > 0 && data[i] > 200 && data[i + 2] > 200 && data[i + 1] < 120) data[i + 3] = 0;
}

// 2) 열-투영으로 프레임 클러스터 분리 (완전 투명 열 ≥ gapMin 이 경계)
const colHas = new Uint8Array(width);
for (let x = 0; x < width; x++) {
  for (let y = 0; y < height; y++) if (data[idx(x, y) + 3] > 8) { colHas[x] = 1; break; }
}
const gapMin = Math.max(4, Math.round(width / 200));
const clusters = [];
let start = -1; let gap = 0;
for (let x = 0; x <= width; x++) {
  const has = x < width && colHas[x];
  if (has) {
    if (start < 0) start = x;
    gap = 0;
  } else if (start >= 0) {
    gap++;
    if (gap >= gapMin || x === width) { clusters.push([start, x - gap]); start = -1; gap = 0; }
  }
}
if (clusters.length < 4) {
  console.error(`프레임 분리 실패: ${clusters.length}개 클러스터 (4 필요) — 개별 재생성 요망`);
  process.exit(2);
}
// 폭 상위 4개를 x순으로 (파편 노이즈 제거)
const frames4 = clusters
  .map((c) => ({ c, w: c[1] - c[0] }))
  .sort((a, b) => b.w - a.w).slice(0, 4)
  .map((o) => o.c).sort((a, b) => a[0] - b[0]);

// 3) 프레임별 bbox → 공통 셀 (하단-중앙 정렬)
const boxes = frames4.map(([x0, x1]) => {
  let top = height; let bot = -1; let left = x1; let right = x0;
  for (let x = x0; x <= x1; x++) for (let y = 0; y < height; y++) {
    if (data[idx(x, y) + 3] > 8) {
      if (y < top) top = y; if (y > bot) bot = y;
      if (x < left) left = x; if (x > right) right = x;
    }
  }
  return { left, right, top, bot, w: right - left + 1, h: bot - top + 1 };
});
const maxW = Math.max(...boxes.map((b) => b.w));
const maxH = Math.max(...boxes.map((b) => b.h));
const cellW = maxW + 4; const cellH = maxH + 4;

boxes.forEach((b, f) => {
  const out = new PNG({ width: cellW, height: cellH });
  const ox = Math.floor((cellW - b.w) / 2); // 가로 중앙
  const oy = cellH - 2 - b.h;               // 발끝 기준선 = cellH-2
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const si = idx(b.left + x, b.top + y);
    const di = ((oy + y) * cellW + (ox + x)) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
  }
  fs.writeFileSync(path.join(outDir, `${keyName}_${f}.png`), PNG.sync.write(out));
});
console.log(`${keyName}: 4프레임 → ${cellW}×${cellH} (셀), 출력 ${outDir}`);
