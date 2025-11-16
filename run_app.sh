#!/usr/bin/env bash
set -euo pipefail

# Launch backend (FastAPI via Uvicorn) and static React frontend server from one terminal.
# Override ports/host via env: BACKEND_PORT, FRONTEND_PORT, BACKEND_HOST.

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-4173}"
BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

cd "$REPO_ROOT"

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "${BACK_PID:-}" ]] && kill -0 "$BACK_PID" 2>/dev/null; then
    kill "$BACK_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONT_PID:-}" ]] && kill -0 "$FRONT_PID" 2>/dev/null; then
    kill "$FRONT_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

PYTHONPATH="$REPO_ROOT:${PYTHONPATH:-}" python -m uvicorn backend.main:app \
  --host "$BACKEND_HOST" --port "$BACKEND_PORT" --reload &
BACK_PID=$!

echo "Backend running on http://$BACKEND_HOST:$BACKEND_PORT"

cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies..." >&2
  npm install
fi
BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT" npm run build >&2
BACKEND_URL="http://$BACKEND_HOST:$BACKEND_PORT" PORT="$FRONTEND_PORT" npm run preview -- --host --port "$FRONTEND_PORT" &
FRONT_PID=$!

echo "Frontend (Vite preview) running on http://localhost:$FRONTEND_PORT"
echo "Press Ctrl+C to stop both."

wait -n "$BACK_PID" "$FRONT_PID"
echo "Process exited; shutting down..."
