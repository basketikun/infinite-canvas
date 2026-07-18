#!/bin/zsh
set -e

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR/web"

if [[ ! -x node_modules/.bin/vite ]]; then
  npm install --legacy-peer-deps --package-lock=false
fi

npm run dev &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for _ in {1..30}; do
  if curl --silent --fail http://localhost:3000 >/dev/null; then
    open http://localhost:3000
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 1
done

echo "启动失败：30 秒内无法访问 http://localhost:3000"
exit 1
