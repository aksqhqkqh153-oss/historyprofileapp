from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from app.db import DB_ENGINE, get_conn

OUTPUT_DIR = Path(__file__).resolve().parents[1] / 'backups'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

with get_conn() as conn:
    if DB_ENGINE == 'postgresql':
        tables = [row[0] for row in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename").fetchall()]
    else:
        tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()]

    payload = {
        'created_at': datetime.utcnow().isoformat(timespec='seconds'),
        'db_engine': DB_ENGINE,
        'tables': {},
    }
    for table in tables:
        rows = conn.execute(f'SELECT * FROM {table}').fetchall()
        payload['tables'][table] = [dict(row) for row in rows]

output = OUTPUT_DIR / f"backup_{datetime.utcnow():%Y%m%d_%H%M%S}.json"
output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
print(output)
