from __future__ import annotations

import hashlib
import json
import os
import random
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from .settings import settings

try:
    import psycopg  # type: ignore
except Exception:  # pragma: no cover - optional dependency for local sqlite development
    psycopg = None

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
SQLITE_DB_PATH = DATA_DIR / "app.db"
DB_PATH = Path(settings.sqlite_db_path) if settings.sqlite_db_path else SQLITE_DB_PATH
DB_ENGINE = "postgresql" if settings.database_url.lower().startswith(("postgres://", "postgresql://")) else "sqlite"
DB_LABEL = settings.database_url if DB_ENGINE == "postgresql" else str(DB_PATH)

DATA_DIR.mkdir(parents=True, exist_ok=True)


def utcnow() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def make_token() -> str:
    return secrets.token_hex(24)


class CompatRow(dict):
    def __init__(self, keys: Iterable[str], values: Iterable[Any]):
        key_list = list(keys)
        value_list = list(values)
        super().__init__(zip(key_list, value_list))
        self._keys = key_list
        self._values = value_list

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def keys(self):  # type: ignore[override]
        return list(self._keys)


class CompatCursor:
    def __init__(self, cursor: Any, backend: str):
        self._cursor = cursor
        self._backend = backend
        self.lastrowid = getattr(cursor, 'lastrowid', None)

    @property
    def description(self):
        return getattr(self._cursor, 'description', None)

    def _normalize_row(self, row: Any):
        if row is None:
            return None
        if self._backend == 'sqlite':
            return row
        description = self.description or []
        keys = [col[0] for col in description]
        return CompatRow(keys, row)

    def fetchone(self):
        return self._normalize_row(self._cursor.fetchone())

    def fetchall(self):
        rows = self._cursor.fetchall()
        return [self._normalize_row(row) for row in rows]


class CompatConnection:
    def __init__(self, conn: Any, backend: str):
        self._conn = conn
        self._backend = backend

    def execute(self, sql: str, params: tuple | list = ()):
        cur = self._conn.cursor()
        cur.execute(_transform_sql(sql, self._backend), params)
        return CompatCursor(cur, self._backend)

    def executescript(self, sql_script: str):
        statements = [stmt.strip() for stmt in sql_script.split(';') if stmt.strip()]
        for stmt in statements:
            self.execute(stmt)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()


def row_to_dict(row: Any) -> dict:
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    return {k: row[k] for k in row.keys()}


