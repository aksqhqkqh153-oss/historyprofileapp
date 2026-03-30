from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

from app.db import SCHEMA_SQL, _sqlite_schema_to_postgres  # type: ignore

try:
    import psycopg  # type: ignore
except Exception as exc:  # pragma: no cover
    raise SystemExit('psycopg 가 설치되지 않았습니다. pip install -r backend/requirements.txt 를 먼저 실행하세요.') from exc

ROOT = Path(__file__).resolve().parents[1]
SQLITE_PATH = Path(os.getenv('SQLITE_SOURCE_PATH', ROOT / 'data' / 'app.db'))
DATABASE_URL = os.getenv('DATABASE_URL', '').strip()

if not DATABASE_URL:
    raise SystemExit('DATABASE_URL 환경변수가 필요합니다.')
if not SQLITE_PATH.exists():
    raise SystemExit(f'SQLite 원본 파일을 찾을 수 없습니다: {SQLITE_PATH}')

TABLES = [
    'users', 'auth_tokens', 'verification_codes', 'feed_posts', 'feed_comments', 'feed_likes', 'feed_bookmarks',
    'follows', 'passes', 'friend_requests', 'friends', 'direct_chat_requests', 'dm_messages', 'group_rooms',
    'group_room_members', 'group_room_messages', 'chat_room_settings', 'chat_mentions', 'voice_rooms',
    'voice_signals', 'meetup_schedules', 'meetup_reviews', 'board_posts', 'board_comments', 'notifications',
    'calendar_events', 'work_schedule_entries', 'work_schedule_day_notes', 'inquiries', 'reports', 'blocks',
    'preferences', 'admin_settings', 'region_boundaries'
]


def quote_value(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


with sqlite3.connect(SQLITE_PATH) as src, psycopg.connect(DATABASE_URL) as dst:
    src.row_factory = sqlite3.Row
    with dst.cursor() as cur:
        for stmt in [s.strip() for s in _sqlite_schema_to_postgres(SCHEMA_SQL).split(';') if s.strip()]:
            cur.execute(stmt)
        dst.commit()

        for table in TABLES:
            rows = src.execute(f'SELECT * FROM {table}').fetchall()
            if not rows:
                print(f'[skip] {table}: 0 rows')
                continue
            columns = rows[0].keys()
            cur.execute(f'TRUNCATE TABLE {table} RESTART IDENTITY CASCADE')
            for row in rows:
                values = ', '.join(quote_value(row[col]) for col in columns)
                cur.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({values})")
            dst.commit()
            print(f'[ok] {table}: {len(rows)} rows')

print('SQLite -> PostgreSQL migration completed.')
