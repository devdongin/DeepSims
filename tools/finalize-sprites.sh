#!/bin/zsh
# 스프라이트 마무리: 배경 제거 → 192px 다운스케일 → client/public/sprites/ 배치
set -e
cd "$(dirname "$0")/.."
node tools/chromakey.js client/public/sprites/raw /tmp/deepsims-keyed
for f in /tmp/deepsims-keyed/*.png; do
  sips -Z 192 "$f" --out "client/public/sprites/$(basename "$f")" >/dev/null
done
ls -la client/public/sprites/*.png
