#!/bin/zsh
# §22.25 자율 에셋 개선 에이전트 (사용자 지시: "목업 이미지의 길과 타일의 배치가
# 지금의 모습과 너무 다르잖아. Codex에게 에셋을 열심히 만들어서 적용하라고 지시해.
# Codex는 지시를 기다리지 말고 스스로 에셋 개선 작업도 별도로 진행하게 해")
#
# 프로젝트 규칙: 픽셀아트 에셋은 **Codex 전담**이다. 이 스크립트는 주기적으로 Codex를
# 깨워 목업(docs/mockup.png)과 현재 에셋의 간극을 하나씩 줄이게 한다.
# 파이프라인: pngjs로 픽셀을 그리는 Node 스크립트를 Codex가 직접 써서 실행한다
# (tools/chromakey.js가 같은 방식). 코드(js/html)는 건드리지 않는다 — 그건 Claude 몫.
#
# 사용: ./tools/asset-agent.sh [지시문]   (지시문 없으면 Codex가 스스로 갭을 고른다)
set -e
cd "$(dirname "$0")/.."
mkdir -p logs
LOG="logs/assets-$(date +%Y%m%d-%H%M).md"
FOCUS="${1:-}"

INVENTORY=$(find client/public -name '*.png' | sort | head -80 | while read f; do
  sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | tr '\n' ' ' | sed "s|^|$f |" | awk '{print $1, $3, $5}'
done)
PREV=$(ls -t logs/assets-*.md 2>/dev/null | head -3 | xargs cat 2>/dev/null | head -60 || echo '(첫 실행)')

codex exec -m gpt-5.6-luna --sandbox workspace-write "너는 DeepSims의 **전담 픽셀아트 작가**다. 목업(docs/mockup.png)이 이 게임이 도달하려는 그림이고, 현재 에셋과의 간극을 매 회차 하나씩 줄이는 것이 네 일이다. 지시를 기다리지 말고 스스로 진행하라 (사용자 지시).

## 목업의 지면 문법 (현재와 가장 다른 부분)
목업: 마을 전체가 **따뜻한 회갈색 석재 포장 광장**이고, 잔디는 정원·화단 구획 안에만 있다. 구획 경계는 낮은 석벽·나무 울타리. 길은 검은 아스팔트가 아니라 밝은 돌바닥, 가장자리에 흙·꽃 테두리.
현재: 화면 전체가 밝은 초록 잔디 + 검은 격자 도로 — 차갑고 밋밋하다.

## 이번 회차 작업
${FOCUS:-지난 기록(아래)을 읽고 아직 남은 간극 중 가장 눈에 띄는 것 하나를 골라라.}

## 규칙
1. **PNG만 만들거나 교체한다.** client/main.js·index.html 등 코드는 절대 건드리지 않는다. 새 텍스처 키가 필요하면 로그에 '배선 요청'으로 남겨라 — Claude가 배선한다.
2. 기존 파일 교체가 우선이다(배선 없이 즉시 반영된다): client/public/props/tile_*.png (128×64 소스, 게임에서 32×16으로 축소), 건물 bld_*.png, 소품.
3. 그리는 방법: node로 pngjs를 써서 픽셀을 직접 그리는 스크립트를 /tmp/에 쓰고 실행하라 (tools/chromakey.js가 pngjs 사용 예시). 아이소메트릭 2:1 마름모, 팔레트는 목업에서 뽑아라(석재 #b8a88a~#8a7a5c 계열, 잔디는 채도 낮춘 #5a7a4a 계열에 질감 노이즈).
4. 결과 검증: sips -g pixelWidth로 치수 확인, 기존 파일과 같은 치수여야 한다.
5. 마치면 로그를 stdout에 남겨라: 무엇을 왜 바꿨고, 다음 회차에 무엇이 남았는지, 배선 요청이 있는지.
6. git 커밋은 하지 마라 — 스크립트가 한다.

## 현재 에셋 인벤토리 (파일 폭 높이)
$INVENTORY

## 지난 회차 기록
$PREV
" </dev/null 2>&1 | tee "$LOG" | tail -30

# PNG만 바뀌었는지 확인 후 커밋 (코드가 바뀌었으면 되돌리고 경고)
CHANGED=$(git status --porcelain | awk '{print $2}')
NONPNG=$(echo "$CHANGED" | grep -v '\.png$' | grep -v '^logs/' || true)
if [ -n "$NONPNG" ]; then
  echo "⚠️ 에셋 에이전트가 코드 파일을 건드렸다 — 되돌린다: $NONPNG"
  echo "$NONPNG" | xargs git checkout -- 2>/dev/null || true
fi
PNGS=$(git status --porcelain | awk '{print $2}' | grep '\.png$' || true)
if [ -n "$PNGS" ]; then
  git add $(echo $PNGS) "$LOG" 2>/dev/null || git add $(echo $PNGS)
  git commit -q -m "assets: Codex 자율 에셋 개선 회차 — $(basename $LOG .md)

목업(docs/mockup.png) 간극 축소. PNG 전용 커밋 — 코드 불변.
상세: $LOG

Co-Authored-By: Codex (gpt-5.6-luna) <noreply@openai.com>"
  git push -q || true
  echo "커밋 완료: $(echo "$PNGS" | wc -l | tr -d ' ')개 PNG"
else
  echo "이번 회차 변경 없음"
fi
