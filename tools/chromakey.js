// 스프라이트 배경 제거 (1회성 도구): 네 코너에서 플러드필로 배경색 연결 영역을 투명화.
// 배경이 마젠타든 흰색이든 균일하기만 하면 동작. 캐릭터 내부의 유사색은 외곽선에 막혀 보존됨.
// 사용: node tools/chromakey.js <입력디렉토리> <출력디렉토리>
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , inDir, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });

const TOL = 42; // 채널당 허용 오차 (JPEG성 번짐 흡수)

for (const file of fs.readdirSync(inDir).filter((f) => f.endsWith('.png'))) {
  const png = PNG.sync.read(fs.readFileSync(path.join(inDir, file)));
  const { width, height, data } = png;
  const idx = (x, y) => (y * width + x) * 4;

  // 배경 기준색 = 네 코너 평균
  const corners = [idx(0, 0), idx(width - 1, 0), idx(0, height - 1), idx(width - 1, height - 1)];
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((a, i) => a + data[i + c], 0) / 4));
  const isBg = (i) => Math.abs(data[i] - bg[0]) < TOL
    && Math.abs(data[i + 1] - bg[1]) < TOL && Math.abs(data[i + 2] - bg[2]) < TOL;

  // BFS 플러드필 (코너 4곳 시작)
  const visited = new Uint8Array(width * height);
  const queue = [];
  for (const [sx, sy] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    queue.push(sx, sy);
  }
  let removed = 0;
  while (queue.length > 0) {
    const y = queue.pop(), x = queue.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!isBg(i)) continue;
    data[i + 3] = 0;
    removed++;
    queue.push(x - 1, y, x + 1, y, x, y - 1, x, y + 1);
  }
  // 프린지 완화: 투명과 접한 픽셀의 배경색 기를 알파 절반으로
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = idx(x, y);
      if (data[i + 3] === 0) continue;
      const near = [idx(x - 1, y), idx(x + 1, y), idx(x, y - 1), idx(x, y + 1)].some((n) => data[n + 3] === 0);
      if (near && Math.abs(data[i] - bg[0]) < TOL * 2 && Math.abs(data[i + 1] - bg[1]) < TOL * 2
        && Math.abs(data[i + 2] - bg[2]) < TOL * 2) {
        data[i + 3] = 128;
      }
    }
  }
  fs.writeFileSync(path.join(outDir, file), PNG.sync.write(png));
  console.log(`${file}: ${width}x${height}, bg rgb(${bg}), ${Math.round((removed / (width * height)) * 100)}% 제거`);
}
