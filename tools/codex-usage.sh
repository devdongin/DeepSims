#!/bin/zsh
# Codex 주간 사용량을 세션 롤아웃 로그에서 읽는다.
# codex CLI가 매 응답의 rate_limits를 rollout jsonl에 남긴다 — 그 마지막 값을 쓴다.
# 출력: "used_percent remaining_percent" (읽지 못하면 "-1 -1")
F=$(ls -t ~/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -1)
[ -z "$F" ] && { echo "-1 -1"; exit 0; }
python3 - "$F" <<'PY'
import json,sys
used=None
for line in open(sys.argv[1], errors='ignore'):
    try: o=json.loads(line)
    except: continue
    rl=(o.get('payload') or {}).get('rate_limits')
    if isinstance(rl,dict):
        p=rl.get('primary') or {}
        if isinstance(p.get('used_percent'),(int,float)): used=float(p['used_percent'])
print(f"{used:.1f} {100-used:.1f}" if used is not None else "-1 -1")
PY