def json_loads(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _append_sql_clause(sql: str, clause: str) -> str:
    stripped = sql.rstrip()
    if stripped.endswith(';'):
        return stripped[:-1] + clause + ';'
    return stripped + clause


def _transform_insert_or_replace(sql: str) -> str:
    match = re.search(r'INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z_][\w]*)\s*(\((.*?)\))?\s*VALUES', sql, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return sql.replace('INSERT OR REPLACE INTO', 'INSERT INTO')
    table = match.group(1)
    columns_raw = match.group(3) or ''
    columns = [col.strip() for col in columns_raw.split(',') if col.strip()]
    conflict_map = {
        'preferences': ['user_id'],
        'blocks': ['blocker_id', 'blocked_user_id'],
        'settlement_platform_metrics': ['platform', 'metric_key'],
        'settlement_reflections': ['settlement_date', 'category'],
        'app_secrets': ['secret_key'],
    }
    conflict_cols = conflict_map.get(table, columns[:1])
    update_cols = [col for col in columns if col not in conflict_cols]
    if not update_cols:
        return _append_sql_clause(sql.replace('INSERT OR REPLACE INTO', 'INSERT INTO'), ' ON CONFLICT DO NOTHING')
    assignments = ', '.join(f'{col} = EXCLUDED.{col}' for col in update_cols)
    transformed = sql.replace('INSERT OR REPLACE INTO', 'INSERT INTO')
    return _append_sql_clause(transformed, f" ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET {assignments}")


def _sqlite_schema_to_postgres(sql: str) -> str:
    converted = sql
    converted = re.sub(r'INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT', 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY', converted, flags=re.IGNORECASE)
    converted = re.sub(r'INTEGER\s+PRIMARY\s+KEY', 'BIGINT PRIMARY KEY', converted, flags=re.IGNORECASE)
    converted = re.sub(r'\bINTEGER\b', 'BIGINT', converted)
    converted = re.sub(r'\bAUTOINCREMENT\b', '', converted, flags=re.IGNORECASE)
    return converted


def _transform_column_ddl(ddl: str, backend: str) -> str:
    if backend != 'postgresql':
        return ddl
    return re.sub(r'\bINTEGER\b', 'BIGINT', ddl)


def _transform_sql(sql: str, backend: str) -> str:
    if backend != 'postgresql':
        return sql
    transformed = sql.strip()
    if re.fullmatch(r'SELECT\s+last_insert_rowid\(\)\s*;?', transformed, flags=re.IGNORECASE):
        return 'SELECT lastval() AS last_insert_rowid'
    if re.search(r'INSERT\s+OR\s+IGNORE\s+INTO', transformed, flags=re.IGNORECASE):
        transformed = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', transformed, flags=re.IGNORECASE)
        transformed = _append_sql_clause(transformed, ' ON CONFLICT DO NOTHING')
    if re.search(r'INSERT\s+OR\s+REPLACE\s+INTO', transformed, flags=re.IGNORECASE):
        transformed = _transform_insert_or_replace(transformed)
    transformed = transformed.replace('?', '%s')
    return transformed


@contextmanager
def get_conn():
    if DB_ENGINE == 'postgresql':
        if psycopg is None:
            raise RuntimeError('DATABASE_URL 이 PostgreSQL 로 설정되었지만 psycopg 가 설치되지 않았습니다.')
        conn = psycopg.connect(settings.database_url)
        wrapped = CompatConnection(conn, 'postgresql')
        try:
            yield wrapped
            wrapped.commit()
        except Exception:
            wrapped.rollback()
            raise
        finally:
            wrapped.close()
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON;')
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT DEFAULT '',
    nickname TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    grade INTEGER NOT NULL DEFAULT 6,
    approved INTEGER NOT NULL DEFAULT 1,
    gender TEXT DEFAULT '',
    birth_year INTEGER DEFAULT 1990,
    region TEXT DEFAULT '서울',
    bio TEXT DEFAULT '',
    one_liner TEXT DEFAULT '',
    interests TEXT DEFAULT '[]',
    tendencies TEXT DEFAULT '[]',
    photo_url TEXT DEFAULT '',
    latitude REAL DEFAULT 37.5665,
    longitude REAL DEFAULT 126.9780,
    phone TEXT DEFAULT '',
    recovery_email TEXT DEFAULT '',
    vehicle_number TEXT DEFAULT '',
    branch_no INTEGER,
    location_share_consent INTEGER NOT NULL DEFAULT 0,
    location_share_enabled INTEGER NOT NULL DEFAULT 0,
    location_share_updated_at TEXT DEFAULT '',
    marital_status TEXT DEFAULT '',
    resident_address TEXT DEFAULT '',
    business_name TEXT DEFAULT '',
    business_number TEXT DEFAULT '',
    business_type TEXT DEFAULT '',
    business_item TEXT DEFAULT '',
    business_address TEXT DEFAULT '',
    bank_account TEXT DEFAULT '',
    bank_name TEXT DEFAULT '',
    mbti TEXT DEFAULT '',
    google_email TEXT DEFAULT '',
    resident_id TEXT DEFAULT '',
    position_title TEXT DEFAULT '',
    vehicle_available INTEGER NOT NULL DEFAULT 1,
    account_unique_id TEXT DEFAULT '',
    group_number INTEGER NOT NULL DEFAULT 0,
    archived_in_branch_status INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);



CREATE TABLE IF NOT EXISTS settlement_platform_metrics (
    platform TEXT NOT NULL,
    metric_key TEXT NOT NULL,
    metric_value INTEGER NOT NULL DEFAULT 0,
    detail_json TEXT NOT NULL DEFAULT '[]',
    sync_status TEXT NOT NULL DEFAULT 'idle',
    sync_message TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (platform, metric_key)
);

CREATE TABLE IF NOT EXISTS settlement_sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    sync_status TEXT NOT NULL DEFAULT 'idle',
    metric_value INTEGER NOT NULL DEFAULT 0,
    detail_json TEXT NOT NULL DEFAULT '[]',
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    settlement_date TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'daily',
    title TEXT NOT NULL DEFAULT '',
    block_json TEXT NOT NULL DEFAULT '{}',
    reflected_at TEXT NOT NULL DEFAULT '',
    reflected_by_user_id INTEGER,
    reflected_by_name TEXT NOT NULL DEFAULT '',
    UNIQUE (settlement_date, category),
    FOREIGN KEY(reflected_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS deleted_imported_accounts (
    email TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_secrets (
    secret_key TEXT PRIMARY KEY,
    secret_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recovery_email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_likes (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feed_bookmarks (
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id),
    FOREIGN KEY (post_id) REFERENCES feed_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS follows (
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (from_user_id, to_user_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passes (
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (from_user_id, to_user_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT DEFAULT '',
    UNIQUE (requester_id, target_user_id),
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friends (
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS direct_chat_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    responded_at TEXT DEFAULT '',
    UNIQUE (requester_id, target_user_id),
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dm_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_key TEXT NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    attachment_name TEXT DEFAULT '',
    attachment_url TEXT DEFAULT '',
    attachment_type TEXT DEFAULT '',
    reply_to_id INTEGER,
    mention_user_id INTEGER,
    reactions TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    region TEXT DEFAULT '',
    creator_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_room_members (
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES group_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_room_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    attachment_name TEXT DEFAULT '',
    attachment_url TEXT DEFAULT '',
    attachment_type TEXT DEFAULT '',
    reply_to_id INTEGER,
    mention_user_id INTEGER,
    reactions TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES group_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_room_settings (
    user_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    room_ref TEXT NOT NULL,
    custom_name TEXT DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, room_type, room_ref),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    room_type TEXT NOT NULL,
    room_ref TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_type TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    target_user_id INTEGER,
    group_room_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    ended_by_user_id INTEGER,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (room_id) REFERENCES voice_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meetup_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    place TEXT NOT NULL,
    meetup_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    content TEXT DEFAULT '',
    cautions TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meetup_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (schedule_id) REFERENCES meetup_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES board_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    event_date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT DEFAULT '',
    color TEXT DEFAULT '#2563eb',
    visit_time TEXT DEFAULT '',
    move_start_date TEXT DEFAULT '',
    move_end_date TEXT DEFAULT '',
    start_address TEXT DEFAULT '',
    end_address TEXT DEFAULT '',
    platform TEXT DEFAULT '',
    customer_name TEXT DEFAULT '',
    department_info TEXT DEFAULT '',
    schedule_type TEXT DEFAULT 'A',
    status_a_count INTEGER NOT NULL DEFAULT 0,
    status_b_count INTEGER NOT NULL DEFAULT 0,
    status_c_count INTEGER NOT NULL DEFAULT 0,
    amount1 TEXT DEFAULT '',
    amount2 TEXT DEFAULT '',
    amount_item TEXT DEFAULT '',
    deposit_method TEXT DEFAULT '',
    deposit_amount TEXT DEFAULT '',
    representative1 TEXT DEFAULT '',
    representative2 TEXT DEFAULT '',
    representative3 TEXT DEFAULT '',
    staff1 TEXT DEFAULT '',
    staff2 TEXT DEFAULT '',
    staff3 TEXT DEFAULT '',
    deposit_status TEXT DEFAULT '',
    image_data TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_schedule_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    schedule_date TEXT NOT NULL,
    schedule_time TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    representative_names TEXT NOT NULL DEFAULT '',
    staff_names TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS work_schedule_day_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    schedule_date TEXT NOT NULL,
    excluded_business TEXT NOT NULL DEFAULT '',
    excluded_staff TEXT NOT NULL DEFAULT '',
    excluded_business_details TEXT NOT NULL DEFAULT '[]',
    excluded_staff_details TEXT NOT NULL DEFAULT '[]',
    available_vehicle_count INTEGER NOT NULL DEFAULT 0,
    status_a_count INTEGER NOT NULL DEFAULT 0,
    status_b_count INTEGER NOT NULL DEFAULT 0,
    status_c_count INTEGER NOT NULL DEFAULT 0,
    day_memo TEXT NOT NULL DEFAULT '',
    is_handless_day INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, schedule_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quote_form_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_type TEXT NOT NULL DEFAULT 'same_day',
    requester_user_id INTEGER,
    requester_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    desired_date TEXT NOT NULL DEFAULT '',
    summary_title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'received',
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    target_user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    detail TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    closed_at TEXT DEFAULT '',
    closed_by INTEGER,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id INTEGER NOT NULL,
    blocked_user_id INTEGER NOT NULL,
    reason TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (blocker_id, blocked_user_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preferences (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS region_boundaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region TEXT NOT NULL,
    geojson TEXT NOT NULL
);
"""

def insert_notification(conn: sqlite3.Connection, user_id: int, type_: str, title: str, body: str) -> None:
    conn.execute(
        "INSERT INTO notifications(user_id, type, title, body, created_at) VALUES (?, ?, ?, ?, ?)",
        (user_id, type_, title, body, utcnow()),
    )



IMPORTED_ACCOUNTS = [
    {
        "email": "1ghwja",
        "password": "123123",
        "nickname": "임채영",
        "role": "admin",
        "grade": 2,
        "approved": 1,
        "gender": "",
        "birth_year": 1993,
        "region": "경기도 양주시",
        "bio": "미래로1729",
        "one_liner": "부관리자 · 1",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-6614-7795",
        "recovery_email": "nnmm0324@naver.com",
        "vehicle_number": "경기90자1729",
        "branch_no": 1,
        "marital_status": "미혼",
        "resident_address": "경기도 양주시 고암길 275, 309동 1901호(고암동, 동안마을)",
        "business_name": "미래로1729",
        "business_number": "120-15-02704",
        "business_type": "운수업",
        "business_item": "일반화물",
        "business_address": "경기도 양주시 고암길 275, 309동 1901호(고암동, 동안마을)",
        "bank_account": "3333-24-1952830",
        "bank_name": "카카오뱅크",
        "mbti": "INTJ",
        "google_email": "nnmm0324@naver,com",
        "resident_id": "930818"
    },
    {
        "email": "2ghwja",
        "password": "123123",
        "nickname": "박우민",
        "role": "admin",
        "grade": 2,
        "approved": 1,
        "gender": "",
        "birth_year": 1993,
        "region": "서울특별시 노원구",
        "bio": "이청잘 이집청년 이사잘하네 2호점(원룸/소형이사)",
        "one_liner": "부관리자 · 2",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-2479-2742",
        "recovery_email": "woomin1993@naver.com",
        "vehicle_number": "서울91자8214",
        "branch_no": 2,
        "marital_status": "미혼",
        "resident_address": "김포시 장기동 1524 가동 201호",
        "business_name": "이청잘 이집청년 이사잘하네 2호점(원룸/소형이사)",
        "business_number": "109-28-97941",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "서울특별시 노원구 덕릉로130길 29, 204호(상계동, 보람빌라)",
        "bank_account": "3333-24-6659806",
        "bank_name": "카카오뱅크",
        "mbti": "ESFP",
        "google_email": "woomin19931@gmail.com",
        "resident_id": "930902"
    },
    {
        "email": "3ghwja",
        "password": "123123",
        "nickname": "장준영",
        "role": "admin",
        "grade": 2,
        "approved": 1,
        "gender": "",
        "birth_year": 1992,
        "region": "세종특별자치시 전의면",
        "bio": "오성상운",
        "one_liner": "부관리자 · 3",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-4162-4429",
        "recovery_email": "jjdyu1@naver.com",
        "vehicle_number": "세종86바2682",
        "branch_no": 3,
        "marital_status": "미혼",
        "resident_address": "서울시 창동 676-3 202호",
        "business_name": "오성상운",
        "business_number": "698-15-026777",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "세종특별자치시 전의면 산단길 22-50",
        "bank_account": "3333-11-2936720",
        "bank_name": "카카오뱅크",
        "mbti": "ISTJ",
        "google_email": "Jjdyu1@gmail.com",
        "resident_id": "920714"
    },
    {
        "email": "4ghwja",
        "password": "123123",
        "nickname": "송지훈",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1998,
        "region": "경기도 안양시",
        "bio": "로얄상운",
        "one_liner": "사업자 · 4",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-4037-1632",
        "recovery_email": "asasas9530@naver.com",
        "vehicle_number": "경기89자1216",
        "branch_no": 4,
        "marital_status": "기혼",
        "resident_address": "경기도 시흥시 능곡서로27 402동 1414호",
        "business_name": "로얄상운",
        "business_number": "318-27-01305",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "경기도 안양시 만안구 문예로 57, 402호(안양동)",
        "bank_account": "3333-19-3960775",
        "bank_name": "카카오뱅크",
        "mbti": "INFJ",
        "google_email": "asasas95300@gmail.com",
        "resident_id": "980716"
    },
    {
        "email": "5ghwja",
        "password": "123123",
        "nickname": "5ghwja",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1990,
        "region": "서울",
        "bio": "",
        "one_liner": "사업자 · 5",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "",
        "recovery_email": "",
        "vehicle_number": "",
        "branch_no": 5,
        "marital_status": "",
        "resident_address": "",
        "business_name": "",
        "business_number": "",
        "business_type": "",
        "business_item": "",
        "business_address": "",
        "bank_account": "",
        "bank_name": "",
        "mbti": "",
        "google_email": "",
        "resident_id": ""
    },
    {
        "email": "6ghwja",
        "password": "123123",
        "nickname": "심훈",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1997,
        "region": "세종특별자치시 전의면",
        "bio": "오성상운",
        "one_liner": "사업자 · 6",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-9461-7299",
        "recovery_email": "tlagns97@naver.com",
        "vehicle_number": "세종86바2555",
        "branch_no": 6,
        "marital_status": "미혼",
        "resident_address": "서울 서대문구 이화여대 2다길 23 402호",
        "business_name": "오성상운",
        "business_number": "232-18-02615",
        "business_type": "운수업",
        "business_item": "일반 화물자동차 운송업",
        "business_address": "세종특별자치시 전의면 산단길 22-50",
        "bank_account": "3333-27-4478792",
        "bank_name": "카카오뱅크",
        "mbti": "ESFP",
        "google_email": "tlagns97@gmail.com",
        "resident_id": "971211"
    },
    {
        "email": "7ghwja",
        "password": "123123",
        "nickname": "손영재",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1999,
        "region": "서울특별시 송파구",
        "bio": "제이와이로지스",
        "one_liner": "사업자 · 7",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-2998-8344",
        "recovery_email": "syj8344@naver.com",
        "vehicle_number": "서울85바8790",
        "branch_no": 7,
        "marital_status": "미혼",
        "resident_address": "경기도 구리시 갈매순환로166번길 46, 스테이동 240호",
        "business_name": "제이와이로지스",
        "business_number": "540-76-00425",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "서울특별시 송파구 오금로36길 4-17, 3층(가락동)",
        "bank_account": "3333 04 2105654",
        "bank_name": "카카오뱅크",
        "mbti": "ISTJ",
        "google_email": "sonyoungjae8344@gmail.com",
        "resident_id": "990310"
    },
    {
        "email": "8ghwja",
        "password": "123123",
        "nickname": "최명권",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1994,
        "region": "경기도 부천시",
        "bio": "구팔운수",
        "one_liner": "사업자 · 8",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-4035-7378",
        "recovery_email": "94audrnjs@naver.com",
        "vehicle_number": "경기83사3117",
        "branch_no": 8,
        "marital_status": "기혼",
        "resident_address": "경기도 양주시 회천중앙로 154 회천트루엘시그니처 2402동 1203호",
        "business_name": "구팔운수",
        "business_number": "741-26-01809",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "경기도 부천시 원미구 정주로 53, 101호(약대동, 신중동 더퍼스트 지식산업센터)",
        "bank_account": "3333-03-2365250",
        "bank_name": "카카오뱅크",
        "mbti": "ISTJ",
        "google_email": "mkc7378@gmail.com",
        "resident_id": "940124"
    },
    {
        "email": "9ghwja",
        "password": "123123",
        "nickname": "정경호",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1997,
        "region": "경기도 남양주시",
        "bio": "미래로1166",
        "one_liner": "사업자 · 9",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-2641-9701",
        "recovery_email": "rudgh9701@naver.com",
        "vehicle_number": "경기92자1166",
        "branch_no": 9,
        "marital_status": "기혼",
        "resident_address": "경기도 여주시 교동 25-14 글로리빌A동",
        "business_name": "미래로1166",
        "business_number": "840-05-03657",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "경기도 남양주시 다산지금로 202, 7층 비에프07-0073호 (다산동, 현대테라타워디아이엠씨)",
        "bank_account": "3333-34-7326812",
        "bank_name": "카카오뱅크",
        "mbti": "ISFP",
        "google_email": "rudgh9701@naver.com",
        "resident_id": "970908"
    },
    {
        "email": "10ghwja",
        "password": "123123",
        "nickname": "백인환",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 2000,
        "region": "세종특별자치시 전의면",
        "bio": "그린운송",
        "one_liner": "사업자 · 10",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-7497-3060",
        "recovery_email": "qor659@naver.com",
        "vehicle_number": "세종86바1256",
        "branch_no": 10,
        "marital_status": "미혼",
        "resident_address": "경기도 남양주시 진건읍 사릉로용정1길 14 303호",
        "business_name": "그린운송",
        "business_number": "345-06-03687",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "세종특별자치시 전의면 산단길 22-50",
        "bank_account": "3333-11-8714171",
        "bank_name": "카카오뱅크",
        "mbti": "ISTJ",
        "google_email": "qor659659@gmail.com",
        "resident_id": "000215"
    },
    {
        "email": "11ghwja",
        "password": "123123",
        "nickname": "황인준",
        "role": "user",
        "grade": 4,
        "approved": 1,
        "gender": "",
        "birth_year": 1999,
        "region": "세종특별자치시 전의면",
        "bio": "그린운수",
        "one_liner": "사업자 · 11",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-8995-3372",
        "recovery_email": "suweb990720@gmail.com",
        "vehicle_number": "세종86바1206",
        "branch_no": 11,
        "marital_status": "미혼",
        "resident_address": "서울 특별시 도봉구 도봉로113길 40-14, 301호",
        "business_name": "그린운수",
        "business_number": "851-61-00831",
        "business_type": "운수업",
        "business_item": "화물",
        "business_address": "세종특별자치시 전의면 산단길 22-50",
        "bank_account": "3333-36-5030286",
        "bank_name": "카카오뱅크",
        "mbti": "ISTP",
        "google_email": "suweb990720@gmail.com",
        "resident_id": "990720"
    },
    {
        "email": "qhswja",
        "password": "123123",
        "nickname": "심진수",
        "role": "admin",
        "grade": 1,
        "approved": 1,
        "gender": "",
        "birth_year": 1993,
        "region": "경기 구리시",
        "bio": "이청잘 이집청년 이사잘하네 본점(원룸/소형이사)",
        "one_liner": "관리자 · 본점",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-9441-6704",
        "recovery_email": "someaddon@naver.com",
        "vehicle_number": "세종86바1097",
        "branch_no": None,
        "marital_status": "예정",
        "resident_address": "",
        "business_name": "이청잘 이집청년 이사잘하네 본점(원룸/소형이사)",
        "business_number": "190-05-02096",
        "business_type": "운수",
        "business_item": "개인화물",
        "business_address": "경기 구리시 갈매순환로166번길 45 구리갈매아너시티 5층 S540호",
        "bank_account": "3333-11-8122587",
        "bank_name": "카카오뱅크",
        "mbti": "ESFP-A",
        "google_email": "icj2424@naver.com",
        "resident_id": "931110"
    },
    {
        "email": "aksqhqkqh3",
        "password": "329tjdrb@2a",
        "nickname": "최성규",
        "role": "admin",
        "grade": 1,
        "approved": 1,
        "gender": "",
        "birth_year": 1995,
        "region": "서울특별시 도봉구",
        "bio": "이청잘 이집청년 폐기잘하네",
        "one_liner": "관리자 · 본점",
        "interests": [],
        "tendencies": [],
        "photo_url": "",
        "latitude": 37.5665,
        "longitude": 126.978,
        "phone": "010-5610-5855",
        "recovery_email": "aksqhqkqh3@naver.com",
        "vehicle_number": "없음",
        "branch_no": None,
        "marital_status": "미혼",
        "resident_address": "민증상 주소 : 서울특별시 도봉구 노해로 41나길 41-10, 지하층 2호(현대빌라)\n실주소(전입신고불가) : 경기 구리시 갈매순환로 154, 현대테라타워 B동 라이브오피스 1027호",
        "business_name": "이청잘 이집청년 폐기잘하네",
        "business_number": "323-32-01558",
        "business_type": "사업시설 관리,\n사업지원 및 임대\n서비스업",
        "business_item": "그 외 기타\n분류 안된\n사업 지원 서비스업\n폐기물 운반",
        "business_address": "서울특별시 도봉구 노해로 41나길 41-10, 지하층 2호(현대빌라)",
        "bank_account": "3333-22-9934975",
        "bank_name": "카카오뱅크",
        "mbti": "ISFJ",
        "google_email": "aksqhqkqh153@gmail.com",
        "resident_id": "950109"
    }
]

IMPORTED_EMPLOYEE_ACCOUNTS = [{'email': 'staff004',
  'password': '123123',
  'nickname': '우영우',
  'name': '김우영',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1995,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 4',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-4114-7667',
  'recovery_email': 'kwyoung2s@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울특별시 노원구 노원로 532, 922동 807호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '51130101364497',
  'bank_name': '국민은행',
  'mbti': 'ISTJ',
  'google_email': 'woos456@gmail.com',
  'resident_id': '950202-1069118',
  'position_title': '직원'},
 {'email': 'staff005',
  'password': '123123',
  'nickname': '용현이',
  'name': '심용현',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1999,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 5',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-4713-6413',
  'recovery_email': 'vega2111@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울특별시 도봉구 노해로70길 54 1907동404호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '1002-953-726925',
  'bank_name': '우리은행',
  'mbti': 'INFP',
  'google_email': 'vgea2111@gmail.com',
  'resident_id': '990705-1035816',
  'position_title': '직원'},
 {'email': 'staff014',
  'password': '123123',
  'nickname': '진하짱',
  'name': '주진하',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2001,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 14',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-2286-0651',
  'recovery_email': 'ahja1598@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울 도봉구 도당로 146-14 101호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '110456-354269',
  'bank_name': '신한은행',
  'mbti': 'ISFJ',
  'google_email': 'ahja1589@naver.com',
  'resident_id': '011028-3034511',
  'position_title': '직원'},
 {'email': 'staff015',
  'password': '123123',
  'nickname': '건휘짱',
  'name': '임건휘',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2000,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 15',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-4428-0642',
  'recovery_email': 'kryhoo1234@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울 강남구 논현로 71길 11 소망빌딩 302호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '78940201569106',
  'bank_name': '국민은행',
  'mbti': 'ENTP',
  'google_email': 'kryhoo1234@gmail.com',
  'resident_id': '000428-3580414',
  'position_title': '직원'},
 {'email': 'staff023',
  'password': '123123',
  'nickname': '홍준이',
  'name': '윤홍준',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1997,
  'region': '경기',
  'bio': '현장직원',
  'one_liner': '직원 · 23',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-3898-4579',
  'recovery_email': 'ho3370@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '경기 양주시 평화로1970번길 197-24',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '351-0566-0560-53',
  'bank_name': '농협은행',
  'mbti': 'ISTJ',
  'google_email': 'hoongjun123@gmail.com',
  'resident_id': '970818-1221413',
  'position_title': '직원'},
 {'email': 'staff024',
  'password': '123123',
  'nickname': '태지니',
  'name': '박태진',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2000,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 24',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-8837-4323',
  'recovery_email': 'qkrxowls75@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울 관악구 은천로 8길 21',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '3333-09-3934696',
  'bank_name': '카카오뱅크',
  'mbti': 'ENFJ',
  'google_email': 'qkrxowls4577@gamil.com',
  'resident_id': '000417-3581621',
  'position_title': '직원'},
 {'email': 'staff025',
  'password': '123123',
  'nickname': '승혀니',
  'name': '최승현',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2001,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 25',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-8113-8716',
  'recovery_email': 'tmzkdlwor129@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울특별시 노원구 공릉동 589-6 B03호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '1000-5759-2547',
  'bank_name': '토스은행',
  'mbti': 'ISTP',
  'google_email': 'tmzkdlwor123@gmail.com',
  'resident_id': '010809-3789919',
  'position_title': '직원'},
 {'email': 'staff026',
  'password': '123123',
  'nickname': '여주니',
  'name': '윤여준',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2007,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 26',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-4890-7561',
  'recovery_email': 'haerani0908@gmail.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울특별시 강동구 상암로 5길 25',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '3333-33-6684189',
  'bank_name': '카카오뱅크',
  'mbti': '-',
  'google_email': 'haerani0908@gmail.com',
  'resident_id': '070727-3209914',
  'position_title': '직원'},
 {'email': 'staff027',
  'password': '123123',
  'nickname': '주호짱',
  'name': '이주호',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1994,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 27',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-3284-0778',
  'recovery_email': 'joho0778@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '기혼',
  'resident_address': '서울 노원구 수락산로 174, 1422동 901호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '212-092184-01-018',
  'bank_name': '기업은행',
  'mbti': 'ENFP',
  'google_email': 'joho3251148@gmail.com',
  'resident_id': '940806-1661014',
  'position_title': '직원'},
 {'email': 'staff028',
  'password': '123123',
  'nickname': '유지니',
  'name': '양유진',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1999,
  'region': '경기',
  'bio': '현장직원',
  'one_liner': '직원 · 28',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-8922-9428',
  'recovery_email': 'ujn1109@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '경기도 의정부시 의정부동 165-7uj',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '951302-00-044841',
  'bank_name': '국민은행',
  'mbti': 'INTJ',
  'google_email': 'ujn0401@gmail.com',
  'resident_id': '990401-1933913',
  'position_title': '직원'},
 {'email': 'staff031',
  'password': '123123',
  'nickname': '태정이',
  'name': '김태정',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 2002,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 31',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-3576-2399',
  'recovery_email': 'tj0287@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울 관악구 난곡로63가길 8 B03호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '100151397044',
  'bank_name': '케이뱅크',
  'mbti': 'ISTJ',
  'google_email': 'qwaszx7a1@gmail.com',
  'resident_id': '020807-3629715',
  'position_title': '직원'},
 {'email': 'staff032',
  'password': '123123',
  'nickname': '기수짱',
  'name': '박기수',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1997,
  'region': '서울',
  'bio': '현장직원',
  'one_liner': '직원 · 32',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-8061-2342',
  'recovery_email': '1997rltn@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '서울 특별시 동대문구 사가정로190 우성아파트 2동1005호',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '100121350298',
  'bank_name': '케이뱅크',
  'mbti': 'ISTJ',
  'google_email': 'rnjschd159@gmail.com',
  'resident_id': '971205-1030312',
  'position_title': '직원'},
 {'email': 'staff034',
  'password': '123123',
  'nickname': '동혁킹',
  'name': '허동혁',
  'role': 'user',
  'grade': 5,
  'approved': 1,
  'gender': '',
  'birth_year': 1989,
  'region': '경기',
  'bio': '현장직원',
  'one_liner': '직원 · 34',
  'interests': [],
  'tendencies': [],
  'photo_url': '',
  'latitude': 37.5665,
  'longitude': 126.978,
  'phone': '010-3170-5993',
  'recovery_email': 'heo1288@naver.com',
  'vehicle_number': '',
  'branch_no': None,
  'marital_status': '미혼',
  'resident_address': '경기도 양주시 고덕로 182-17',
  'business_name': '',
  'business_number': '',
  'business_type': '',
  'business_item': '',
  'business_address': '',
  'bank_account': '352-1265-1128-53',
  'bank_name': '농협은행',
  'mbti': 'INFP',
  'google_email': 'xcvfg1234@gmail.com',
  'resident_id': '890613-1025011',
  'position_title': '직원'}]
SEEDED_ACCOUNT_EMAILS = {account['email'] for account in (IMPORTED_ACCOUNTS + IMPORTED_EMPLOYEE_ACCOUNTS)}

FORCE_REMOVED_SEED_ACCOUNT_EMAILS = {
    '1ghwja',
    '2ghwja',
    '3ghwja',
    '4ghwja',
    '5ghwja',
    '6ghwja',
    '7ghwja',
    '8ghwja',
    '9ghwja',
    'qhswja',
    'staff023',
    'staff024',
    'staff025',
    'staff026',
    'staff027',
    'staff028',
    'staff031',
    'staff032',
    'staff034',
}


LEGACY_DEMO_ACCOUNT_IDS = (
    'admin@example.com',
    'mina@example.com',
    'juno@example.com',
    'sora@example.com',
    'haon@example.com',
    'g6@example.com',
)


def seed_imported_accounts(conn) -> None:
    deleted_emails = {row[0] for row in conn.execute("SELECT email FROM deleted_imported_accounts").fetchall()}
    all_seed_accounts = IMPORTED_ACCOUNTS + IMPORTED_EMPLOYEE_ACCOUNTS
    for legacy_id in LEGACY_DEMO_ACCOUNT_IDS:
        conn.execute("DELETE FROM users WHERE email = ?", (legacy_id,))
    for removed_email in FORCE_REMOVED_SEED_ACCOUNT_EMAILS:
        conn.execute("DELETE FROM deleted_imported_accounts WHERE email = ?", (removed_email,))
        conn.execute("DELETE FROM users WHERE email = ?", (removed_email,))
    for account in all_seed_accounts:
        if account['email'] in FORCE_REMOVED_SEED_ACCOUNT_EMAILS:
            continue
        if account['email'] in deleted_emails:
            continue
        exists = conn.execute("SELECT id, account_unique_id FROM users WHERE email = ?", (account['email'],)).fetchone()
        existing_user_id = int(exists['id']) if exists else None
        existing_unique_id = str(exists['account_unique_id'] or '').strip() if exists else ''
        unique_id = existing_unique_id or generate_account_unique_id(conn, account['email'], existing_user_id)
        interests_json = json.dumps(account.get('interests', []), ensure_ascii=False)
        tendencies_json = json.dumps(account.get('tendencies', []), ensure_ascii=False)
        payload = (
            hash_password(account['password']),
            account.get('name', account['nickname']),
            account['nickname'],
            account['role'],
            int(account['grade']),
            int(account.get('approved', 1)),
            account.get('gender', ''),
            int(account.get('birth_year', 1990) or 1990),
            account.get('region', '서울'),
            account.get('bio', ''),
            account.get('one_liner', ''),
            interests_json,
            tendencies_json,
            account.get('photo_url', ''),
            float(account.get('latitude', 37.5665) or 37.5665),
            float(account.get('longitude', 126.9780) or 126.9780),
            account.get('phone', ''),
            account.get('recovery_email', ''),
            account.get('vehicle_number', ''),
            account.get('branch_no'),
            account.get('marital_status', ''),
            account.get('resident_address', ''),
            account.get('business_name', ''),
            account.get('business_number', ''),
            account.get('business_type', ''),
            account.get('business_item', ''),
            account.get('business_address', ''),
            account.get('bank_account', ''),
            account.get('bank_name', ''),
            account.get('mbti', ''),
            account.get('google_email', ''),
            account.get('resident_id', ''),
            account.get('position_title', ''),
            unique_id,
        )
        if exists:
            conn.execute(
                """
                UPDATE users SET
                    password_hash = ?, name = ?, nickname = ?, role = ?, grade = ?, approved = ?, gender = ?, birth_year = ?, region = ?,
                    bio = ?, one_liner = ?, interests = ?, tendencies = ?, photo_url = ?, latitude = ?, longitude = ?, phone = ?,
                    recovery_email = ?, vehicle_number = ?, branch_no = ?, marital_status = ?, resident_address = ?, business_name = ?,
                    business_number = ?, business_type = ?, business_item = ?, business_address = ?, bank_account = ?, bank_name = ?,
                    mbti = ?, google_email = ?, resident_id = ?, position_title = ?, account_unique_id = ?
                WHERE email = ?
                """,
                payload + (account['email'],),
            )
        else:
            conn.execute(
                """
                INSERT INTO users(
                    email, password_hash, name, nickname, role, grade, approved, gender, birth_year, region, bio, one_liner,
                    interests, tendencies, photo_url, latitude, longitude, phone, recovery_email, vehicle_number, branch_no,
                    marital_status, resident_address, business_name, business_number, business_type, business_item,
                    business_address, bank_account, bank_name, mbti, google_email, resident_id, position_title, account_unique_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account['email'],
                    *payload,
                    utcnow(),
                ),
            )

def mark_deleted_imported_account(conn, email: str) -> None:
    normalized = str(email or '').strip()
    if normalized in SEEDED_ACCOUNT_EMAILS:
        conn.execute(
            "INSERT INTO deleted_imported_accounts(email, deleted_at) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET deleted_at = excluded.deleted_at",
            (normalized, utcnow()),
        )

def seed_if_empty(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count:
        return

    users = [
        ("admin@example.com", "admin1234", "관리자", "admin", "기타", 1988, "서울 강남구", "이청잘 운영 관리자입니다.", "민원과 신고를 관리합니다.", ["운영", "관리"], ["신속", "정확"], "", 37.498, 127.028, "01000000000", "admin-reset@example.com", "", None),
        ("mina@example.com", "demo1234", "미나", "user", "여성", 1995, "서울 송파구", "소형이사 경험이 많은 기사입니다.", "친절하고 꼼꼼합니다.", ["원룸이사", "짐보관"], ["친절", "안전"], "", 37.514, 127.106, "01011112222", "mina-reset@example.com", "12가3456", 3),
        ("juno@example.com", "demo1234", "주노", "user", "남성", 1991, "서울 마포구", "빠른 응답과 일정 조율이 강점입니다.", "야간 작업 가능", ["사무실이사", "포장이사"], ["정확", "신속"], "", 37.556, 126.91, "01022223333", "juno-reset@example.com", "34나7890", 8),
        ("sora@example.com", "demo1234", "소라", "user", "여성", 1997, "경기 성남시", "여성 1인가구 이사 상담 환영", "상담 먼저 가능합니다.", ["원룸이사", "용달"], ["상담", "배려"], "", 37.42, 127.126, "01033334444", "sora-reset@example.com", "56다1234", 12),
        ("haon@example.com", "demo1234", "하온", "user", "남성", 1990, "인천 연수구", "주말 작업 선호", "장거리 협의 가능", ["장거리", "포장이사"], ["책임감", "성실"], "", 37.406, 126.678, "01044445555", "haon-reset@example.com", "78라4321", 15),
    ]
    for email, password, nickname, role, gender, birth_year, region, bio, one_liner, interests, tendencies, photo_url, lat, lon, phone, recovery_email, vehicle_number, branch_no in users:
        conn.execute(
            """
            INSERT INTO users (
                email, password_hash, nickname, role, gender, birth_year, region, bio, one_liner,
                interests, tendencies, photo_url, latitude, longitude, phone, recovery_email, vehicle_number, branch_no, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                email, hash_password(password), nickname, role, gender, birth_year, region, bio, one_liner,
                json.dumps(interests, ensure_ascii=False), json.dumps(tendencies, ensure_ascii=False), photo_url,
                lat, lon, phone, recovery_email, vehicle_number, branch_no, utcnow()
            ),
        )

    posts = [
        (2, "강남 → 송파 원룸이사 가능한 기사님 일정 공유합니다.", ""),
        (3, "마포구 소형 사무실 이전 상담 가능합니다. 오전 타임 선호.", ""),
        (4, "여성 고객 전용 1인 이사 문의 환영합니다.", ""),
    ]
    for user_id, content, image_url in posts:
        conn.execute("INSERT INTO feed_posts(user_id, content, image_url, created_at) VALUES (?, ?, ?, ?)", (user_id, content, image_url, utcnow()))

    conn.execute("INSERT INTO feed_likes(post_id, user_id, created_at) VALUES (1, 3, ?)", (utcnow(),))
    conn.execute("INSERT INTO feed_likes(post_id, user_id, created_at) VALUES (1, 4, ?)", (utcnow(),))
    conn.execute("INSERT INTO feed_bookmarks(post_id, user_id, created_at) VALUES (2, 2, ?)", (utcnow(),))
    conn.execute("INSERT INTO follows(from_user_id, to_user_id, created_at) VALUES (2, 3, ?)", (utcnow(),))
    conn.execute("INSERT INTO follows(from_user_id, to_user_id, created_at) VALUES (3, 2, ?)", (utcnow(),))
    conn.execute("INSERT INTO friends(user_id, friend_id, created_at) VALUES (2, 3, ?)", (utcnow(),))
    conn.execute("INSERT INTO friends(user_id, friend_id, created_at) VALUES (3, 2, ?)", (utcnow(),))

    room_key = "2:3"
    conn.execute("INSERT INTO dm_messages(room_key, sender_id, message, created_at) VALUES (?, ?, ?, ?)", (room_key, 2, "안녕하세요. 이번 주 금요일 가능하실까요?", utcnow()))
    conn.execute("INSERT INTO dm_messages(room_key, sender_id, message, created_at) VALUES (?, ?, ?, ?)", (room_key, 3, "네, 오전 시간 가능합니다.", utcnow()))

    conn.execute("INSERT INTO group_rooms(title, description, region, creator_id, created_at) VALUES (?, ?, ?, ?, ?)", ("서울권 기사님 오픈방", "서울·경기권 기사님들 정보 공유", "서울", 2, utcnow()))
    conn.execute("INSERT INTO group_room_members(room_id, user_id, created_at) VALUES (1, 2, ?)", (utcnow(),))
    conn.execute("INSERT INTO group_room_members(room_id, user_id, created_at) VALUES (1, 3, ?)", (utcnow(),))
    conn.execute("INSERT INTO group_room_messages(room_id, sender_id, message, created_at) VALUES (1, 2, ?, ?)", ("오늘 송파 일정 가능하신 분 계신가요?", utcnow()))
    conn.execute("INSERT INTO group_room_messages(room_id, sender_id, message, created_at) VALUES (1, 3, ?, ?)", ("오후 3시 이후 가능합니다.", utcnow()))

    conn.execute(
        "INSERT INTO meetup_schedules(creator_id, title, place, meetup_date, start_time, end_time, content, cautions, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (2, "기사님 네트워킹 모임", "서울 잠실", "2026-03-30", "14:00", "16:00", "이사 일정 협업 및 차량 공유 논의", "지각 주의", "간단한 다과 제공", utcnow())
    )
    conn.execute("INSERT INTO meetup_reviews(schedule_id, user_id, content, created_at) VALUES (1, 3, ?, ?)", ("지난 모임에서 실무 정보 교류가 유익했습니다.", utcnow()))

    for category, title, content, user_id in [
        ("free", "서울 지역 주말 일정 공유", "이번 주말 1톤 차량 수요가 많습니다.", 2),
        ("anonymous", "고객 응대 팁 공유", "전화 응대 스크립트를 정리해두면 좋습니다.", 3),
        ("tips", "포장재 비용 절감 팁", "재사용 가능한 박스를 미리 확보하세요.", 4),
    ]:
        conn.execute("INSERT INTO board_posts(category, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)", (category, user_id, title, content, utcnow()))

    conn.execute("INSERT INTO board_comments(post_id, user_id, content, created_at) VALUES (1, 3, ?, ?)", ("좋은 정보 감사합니다.", utcnow()))

    conn.execute("INSERT INTO calendar_events(user_id, title, content, event_date, start_time, end_time, location, color, move_start_date, move_end_date, platform, customer_name, department_info, amount1, amount2, amount_item, deposit_status, image_data, created_at) VALUES (2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                 ("09:00 (공홈) (송파고객) ((180,000원)) (계약금입금)", "고객 요청 확인 필요", "2026-03-28", "09:00", "11:00", "서울 송파구", "#16a34a", "2026-03-28", "2026-03-28", "공홈", "송파고객", "1팀", "180000", "", "", "계약금입금", "", utcnow()))

    conn.execute("INSERT INTO inquiries(user_id, category, title, content, status, created_at) VALUES (2, ?, ?, ?, 'received', ?)",
                 ("기능문의", "일정 공유 기능 건의", "기사님끼리 일정표를 더 쉽게 공유하고 싶습니다.", utcnow()))

    conn.execute("INSERT INTO reports(reporter_id, target_user_id, reason, detail, status, created_at) VALUES (2, 4, ?, ?, 'open', ?)",
                 ("부적절한 메시지", "채팅 중 부적절한 표현이 있었습니다.", utcnow()))

    default_pref = json.dumps({
        "groupChatNotifications": True,
        "directChatNotifications": True,
        "likeNotifications": True,
        "theme": "dark",
    }, ensure_ascii=False)
    for user_id in range(1, 6):
        conn.execute("INSERT INTO preferences(user_id, data) VALUES (?, ?)", (user_id, default_pref))

    conn.execute("INSERT OR IGNORE INTO admin_settings(key, value, updated_at) VALUES ('total_vehicle_count', '', ?)", (utcnow(),))

    geojson = json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "서울권"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[126.76,37.42],[127.18,37.42],[127.18,37.70],[126.76,37.70],[126.76,37.42]]]
                }
            }
        ]
    }, ensure_ascii=False)
    conn.execute("INSERT INTO region_boundaries(region, geojson) VALUES (?, ?)", ("서울", geojson))



def _group_rule_matches(user: dict, rule: str) -> bool:
    email = str(user.get("email") or "").strip()
    nickname = str(user.get("nickname") or "").strip()
    grade = int(user.get("grade") or 6)
    gender = str(user.get("gender") or "").strip()
    if rule == 'hq':
        return email in {'이청잘A', '이청잘B', '이청잘C'} or nickname in {'심진수', '임채영', '박우민', '장준영'}
    if rule == 'hq_consulting':
        return email in {'이청잘A', '이청잘B', '이청잘C'}
    if rule == 'hq_ops':
        return grade in {1, 2, 4}
    if rule == 'group_all_except_female':
        return gender not in {'여성', '여'}
    if rule == 'notice':
        return grade in {1, 2, 4, 5}
    if rule == 'payroll':
        return grade in {1, 2, 4, 5} and nickname != '손지민'
    if rule == 'cs':
        return email in {'이청잘A', '이청잘B', '이청잘C'} or nickname == '심진수'
    return False


def ensure_default_group_rooms(conn) -> None:
    room_specs = [
        {'title': '본사방', 'description': '운영 기본 단체방', 'rule': 'hq'},
        {'title': '본사 상담팀방', 'description': '본사 상담 인력용', 'rule': 'hq_consulting'},
        {'title': '본사 업무방', 'description': '관리자/부관리자/사업자용', 'rule': 'hq_ops'},
        {'title': '단톡방', 'description': '여성 계정 외 공용 단톡방', 'rule': 'group_all_except_female'},
        {'title': '공지방', 'description': '관리자/부관리자/사업자/직원 공지', 'rule': 'notice'},
        {'title': '근무정산방', 'description': '근무 정산용 단체방', 'rule': 'payroll'},
        {'title': 'CS방', 'description': '상담/CS 운영방', 'rule': 'cs'},
    ]
    users = [row_to_dict(r) for r in conn.execute('SELECT * FROM users').fetchall()]
    fallback_creator = next((u['id'] for u in users if int(u.get('grade') or 6) <= 2), users[0]['id'] if users else 1)
    for spec in room_specs:
        room = conn.execute('SELECT * FROM group_rooms WHERE title = ?', (spec['title'],)).fetchone()
        if room:
            room_id = room['id']
        else:
            conn.execute(
                'INSERT INTO group_rooms(title, description, region, creator_id, created_at) VALUES (?, ?, ?, ?, ?)',
                (spec['title'], spec['description'], '전국', fallback_creator, utcnow()),
            )
            room_id = conn.execute('SELECT last_insert_rowid()').fetchone()[0]
        matched_ids = [u['id'] for u in users if _group_rule_matches(u, spec['rule'])]
        for user_id in matched_ids:
            conn.execute('INSERT OR IGNORE INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)', (room_id, user_id, utcnow()))

def _ensure_columns(conn: Any, table: str, columns: dict[str, str]) -> None:
    if DB_ENGINE == 'postgresql':
        existing = {
            row[0]
            for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
                (table,),
            ).fetchall()
        }
    else:
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for name, ddl in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {_transform_column_ddl(ddl, DB_ENGINE)}")




def _ensure_unique_index(conn: Any, table: str, index_name: str, columns: list[str]) -> None:
    cols = ', '.join(columns)
    conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table} ({cols})")

def init_db() -> None:
    schema_sql = _sqlite_schema_to_postgres(SCHEMA_SQL) if DB_ENGINE == 'postgresql' else SCHEMA_SQL
    with get_conn() as conn:
        conn.executescript(schema_sql)
        _ensure_columns(conn, 'calendar_events', {
            'visit_time': "TEXT DEFAULT ''",
            'move_start_date': "TEXT DEFAULT ''",
            'move_end_date': "TEXT DEFAULT ''",
            'start_address': "TEXT DEFAULT ''",
            'end_address': "TEXT DEFAULT ''",
            'platform': "TEXT DEFAULT ''",
            'customer_name': "TEXT DEFAULT ''",
            'department_info': "TEXT DEFAULT ''",
            'schedule_type': "TEXT DEFAULT 'A'",
            'status_a_count': 'INTEGER NOT NULL DEFAULT 0',
            'status_b_count': 'INTEGER NOT NULL DEFAULT 0',
            'status_c_count': 'INTEGER NOT NULL DEFAULT 0',
            'amount1': "TEXT DEFAULT ''",
            'amount2': "TEXT DEFAULT ''",
            'amount_item': "TEXT DEFAULT ''",
            'deposit_method': "TEXT DEFAULT ''",
            'deposit_amount': "TEXT DEFAULT ''",
            'representative1': "TEXT DEFAULT ''",
            'representative2': "TEXT DEFAULT ''",
            'representative3': "TEXT DEFAULT ''",
            'staff1': "TEXT DEFAULT ''",
            'staff2': "TEXT DEFAULT ''",
            'staff3': "TEXT DEFAULT ''",
            'deposit_status': "TEXT DEFAULT ''",
            'image_data': "TEXT DEFAULT ''",
        })
        _ensure_columns(conn, 'users', {
            'vehicle_number': "TEXT DEFAULT ''",
            'branch_no': 'INTEGER',
            'grade': 'INTEGER NOT NULL DEFAULT 6',
            'approved': 'INTEGER NOT NULL DEFAULT 1',
            'location_share_consent': 'INTEGER NOT NULL DEFAULT 0',
            'location_share_enabled': 'INTEGER NOT NULL DEFAULT 0',
            'location_share_updated_at': "TEXT DEFAULT ''",
            'marital_status': "TEXT DEFAULT ''",
            'resident_address': "TEXT DEFAULT ''",
            'business_name': "TEXT DEFAULT ''",
            'business_number': "TEXT DEFAULT ''",
            'business_type': "TEXT DEFAULT ''",
            'business_item': "TEXT DEFAULT ''",
            'business_address': "TEXT DEFAULT ''",
            'bank_account': "TEXT DEFAULT ''",
            'bank_name': "TEXT DEFAULT ''",
            'mbti': "TEXT DEFAULT ''",
            'google_email': "TEXT DEFAULT ''",
            'resident_id': "TEXT DEFAULT ''",
            'position_title': "TEXT DEFAULT ''",
            'vehicle_available': 'INTEGER NOT NULL DEFAULT 1',
            'show_in_branch_status': 'INTEGER',
            'show_in_employee_status': 'INTEGER',
            'name': "TEXT DEFAULT ''",
            'account_unique_id': "TEXT DEFAULT ''",
            'group_number': 'INTEGER NOT NULL DEFAULT 0',
            'group_number_text': "TEXT DEFAULT '0'",
            'archived_in_branch_status': 'INTEGER NOT NULL DEFAULT 0',
        })
        default_admin_settings = {
            'total_vehicle_count': '',
            'branch_count_override': '',
            'admin_mode_access_grade': '2',
            'role_assign_actor_max_grade': '3',
            'role_assign_target_min_grade': '3',
            'account_suspend_actor_max_grade': '3',
            'account_suspend_target_min_grade': '3',
            'signup_approve_actor_max_grade': '3',
            'signup_approve_target_min_grade': '7',
            'menu_permissions_json': '',
        }
        for setting_key, setting_value in default_admin_settings.items():
            conn.execute("INSERT OR IGNORE INTO admin_settings(key, value, updated_at) VALUES (?, ?, ?)", (setting_key, setting_value, utcnow()))
        conn.execute("UPDATE users SET name = nickname WHERE COALESCE(name, '') = ''")
        ensure_account_unique_ids(conn)
        _ensure_unique_index(conn, 'users', 'uq_users_account_unique_id', ['account_unique_id'])
        _ensure_columns(conn, 'work_schedule_day_notes', {
            'excluded_business_details': "TEXT NOT NULL DEFAULT '[]'",
            'excluded_staff_details': "TEXT NOT NULL DEFAULT '[]'",
            'available_vehicle_count': 'INTEGER NOT NULL DEFAULT 0',
            'status_a_count': 'INTEGER NOT NULL DEFAULT 0',
            'status_b_count': 'INTEGER NOT NULL DEFAULT 0',
            'status_c_count': 'INTEGER NOT NULL DEFAULT 0',
            'day_memo': "TEXT NOT NULL DEFAULT ''",
            'is_handless_day': 'INTEGER NOT NULL DEFAULT 0',
        })
        vehicle_exclusions_sql = "CREATE TABLE IF NOT EXISTS vehicle_exclusions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"
        conn.execute(_sqlite_schema_to_postgres(vehicle_exclusions_sql) if DB_ENGINE == 'postgresql' else vehicle_exclusions_sql)
        _ensure_unique_index(conn, 'vehicle_exclusions', 'idx_vehicle_exclusions_user_dates', ['user_id', 'start_date', 'end_date'])
        _ensure_columns(conn, 'dm_messages', {
            'reply_to_id': 'INTEGER',
            'mention_user_id': 'INTEGER',
            'reactions': "TEXT DEFAULT '[]'",
        })
        workday_logs_sql = "CREATE TABLE IF NOT EXISTS workday_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, work_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"
        conn.execute(_sqlite_schema_to_postgres(workday_logs_sql) if DB_ENGINE == 'postgresql' else workday_logs_sql)
        _ensure_unique_index(conn, 'workday_logs', 'idx_workday_logs_user_date', ['user_id', 'work_date'])
        _ensure_columns(conn, 'workday_logs', {
            'start_time': "TEXT NOT NULL DEFAULT ''",
            'end_time': "TEXT NOT NULL DEFAULT ''",
            'started_at': "TEXT NOT NULL DEFAULT ''",
            'ended_at': "TEXT NOT NULL DEFAULT ''",
            'created_at': 'TEXT NOT NULL',
            'updated_at': 'TEXT NOT NULL',
        })
        _ensure_columns(conn, 'group_room_messages', {
            'attachment_name': "TEXT DEFAULT ''",
            'attachment_url': "TEXT DEFAULT ''",
            'attachment_type': "TEXT DEFAULT ''",
            'reply_to_id': 'INTEGER',
            'mention_user_id': 'INTEGER',
            'reactions': "TEXT DEFAULT '[]'",
        })
        _ensure_columns(conn, 'settlement_platform_metrics', {
            'detail_json': "TEXT NOT NULL DEFAULT '[]'",
            'sync_status': "TEXT NOT NULL DEFAULT 'idle'",
            'sync_message': "TEXT NOT NULL DEFAULT ''",
            'updated_at': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_unique_index(conn, 'settlement_platform_metrics', 'uq_settlement_platform_metrics_platform_metric_key', ['platform', 'metric_key'])
        _ensure_columns(conn, 'settlement_sync_history', {
            'trigger_type': "TEXT NOT NULL DEFAULT 'manual'",
            'sync_status': "TEXT NOT NULL DEFAULT 'idle'",
            'metric_value': 'INTEGER NOT NULL DEFAULT 0',
            'detail_json': "TEXT NOT NULL DEFAULT '[]'",
            'message': "TEXT NOT NULL DEFAULT ''",
            'created_at': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_columns(conn, 'settlement_reflections', {
            'settlement_date': "TEXT NOT NULL DEFAULT ''",
            'category': "TEXT NOT NULL DEFAULT 'daily'",
            'title': "TEXT NOT NULL DEFAULT ''",
            'block_json': "TEXT NOT NULL DEFAULT '{}'",
            'reflected_at': "TEXT NOT NULL DEFAULT ''",
            'reflected_by_user_id': 'INTEGER',
            'reflected_by_name': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_unique_index(conn, 'settlement_reflections', 'uq_settlement_reflections_date_category', ['settlement_date', 'category'])
        _ensure_columns(conn, 'app_secrets', {
            'secret_value': "TEXT NOT NULL DEFAULT ''",
            'updated_at': "TEXT NOT NULL DEFAULT ''",
        })
        quote_form_submissions_sql = "CREATE TABLE IF NOT EXISTS quote_form_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_type TEXT NOT NULL DEFAULT 'same_day', requester_user_id INTEGER, requester_name TEXT NOT NULL DEFAULT '', contact_phone TEXT NOT NULL DEFAULT '', desired_date TEXT NOT NULL DEFAULT '', summary_title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'received', payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE SET NULL)"
        conn.execute(_sqlite_schema_to_postgres(quote_form_submissions_sql) if DB_ENGINE == 'postgresql' else quote_form_submissions_sql)
        _ensure_columns(conn, 'quote_form_submissions', {
            'form_type': "TEXT NOT NULL DEFAULT 'same_day'",
            'requester_user_id': 'INTEGER',
            'requester_name': "TEXT NOT NULL DEFAULT ''",
            'contact_phone': "TEXT NOT NULL DEFAULT ''",
            'desired_date': "TEXT NOT NULL DEFAULT ''",
            'summary_title': "TEXT NOT NULL DEFAULT ''",
            'status': "TEXT NOT NULL DEFAULT 'received'",
            'payload_json': "TEXT NOT NULL DEFAULT '{}'",
            'created_at': "TEXT NOT NULL DEFAULT ''",
            'updated_at': "TEXT NOT NULL DEFAULT ''",
        })

        material_schema_sql = _sqlite_schema_to_postgres("""
CREATE TABLE IF NOT EXISTS material_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    unit_label TEXT NOT NULL DEFAULT '개',
    unit_price INTEGER NOT NULL DEFAULT 0,
    current_stock INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS material_purchase_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    requester_name TEXT NOT NULL DEFAULT '',
    requester_unique_id TEXT NOT NULL DEFAULT '',
    request_note TEXT NOT NULL DEFAULT '',
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    settled_at TEXT NOT NULL DEFAULT '',
    settled_by_user_id INTEGER,
    share_snapshot_json TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS material_purchase_request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_price INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0,
    memo TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(request_id) REFERENCES material_purchase_requests(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES material_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS material_inventory_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_date TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    incoming_qty INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    outgoing_qty INTEGER NOT NULL DEFAULT 0,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    UNIQUE (inventory_date, product_id),
    FOREIGN KEY(product_id) REFERENCES material_products(id) ON DELETE CASCADE
);
""") if DB_ENGINE == 'postgresql' else """
CREATE TABLE IF NOT EXISTS material_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    unit_label TEXT NOT NULL DEFAULT '개',
    unit_price INTEGER NOT NULL DEFAULT 0,
    current_stock INTEGER NOT NULL DEFAULT 0,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS material_purchase_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    requester_name TEXT NOT NULL DEFAULT '',
    requester_unique_id TEXT NOT NULL DEFAULT '',
    request_note TEXT NOT NULL DEFAULT '',
    total_amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    settled_at TEXT NOT NULL DEFAULT '',
    settled_by_user_id INTEGER,
    share_snapshot_json TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS material_purchase_request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    unit_price INTEGER NOT NULL DEFAULT 0,
    line_total INTEGER NOT NULL DEFAULT 0,
    memo TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(request_id) REFERENCES material_purchase_requests(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES material_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS material_inventory_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_date TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    incoming_qty INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    outgoing_qty INTEGER NOT NULL DEFAULT 0,
    is_closed INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    UNIQUE (inventory_date, product_id),
    FOREIGN KEY(product_id) REFERENCES material_products(id) ON DELETE CASCADE
);
"""
        conn.executescript(material_schema_sql)
        _ensure_columns(conn, 'material_products', {
            'short_name': "TEXT NOT NULL DEFAULT ''",
            'unit_label': "TEXT NOT NULL DEFAULT '개'",
            'unit_price': 'INTEGER NOT NULL DEFAULT 0',
            'current_stock': 'INTEGER NOT NULL DEFAULT 0',
            'display_order': 'INTEGER NOT NULL DEFAULT 0',
            'is_active': 'INTEGER NOT NULL DEFAULT 1',
            'created_at': "TEXT NOT NULL DEFAULT ''",
            'updated_at': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_columns(conn, 'material_purchase_requests', {
            'requester_name': "TEXT NOT NULL DEFAULT ''",
            'requester_unique_id': "TEXT NOT NULL DEFAULT ''",
            'request_note': "TEXT NOT NULL DEFAULT ''",
            'total_amount': 'INTEGER NOT NULL DEFAULT 0',
            'status': "TEXT NOT NULL DEFAULT 'pending'",
            'payment_confirmed': 'INTEGER NOT NULL DEFAULT 0',
            'created_at': "TEXT NOT NULL DEFAULT ''",
            'settled_at': "TEXT NOT NULL DEFAULT ''",
            'settled_by_user_id': 'INTEGER',
            'share_snapshot_json': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_columns(conn, 'material_purchase_request_items', {
            'quantity': 'INTEGER NOT NULL DEFAULT 0',
            'unit_price': 'INTEGER NOT NULL DEFAULT 0',
            'line_total': 'INTEGER NOT NULL DEFAULT 0',
            'memo': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_columns(conn, 'material_inventory_daily', {
            'incoming_qty': 'INTEGER NOT NULL DEFAULT 0',
            'note': "TEXT NOT NULL DEFAULT ''",
            'outgoing_qty': 'INTEGER NOT NULL DEFAULT 0',
            'is_closed': 'INTEGER NOT NULL DEFAULT 0',
            'closed_at': "TEXT NOT NULL DEFAULT ''",
            'created_at': "TEXT NOT NULL DEFAULT ''",
            'updated_at': "TEXT NOT NULL DEFAULT ''",
        })
        _ensure_unique_index(conn, 'material_inventory_daily', 'uq_material_inventory_daily_date_product', ['inventory_date', 'product_id'])
        for _platform_name in ('숨고', '오늘', '공홈'):
            conn.execute("INSERT OR IGNORE INTO settlement_platform_metrics(platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at) VALUES (?, 'platform_send_count', 0, '[]', 'idle', '', ?)", (_platform_name, utcnow()))
        seed_imported_accounts(conn)
        ensure_default_group_rooms(conn)
        seed_material_products(conn)
        if settings.seed_demo_data:
            seed_if_empty(conn)
            conn.execute("UPDATE users SET grade = 1, approved = 1 WHERE email = 'admin@example.com'")
            conn.execute("UPDATE users SET grade = 4, approved = 1 WHERE email IN ('mina@example.com', 'juno@example.com', 'sora@example.com', 'haon@example.com')")
            conn.execute("UPDATE users SET vehicle_number = ?, branch_no = ?, position_title = '호점대표' WHERE email = ? AND COALESCE(vehicle_number, '') = ''", ('12가3456', 3, 'mina@example.com'))
            conn.execute("UPDATE users SET vehicle_number = ?, branch_no = ?, position_title = '호점대표' WHERE email = ? AND COALESCE(vehicle_number, '') = ''", ('34나7890', 8, 'juno@example.com'))
            conn.execute("UPDATE users SET vehicle_number = ?, branch_no = ?, position_title = '호점대표' WHERE email = ? AND COALESCE(vehicle_number, '') = ''", ('56다1234', 12, 'sora@example.com'))
            conn.execute("UPDATE users SET vehicle_number = ?, branch_no = ?, position_title = '호점대표' WHERE email = ? AND COALESCE(vehicle_number, '') = ''", ('78라4321', 15, 'haon@example.com'))
            admin_row = conn.execute("SELECT id FROM users WHERE grade = 1 ORDER BY id LIMIT 1").fetchone()
            fallback_row = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
            owner_id = (admin_row[0] if admin_row else (fallback_row[0] if fallback_row else None))
            peer_row = None
            if owner_id is not None:
                peer_row = conn.execute(
                    "SELECT id FROM users WHERE id <> ? ORDER BY CASE WHEN grade = 4 THEN 0 ELSE 1 END, id LIMIT 1",
                    (owner_id,),
                ).fetchone()
            if owner_id is not None and peer_row is not None:
                peer_id = peer_row[0]
                dm_room_key = ':'.join(str(v) for v in sorted((int(owner_id), int(peer_id))))
                has_admin_dm = conn.execute("SELECT 1 FROM dm_messages WHERE room_key = ? LIMIT 1", (dm_room_key,)).fetchone()
                if not has_admin_dm:
                    conn.execute(
                        "INSERT INTO dm_messages(room_key, sender_id, message, created_at) VALUES (?, ?, ?, ?)",
                        (dm_room_key, peer_id, '관리자님, 금일 기사 배정 문의드립니다.', utcnow()),
                    )
            room_exists = conn.execute("SELECT id FROM group_rooms ORDER BY id LIMIT 1").fetchone()
            if room_exists and owner_id is not None:
                conn.execute(
                    "INSERT OR IGNORE INTO group_room_members(room_id, user_id, created_at) VALUES (?, ?, ?)",
                    (room_exists[0], owner_id, utcnow()),
                )

            work_entry_exists = conn.execute("SELECT 1 FROM work_schedule_entries LIMIT 1").fetchone()
            if not work_entry_exists and owner_id is not None:
                today = datetime.utcnow().date()
                demo_entries = [
                    (owner_id, today.isoformat(), '09:00', '김민수', '대표A/대표B', '직원1/직원2', '엘리베이터 예약 확인 필요'),
                    (owner_id, (today + timedelta(days=1)).isoformat(), '10:30', '박서연', '대표C', '직원3/직원4', '사다리차 가능 여부 확인'),
                    (owner_id, (today + timedelta(days=2)).isoformat(), '08:00', '이준호', '대표A/대표D', '직원2/직원5', '장거리 이동 건'),
                ]
                for user_id, schedule_date, schedule_time, customer_name, representative_names, staff_names, memo in demo_entries:
                    conn.execute(
                        """
                        INSERT INTO work_schedule_entries(user_id, schedule_date, schedule_time, customer_name, representative_names, staff_names, memo, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (user_id, schedule_date, schedule_time, customer_name, representative_names, staff_names, memo, utcnow(), utcnow()),
                    )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO work_schedule_day_notes(user_id, schedule_date, excluded_business, excluded_staff, available_vehicle_count, status_a_count, status_b_count, status_c_count, day_memo, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (owner_id, today.isoformat(), '사업자A', '직원7', 8, 2, 1, 0, '당일 배차 메모 예시', utcnow(), utcnow()),
                )

def get_user_by_token(conn: sqlite3.Connection, token: str):
    return conn.execute(
        """
        SELECT u.* FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ?
        """,
        (token,),
    ).fetchone()



ROLE_LABELS = {
    1: '관리자',
    2: '부관리자',
    3: '중간관리자',
    4: '사업자',
    5: '직원',
    6: '일반',
    7: '기타',
}

def grade_label(grade: int | None) -> str:
    try:
        grade_num = int(grade or 6)
    except Exception:
        grade_num = 6
    return ROLE_LABELS.get(grade_num, '일반')





def seed_material_products(conn) -> None:
    product_specs = [
        {'code': 'yellow_vinyl', 'name': '노란 비닐', 'short_name': '노비', 'unit_price': 58400, 'current_stock': 15, 'display_order': 1},
        {'code': 'white_vinyl', 'name': '흰색 비닐', 'short_name': '흰비', 'unit_price': 45000, 'current_stock': 85, 'display_order': 2},
        {'code': 'bed_vinyl', 'name': '침대 비닐', 'short_name': '침비', 'unit_price': 55440, 'current_stock': 19, 'display_order': 3},
        {'code': 'sticker', 'name': '스티커 인쇄물', 'short_name': '스티커', 'unit_price': 13000, 'current_stock': 40, 'display_order': 4},
        {'code': 'tape', 'name': '이사테이프', 'short_name': '테이프', 'unit_price': 46000, 'current_stock': 7, 'display_order': 5},
        {'code': 'shoe_cover', 'name': '덧신', 'short_name': '덧신', 'unit_price': 95590, 'current_stock': 8, 'display_order': 6},
        {'code': 'blanket_box', 'name': '이불박스(흰)', 'short_name': '이불박스(흰)', 'unit_price': 16000, 'current_stock': 110, 'display_order': 7},
        {'code': 'clothes_box', 'name': '옷박스(흰)', 'short_name': '옷박스(흰)', 'unit_price': 14000, 'current_stock': 134, 'display_order': 8},
        {'code': 'large_box', 'name': '대박스(흰)', 'short_name': '대박스(흰)', 'unit_price': 11000, 'current_stock': 43, 'display_order': 9},
        {'code': 'vest_95', 'name': '조끼(95)', 'short_name': '조끼(95)', 'unit_price': 30000, 'current_stock': 0, 'display_order': 10},
        {'code': 'vest_100', 'name': '조끼(100)', 'short_name': '조끼(100)', 'unit_price': 30000, 'current_stock': 4, 'display_order': 11},
        {'code': 'vest_105', 'name': '조끼(105)', 'short_name': '조끼(105)', 'unit_price': 30000, 'current_stock': 2, 'display_order': 12},
        {'code': 'vest_110', 'name': '조끼(110)', 'short_name': '조끼(110)', 'unit_price': 30000, 'current_stock': 1, 'display_order': 13},
    ]
    for spec in product_specs:
        existing = conn.execute("SELECT id FROM material_products WHERE code = ?", (spec['code'],)).fetchone()
        now = utcnow()
        if existing:
            conn.execute(
                "UPDATE material_products SET name = ?, short_name = ?, unit_price = ?, display_order = ?, updated_at = ? WHERE code = ?",
                (spec['name'], spec['short_name'], spec['unit_price'], spec['display_order'], now, spec['code']),
            )
        else:
            conn.execute(
                "INSERT INTO material_products(code, name, short_name, unit_price, current_stock, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (spec['code'], spec['name'], spec['short_name'], spec['unit_price'], spec['current_stock'], spec['display_order'], now, now),
            )

def generate_account_unique_id(conn, email: str, user_id: int | None = None) -> str:
    base_source = str(email or '').strip()
    local = base_source.split('@')[0] if '@' in base_source else base_source
    base = re.sub(r'[^0-9A-Za-z가-힣]', '', local)[:24] or f'USER{user_id or random.randint(100, 999)}'
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    while True:
        suffix = ''.join(random.choice(alphabet) for _ in range(5))
        candidate = f'{base}-{suffix}'
        existing = conn.execute('SELECT id FROM users WHERE account_unique_id = ? LIMIT 1', (candidate,)).fetchone()
        if not existing or (user_id is not None and int(existing[0]) == int(user_id)):
            return candidate


def ensure_account_unique_ids(conn) -> None:
    rows = conn.execute("SELECT id, email, account_unique_id FROM users ORDER BY id").fetchall()
    used: set[str] = set()
    for row in rows:
        current = str(row['account_unique_id'] or '').strip()
        if current and current not in used:
            used.add(current)
            continue
        candidate = generate_account_unique_id(conn, row['email'], row['id'])
        used.add(candidate)
        conn.execute('UPDATE users SET account_unique_id = ? WHERE id = ?', (candidate, row['id']))

def user_public_dict(row: sqlite3.Row) -> dict:
    grade = int(row['grade'] if row['grade'] is not None else 6)
    approved = bool(row['approved'] if row['approved'] is not None else 1)
    return {
        'id': row['id'],
        'email': row['email'],
        'name': row['name'] if 'name' in row.keys() else row['nickname'],
        'nickname': row['nickname'],
        'account_unique_id': row['account_unique_id'] if 'account_unique_id' in row.keys() else '',
        'group_number': str((row['group_number_text'] if 'group_number_text' in row.keys() and row['group_number_text'] not in (None, '') else row['group_number'] if 'group_number' in row.keys() else '0') or '0'),
        'role': row['role'],
        'grade': grade,
        'grade_label': grade_label(grade),
        'approved': approved,
        'gender': row['gender'],
        'birth_year': row['birth_year'],
        'region': row['region'],
        'bio': row['bio'],
        'one_liner': row['one_liner'],
        'interests': json_loads(row['interests'], []),
        'photo_url': row['photo_url'],
        'latitude': row['latitude'],
        'longitude': row['longitude'],
        'phone': row['phone'],
        'recovery_email': row['recovery_email'],
        'vehicle_number': row['vehicle_number'],
        'branch_no': row['branch_no'],
        'location_share_consent': bool(row['location_share_consent']) if 'location_share_consent' in row.keys() else False,
        'location_share_enabled': bool(row['location_share_enabled']) if 'location_share_enabled' in row.keys() else False,
        'location_share_updated_at': row['location_share_updated_at'] if 'location_share_updated_at' in row.keys() else '',
        'marital_status': row['marital_status'] if 'marital_status' in row.keys() else '',
        'resident_address': row['resident_address'] if 'resident_address' in row.keys() else '',
        'business_name': row['business_name'] if 'business_name' in row.keys() else '',
        'business_number': row['business_number'] if 'business_number' in row.keys() else '',
        'business_type': row['business_type'] if 'business_type' in row.keys() else '',
        'business_item': row['business_item'] if 'business_item' in row.keys() else '',
        'business_address': row['business_address'] if 'business_address' in row.keys() else '',
        'bank_account': row['bank_account'] if 'bank_account' in row.keys() else '',
        'bank_name': row['bank_name'] if 'bank_name' in row.keys() else '',
        'mbti': row['mbti'] if 'mbti' in row.keys() else '',
        'google_email': row['google_email'] if 'google_email' in row.keys() else '',
        'resident_id': row['resident_id'] if 'resident_id' in row.keys() else '',
        'position_title': row['position_title'] if 'position_title' in row.keys() else ('호점대표' if row['branch_no'] is not None else ''),
        'vehicle_available': bool(row['vehicle_available']) if 'vehicle_available' in row.keys() else True,
        'created_at': row['created_at'],
    }
