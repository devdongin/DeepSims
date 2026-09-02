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

# 시작 전에 작업트리가 깨끗해야 한다.
#
# 이 스크립트는 "실행이 끝난 뒤 바뀐 파일 = Codex가 바꾼 파일"로 판정하고, 코드 파일이면
# 되돌린다. 그 전제는 **깨끗한 baseline에서만** 참이다. 더러운 상태로 돌리면 아래
# 되돌리기가 사람이 쓰던 미커밋 작업을 그대로 날린다 — 실제로 fence_wood·bench2·
# street_tree_lit 배선 작업이 이 경로로 통째로 사라졌다(§22.30).
DIRTY=$(git status --porcelain | grep -v '^?? logs/' || true)
if [ -n "$DIRTY" ]; then
  echo "✋ 작업트리가 깨끗하지 않다. 커밋하거나 stash한 뒤 다시 실행해라."
  echo "$DIRTY"
  exit 1
fi
LOG="logs/assets-$(date +%Y%m%d-%H%M).md"
FOCUS="${1:-}"

INVENTORY=$(find client/public -name '*.png' | sort | head -80 | while read f; do
  sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | tr '\n' ' ' | sed "s|^|$f |" | awk '{print $1, $3, $5}'
done)
CONSTRAINTS=$(cat docs/ASSET_CONSTRAINTS.md 2>/dev/null || echo '(제약 문서 없음)')
PREV=$(ls -t logs/assets-*.md 2>/dev/null | head -3 | xargs cat 2>/dev/null | head -60 || echo '(첫 실행)')

codex exec -m gpt-5.6-luna --sandbox workspace-write "너는 DeepSims의 **전담 픽셀아트 작가**다. 목업(docs/mockup.png)이 이 게임이 도달하려는 그림이고, 현재 에셋과의 간극을 매 회차 하나씩 줄이는 것이 네 일이다. 지시를 기다리지 말고 스스로 진행하라 (사용자 지시).

## 목업의 지면 문법
목업: 마을 전체가 **따뜻한 회갈색 석재 포장 광장**이고, 잔디는 정원·화단 구획 안에만 있다. 구획 경계는 낮은 석벽·나무 울타리. 길은 검은 아스팔트가 아니라 밝은 돌바닥, 가장자리에 흙·꽃 테두리.

**화면의 현재 상태는 아래 '상시 제약' 문서를 믿어라.** 이 프롬프트에 현재 상태를 적어 두면 낡아서 너를 오도한다 — 실제로 그렇게 한 회차의 성과가 다음 회차에 통째로 되돌아간 적이 있다.

## 상시 제약 — 이미 내려진 결정 (반드시 먼저 읽어라)
$CONSTRAINTS

## 이번 회차 작업
${FOCUS:-지난 기록(아래)을 읽고 아직 남은 간극 중 가장 눈에 띄는 것 하나를 골라라.}

## 규칙
1. **PNG만 만들거나 교체한다.** client/main.js·index.html 등 코드는 절대 건드리지 않는다. 새 텍스처 키가 필요하면 로그에 '배선 요청'으로 남겨라 — Claude가 배선한다.
2. 기존 파일 교체가 우선이다(배선 없이 즉시 반영된다): client/public/props/tile_*.png (128×64 소스, 게임에서 32×16으로 축소), 건물 bld_*.png, 소품.
3. 그리는 방법: node로 pngjs를 써서 픽셀을 직접 그리는 스크립트를 /tmp/에 쓰고 실행하라 (tools/chromakey.js가 pngjs 사용 예시). 아이소메트릭 2:1 마름모, 팔레트는 목업에서 뽑아라(석재 #b8a88a~#8a7a5c 계열). **지면 타일을 건드렸으면 상시 제약 §2의 색거리 계약을 스크립트 안에서 직접 계산해 확인하라.**
4. 결과 검증: sips -g pixelWidth로 치수 확인, 기존 파일과 같은 치수여야 한다.
5. 마치면 로그를 stdout에 남겨라: 무엇을 왜 바꿨고, 다음 회차에 무엇이 남았는지, 배선 요청이 있는지.
6. git 커밋은 하지 마라 — 스크립트가 한다.

## 현재 에셋 인벤토리 (파일 폭 높이)
$INVENTORY

## 지난 회차 기록
$PREV
" </dev/null 2>&1 | tee "$LOG" | tail -30

# PNG가 아닌 변경이 있으면 **알리기만** 한다 — 지우지 않는다.
#
# 예전에는 여기서 git checkout --로 되돌렸다. 그러다 실제로 사고가 났다:
# 시작 시점엔 트리가 깨끗했지만 **Codex가 도는 동안 사람이 코드를 고쳤고**, 끝날 때
# 그 변경을 Codex의 것으로 보고 통째로 지웠다(§22.37 수정이 그렇게 날아갔다 —
# 사본이 없었으면 복구 못 했다). 시작 시점 검사로는 이 경쟁 상태를 막을 수 없다:
# 이 스크립트는 몇 분씩 돌고, 그동안의 변경을 **누가 했는지 구별할 방법이 없다.**
#
# 그런데 되돌리기는 애초에 없어도 된다. 아래 커밋 단계가 이미 **PNG만 골라
# add**하므로 코드 변경은 어차피 커밋되지 않는다. 되돌리기는 덤이었고, 그 덤이
# 유일하게 파괴적인 부분이었다. 알리고 사본만 남기고, 처리는 사람이 판단한다.
NONPNG=$(git status --porcelain | awk '{print $2}' | grep -v '\.png$' | grep -v '^logs/' || true)
if [ -n "$NONPNG" ]; then
  BK="logs/uncommitted-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BK"
  echo "$NONPNG" | while read -r f; do
    [ -f "$f" ] && { mkdir -p "$BK/$(dirname "$f")"; cp "$f" "$BK/$f"; }
  done
  echo "⚠️ PNG가 아닌 변경이 남아 있다 (커밋에는 안 들어간다). 사본: $BK"
  echo "$NONPNG" | sed 's/^/     /'
  echo "   Codex가 건드린 것일 수도, 실행 중 사람이 고친 것일 수도 있다 — 확인해라."
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
