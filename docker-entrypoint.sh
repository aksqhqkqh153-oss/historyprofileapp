#!/bin/sh
set -eu
PORT_VALUE="${PORT:-8000}"
echo "[entrypoint] Python: $(python --version 2>&1)"
echo "[entrypoint] Playwright browsers path: ${PLAYWRIGHT_BROWSERS_PATH:-default}"
echo "[entrypoint] SOOMGO_EMAIL present: $( [ -n "${SOOMGO_EMAIL:-}" ] && echo yes || echo no )"
echo "[entrypoint] SOOMGO_PASSWORD present: $( [ -n "${SOOMGO_PASSWORD:-}" ] && echo yes || echo no )"
python - <<'PY'
from pathlib import Path
import os
base = Path(os.getenv('PLAYWRIGHT_BROWSERS_PATH', '/ms-playwright'))
print(f"[entrypoint] Playwright path exists: {base.exists()} -> {base}")
if base.exists():
    for child in sorted(base.glob('*')):
        print(f"[entrypoint] browser cache entry: {child}")
PY
echo "[entrypoint] Starting uvicorn on port ${PORT_VALUE}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT_VALUE}"
