#!/usr/bin/env bash
# 用本机 Chrome 无头渲染 poster.html -> PNG（2x，2560x1280）
# 用法: ./render.sh [输出名.png]
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-deepimage-banner@2x.png}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p home tmp crash
HOME="$PWD/home" TMPDIR="$PWD/tmp" "$CHROME" \
  --headless=new --no-sandbox --disable-gpu --disable-crashpad --hide-scrollbars \
  --user-data-dir="$PWD/chrome-profile" --crash-dumps-dir="$PWD/crash" \
  --force-device-scale-factor=2 --window-size=1280,640 \
  --screenshot="$OUT" poster.html >/dev/null 2>&1
echo "render -> $OUT"
python3 export.py
