#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
PORT="${PORT:-3000}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  exit 1
fi

if [ ! -d "$WEB_DIR" ]; then
  echo "Cannot find web app directory: $WEB_DIR"
  exit 1
fi

cd "$WEB_DIR"

if [ ! -d node_modules ]; then
  echo "Installing web dependencies..."
  npm install
fi

NEXT_BIN="$WEB_DIR/node_modules/.bin/next"
if command -v pgrep >/dev/null 2>&1; then
  OLD_PIDS="$(pgrep -f "$NEXT_BIN dev" || true)"
  if [ -n "$OLD_PIDS" ]; then
    echo "Stopping existing Next dev server for this app..."
    kill $OLD_PIDS || true
    for _ in 1 2 3 4 5; do
      sleep 1
      if [ -z "$(pgrep -f "$NEXT_BIN dev" || true)" ]; then
        break
      fi
    done

    REMAINING_NEXT_PIDS="$(pgrep -f "$NEXT_BIN dev" || true)"
    if [ -n "$REMAINING_NEXT_PIDS" ]; then
      echo "Old Next dev server is still running; forcing it to stop..."
      kill -9 $REMAINING_NEXT_PIDS || true
      sleep 1
    fi
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:"$PORT" || true)"
  if [ -n "$PIDS" ]; then
    echo "Stopping existing process on port $PORT..."
    kill $PIDS || true
    for _ in 1 2 3 4 5; do
      sleep 1
      if [ -z "$(lsof -ti tcp:"$PORT" || true)" ]; then
        break
      fi
    done

    REMAINING_PIDS="$(lsof -ti tcp:"$PORT" || true)"
    if [ -n "$REMAINING_PIDS" ]; then
      echo "Port $PORT is still busy; forcing old process to stop..."
      kill -9 $REMAINING_PIDS || true
      sleep 1
    fi
  fi
fi

echo "Starting Infinite Canvas at http://localhost:$PORT"
PORT="$PORT" npm run dev
