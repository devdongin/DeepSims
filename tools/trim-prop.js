// 에셋 투명 여백 트림 (이슈 #15): 알파 bbox로 크롭해 '그림 내용 = 파일 크기'를 보장.
// 클라 스케일 계산이 내용 기준으로 정확히 발자국과 일치하게 된다.
// 사용: node tools/trim-prop.js <파일.png 또는 디렉토리> [패턴접두어]
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const [, , target, prefix] = process.argv;
const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter((f) => f.endsWith('.png') && (!prefix || f.startsWith(prefix)))
    .map((f) => path.join(target, f))
  : [target];

for (const file of files) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  let top = height; let bot = -1; let left = width; let right = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) {
      if (y < top) top = y; if (y > bot) bot = y;
      if (x < left) left = x; if (x > right) right = x;
    }
  }
  if (bot < 0) { console.log(`${path.basename(file)}: 내용 없음 — 건너뜀`); continue; }
  const w = right - left + 1; const h = bot - top + 1;
  if (w === width && h === height) { console.log(`${path.basename(file)}: 이미 타이트`); continue; }
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((top + y) * width + (left + x)) * 4;
    const di = (y * w + x) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
  }
  fs.writeFileSync(file, PNG.sync.write(out));
  console.log(`${path.basename(file)}: ${width}×${height} → ${w}×${h}`);
}
