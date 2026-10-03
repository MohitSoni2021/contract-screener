#!/bin/bash
set -e

# Run background ingestion worker with auto-restart on unexpected exit
run_worker() {
    while true; do
        echo "[Worker] Starting document ingestion worker..."
        python -m app.worker || true
        echo "[Worker] Ingestion worker exited. Restarting in 5 seconds..."
        sleep 5
    done
}

run_worker &
WORKER_PID=$!

cleanup() {
    trap - TERM INT EXIT
    echo "[Entrypoint] Stopping services..."
    kill -TERM "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
    exit 0
}

trap cleanup TERM INT

echo "[Entrypoint] Starting Uvicorn Web Server on port ${PORT:-8000}..."
uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "${WORKERS:-${WEB_CONCURRENCY:-1}}" &
SERVER_PID=$!

wait "$SERVER_PID"
cleanup

