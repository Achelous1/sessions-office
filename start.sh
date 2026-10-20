#!/usr/bin/env bash
# Session Office: start the server (if not already running) and open it in the browser.
# Usage: ./start.sh            (PORT=5000 ./start.sh to change the port)
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-4545}"
URL="http://localhost:$PORT"

command -v node >/dev/null || { echo "node가 필요합니다 (v18 이상)." >&2; exit 1; }

open_browser() {
  if grep -qi microsoft /proc/version 2>/dev/null; then cmd.exe /c start "" "$URL" >/dev/null 2>&1   # WSL -> Windows browser
  elif command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null; then open "$URL"
  else echo "브라우저에서 $URL 을 열어 주세요."; fi
}

if curl -s -o /dev/null "$URL/api/sessions" 2>/dev/null; then
  echo "이미 실행 중입니다: $URL"
  open_browser
  exit 0
fi

PORT="$PORT" node server &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' INT TERM
for _ in $(seq 20); do curl -s -o /dev/null "$URL/api/sessions" && break; sleep 0.25; done
echo "Session Office: $URL  (종료: Ctrl+C)"
open_browser
wait $SERVER
