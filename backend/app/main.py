from __future__ import annotations

import logging
import random
import re
from collections import defaultdict, deque
import hashlib
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from mimetypes import guess_type
from typing import Any, Optional
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .db import (
    DB_ENGINE,
    DB_LABEL,
    generate_account_unique_id,
    get_conn,
    get_user_by_token,
    hash_password,
    init_db,
    make_token,
    row_to_dict,
    user_public_dict,
    utcnow,
)
from .settings import settings
from .storage import StorageError, save_upload
from .constants import *
from .schemas import *
from .integrations import integration_status, send_sms_verification_code, verify_sms_code_provider, verify_turnstile_token

logger = logging.getLogger("historyprofile_app")
logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO))

app = FastAPI(title="historyprofile_app API", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.allowed_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def cost_protection_middleware(request: Request, call_next):
    try:
        enforce_cost_protection(request)
    except HTTPException as exc:
        return Response(content=json.dumps({"detail": exc.detail}, ensure_ascii=False), status_code=exc.status_code, media_type="application/json")
    response = await call_next(request)
    return response


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, room_key: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections[room_key].append(websocket)

    def disconnect(self, room_key: str, websocket: WebSocket) -> None:
        if room_key not in self.connections:
            return
        with suppress(ValueError):
            self.connections[room_key].remove(websocket)
        if not self.connections[room_key]:
            self.connections.pop(room_key, None)

    async def broadcast(self, room_key: str, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for websocket in self.connections.get(room_key, []):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(room_key, websocket)


manager = ConnectionManager()


STARTUP_STATE = {
    "db_ready": False,
    "startup_error": "",
    "started_at": utcnow() if "utcnow" in globals() else "",
}

IP_REQUEST_BUCKETS: dict[str, deque[float]] = defaultdict(deque)

AUTH_RATE_LIMIT_PATH_PREFIXES = (
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/phone/request-code",
    "/api/auth/password-reset/request",
    "/api/auth/find-account",
)

PUBLIC_PAGE_RATE_LIMIT_PATH_PREFIXES = (
    "/p/",
    "/public/p/",
    "/share/",
)

API_READ_RATE_LIMIT_PATH_PREFIXES = (
    "/api/public/",
    "/api/questions",
)


def optional_token(authorization: Optional[str]) -> str:
    if not authorization:
        return ""
    if not authorization.lower().startswith("bearer "):
        return ""
    return authorization.split(" ", 1)[1].strip()


def slugify(value: str) -> str:
    value = re.sub(r"\s+", "-", (value or "").strip().lower())
    value = re.sub(r"[^a-z0-9가-힣_-]", "", value)
    return value[:40].strip("-_") or f"profile-{random.randint(1000, 9999)}"


def to_bool(value: Any) -> bool:
    return bool(int(value)) if isinstance(value, (int, float)) else bool(value)


def sanitize_visibility_mode(value: str) -> str:
    return value if value in VISIBILITY_MODE_VALUES else "link_only"


def sanitize_question_permission(value: str) -> str:
    return value if value in QUESTION_PERMISSION_VALUES else "any"


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D+", "", value or "")
    if digits.startswith("82") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits[:11]


def format_phone(value: str) -> str:
    digits = normalize_phone(value)
    if len(digits) == 11:
        return f"{digits[:3]}-{digits[3:7]}-{digits[7:]}"
    if len(digits) == 10:
        return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
    return digits


def mask_phone(value: str) -> str:
    digits = normalize_phone(value)
    if len(digits) < 8:
        return digits
    return f"{digits[:3]}-****-{digits[-4:]}"


def client_ip(request: Request | None) -> str:
    forwarded = (request.headers.get("x-forwarded-for", "") if request else "").split(",")[0].strip()
    host = request.client.host if request and request.client else ""
    return forwarded or host or "0.0.0.0"


def is_blocked_user_agent(user_agent: str) -> bool:
    ua = (user_agent or "").strip().lower()
    if not ua:
        return False
    return any(keyword.lower() in ua for keyword in settings.bot_block_user_agents if keyword.strip())


def apply_ip_rate_limit(bucket_key: str, limit: int, window_seconds: int) -> None:
    if limit <= 0 or window_seconds <= 0:
        return
    now_ts = datetime.now(timezone.utc).timestamp()
    q = IP_REQUEST_BUCKETS[bucket_key]
    cutoff = now_ts - window_seconds
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status_code=429, detail="요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
    q.append(now_ts)


def enforce_cost_protection(request: Request) -> None:
    if not settings.cost_protection_enabled:
        return
    path = request.url.path or "/"
    method = (request.method or "GET").upper()
    ip = client_ip(request)
    if is_blocked_user_agent(request.headers.get("user-agent", "")) and not path.startswith("/api/admin"):
        raise HTTPException(status_code=403, detail="자동화 도구 접근이 차단되었습니다.")
    if method != "OPTIONS":
        apply_ip_rate_limit(f"global:{ip}", settings.ip_rate_limit_requests, settings.ip_rate_limit_window_seconds)
    if any(path.startswith(prefix) for prefix in AUTH_RATE_LIMIT_PATH_PREFIXES):
        apply_ip_rate_limit(f"auth:{ip}", settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds)
    elif method == "GET" and any(path.startswith(prefix) for prefix in PUBLIC_PAGE_RATE_LIMIT_PATH_PREFIXES):
        apply_ip_rate_limit(f"public:{ip}", settings.public_page_rate_limit_requests, settings.public_page_rate_limit_window_seconds)
    elif method == "GET" and any(path.startswith(prefix) for prefix in API_READ_RATE_LIMIT_PATH_PREFIXES):
        apply_ip_rate_limit(f"read:{ip}", settings.api_read_rate_limit_requests, settings.api_read_rate_limit_window_seconds)


def ensure_active_account(user: dict) -> None:
    status = str(user.get("account_status") or "active")
    if status == "suspended":
        raise HTTPException(status_code=403, detail=(user.get("suspended_reason") or "정지된 계정입니다. 관리자에게 문의해주세요."))


def media_kind_from_content_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    return "file"


def qr_image_url(target_url: str) -> str:
    return f"https://api.qrserver.com/v1/create-qr-code/?size=240x240&data={quote(target_url, safe='')}"


def detect_link_meta(original_url: str, explicit_type: str = "external") -> dict[str, str]:
    raw = (original_url or "").strip().lower()
    host = raw
    for prefix in ("https://", "http://"):
        if host.startswith(prefix):
            host = host[len(prefix):]
    host = host.split("/", 1)[0]
    mapping = [
        ("instagram.com", ("instagram", "Instagram", "instagram")),
        ("facebook.com", ("facebook", "Facebook", "facebook")),
        ("fb.com", ("facebook", "Facebook", "facebook")),
        ("youtube.com", ("youtube", "YouTube", "youtube")),
        ("youtu.be", ("youtube", "YouTube", "youtube")),
        ("x.com", ("x", "X", "x")),
        ("twitter.com", ("x", "X", "x")),
        ("tiktok.com", ("tiktok", "TikTok", "tiktok")),
        ("linkedin.com", ("linkedin", "LinkedIn", "linkedin")),
        ("github.com", ("github", "GitHub", "github")),
        ("notion.site", ("notion", "Notion", "notion")),
        ("notion.so", ("notion", "Notion", "notion")),
        ("blog.naver.com", ("naver-blog", "네이버 블로그", "blog")),
        ("smartstore.naver.com", ("naver-store", "네이버 스마트스토어", "store")),
        ("cafe.naver.com", ("naver-cafe", "네이버 카페", "cafe")),
        ("brunch.co.kr", ("brunch", "브런치", "brunch")),
        ("threads.net", ("threads", "Threads", "threads")),
        ("open.kakao.com", ("kakao", "카카오톡", "chat")),
        ("pf.kakao.com", ("kakao-channel", "카카오채널", "chat")),
    ]
    for needle, (slug, label, icon) in mapping:
        if needle in host:
            return {"social_platform": slug, "social_label": label, "social_icon": icon}
    fallback = explicit_type.strip().lower() if explicit_type else "external"
    return {"social_platform": fallback or "external", "social_label": "외부 링크", "social_icon": "link"}


def new_short_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz"
    return "".join(random.choice(alphabet) for _ in range(7))



LINK_RETENTION_DAYS = 365

def retention_cutoff_iso() -> str:
    return (utcnow_datetime() - timedelta(days=LINK_RETENTION_DAYS)).isoformat()

def cleanup_expired_marketing_assets(conn):
    cutoff = retention_cutoff_iso()
    conn.execute("DELETE FROM app_links WHERE COALESCE(NULLIF(last_accessed_at, ''), created_at) < ?", (cutoff,))
    conn.execute("DELETE FROM app_qr_codes WHERE COALESCE(NULLIF(last_accessed_at, ''), created_at) < ?", (cutoff,))

def current_user(authorization: Optional[str] = Header(default=None)):
    token = optional_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    with get_conn() as conn:
        row = get_user_by_token(conn, token)
        if not row:
            raise HTTPException(status_code=401, detail="세션이 만료되었습니다.")
        user = row_to_dict(row)
        ensure_active_account(user)
        return user


def current_user_optional(authorization: Optional[str] = Header(default=None)):
    token = optional_token(authorization)
    if not token:
        return None
    with get_conn() as conn:
        row = get_user_by_token(conn, token)
        if not row:
            return None
        user = row_to_dict(row)
        with suppress(HTTPException):
            ensure_active_account(user)
            return user
        return None


def admin_user(user=Depends(current_user)):
    role = str(user.get("role") or "user")
    grade = int(user.get("grade") or 99)
    if role != "admin" and grade > 1:
        raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")
    return user


# Backward-compatible alias for recently added admin endpoints.
# Railway startup logs showed NameError from Depends(admin_user) during app import.
require_admin_user = admin_user


def room_key_for(a: int, b: int) -> str:
    left, right = sorted((int(a), int(b)))
    return f"{left}:{right}"


def json_loads(value: Any, default: Any):
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def ensure_column(conn, table: str, column_ddl: str) -> None:
    if DB_ENGINE == "postgresql":
        sql = f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column_ddl}"
        conn.execute(sql)
        return
    sql = f"ALTER TABLE {table} ADD COLUMN {column_ddl}"
    with suppress(Exception):
        conn.execute(sql)


def ensure_indexes(conn) -> None:
    statements = [
        "CREATE INDEX IF NOT EXISTS idx_app_profiles_user_id ON app_profiles(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_profiles_slug ON app_profiles(slug)",
        "CREATE INDEX IF NOT EXISTS idx_app_careers_profile_id ON app_careers(profile_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_questions_profile_id ON app_questions(profile_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_uploads_user_id ON app_uploads(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_reports_target ON app_reports(target_type, target_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_reports_status ON app_reports(status)",
        "CREATE INDEX IF NOT EXISTS idx_app_blocks_blocker ON app_blocks(blocker_user_id)",
        "CREATE INDEX IF NOT EXISTS idx_app_abuse_events_fingerprint ON app_abuse_events(fingerprint, event_type)",
        "CREATE INDEX IF NOT EXISTS idx_feed_posts_user_id ON feed_posts(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_feed_posts_created_at ON feed_posts(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_friend_requests_target ON friend_requests(target_user_id, status)",
        "CREATE INDEX IF NOT EXISTS idx_community_posts_created_at ON community_posts(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_community_posts_category ON community_posts(category)",
    ]
    for stmt in statements:
        try:
            conn.execute(stmt)
        except Exception:
            with suppress(Exception):
                conn.rollback()


def ensure_profile_tables(conn=None) -> None:
    sql = """
    CREATE TABLE IF NOT EXISTS app_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        profile_image_url TEXT NOT NULL DEFAULT '',
        cover_image_url TEXT NOT NULL DEFAULT '',
        headline TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        current_work TEXT NOT NULL DEFAULT '',
        industry_category TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 1,
        allow_anonymous_questions INTEGER NOT NULL DEFAULT 1,
        theme_color TEXT NOT NULL DEFAULT '#3b82f6',
        visibility_mode TEXT NOT NULL DEFAULT 'link_only',
        question_permission TEXT NOT NULL DEFAULT 'any',
        display_name TEXT NOT NULL DEFAULT '',
        gender TEXT NOT NULL DEFAULT '',
        birth_year TEXT NOT NULL DEFAULT '',
        feed_profile_public INTEGER NOT NULL DEFAULT 0,
        report_count INTEGER NOT NULL DEFAULT 0,
        auto_private_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(slug),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_careers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        one_line TEXT NOT NULL DEFAULT '',
        period TEXT NOT NULL DEFAULT '',
        role_name TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        review_text TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        gallery_json TEXT NOT NULL DEFAULT '[]',
        media_items_json TEXT NOT NULL DEFAULT '[]',
        is_public INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_introductions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'freeform',
        content TEXT NOT NULL DEFAULT '',
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        original_url TEXT NOT NULL,
        short_code TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'external',
        is_public INTEGER NOT NULL DEFAULT 1,
        click_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(short_code),
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_qr_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        target_url TEXT NOT NULL,
        is_public INTEGER NOT NULL DEFAULT 1,
        scan_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        nickname TEXT NOT NULL DEFAULT '익명',
        question_text TEXT NOT NULL,
        answer_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        is_hidden INTEGER NOT NULL DEFAULT 0,
        reporter_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        answered_at TEXT NOT NULL DEFAULT '',
        asker_user_id INTEGER,
        public_alias TEXT NOT NULL DEFAULT '',
        liked_count INTEGER NOT NULL DEFAULT 0,
        bookmarked_count INTEGER NOT NULL DEFAULT 0,
        shared_count INTEGER NOT NULL DEFAULT 0,
        comments_count INTEGER NOT NULL DEFAULT 0,
        rejected_at TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY(asker_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS app_question_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        user_id INTEGER,
        nickname TEXT NOT NULL DEFAULT '익명',
        comment_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(question_id) REFERENCES app_questions(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS app_uploads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        profile_id INTEGER,
        category TEXT NOT NULL DEFAULT 'general',
        media_kind TEXT NOT NULL DEFAULT 'file',
        key TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        preview_key TEXT NOT NULL DEFAULT '',
        preview_url TEXT NOT NULL DEFAULT '',
        content_type TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        report_count INTEGER NOT NULL DEFAULT 0,
        moderation_status TEXT NOT NULL DEFAULT 'pending',
        moderation_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS app_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_user_id INTEGER,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        resolution_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        resolved_at TEXT NOT NULL DEFAULT '',
        resolved_by_user_id INTEGER,
        FOREIGN KEY(reporter_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(resolved_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS app_blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blocker_user_id INTEGER NOT NULL,
        blocked_user_id INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(blocker_user_id, blocked_user_id),
        FOREIGN KEY(blocker_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_moderation_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS app_abuse_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT '',
        target_id INTEGER NOT NULL DEFAULT 0,
        normalized_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_phone_verifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        code TEXT NOT NULL,
        verification_token TEXT NOT NULL DEFAULT '',
        is_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
    );
    """
    def _apply(conn):
        conn.executescript(sql)
        ensure_column(conn, "users", "extra_profile_slots INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "storage_quota_override_bytes INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "phone_verified_at TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "account_status TEXT NOT NULL DEFAULT 'active'")
        ensure_column(conn, "users", "warning_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "users", "suspended_reason TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "last_warning_at TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "users", "chat_media_quota_bytes INTEGER NOT NULL DEFAULT 104857600")
        ensure_column(conn, "app_profiles", "visibility_mode TEXT NOT NULL DEFAULT 'link_only'")
        ensure_column(conn, "app_profiles", "question_permission TEXT NOT NULL DEFAULT 'any'")
        ensure_column(conn, "app_profiles", "display_name TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_profiles", "gender TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_profiles", "birth_year TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_profiles", "feed_profile_public INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_profiles", "current_work TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_profiles", "industry_category TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_careers", "media_items_json TEXT NOT NULL DEFAULT '[]'")
        ensure_column(conn, "app_links", "click_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_links", "last_accessed_at TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_qr_codes", "scan_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_qr_codes", "last_accessed_at TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_questions", "reporter_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_questions", "asker_user_id INTEGER")
        ensure_column(conn, "app_questions", "public_alias TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_questions", "liked_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_questions", "bookmarked_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_questions", "shared_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_questions", "comments_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_questions", "rejected_at TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_questions", "deleted_at TEXT NOT NULL DEFAULT ''")
        conn.execute("""
        CREATE TABLE IF NOT EXISTS app_question_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            user_id INTEGER,
            nickname TEXT NOT NULL DEFAULT '익명',
            comment_text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(question_id) REFERENCES app_questions(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
        )
        """)
        ensure_column(conn, "app_uploads", "preview_key TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_uploads", "preview_url TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_uploads", "report_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_profiles", "report_count INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_profiles", "auto_private_reason TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "app_profiles", "account_type TEXT NOT NULL DEFAULT 'personal'")
        ensure_column(conn, "app_profiles", "brand_verified INTEGER NOT NULL DEFAULT 0")
        ensure_column(conn, "app_profiles", "verification_badge_text TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "feed_posts", "title TEXT NOT NULL DEFAULT ''")
        conn.execute("""
        CREATE TABLE IF NOT EXISTS community_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            category TEXT NOT NULL DEFAULT '일반',
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """)
        ensure_column(conn, "community_posts", "primary_category TEXT NOT NULL DEFAULT '일반'")
        ensure_column(conn, "community_posts", "secondary_category TEXT NOT NULL DEFAULT '자유'")
        ensure_column(conn, "community_posts", "attachment_url TEXT NOT NULL DEFAULT ''")
        conn.execute("""
        CREATE TABLE IF NOT EXISTS community_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """)
        ensure_column(conn, "dm_messages", "message_type TEXT NOT NULL DEFAULT 'text'")
        ensure_column(conn, "dm_messages", "attachment_url TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "dm_messages", "attachment_preview_url TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "dm_messages", "attachment_name TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "dm_messages", "attachment_size_bytes INTEGER NOT NULL DEFAULT 0")
        ensure_reward_tables(conn)
        ensure_brand_verification_tables(conn)
        ensure_keyword_boost_tables(conn)
        ensure_direct_ad_tables(conn)
        ensure_indexes(conn)
        cleanup_expired_marketing_assets(conn)

    if conn is None:
        with get_conn() as conn:
            _apply(conn)
    else:
        _apply(conn)



def get_allowed_profile_count(user: dict) -> int:
    extra = int(user.get("extra_profile_slots") or 0)
    return FREE_PROFILE_LIMIT + max(extra, 0)


def get_storage_limit_bytes(user: dict) -> int:
    override = int(user.get("storage_quota_override_bytes") or 0)
    return override if override > 0 else TOTAL_MEDIA_LIMIT_BYTES



REWARD_MIN_WITHDRAW_POINTS = 10000
REWARD_MONTHLY_WITHDRAW_LIMIT = 1
REWARD_RULES = {
    "receive_question": {"label": "질문 받기", "points": 120, "daily_limit": 20, "description": "내 프로필에 새로운 질문이 등록되면 적립"},
    "answer_question": {"label": "답변 작성", "points": 300, "daily_limit": 20, "description": "질문에 답변을 등록하면 적립"},
    "share_profile": {"label": "프로필 공유", "points": 50, "daily_limit": 5, "description": "내 공개 프로필을 공유하면 일 최대 5회 적립"},
    "complete_profile": {"label": "프로필 정리 완료", "points": 500, "daily_limit": 1, "description": "핵심 프로필 정보를 모두 입력하면 1회 적립"},
    "keyword_boost_spend": {"label": "키워드 상위 노출 사용", "points": -1, "daily_limit": 0, "description": "피드/게시글 키워드 상위 노출에 사용한 포인트"},
    "direct_ad_spend": {"label": "직접 광고 슬롯 사용", "points": -1, "daily_limit": 0, "description": "홈 피드 직접 광고 집행에 사용한 포인트"},
}


def ensure_reward_tables(conn) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS app_point_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        rule_code TEXT NOT NULL,
        points INTEGER NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL DEFAULT '',
        source_id INTEGER,
        source_key TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, source_key)
    )
    """)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS app_withdrawal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        points_amount INTEGER NOT NULL DEFAULT 0,
        cash_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        account_holder TEXT NOT NULL DEFAULT '',
        bank_name TEXT NOT NULL DEFAULT '',
        account_number TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        rejection_reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    with suppress(Exception):
        conn.execute("CREATE INDEX IF NOT EXISTS idx_point_ledger_user_created ON app_point_ledger(user_id, created_at)")
    with suppress(Exception):
        conn.execute("CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created ON app_withdrawal_requests(user_id, created_at)")




def ensure_brand_verification_tables(conn) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS app_brand_verification_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        profile_id INTEGER NOT NULL,
        business_name TEXT NOT NULL DEFAULT '',
        business_category TEXT NOT NULL DEFAULT '',
        website_url TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(profile_id) REFERENCES app_profiles(id) ON DELETE CASCADE
    )
    """)


def ensure_keyword_boost_tables(conn) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS app_keyword_boosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        profile_id INTEGER,
        content_type TEXT NOT NULL DEFAULT 'feed_post',
        content_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        points_spent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    with suppress(Exception):
        conn.execute("CREATE INDEX IF NOT EXISTS idx_keyword_boosts_keyword_status ON app_keyword_boosts(keyword, status, created_at DESC)")




def ensure_direct_ad_tables(conn) -> None:
    conn.execute("""
    CREATE TABLE IF NOT EXISTS app_direct_ad_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        profile_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        subtitle TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        target_url TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        placement TEXT NOT NULL DEFAULT 'home_feed',
        category TEXT NOT NULL DEFAULT '',
        target_keyword TEXT NOT NULL DEFAULT '',
        bid_points INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        admin_note TEXT NOT NULL DEFAULT '',
        impressions INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        processed_at TEXT NOT NULL DEFAULT '',
        starts_at TEXT NOT NULL DEFAULT '',
        ends_at TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    with suppress(Exception):
        conn.execute("CREATE INDEX IF NOT EXISTS idx_direct_ads_status_placement ON app_direct_ad_campaigns(status, placement, created_at DESC)")


def serialize_direct_ad_campaign(row: Any) -> dict[str, Any]:
    item = row_to_dict(row)
    return {
        "id": int(item.get("id") or 0),
        "user_id": int(item.get("user_id") or 0),
        "profile_id": int(item.get("profile_id") or 0),
        "title": item.get("title") or '',
        "subtitle": item.get("subtitle") or '',
        "description": item.get("description") or '',
        "target_url": item.get("target_url") or '',
        "image_url": item.get("image_url") or '',
        "placement": item.get("placement") or 'home_feed',
        "category": item.get("category") or '',
        "target_keyword": item.get("target_keyword") or '',
        "bid_points": int(item.get("bid_points") or 0),
        "status": item.get("status") or 'pending',
        "admin_note": item.get("admin_note") or '',
        "impressions": int(item.get("impressions") or 0),
        "clicks": int(item.get("clicks") or 0),
        "created_at": item.get("created_at") or '',
        "processed_at": item.get("processed_at") or '',
        "starts_at": item.get("starts_at") or '',
        "ends_at": item.get("ends_at") or '',
    }


def active_direct_ads_payload(conn, *, placement: str = 'home_feed', limit: int = 3) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT d.*, u.nickname, u.email, p.display_name, p.verification_badge_text, p.brand_verified FROM app_direct_ad_campaigns d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN app_profiles p ON p.id = d.profile_id WHERE d.status = 'approved' AND d.placement = ? ORDER BY d.bid_points DESC, d.id DESC LIMIT ?",
        (placement, max(1, min(int(limit or 3), 10))),
    ).fetchall()
    items=[]
    for row in rows:
        item=serialize_direct_ad_campaign(row)
        item.update({
            'nickname': row['nickname'] or row['email'] or f"회원 #{row['user_id']}",
            'display_name': row['display_name'] or row['nickname'] or row['email'] or '광고주',
            'brand_verified': bool(row['brand_verified']) if 'brand_verified' in row.keys() else False,
            'verification_badge_text': row['verification_badge_text'] or ('브랜드 인증' if row['brand_verified'] else ''),
        })
        items.append(item)
    return items


def direct_ad_competition_payload(conn, *, placement: str = 'home_feed', category: str = '') -> dict[str, Any]:
    category_norm = normalize_keyword(category)
    params=[placement]
    where="WHERE placement = ? AND status IN ('pending','approved')"
    if category_norm:
        where += " AND category = ?"
        params.append(category_norm)
    rows=conn.execute(f"""
        SELECT user_id, COALESCE(profile_id, 0) AS profile_id, category, COUNT(*) AS campaign_count, SUM(bid_points) AS total_points, MAX(created_at) AS last_used
        FROM app_direct_ad_campaigns
        {where}
        GROUP BY user_id, COALESCE(profile_id, 0), category
        ORDER BY total_points DESC, last_used DESC
        LIMIT 20
    """, tuple(params)).fetchall()
    leaderboard=[]
    for idx,row in enumerate(rows, start=1):
        user_row=conn.execute("SELECT nickname, email FROM users WHERE id = ?", (row['user_id'],)).fetchone()
        leaderboard.append({
            'rank': idx,
            'user_id': int(row['user_id'] or 0),
            'profile_id': int(row['profile_id'] or 0),
            'nickname': (user_row['nickname'] if user_row else '') or (user_row['email'] if user_row else f"회원 #{row['user_id']}"),
            'category': row['category'] or '',
            'campaign_count': int(row['campaign_count'] or 0),
            'total_points': int(row['total_points'] or 0),
            'last_used': row['last_used'] or '',
        })
    return {'placement': placement, 'category': category_norm, 'leaderboard': leaderboard}

def serialize_brand_verification_request(row: Any) -> dict[str, Any]:
    item = row_to_dict(row)
    return {
        "id": int(item.get("id") or 0),
        "user_id": int(item.get("user_id") or 0),
        "profile_id": int(item.get("profile_id") or 0),
        "business_name": item.get("business_name") or '',
        "business_category": item.get("business_category") or '',
        "website_url": item.get("website_url") or '',
        "note": item.get("note") or '',
        "status": item.get("status") or 'pending',
        "admin_note": item.get("admin_note") or '',
        "created_at": item.get("created_at") or '',
        "processed_at": item.get("processed_at") or '',
    }


def serialize_keyword_boost(row: Any) -> dict[str, Any]:
    item = row_to_dict(row)
    return {
        "id": int(item.get("id") or 0),
        "user_id": int(item.get("user_id") or 0),
        "profile_id": int(item.get("profile_id") or 0),
        "content_type": item.get("content_type") or 'feed_post',
        "content_id": int(item.get("content_id") or 0),
        "keyword": item.get("keyword") or '',
        "points_spent": int(item.get("points_spent") or 0),
        "status": item.get("status") or 'active',
        "created_at": item.get("created_at") or '',
        "expires_at": item.get("expires_at") or '',
    }


def spend_points(conn, user_id: int, amount: int, *, description: str, source_type: str = '', source_id: int | None = None, source_key: str = '', rule_code: str = 'keyword_boost_spend') -> bool:
    points = int(amount or 0)
    if points <= 0:
        return False
    balance = get_reward_balance(conn, user_id)
    if balance['available'] < points:
        raise HTTPException(status_code=400, detail='사용 가능한 포인트가 부족합니다.')
    conn.execute(
        "INSERT INTO app_point_ledger(user_id, rule_code, points, source_type, source_id, source_key, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, rule_code or 'keyword_boost_spend', -points, source_type, source_id, source_key or '', description, utcnow()),
    )
    return True


def normalize_keyword(value: str) -> str:
    normalized = re.sub(r"\s+", ' ', str(value or '').strip().lower())
    normalized = re.sub(r"[^0-9a-z가-힣\s_-]", '', normalized)
    return normalized[:30].strip()


def compute_keyword_boost_score(conn, *, content_type: str, content_id: int, keyword: str) -> int:
    norm = normalize_keyword(keyword)
    if not norm:
        return 0
    row = conn.execute(
        "SELECT COALESCE(SUM(points_spent), 0) FROM app_keyword_boosts WHERE content_type = ? AND content_id = ? AND keyword = ? AND status = 'active'",
        (content_type, content_id, norm),
    ).fetchone()
    return int(row[0] or 0)


def keyword_competition_payload(conn, keyword: str, viewer_user_id: int = 0) -> dict[str, Any]:
    norm = normalize_keyword(keyword)
    if not norm:
        return {"keyword": '', "leaderboard": [], "my_rank": 0}
    rows = conn.execute("""
        SELECT kb.user_id, kb.content_type, kb.content_id, SUM(kb.points_spent) AS total_points, MAX(kb.created_at) AS last_used
        FROM app_keyword_boosts kb
        WHERE kb.keyword = ? AND kb.status = 'active'
        GROUP BY kb.user_id, kb.content_type, kb.content_id
        ORDER BY total_points DESC, last_used DESC, kb.id DESC
        LIMIT 20
    """, (norm,)).fetchall()
    leaderboard=[]
    my_rank=0
    for idx,row in enumerate(rows, start=1):
        item=row_to_dict(row)
        content_title=''
        if item.get('content_type')=='feed_post':
            target=conn.execute("SELECT title, content FROM feed_posts WHERE id = ?", (item.get('content_id'),)).fetchone()
            if target:
                content_title=(target['title'] or target['content'] or '피드').strip()[:60]
        else:
            target=conn.execute("SELECT title, content FROM community_posts WHERE id = ?", (item.get('content_id'),)).fetchone()
            if target:
                content_title=(target['title'] or target['content'] or '게시글').strip()[:60]
        user_row=conn.execute("SELECT nickname, email FROM users WHERE id = ?", (item.get('user_id'),)).fetchone()
        entry={
            'rank': idx,
            'user_id': int(item.get('user_id') or 0),
            'content_type': item.get('content_type') or '',
            'content_id': int(item.get('content_id') or 0),
            'points_spent': int(item.get('total_points') or 0),
            'last_used': item.get('last_used') or '',
            'nickname': (user_row['nickname'] if user_row else '') or (user_row['email'] if user_row else f"회원 #{item.get('user_id')}") ,
            'content_title': content_title,
            'is_me': viewer_user_id and int(item.get('user_id') or 0) == int(viewer_user_id),
        }
        if entry['is_me']:
            my_rank = idx
        leaderboard.append(entry)
    return {'keyword': norm, 'leaderboard': leaderboard, 'my_rank': my_rank}


def month_window_from_now() -> tuple[str, str]:
    now = datetime.now()
    month_start = datetime(now.year, now.month, 1)
    next_month = datetime(now.year + (1 if now.month == 12 else 0), 1 if now.month == 12 else now.month + 1, 1)
    return month_start.isoformat(), next_month.isoformat()


def today_window() -> tuple[str, str]:
    now = datetime.now()
    start = datetime(now.year, now.month, now.day)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def reward_rule_rows() -> list[dict[str, Any]]:
    return [dict(code=code, **meta) for code, meta in REWARD_RULES.items()]


def get_reward_balance(conn, user_id: int) -> dict[str, int]:
    earned = int(conn.execute("SELECT COALESCE(SUM(points), 0) FROM app_point_ledger WHERE user_id = ?", (user_id,)).fetchone()[0] or 0)
    pending = int(conn.execute("SELECT COALESCE(SUM(points_amount), 0) FROM app_withdrawal_requests WHERE user_id = ? AND status IN ('pending', 'approved')", (user_id,)).fetchone()[0] or 0)
    available = max(0, earned - pending)
    return {"earned": earned, "pending": pending, "available": available}


def monthly_withdraw_count(conn, user_id: int) -> int:
    start, end = month_window_from_now()
    return int(conn.execute("SELECT COUNT(*) FROM app_withdrawal_requests WHERE user_id = ? AND created_at >= ? AND created_at < ? AND status IN ('pending', 'approved')", (user_id, start, end)).fetchone()[0] or 0)


def serialize_point_entry(row: Any) -> dict[str, Any]:
    item = row_to_dict(row)
    return {
        "id": item.get("id"),
        "rule_code": item.get("rule_code") or '',
        "label": REWARD_RULES.get(item.get("rule_code") or '', {}).get("label") or '포인트',
        "points": int(item.get("points") or 0),
        "description": item.get("description") or '',
        "created_at": item.get("created_at") or '',
    }


def serialize_withdrawal(row: Any) -> dict[str, Any]:
    item = row_to_dict(row)
    return {
        "id": item.get("id"),
        "points_amount": int(item.get("points_amount") or 0),
        "cash_amount": int(item.get("cash_amount") or 0),
        "status": item.get("status") or 'pending',
        "account_holder": item.get("account_holder") or '',
        "bank_name": item.get("bank_name") or '',
        "account_number_masked": re.sub(r'(?<=..).(?=..)', '*', str(item.get("account_number") or '')),
        "note": item.get("note") or '',
        "rejection_reason": item.get("rejection_reason") or '',
        "created_at": item.get("created_at") or '',
        "processed_at": item.get("processed_at") or '',
    }


def award_points(conn, user_id: int, rule_code: str, *, source_type: str = '', source_id: int | None = None, source_key: str = '', description: str = '') -> bool:
    meta = REWARD_RULES.get(rule_code)
    if not meta or not user_id:
        return False
    ensure_reward_tables(conn)
    if source_key:
        exists = conn.execute("SELECT id FROM app_point_ledger WHERE user_id = ? AND source_key = ?", (user_id, source_key)).fetchone()
        if exists:
            return False
    daily_limit = int(meta.get('daily_limit') or 0)
    if daily_limit > 0:
        start, end = today_window()
        count = int(conn.execute("SELECT COUNT(*) FROM app_point_ledger WHERE user_id = ? AND rule_code = ? AND created_at >= ? AND created_at < ?", (user_id, rule_code, start, end)).fetchone()[0] or 0)
        if count >= daily_limit:
            return False
    conn.execute(
        "INSERT INTO app_point_ledger(user_id, rule_code, points, source_type, source_id, source_key, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, rule_code, int(meta.get('points') or 0), source_type, source_id, source_key or '', description or str(meta.get('description') or ''), utcnow()),
    )
    return True


def maybe_award_profile_completion(conn, user_id: int, profile_id: int) -> bool:
    row = conn.execute("SELECT id, display_name, title, headline, bio, current_work, industry_category, profile_image_url FROM app_profiles WHERE id = ? AND user_id = ?", (profile_id, user_id)).fetchone()
    if not row:
        return False
    item = row_to_dict(row)
    required = [item.get('display_name') or item.get('title'), item.get('headline'), item.get('bio'), item.get('current_work'), item.get('industry_category'), item.get('profile_image_url')]
    if not all(str(value or '').strip() for value in required):
        return False
    return award_points(conn, user_id, 'complete_profile', source_type='profile', source_id=profile_id, source_key=f'complete_profile:{profile_id}', description='핵심 프로필 정보를 모두 입력해 보너스가 적립되었습니다.')


def compute_reward_projection(conn, user_id: int) -> dict[str, Any]:
    ensure_reward_tables(conn)
    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day).isoformat()
    week_start = (now - timedelta(days=7)).isoformat()
    month_start, month_end = month_window_from_now()
    today_earned = int(conn.execute("SELECT COALESCE(SUM(points), 0) FROM app_point_ledger WHERE user_id = ? AND created_at >= ?", (user_id, today_start)).fetchone()[0] or 0)
    week_earned = int(conn.execute("SELECT COALESCE(SUM(points), 0) FROM app_point_ledger WHERE user_id = ? AND created_at >= ?", (user_id, week_start)).fetchone()[0] or 0)
    month_earned = int(conn.execute("SELECT COALESCE(SUM(points), 0) FROM app_point_ledger WHERE user_id = ? AND created_at >= ? AND created_at < ?", (user_id, month_start, month_end)).fetchone()[0] or 0)
    answered_count = int(conn.execute("SELECT COUNT(*) FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE p.user_id = ? AND q.status = 'answered' AND COALESCE(q.deleted_at, '') = ''", (user_id,)).fetchone()[0] or 0)
    question_count = int(conn.execute("SELECT COUNT(*) FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE p.user_id = ? AND COALESCE(q.deleted_at, '') = ''", (user_id,)).fetchone()[0] or 0)
    share_count = int(conn.execute("SELECT COUNT(*) FROM app_point_ledger WHERE user_id = ? AND rule_code = 'share_profile' AND created_at >= ?", (user_id, week_start)).fetchone()[0] or 0)
    public_profile_count = int(conn.execute("SELECT COUNT(*) FROM app_profiles WHERE user_id = ? AND is_public = 1", (user_id,)).fetchone()[0] or 0)
    activity_score_7d = week_earned + (answered_count * 40) + (share_count * 25) + (public_profile_count * 30)
    projected_month_points = max(month_earned, int(round(week_earned * 4.3)))
    estimated_ad_exposure = max(0, answered_count * 35 + question_count * 18 + share_count * 12 + public_profile_count * 40)
    expected_cash_krw = projected_month_points
    return {
        "today_earned": today_earned,
        "week_earned": week_earned,
        "month_earned": month_earned,
        "activity_score_7d": activity_score_7d,
        "projected_month_points": projected_month_points,
        "expected_cash_krw": expected_cash_krw,
        "estimated_ad_exposure": estimated_ad_exposure,
        "answered_questions": answered_count,
        "received_questions": question_count,
        "profile_shares_7d": share_count,
        "public_profiles": public_profile_count,
    }


def reward_summary_payload(conn, user_id: int) -> dict[str, Any]:
    ensure_reward_tables(conn)
    ensure_brand_verification_tables(conn)
    ensure_keyword_boost_tables(conn)
    ensure_direct_ad_tables(conn)
    balance = get_reward_balance(conn, user_id)
    projection = compute_reward_projection(conn, user_id)
    month_earned = int(projection.get('month_earned') or 0)
    month_withdraw_count = monthly_withdraw_count(conn, user_id)
    ledger_rows = conn.execute("SELECT * FROM app_point_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 50", (user_id,)).fetchall()
    withdrawal_rows = conn.execute("SELECT * FROM app_withdrawal_requests WHERE user_id = ? ORDER BY id DESC LIMIT 12", (user_id,)).fetchall()
    return {
        "balance": balance,
        "month_earned": month_earned,
        "today_earned": int(projection.get('today_earned') or 0),
        "week_earned": int(projection.get('week_earned') or 0),
        "estimated": projection,
        "min_withdraw_points": REWARD_MIN_WITHDRAW_POINTS,
        "monthly_withdraw_limit": REWARD_MONTHLY_WITHDRAW_LIMIT,
        "monthly_withdraw_count": month_withdraw_count,
        "can_withdraw": balance['available'] >= REWARD_MIN_WITHDRAW_POINTS and month_withdraw_count < REWARD_MONTHLY_WITHDRAW_LIMIT,
        "rules": reward_rule_rows(),
        "brand_verification": {
            "my_requests": [serialize_brand_verification_request(row) for row in conn.execute("SELECT * FROM app_brand_verification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 10", (user_id,)).fetchall()],
            "external_examples": [
                {"platform": "X Premium Business Basic", "price_text": "$200/월 또는 $2,000/년", "source": "official"},
                {"platform": "X Premium Organizations Full Access", "price_text": "$1,000/월 또는 $10,000/년", "source": "official"},
                {"platform": "Meta Verified for businesses", "price_text": "Meta가 사업용 유료 플랜을 운영하며 번들 할인 안내를 제공", "source": "official"},
            ],
        },
        "keyword_boosts": {
            "my_items": [serialize_keyword_boost(row) for row in conn.execute("SELECT * FROM app_keyword_boosts WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user_id,)).fetchall()],
        },
        "direct_ads": {
            "my_items": [serialize_direct_ad_campaign(row) for row in conn.execute("SELECT * FROM app_direct_ad_campaigns WHERE user_id = ? ORDER BY id DESC LIMIT 20", (user_id,)).fetchall()],
            "placements": [
                {"code": "home_feed", "label": "홈 피드 중간"},
                {"code": "question_sidebar", "label": "질문/답변 하단"},
            ],
            "guide": [
                "직접 광고는 운영자가 검수 승인한 뒤 노출됩니다.",
                "포인트를 더 많이 사용할수록 같은 지면/카테고리 경쟁에서 우선 노출됩니다.",
                "광고주 정보와 랜딩 URL은 관리자 승인 전까지 공개 노출되지 않습니다.",
            ],
        },
        "creator_model": [
            {"title": "프로필 자산화", "description": "프로필, 경력, 자기소개, 링크, 파일관리 자산을 공개 프로필과 함께 운영해 검색·공유 자산으로 누적합니다."},
            {"title": "질문/답변 전환", "description": "공개 프로필에서 질문, DM, 피드 유입이 발생하면 광고 노출과 상담 전환이 함께 일어나는 구조입니다."},
            {"title": "활동 기반 포인트", "description": "광고 시청 자체가 아니라 프로필 공유, 질문 수신, 답변 완료, 공개 자산 완성도 같은 활동에만 포인트를 지급합니다."},
            {"title": "플랫폼 상위 수익", "description": "광고 영업과 광고주 관리는 플랫폼이 담당하고, 회원에게는 안전한 범위의 포인트/출금 리워드를 제공하는 구조입니다."},
        ],
        "strategy_comparison": [
            {"service": "LinkedIn", "strength": "전문 프로필·경력 관리", "gap": "노출 이후 개인 보상 구조가 약함", "our_edge": "프로필 자산 관리 + 활동 리워드 + 키워드 경쟁을 결합"},
            {"service": "Instagram", "strength": "자기 표현과 팔로우 기반 노출", "gap": "경력·증빙·파일 자산 관리가 약함", "our_edge": "경력·증빙·자기소개·질문 전환까지 한 앱에서 운영"},
            {"service": "크몽/숨고형 서비스", "strength": "문의/매칭 전환이 빠름", "gap": "개인 브랜딩 자산 축적과 장기 팬화 구조가 약함", "our_edge": "프로필 자산을 쌓으면서 질문·DM·광고 보상을 동시에 운영"},
            {"service": "노션/링크인바이오", "strength": "링크·파일 정리", "gap": "커뮤니티와 수익화 운영 기능이 약함", "our_edge": "링크·파일관리 + 피드·질문·광고·정산까지 연결"},
        ],
        "notices": [
            "광고 수익은 플랫폼 운영 수익이며 회원 보상은 활동 포인트 기준으로만 적립됩니다.",
            "광고 시청·클릭 자체는 포인트 지급 기준이 아니며, 부정 트래픽 유도 행위는 제한됩니다.",
            f"현금 전환은 최소 {REWARD_MIN_WITHDRAW_POINTS:,}P부터 가능하며 월 {REWARD_MONTHLY_WITHDRAW_LIMIT}회까지 신청할 수 있습니다.",
        ],
        "insights": [
            f"최근 7일 활동 점수는 {int(projection.get('activity_score_7d') or 0):,}점 입니다.",
            f"예상 월 리워드는 약 {int(projection.get('projected_month_points') or 0):,}P 입니다.",
            f"질문 화면 기반 예상 광고 노출 지수는 {int(projection.get('estimated_ad_exposure') or 0):,}회 입니다.",
        ],
        "ledger": [serialize_point_entry(row) for row in ledger_rows],
        "withdrawals": [serialize_withdrawal(row) for row in withdrawal_rows],
    }


def admin_reward_overview_payload(conn) -> dict[str, Any]:
    ensure_reward_tables(conn)
    ensure_brand_verification_tables(conn)
    ensure_keyword_boost_tables(conn)
    ensure_direct_ad_tables(conn)
    pending_count = int(conn.execute("SELECT COUNT(*) FROM app_withdrawal_requests WHERE status = 'pending'").fetchone()[0] or 0)
    approved_count = int(conn.execute("SELECT COUNT(*) FROM app_withdrawal_requests WHERE status = 'approved'").fetchone()[0] or 0)
    paid_count = int(conn.execute("SELECT COUNT(*) FROM app_withdrawal_requests WHERE status = 'paid'").fetchone()[0] or 0)
    total_pending_points = int(conn.execute("SELECT COALESCE(SUM(points_amount), 0) FROM app_withdrawal_requests WHERE status IN ('pending', 'approved')").fetchone()[0] or 0)
    total_paid_points = int(conn.execute("SELECT COALESCE(SUM(points_amount), 0) FROM app_withdrawal_requests WHERE status = 'paid'").fetchone()[0] or 0)
    withdrawal_rows = conn.execute("""
        SELECT w.*, u.email, u.nickname
        FROM app_withdrawal_requests w
        JOIN users u ON u.id = w.user_id
        ORDER BY CASE w.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, w.id DESC
        LIMIT 80
    """).fetchall()
    top_rows = conn.execute("""
        SELECT u.id, u.email, u.nickname, COALESCE(SUM(l.points), 0) AS earned_points
        FROM users u
        LEFT JOIN app_point_ledger l ON l.user_id = u.id
        GROUP BY u.id, u.email, u.nickname
        ORDER BY earned_points DESC, u.id DESC
        LIMIT 12
    """).fetchall()
    top_users = []
    for row in top_rows:
        item = row_to_dict(row)
        projection = compute_reward_projection(conn, int(item.get('id') or 0))
        top_users.append({
            "user_id": int(item.get('id') or 0),
            "email": item.get('email') or '',
            "nickname": item.get('nickname') or '',
            "earned_points": int(item.get('earned_points') or 0),
            "projected_month_points": int(projection.get('projected_month_points') or 0),
            "estimated_ad_exposure": int(projection.get('estimated_ad_exposure') or 0),
        })
    requests = []
    for row in withdrawal_rows:
        item = serialize_withdrawal(row)
        item.update({
            "user_id": int(row['user_id']),
            "email": row['email'] or '',
            "nickname": row['nickname'] or '',
        })
        requests.append(item)
    brand_requests = [serialize_brand_verification_request(r) | {"email": r["email"], "nickname": r["nickname"]} for r in conn.execute("SELECT b.*, u.email, u.nickname FROM app_brand_verification_requests b JOIN users u ON u.id = b.user_id ORDER BY CASE b.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, b.id DESC LIMIT 40").fetchall()]
    top_keywords = [row_to_dict(r) for r in conn.execute("SELECT keyword, SUM(points_spent) AS total_points, COUNT(*) AS item_count FROM app_keyword_boosts WHERE status = 'active' GROUP BY keyword ORDER BY total_points DESC, keyword ASC LIMIT 20").fetchall()]
    direct_ads = [serialize_direct_ad_campaign(r) | {"email": r["email"], "nickname": r["nickname"]} for r in conn.execute("SELECT d.*, u.email, u.nickname FROM app_direct_ad_campaigns d JOIN users u ON u.id = d.user_id ORDER BY CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, d.id DESC LIMIT 40").fetchall()]
    active_direct_ads = int(conn.execute("SELECT COUNT(*) FROM app_direct_ad_campaigns WHERE status = 'approved'").fetchone()[0] or 0)
    pending_direct_ads = int(conn.execute("SELECT COUNT(*) FROM app_direct_ad_campaigns WHERE status = 'pending'").fetchone()[0] or 0)
    return {
        "summary": {
            "pending_count": pending_count,
            "approved_count": approved_count,
            "paid_count": paid_count,
            "total_pending_points": total_pending_points,
            "total_paid_points": total_paid_points,
        },
        "requests": requests,
        "top_users": top_users,
        "brand_requests": brand_requests,
        "top_keywords": top_keywords,
        "direct_ads": direct_ads,
        "direct_ad_summary": {"active_count": active_direct_ads, "pending_count": pending_direct_ads},
    }

@app.post("/api/rewards/brand-verification/request")
def request_brand_verification(payload: BrandVerificationRequestIn, user=Depends(current_user)):
    with get_conn() as conn:
        ensure_brand_verification_tables(conn)
        profile = conn.execute("SELECT * FROM app_profiles WHERE id = ? AND user_id = ?", (payload.profile_id, user['id'])).fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail='프로필을 찾을 수 없습니다.')
        profile_row = row_to_dict(profile)
        if (profile_row.get('account_type') or 'personal') == 'personal':
            conn.execute("UPDATE app_profiles SET account_type = 'brand' WHERE id = ?", (payload.profile_id,))
        exists = conn.execute("SELECT id FROM app_brand_verification_requests WHERE profile_id = ? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1", (payload.profile_id,)).fetchone()
        if exists:
            raise HTTPException(status_code=400, detail='이미 진행 중이거나 승인된 인증 요청이 있습니다.')
        conn.execute("INSERT INTO app_brand_verification_requests(user_id, profile_id, business_name, business_category, website_url, note, status, admin_note, created_at, processed_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, '')", (user['id'], payload.profile_id, payload.business_name[:120], payload.business_category[:80], payload.website_url[:300], payload.note[:500], utcnow()))
        return {'ok': True, 'summary': reward_summary_payload(conn, int(user['id']))}


@app.post("/api/rewards/keyword-boosts")
def create_keyword_boost(payload: KeywordBoostCreateIn, user=Depends(current_user)):
    with get_conn() as conn:
        ensure_keyword_boost_tables(conn)
        content_type = (payload.content_type or 'feed_post').strip()
        if content_type not in {'feed_post', 'community_post'}:
            raise HTTPException(status_code=400, detail='지원하지 않는 노출 대상입니다.')
        content_id = int(payload.content_id or 0)
        if content_id <= 0:
            raise HTTPException(status_code=400, detail='대상을 선택해주세요.')
        keyword = normalize_keyword(payload.keyword)
        if not keyword:
            raise HTTPException(status_code=400, detail='키워드를 입력해주세요.')
        points = max(100, min(50000, int(payload.points_spent or 0)))
        if content_type == 'feed_post':
            row = conn.execute("SELECT id, user_id FROM feed_posts WHERE id = ?", (content_id,)).fetchone()
        else:
            row = conn.execute("SELECT id, user_id FROM community_posts WHERE id = ?", (content_id,)).fetchone()
        if not row or int(row['user_id']) != int(user['id']):
            raise HTTPException(status_code=403, detail='본인 콘텐츠만 상위 노출에 사용할 수 있습니다.')
        profile_row = conn.execute("SELECT id FROM app_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1", (user['id'],)).fetchone()
        spend_points(conn, int(user['id']), points, description=f"키워드 '{keyword}' 상위 노출 사용", source_type=content_type, source_id=content_id, source_key=f"boost:{content_type}:{content_id}:{keyword}:{utcnow()}")
        conn.execute("INSERT INTO app_keyword_boosts(user_id, profile_id, content_type, content_id, keyword, points_spent, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '')", (user['id'], int(profile_row['id']) if profile_row else None, content_type, content_id, keyword, points, utcnow()))
        return {'ok': True, 'summary': reward_summary_payload(conn, int(user['id'])), 'competition': keyword_competition_payload(conn, keyword, int(user['id']))}


@app.get("/api/rewards/keyword-competition")
def get_keyword_competition(keyword: str = Query(default=''), user=Depends(current_user)):
    with get_conn() as conn:
        ensure_keyword_boost_tables(conn)
        return keyword_competition_payload(conn, keyword, int(user['id']))


@app.post("/api/rewards/direct-ads")
def create_direct_ad_campaign(payload: DirectAdCampaignCreateIn, user=Depends(current_user)):
    with get_conn() as conn:
        ensure_direct_ad_tables(conn)
        title = (payload.title or '').strip()[:80]
        if not title:
            raise HTTPException(status_code=400, detail='광고 제목을 입력해주세요.')
        target_url = (payload.target_url or '').strip()[:300]
        if not target_url.startswith('http://') and not target_url.startswith('https://'):
            raise HTTPException(status_code=400, detail='랜딩 URL은 http:// 또는 https:// 로 시작해야 합니다.')
        placement = (payload.placement or 'home_feed').strip()
        if placement not in {'home_feed', 'question_sidebar'}:
            raise HTTPException(status_code=400, detail='지원하지 않는 광고 지면입니다.')
        bid_points = max(500, min(500000, int(payload.bid_points or 0)))
        category = normalize_keyword(payload.category)
        profile_id = int(payload.profile_id or 0)
        if profile_id > 0:
            profile = conn.execute("SELECT id FROM app_profiles WHERE id = ? AND user_id = ?", (profile_id, user['id'])).fetchone()
            if not profile:
                raise HTTPException(status_code=403, detail='본인 프로필만 광고주 프로필로 연결할 수 있습니다.')
        spend_points(conn, int(user['id']), bid_points, description=f"직접 광고 '{title}' 집행", source_type='direct_ad', source_key=f"directad:{title}:{utcnow()}", rule_code='direct_ad_spend')
        conn.execute("INSERT INTO app_direct_ad_campaigns(user_id, profile_id, title, subtitle, description, target_url, image_url, placement, category, target_keyword, bid_points, status, admin_note, impressions, clicks, created_at, processed_at, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', 0, 0, ?, '', '', '')", (user['id'], profile_id if profile_id > 0 else None, title, (payload.subtitle or '')[:120], (payload.description or '')[:500], target_url, (payload.image_url or '')[:500], placement, category, normalize_keyword(payload.target_keyword), bid_points, utcnow()))
        return {'ok': True, 'summary': reward_summary_payload(conn, int(user['id'])), 'competition': direct_ad_competition_payload(conn, placement=placement, category=category)}


@app.get("/api/direct-ads/placements")
def list_active_direct_ads(placement: str = Query(default='home_feed'), limit: int = Query(default=3, ge=1, le=10), category: str = Query(default='')):
    with get_conn() as conn:
        ensure_direct_ad_tables(conn)
        items = active_direct_ads_payload(conn, placement=placement, limit=limit)
        category_norm = normalize_keyword(category)
        if category_norm:
            items = [item for item in items if normalize_keyword(item.get('category') or '') == category_norm][:limit]
        for item in items:
            conn.execute("UPDATE app_direct_ad_campaigns SET impressions = COALESCE(impressions, 0) + 1 WHERE id = ?", (int(item.get('id') or 0),))
            item['impressions'] = int(item.get('impressions') or 0) + 1
        return {'items': items, 'competition': direct_ad_competition_payload(conn, placement=placement, category=category_norm)}


@app.post("/api/direct-ads/{campaign_id}/click")
def track_direct_ad_click(campaign_id: int):
    with get_conn() as conn:
        ensure_direct_ad_tables(conn)
        conn.execute("UPDATE app_direct_ad_campaigns SET clicks = COALESCE(clicks, 0) + 1 WHERE id = ?", (campaign_id,))
        return {'ok': True}


@app.post("/api/admin/direct-ads/{campaign_id}/process")
def process_direct_ad_campaign(campaign_id: int, payload: AdminDirectAdProcessIn, user=Depends(admin_user)):
    status = (payload.status or 'approved').strip().lower()
    if status not in {'approved', 'rejected'}:
        raise HTTPException(status_code=400, detail='허용되지 않는 처리 상태입니다.')
    with get_conn() as conn:
        ensure_direct_ad_tables(conn)
        row = conn.execute("SELECT * FROM app_direct_ad_campaigns WHERE id = ?", (campaign_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='직접 광고 요청을 찾을 수 없습니다.')
        conn.execute("UPDATE app_direct_ad_campaigns SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?", (status, (payload.note or '')[:500], utcnow(), campaign_id))
        return {'ok': True, 'overview': admin_reward_overview_payload(conn)}


@app.post("/api/admin/brand-verification/{request_id}/process")
def process_brand_verification(request_id: int, payload: AdminBrandVerificationProcessIn, user=Depends(admin_user)):
    status = (payload.status or 'approved').strip().lower()
    if status not in {'approved', 'rejected'}:
        raise HTTPException(status_code=400, detail='허용되지 않는 처리 상태입니다.')
    with get_conn() as conn:
        ensure_brand_verification_tables(conn)
        row = conn.execute("SELECT * FROM app_brand_verification_requests WHERE id = ?", (request_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='인증 요청을 찾을 수 없습니다.')
        req = row_to_dict(row)
        conn.execute("UPDATE app_brand_verification_requests SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?", (status, payload.note[:500], utcnow(), request_id))
        if status == 'approved':
            conn.execute("UPDATE app_profiles SET brand_verified = 1, account_type = 'brand', verification_badge_text = ? WHERE id = ?", ('브랜드/기업 인증', int(req.get('profile_id') or 0)))
        else:
            conn.execute("UPDATE app_profiles SET brand_verified = 0, verification_badge_text = '' WHERE id = ?", (int(req.get('profile_id') or 0),))
        return {'ok': True, 'overview': admin_reward_overview_payload(conn)}


def create_default_profile(conn, user_id: int, nickname: str) -> None:
    existing = conn.execute("SELECT id FROM app_profiles WHERE user_id = ? LIMIT 1", (user_id,)).fetchone()
    if existing:
        return
    now = utcnow()
    base_slug = slugify(nickname)
    unique_slug = base_slug
    suffix = 1
    while conn.execute("SELECT id FROM app_profiles WHERE slug = ? LIMIT 1", (unique_slug,)).fetchone():
        suffix += 1
        unique_slug = f"{base_slug}-{suffix}"
    conn.execute(
        """
        INSERT INTO app_profiles(user_id, title, slug, display_name, gender, birth_year, feed_profile_public, headline, bio, location, current_work, industry_category, is_public, allow_anonymous_questions, theme_color, visibility_mode, question_permission, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, f"{nickname} 프로필", unique_slug, nickname, "", "", 0, "한 줄 소개를 입력해보세요.", "프로필 설명을 입력해보세요.", "", "현재 하는 일을 입력해보세요.", "기타", 1, 1, "#3b82f6", "link_only", "any", now, now),
    )
    profile_id = conn.execute("SELECT id FROM app_profiles WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user_id,)).fetchone()[0]
    conn.execute(
        """
        INSERT INTO app_careers(profile_id, title, one_line, period, role_name, description, review_text, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            profile_id,
            "대표 경력 예시",
            "이 경력 카드 클릭 시 상세 경험과 후기를 확인할 수 있습니다.",
            "2024 - 현재",
            "주요 역할",
            "이 영역에 프로젝트 경험, 성과, 사용 기술, 현장 후기 등을 상세하게 적을 수 있습니다.",
            "실제 사용자 후기 또는 추천사를 여기에 넣을 수 있습니다.",
            1,
            now,
            now,
        ),
    )



DEMO_ACCOUNTS = [
    {
        "email": "demo.admin@historyprofile.com",
        "password": "demo1234!",
        "nickname": "데모관리자",
        "role": "admin",
        "grade": 1,
        "phone": "010-9000-0001",
        "extra_profile_slots": 10,
        "storage_quota_override_bytes": 0,
        "chat_media_quota_bytes": CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES * 3,
    },
    {
        "email": "demo.user@historyprofile.com",
        "password": "demo1234!",
        "nickname": "데모회원",
        "role": "user",
        "grade": 6,
        "phone": "010-9000-0002",
        "extra_profile_slots": 0,
        "storage_quota_override_bytes": 0,
        "chat_media_quota_bytes": CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES,
    },
    {
        "email": "aksqhqkqh3@naver.com",
        "password": "329tjdrb@2a",
        "nickname": "추가회원",
        "role": "user",
        "grade": 6,
        "phone": "010-9000-0003",
        "extra_profile_slots": 0,
        "storage_quota_override_bytes": 0,
        "chat_media_quota_bytes": CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES,
    },
    *[
        {
            "email": f"test{index:02d}@historyprofile.com",
            "password": "demo1234!",
            "nickname": f"테스트{index:02d}",
            "role": "user",
            "grade": 6,
            "phone": f"010-9100-{index:04d}",
            "extra_profile_slots": 0,
            "storage_quota_override_bytes": 0,
            "chat_media_quota_bytes": CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES,
        }
        for index in range(1, 11)
    ],
]

RESETTABLE_SIGNUP_PHONES = {
    "01056105855",
}


def ensure_demo_feed_bundle(conn, user_id: int, nickname: str, profile_index: int) -> None:
    now = utcnow()
    profile = conn.execute("SELECT * FROM app_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1", (user_id,)).fetchone()
    if profile:
        profile_row = row_to_dict(profile)
        slug = profile_row.get("slug") or slugify(f"{nickname}-{user_id}")
        conn.execute(
            """
            UPDATE app_profiles
            SET display_name = ?, feed_profile_public = 1, is_public = 1, visibility_mode = 'search', question_permission = 'any',
                title = CASE WHEN COALESCE(title, '') = '' THEN ? ELSE title END,
                headline = CASE WHEN COALESCE(headline, '') = '' OR headline = '한 줄 소개를 입력해보세요.' THEN ? ELSE headline END,
                bio = CASE WHEN COALESCE(bio, '') = '' OR bio = '프로필 설명을 입력해보세요.' THEN ? ELSE bio END,
                location = CASE WHEN COALESCE(location, '') = '' THEN ? ELSE location END,
                current_work = CASE WHEN COALESCE(current_work, '') = '' OR current_work = '현재 하는 일을 입력해보세요.' THEN ? ELSE current_work END,
                updated_at = ?,
                slug = ?
            WHERE id = ?
            """,
            (
                nickname,
                f"{nickname} 공개 프로필",
                f"{nickname}님의 테스트용 공개 프로필입니다.",
                f"{nickname} 계정은 홈 피드 공유 테스트를 위해 자동 생성된 계정입니다.",
                "서울",
                "홈 피드 테스트 사용자",
                now,
                slug,
                int(profile_row["id"]),
            ),
        )

    post_count = int(conn.execute("SELECT COUNT(*) FROM feed_posts WHERE user_id = ?", (user_id,)).fetchone()[0] or 0)
    if post_count >= 3:
        return

    templates = [
        f"[{nickname}] 홈 피드 공유 테스트 게시글 1 · 오늘 작업 기록과 인사말을 남깁니다.",
        f"[{nickname}] 홈 피드 공유 테스트 게시글 2 · 다른 테스트 계정에서도 이 게시글이 보여야 합니다.",
        f"[{nickname}] 홈 피드 공유 테스트 게시글 3 · 계정 간 피드 노출 확인용 샘플입니다.",
    ]
    for offset, content in enumerate(templates, start=1):
        exists = conn.execute(
            "SELECT id FROM feed_posts WHERE user_id = ? AND content = ? LIMIT 1",
            (user_id, content),
        ).fetchone()
        if exists:
            continue
        created_at = utcnow_datetime() - timedelta(minutes=(profile_index * 10) + offset)
        conn.execute(
            "INSERT INTO feed_posts(user_id, content, image_url, created_at) VALUES (?, ?, '', ?)",
            (user_id, content, created_at.isoformat()),
        )


def ensure_demo_accounts(conn) -> None:
    now = utcnow()
    for profile_index, spec in enumerate(DEMO_ACCOUNTS, start=1):
        row = conn.execute("SELECT * FROM users WHERE email = ? LIMIT 1", (spec["email"],)).fetchone()
        if row:
            user_id = int(row["id"])
            conn.execute(
                "UPDATE users SET password_hash = ?, nickname = ?, role = ?, grade = ?, approved = 1, phone = ?, extra_profile_slots = ?, storage_quota_override_bytes = ?, phone_verified_at = CASE WHEN COALESCE(phone_verified_at, '') = '' THEN ? ELSE phone_verified_at END, account_status = 'active', suspended_reason = '', warning_count = 0, chat_media_quota_bytes = ? WHERE id = ?",
                (
                    hash_password(spec["password"]),
                    spec["nickname"],
                    spec["role"],
                    spec["grade"],
                    spec["phone"],
                    spec["extra_profile_slots"],
                    spec["storage_quota_override_bytes"],
                    now,
                    spec["chat_media_quota_bytes"],
                    user_id,
                ),
            )
        else:
            conn.execute(
                "INSERT INTO users(email, password_hash, nickname, phone, role, grade, created_at, extra_profile_slots, storage_quota_override_bytes, phone_verified_at, account_status, warning_count, suspended_reason, last_warning_at, chat_media_quota_bytes, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    spec["email"],
                    hash_password(spec["password"]),
                    spec["nickname"],
                    spec["phone"],
                    spec["role"],
                    spec["grade"],
                    now,
                    spec["extra_profile_slots"],
                    spec["storage_quota_override_bytes"],
                    now,
                    "active",
                    0,
                    "",
                    "",
                    spec["chat_media_quota_bytes"],
                    1,
                ),
            )
            user_id = int(conn.execute("SELECT id FROM users WHERE email = ? LIMIT 1", (spec["email"],)).fetchone()[0])
        with suppress(Exception):
            unique_id = generate_account_unique_id(conn, spec["email"], user_id)
            conn.execute("UPDATE users SET account_unique_id = ? WHERE id = ?", (unique_id, user_id))
        create_default_profile(conn, user_id, spec["nickname"])
        ensure_demo_feed_bundle(conn, user_id, spec["nickname"], profile_index)


def parse_iso_datetime(value: str | None) -> datetime | None:
    raw = str(value or '').strip()
    if not raw:
        return None
    normalized = raw.replace('Z', '+00:00')
    try:
        dt = datetime.fromisoformat(normalized)
    except Exception:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def utcnow_datetime() -> datetime:
    return datetime.now(timezone.utc)


def release_signup_phone(conn, phone: str, *, clear_verifications: bool = True) -> int:
    normalized = normalize_phone(phone)
    if not normalized or normalized not in RESETTABLE_SIGNUP_PHONES:
        return 0
    formatted = format_phone(normalized)
    rows = conn.execute(
        "SELECT id, email FROM users WHERE REPLACE(COALESCE(phone, ''), '-', '') = ?",
        (normalized,),
    ).fetchall()
    released = 0
    demo_emails = {item["email"] for item in DEMO_ACCOUNTS}
    for row in rows:
        email = str(row["email"] or "").strip().lower()
        if email in demo_emails:
            continue
        conn.execute(
            "UPDATE users SET phone = '', phone_verified_at = '' WHERE id = ?",
            (row["id"],),
        )
        released += 1
    if clear_verifications:
        conn.execute(
            "DELETE FROM app_phone_verifications WHERE phone = ? OR phone = ?",
            (normalized, formatted),
        )
    return released

def profile_owner_or_404(conn, profile_id: int, user_id: int):
    row = conn.execute("SELECT * FROM app_profiles WHERE id = ? AND user_id = ?", (profile_id, user_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
    return row_to_dict(row)


def user_blocks_other(conn, user_id: int, other_user_id: int) -> bool:
    row = conn.execute(
        "SELECT id FROM app_blocks WHERE blocker_user_id = ? AND blocked_user_id = ? LIMIT 1",
        (user_id, other_user_id),
    ).fetchone()
    return bool(row)


def either_side_blocked(conn, user_id: int, other_user_id: int) -> bool:
    row = conn.execute(
        "SELECT id FROM app_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1",
        (user_id, other_user_id, other_user_id, user_id),
    ).fetchone()
    return bool(row)


def get_primary_profile_for_user(conn, user_id: int):
    return conn.execute("SELECT * FROM app_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1", (user_id,)).fetchone()


def are_friends(conn, user_id: int, other_user_id: int) -> bool:
    if not user_id or not other_user_id or int(user_id) == int(other_user_id):
        return False
    row = conn.execute(
        "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1",
        (user_id, other_user_id),
    ).fetchone()
    return bool(row)


def get_friend_request_status(conn, viewer_id: int | None, target_user_id: int) -> str:
    if not viewer_id or int(viewer_id) == int(target_user_id):
        return 'self' if viewer_id and int(viewer_id) == int(target_user_id) else 'none'
    if are_friends(conn, int(viewer_id), int(target_user_id)):
        return 'friends'
    outgoing = conn.execute(
        "SELECT status FROM friend_requests WHERE requester_id = ? AND target_user_id = ? ORDER BY id DESC LIMIT 1",
        (int(viewer_id), int(target_user_id)),
    ).fetchone()
    if outgoing and (outgoing[0] or '') == 'pending':
        return 'requested'
    incoming = conn.execute(
        "SELECT status FROM friend_requests WHERE requester_id = ? AND target_user_id = ? ORDER BY id DESC LIMIT 1",
        (int(target_user_id), int(viewer_id)),
    ).fetchone()
    if incoming and (incoming[0] or '') == 'pending':
        return 'incoming'
    return 'none'


def serialize_feed_post(conn, row: dict, viewer: dict | None = None) -> dict:
    owner = conn.execute("SELECT * FROM users WHERE id = ? LIMIT 1", (row['user_id'],)).fetchone()
    profile_row = get_primary_profile_for_user(conn, int(row['user_id']))
    like_count = int(conn.execute("SELECT COUNT(*) FROM feed_likes WHERE post_id = ?", (row['id'],)).fetchone()[0] or 0)
    comment_count = int(conn.execute("SELECT COUNT(*) FROM feed_comments WHERE post_id = ?", (row['id'],)).fetchone()[0] or 0)
    bookmark_count = int(conn.execute("SELECT COUNT(*) FROM feed_bookmarks WHERE post_id = ?", (row['id'],)).fetchone()[0] or 0)
    viewer_id = int(viewer['id']) if viewer and viewer.get('id') else 0
    liked = False
    bookmarked = False
    if viewer_id:
        liked = bool(conn.execute("SELECT 1 FROM feed_likes WHERE post_id = ? AND user_id = ? LIMIT 1", (row['id'], viewer_id)).fetchone())
        bookmarked = bool(conn.execute("SELECT 1 FROM feed_bookmarks WHERE post_id = ? AND user_id = ? LIMIT 1", (row['id'], viewer_id)).fetchone())
    profile = serialize_profile(conn, row_to_dict(profile_row), include_private=False) if profile_row else None
    title = (row.get('title') or '').strip()
    content = (row.get('content') or '').strip()
    display_title = title or (content[:48] + ('…' if len(content) > 48 else ''))
    return {
        'id': row['id'],
        'title': title,
        'display_title': display_title,
        'content': content,
        'image_url': row.get('image_url') or '',
        'created_at': row.get('created_at') or '',
        'owner': user_public_dict(owner) if owner else None,
        'profile': profile,
        'stats': {
            'likes': like_count,
            'comments': comment_count,
            'bookmarks': bookmark_count,
        },
        'viewer': {
            'liked': liked,
            'bookmarked': bookmarked,
            'friend_request_status': get_friend_request_status(conn, viewer_id or None, int(row['user_id'])),
            'is_own_post': bool(viewer_id and viewer_id == int(row['user_id'])),
        },
    }


def serialize_feed_story(conn, row: dict, viewer: dict | None = None) -> dict:
    owner = conn.execute("SELECT * FROM users WHERE id = ? LIMIT 1", (row['user_id'],)).fetchone()
    profile_row = get_primary_profile_for_user(conn, int(row['user_id']))
    viewer_id = int(viewer['id']) if viewer and viewer.get('id') else 0
    profile = serialize_profile(conn, row_to_dict(profile_row), include_private=False) if profile_row else None
    title = (row.get('title') or '').strip()
    content = (row.get('content') or '').strip()
    return {
        'id': row['id'],
        'title': title,
        'content': content,
        'image_url': row.get('image_url') or '',
        'created_at': row.get('created_at') or '',
        'expires_at': row.get('expires_at') or '',
        'owner': user_public_dict(owner) if owner else None,
        'profile': profile,
        'viewer': {
            'friend_request_status': get_friend_request_status(conn, viewer_id or None, int(row['user_id'])),
            'is_own_story': bool(viewer_id and viewer_id == int(row['user_id'])),
        },
    }


def fetch_feed_posts(conn, viewer: dict | None, limit: int = 10, offset: int = 0, keyword: str = '') -> list[dict]:
    viewer_id = int(viewer['id']) if viewer and viewer.get('id') else 0
    rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM feed_posts ORDER BY created_at DESC, id DESC").fetchall()]
    keyword_norm = normalize_keyword(keyword)
    filtered: list[dict] = []
    for row in rows:
        text_blob = f"{row.get('title') or ''} {row.get('content') or ''}".lower()
        if keyword_norm and keyword_norm not in normalize_keyword(text_blob):
            boost_score = compute_keyword_boost_score(conn, content_type='feed_post', content_id=int(row['id']), keyword=keyword_norm)
            if boost_score <= 0:
                continue
        if viewer_id and int(row['user_id']) == viewer_id:
            filtered.append(row)
            continue
        if viewer_id and either_side_blocked(conn, viewer_id, int(row['user_id'])):
            continue
        filtered.append(row)
    def score(item: dict) -> tuple:
        owner_id = int(item['user_id'])
        is_friend = 1 if (viewer_id and are_friends(conn, viewer_id, owner_id)) else 0
        follows_you = 0
        following = 0
        if viewer_id and owner_id != viewer_id:
            follows_you = 1 if conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ? LIMIT 1", (owner_id, viewer_id)).fetchone() else 0
            following = 1 if conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ? LIMIT 1", (viewer_id, owner_id)).fetchone() else 0
        title_bonus = 1 if (item.get('title') or '').strip() else 0
        image_bonus = 1 if (item.get('image_url') or '').strip() else 0
        created = item.get('created_at') or ''
        boost_bonus = compute_keyword_boost_score(conn, content_type='feed_post', content_id=int(item['id']), keyword=keyword_norm) if keyword_norm else 0
        text_match = 1 if keyword_norm and keyword_norm in normalize_keyword(f"{item.get('title') or ''} {item.get('content') or ''}") else 0
        return (boost_bonus, text_match, is_friend, follows_you, following, image_bonus, title_bonus, created, item['id'])
    ranked = sorted(filtered, key=score, reverse=True)
    if not ranked:
        return []
    pool_size = min(len(ranked), max(limit * 3, 10))
    pool = ranked[:pool_size]
    seed_base = f"{viewer_id}:{offset}:{len(pool)}"
    seeded_pool = sorted(
        pool,
        key=lambda item: hashlib.sha1(f"{seed_base}:{item['id']}".encode('utf-8')).hexdigest(),
    )
    window = seeded_pool[offset:offset + limit]
    if len(window) < limit and pool:
        extra_index = 0
        while len(window) < limit and extra_index < len(seeded_pool):
            window.append(seeded_pool[extra_index])
            extra_index += 1
    return [serialize_feed_post(conn, item, viewer) for item in window[:limit]]


def serialize_community_post(conn, row: dict) -> dict:
    author_row = conn.execute("SELECT * FROM users WHERE id = ? LIMIT 1", (row['user_id'],)).fetchone()
    comment_rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM community_comments WHERE post_id = ? ORDER BY created_at ASC, id ASC", (row['id'],)).fetchall()]
    comments = []
    for comment in comment_rows:
        comment_author_row = conn.execute("SELECT * FROM users WHERE id = ? LIMIT 1", (comment['user_id'],)).fetchone()
        comments.append({
            'id': comment['id'],
            'content': comment.get('content') or '',
            'created_at': comment.get('created_at') or '',
            'author': user_public_dict(comment_author_row) if comment_author_row else None,
        })
    primary_category = (row.get('primary_category') or row.get('category') or '일반').strip() or '일반'
    secondary_category = (row.get('secondary_category') or '자유').strip() or '자유'
    return {
        'id': row['id'],
        'category': row.get('category') or primary_category,
        'primary_category': primary_category,
        'secondary_category': secondary_category,
        'title': row.get('title') or '',
        'content': row.get('content') or '',
        'summary': ((row.get('content') or '').strip()[:72] + ('…' if len((row.get('content') or '').strip()) > 72 else '')) if (row.get('content') or '').strip() else '',
        'attachment_url': row.get('attachment_url') or '',
        'created_at': row.get('created_at') or '',
        'author': user_public_dict(author_row) if author_row else None,
        'comments': comments,
    }


def fetch_community_posts(conn, primary_category: str = '', secondary_category: str = '', keyword: str = '') -> list[dict]:
    params: list[object] = []
    where: list[str] = []
    sql = "SELECT * FROM community_posts"
    if primary_category and primary_category != '전체':
        where.append("COALESCE(primary_category, category) = ?")
        params.append(primary_category)
    if secondary_category and secondary_category != '전체':
        where.append("COALESCE(secondary_category, '자유') = ?")
        params.append(secondary_category)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, id DESC"
    rows = [row_to_dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]
    keyword_norm = normalize_keyword(keyword)
    filtered = []
    for row in rows:
        text_blob = normalize_keyword(f"{row.get('title') or ''} {row.get('content') or ''}")
        boost_bonus = compute_keyword_boost_score(conn, content_type='community_post', content_id=int(row['id']), keyword=keyword_norm) if keyword_norm else 0
        if keyword_norm and keyword_norm not in text_blob and boost_bonus <= 0:
            continue
        row['_boost_bonus'] = boost_bonus
        row['_text_match'] = 1 if keyword_norm and keyword_norm in text_blob else 0
        filtered.append(row)
    if keyword_norm:
        filtered = sorted(filtered, key=lambda item: (int(item.get('_boost_bonus') or 0), int(item.get('_text_match') or 0), item.get('created_at') or '', int(item.get('id') or 0)), reverse=True)
    return [serialize_community_post(conn, row) for row in filtered]


def serialize_career(row: dict) -> dict:
    return {
        **row,
        "is_public": to_bool(row.get("is_public")),
        "gallery_json": json_loads(row.get("gallery_json"), []),
        "media_items": json_loads(row.get("media_items_json"), []),
    }


def serialize_intro(row: dict) -> dict:
    return {**row, "is_public": to_bool(row.get("is_public"))}


def serialize_link(row: dict) -> dict:
    meta = detect_link_meta(row.get("original_url") or "", row.get("link_type") or "external")
    return {
        **row,
        **meta,
        "is_public": to_bool(row.get("is_public")),
        "short_url": f"/r/{row['short_code']}",
        "full_short_url": f"{settings.api_public_url.rstrip('/')}/r/{row['short_code']}",
        "last_accessed_at": row.get("last_accessed_at") or "",
    }


def serialize_qr(row: dict) -> dict:
    return {
        **row,
        "is_public": to_bool(row.get("is_public")),
        "image_url": qr_image_url(f"{settings.api_public_url.rstrip('/')}/qr/{row['id']}") ,
        "redirect_url": f"{settings.api_public_url.rstrip('/')}/qr/{row['id']}",
        "last_accessed_at": row.get("last_accessed_at") or "",
    }


def random_anonymous_alias() -> str:
    adjectives = ["맑은", "차분한", "반짝이는", "든든한", "지적인", "유연한", "깊은", "다정한"]
    nouns = ["별", "바람", "파도", "노트", "나무", "구름", "달빛", "메아리"]
    return f"{random.choice(adjectives)} {random.choice(nouns)}"


def serialize_question(row: dict) -> dict:
    nickname = (row.get("nickname") or "").strip()
    if nickname and nickname != "익명":
        display_nickname = nickname
    else:
        display_nickname = (row.get("public_alias") or nickname or "익명").strip()
    return {
        **row,
        "is_hidden": to_bool(row.get("is_hidden")),
        "display_nickname": display_nickname,
    }


def serialize_question_comment(row: dict) -> dict:
    return {
        **row,
        "display_nickname": (row.get("nickname") or "익명").strip() or "익명",
    }


def serialize_upload(row: dict) -> dict:
    return {
        **row,
        "size_mb": round(int(row.get("size_bytes") or 0) / 1024 / 1024, 2),
        "preview_url": row.get("preview_url") or "",
        "report_count": int(row.get("report_count") or 0),
    }


def profile_publicly_visible(row: dict) -> bool:
    mode = sanitize_visibility_mode(row.get("visibility_mode") or "link_only")
    return mode in {"link_only", "search"}


def profile_search_visible(row: dict) -> bool:
    return sanitize_visibility_mode(row.get("visibility_mode") or "link_only") == "search"


def serialize_profile(conn, row: dict, include_private: bool = False) -> dict:
    profile_id = row["id"]
    user_id = int(row.get("user_id") or 0)
    careers = [
        serialize_career(item)
        for item in map(row_to_dict, conn.execute("SELECT * FROM app_careers WHERE profile_id = ? ORDER BY sort_order ASC, id DESC", (profile_id,)).fetchall())
        if include_private or to_bool(item.get("is_public"))
    ]
    intros = [
        serialize_intro(item)
        for item in map(row_to_dict, conn.execute("SELECT * FROM app_introductions WHERE profile_id = ? ORDER BY id DESC", (profile_id,)).fetchall())
        if include_private or to_bool(item.get("is_public"))
    ]
    links = [
        serialize_link(item)
        for item in map(row_to_dict, conn.execute("SELECT * FROM app_links WHERE profile_id = ? ORDER BY id DESC", (profile_id,)).fetchall())
        if include_private or to_bool(item.get("is_public"))
    ]
    qrs = [
        serialize_qr(item)
        for item in map(row_to_dict, conn.execute("SELECT * FROM app_qr_codes WHERE profile_id = ? ORDER BY id DESC", (profile_id,)).fetchall())
        if include_private or to_bool(item.get("is_public"))
    ]
    question_rows = [row_to_dict(item) for item in conn.execute("SELECT * FROM app_questions WHERE profile_id = ? AND is_hidden = 0 AND COALESCE(deleted_at, '') = '' ORDER BY id DESC", (profile_id,)).fetchall()]
    if not include_private:
        question_rows = [item for item in question_rows if item.get("status") == "answered"]
    upload_rows = [row_to_dict(item) for item in conn.execute("SELECT * FROM app_uploads WHERE profile_id = ? ORDER BY id DESC LIMIT 24", (profile_id,)).fetchall()]
    visible_uploads = upload_rows if include_private else [item for item in upload_rows if item.get("moderation_status") != "rejected"]
    visibility_mode = sanitize_visibility_mode(row.get("visibility_mode") or ("search" if to_bool(row.get("is_public")) else "private"))
    question_permission = sanitize_question_permission(row.get("question_permission") or ("any" if to_bool(row.get("allow_anonymous_questions")) else "none"))
    feed_post_count = int(conn.execute("SELECT COUNT(*) FROM feed_posts WHERE user_id = ?", (user_id,)).fetchone()[0] or 0)
    follower_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE to_user_id = ?", (user_id,)).fetchone()[0] or 0)
    following_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE from_user_id = ?", (user_id,)).fetchone()[0] or 0)
    answered_count = len([item for item in question_rows if item.get("status") == "answered"])
    pending_count = len([item for item in question_rows if item.get("status") == "pending"])
    rejected_count = len([item for item in question_rows if item.get("status") == "rejected"])
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "slug": row["slug"],
        "display_name": row.get("display_name") or row.get("title") or "",
        "gender": row.get("gender") or "",
        "birth_year": row.get("birth_year") or "",
        "feed_profile_public": to_bool(row.get("feed_profile_public")),
        "profile_image_url": row.get("profile_image_url") or "",
        "cover_image_url": row.get("cover_image_url") or "",
        "headline": row.get("headline") or "",
        "bio": row.get("bio") or "",
        "location": row.get("location") or "",
        "current_work": row.get("current_work") or "",
        "industry_category": row.get("industry_category") or "",
        "is_public": profile_publicly_visible({"visibility_mode": visibility_mode}),
        "allow_anonymous_questions": question_permission == "any",
        "theme_color": row.get("theme_color") or "#3b82f6",
        "visibility_mode": visibility_mode,
        "question_permission": question_permission,
        "search_engine_indexing": visibility_mode == "search",
        "report_count": int(row.get("report_count") or 0),
        "auto_private_reason": row.get("auto_private_reason") or "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "careers": careers,
        "introductions": intros,
        "links": links,
        "qrs": qrs,
        "questions": [serialize_question(item) for item in question_rows],
        "uploads": [serialize_upload(item) for item in visible_uploads],
        "account_type": row.get("account_type") or 'personal',
        "brand_verified": to_bool(row.get("brand_verified")),
        "verification_badge_text": row.get("verification_badge_text") or ('브랜드 인증' if to_bool(row.get("brand_verified")) else ''),
        "stats": {
            "feed_post_count": feed_post_count,
            "answered_count": answered_count,
            "pending_count": pending_count,
            "rejected_count": rejected_count,
            "follower_count": follower_count,
            "following_count": following_count,
        },
    }


def user_plan_dict(user: dict, used_storage_bytes: int = 0, chat_media_used_bytes: int = 0) -> dict:
    allowed_profiles = get_allowed_profile_count(user)
    storage_limit = get_storage_limit_bytes(user)
    chat_media_limit = int(user.get("chat_media_quota_bytes") or CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES)
    return {
        "free_profile_limit": FREE_PROFILE_LIMIT,
        "allowed_profile_count": allowed_profiles,
        "extra_profile_slots": int(user.get("extra_profile_slots") or 0),
        "recommended_extra_profile_price_krw": RECOMMENDED_EXTRA_PROFILE_PRICE_KRW,
        "recommended_extra_profile_bundle_price_krw": RECOMMENDED_EXTRA_PROFILE_BUNDLE_KRW,
        "storage_limit_bytes": storage_limit,
        "storage_limit_gb": round(storage_limit / 1024 / 1024 / 1024, 2),
        "used_storage_bytes": used_storage_bytes,
        "used_storage_mb": round(used_storage_bytes / 1024 / 1024, 2),
        "daily_video_limit_bytes": DAILY_VIDEO_LIMIT_BYTES,
        "daily_video_limit_mb": round(DAILY_VIDEO_LIMIT_BYTES / 1024 / 1024, 2),
        "media_strategy": "텍스트 중심 프로필 + 사진 보조 + 100MB/일 영상 제한",
        "chat_media_limit_bytes": chat_media_limit,
        "chat_media_limit_mb": round(chat_media_limit / 1024 / 1024, 2),
        "chat_media_used_bytes": chat_media_used_bytes,
        "chat_media_used_mb": round(chat_media_used_bytes / 1024 / 1024, 2),
        "account_status": str(user.get("account_status") or "active"),
        "warning_count": int(user.get("warning_count") or 0),
        "phone_verified": bool(user.get("phone_verified_at")),
        "phone_masked": mask_phone(user.get("phone") or ""),
    }


def get_user_storage_usage(conn, user_id: int) -> dict:
    total = int(conn.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM app_uploads WHERE user_id = ?", (user_id,)).fetchone()[0] or 0)
    day_prefix = datetime.now(timezone.utc).date().isoformat()
    daily_video = int(
        conn.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM app_uploads WHERE user_id = ? AND media_kind = 'video' AND created_at LIKE ?",
            (user_id, f"{day_prefix}%"),
        ).fetchone()[0]
        or 0
    )
    return {"total_bytes": total, "daily_video_bytes": daily_video}


def get_user_chat_media_usage(conn, user_id: int) -> dict:
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    used = int(conn.execute("SELECT COALESCE(SUM(attachment_size_bytes), 0) FROM dm_messages WHERE sender_id = ? AND attachment_size_bytes > 0 AND created_at LIKE ?", (user_id, f"{month_prefix}%")).fetchone()[0] or 0)
    return {"monthly_bytes": used, "month_prefix": month_prefix}

def escape_html(value: str) -> str:
    return (value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', '&quot;')


def client_fingerprint(request: Request | None, user: dict | None) -> str:
    if user and user.get("id"):
        return f"user:{user['id']}"
    base = client_ip(request)
    ua = request.headers.get("user-agent", "")[:120] if request else ""
    return "anon:" + hashlib.sha256(f"{base}|{ua}".encode("utf-8")).hexdigest()[:24]


def normalize_user_text(value: str) -> str:
    lowered = re.sub(r"\s+", " ", (value or "").strip().lower())
    return lowered[:300]


def contains_spam_keyword(value: str) -> bool:
    normalized = normalize_user_text(value)
    return any(keyword.lower() in normalized for keyword in settings.spam_block_keywords)


def record_abuse_event(conn, fingerprint: str, event_type: str, target_type: str = "", target_id: int = 0, normalized_text: str = "") -> None:
    conn.execute(
        "INSERT INTO app_abuse_events(fingerprint, event_type, target_type, target_id, normalized_text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (fingerprint, event_type, target_type, target_id, normalized_text[:300], utcnow()),
    )


def count_recent_events(conn, fingerprint: str, event_type: str, since_iso: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM app_abuse_events WHERE fingerprint = ? AND event_type = ? AND created_at >= ?",
        (fingerprint, event_type, since_iso),
    ).fetchone()
    return int((row[0] if row else 0) or 0)


def enforce_text_safety(conn, *, request: Request | None, user: dict | None, event_type: str, target_type: str, target_id: int, text_value: str, min_length: int, burst_limit: int, day_limit: int) -> str:
    normalized = normalize_user_text(text_value)
    if len(normalized) < min_length:
        raise HTTPException(status_code=400, detail="입력 내용이 너무 짧습니다.")
    if contains_spam_keyword(normalized):
        raise HTTPException(status_code=400, detail="광고성/외부유도성 문구는 등록할 수 없습니다.")
    fingerprint = client_fingerprint(request, user)
    now = datetime.now(timezone.utc)
    recent_15m = count_recent_events(conn, fingerprint, event_type, (now - timedelta(minutes=15)).replace(microsecond=0).isoformat())
    if recent_15m >= burst_limit:
        raise HTTPException(status_code=429, detail="잠시 후 다시 시도해 주세요. 등록 빈도가 너무 높습니다.")
    recent_day = count_recent_events(conn, fingerprint, event_type, (now - timedelta(days=1)).replace(microsecond=0).isoformat())
    if recent_day >= day_limit:
        raise HTTPException(status_code=429, detail="오늘 허용된 등록 횟수를 초과했습니다.")
    dup_since = (now - timedelta(minutes=settings.duplicate_text_window_minutes)).replace(microsecond=0).isoformat()
    dup = conn.execute(
        "SELECT id FROM app_abuse_events WHERE fingerprint = ? AND event_type = ? AND target_type = ? AND target_id = ? AND normalized_text = ? AND created_at >= ? LIMIT 1",
        (fingerprint, event_type, target_type, target_id, normalized, dup_since),
    ).fetchone()
    if dup:
        raise HTTPException(status_code=409, detail="같은 내용이 이미 최근에 접수되었습니다.")
    return normalized


def log_moderation_note(conn, target_type: str, target_id: int, note: str) -> None:
    admin_row = conn.execute("SELECT id FROM users WHERE role = 'admin' OR grade <= 1 ORDER BY id ASC LIMIT 1").fetchone()
    if admin_row:
        conn.execute(
            "INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)",
            (int(admin_row[0]), target_type, target_id, note[:1000], utcnow()),
        )


def auto_moderate_after_report(conn, target_type: str, target_id: int) -> None:
    if target_type == "question":
        count = int(conn.execute("SELECT reporter_count FROM app_questions WHERE id = ?", (target_id,)).fetchone()[0] or 0)
        if count >= AUTO_HIDE_QUESTION_REPORT_THRESHOLD:
            conn.execute("UPDATE app_questions SET is_hidden = 1, status = 'hidden' WHERE id = ?", (target_id,))
            log_moderation_note(conn, "question", target_id, f"자동 숨김: 신고 {count}회 이상 누적")
    elif target_type == "upload":
        count = int(conn.execute("SELECT report_count FROM app_uploads WHERE id = ?", (target_id,)).fetchone()[0] or 0)
        if count >= AUTO_FLAG_UPLOAD_REPORT_THRESHOLD:
            conn.execute("UPDATE app_uploads SET moderation_status = 'pending', moderation_note = ? WHERE id = ?", (f"자동 검수 대기: 신고 {count}회 누적", target_id))
            log_moderation_note(conn, "upload", target_id, f"자동 검수 대기: 신고 {count}회 이상 누적")
    elif target_type == "profile":
        count = int(conn.execute("SELECT report_count FROM app_profiles WHERE id = ?", (target_id,)).fetchone()[0] or 0)
        if count >= AUTO_PRIVATE_PROFILE_REPORT_THRESHOLD:
            conn.execute("UPDATE app_profiles SET visibility_mode = 'private', auto_private_reason = ? WHERE id = ?", (f"자동 비공개 전환: 신고 {count}회 누적", target_id))
            log_moderation_note(conn, "profile", target_id, f"자동 비공개 전환: 신고 {count}회 이상 누적")


def build_profile_seo_payload(profile: dict, owner: dict | None = None) -> dict:
    owner_name = (owner or {}).get("nickname") or "사용자"
    title = (profile.get("title") or owner_name or "공개 프로필").strip()
    headline = (profile.get("headline") or "").strip()
    bio = re.sub(r"\s+", " ", (profile.get("bio") or "").strip())
    description_parts = [part for part in [headline, bio[:120]] if part]
    description = " · ".join(description_parts)[:150] or f"{owner_name}님의 경력과 자기소개를 볼 수 있는 공개 프로필입니다."
    public_url = f"{settings.app_public_url.rstrip('/')}/p/{profile['slug']}"
    share_url = f"{settings.api_public_url.rstrip('/')}/share/p/{profile['slug']}"
    og_image_url = profile.get("cover_image_url") or profile.get("profile_image_url") or ""
    if not og_image_url:
        uploads = profile.get("uploads") or []
        if uploads:
            og_image_url = uploads[0].get("preview_url") or uploads[0].get("url") or ""
    return {
        "title": f"{title} | historyprofile_app",
        "description": description,
        "canonical_url": public_url,
        "share_url": share_url,
        "og_image_url": og_image_url,
    }


def render_public_profile_share_html(profile: dict, owner: dict | None = None) -> str:
    seo = build_profile_seo_payload(profile, owner)
    og_image = escape_html(seo["og_image_url"])
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@type": "Person",
        "name": owner.get("nickname") if owner else profile.get("title"),
        "description": seo["description"],
        "url": seo["canonical_url"],
        "image": seo["og_image_url"],
    }, ensure_ascii=False)
    return f"""<!doctype html>
<html lang=\"ko\">
  <head>
    <meta charset=\"utf-8\" />
    <title>{escape_html(seo['title'])}</title>
    <meta name=\"description\" content=\"{escape_html(seo['description'])}\" />
    <meta name=\"robots\" content=\"{'index,follow' if profile.get('search_engine_indexing') else 'noindex,nofollow'}\" />
    <link rel=\"canonical\" href=\"{escape_html(seo['canonical_url'])}\" />
    <meta property=\"og:type\" content=\"profile\" />
    <meta property=\"og:title\" content=\"{escape_html(seo['title'])}\" />
    <meta property=\"og:description\" content=\"{escape_html(seo['description'])}\" />
    <meta property=\"og:url\" content=\"{escape_html(seo['canonical_url'])}\" />
    {f'<meta property=\"og:image\" content=\"{og_image}\" />' if og_image else ''}
    <meta name=\"twitter:card\" content=\"summary_large_image\" />
    <meta name=\"twitter:title\" content=\"{escape_html(seo['title'])}\" />
    <meta name=\"twitter:description\" content=\"{escape_html(seo['description'])}\" />
    {f'<meta name=\"twitter:image\" content=\"{og_image}\" />' if og_image else ''}
    <script type=\"application/ld+json\">{json_ld}</script>
    <meta http-equiv=\"refresh\" content=\"0; url={escape_html(seo['canonical_url'])}\" />
  </head>
  <body>
    <p><a href=\"{escape_html(seo['canonical_url'])}\">공개 프로필 열기</a></p>
  </body>
</html>"""




def render_public_profile_full_html(profile: dict, owner: dict | None = None) -> str:
    seo = build_profile_seo_payload(profile, owner)
    og_image = escape_html(seo["og_image_url"])
    careers_html = ''.join([f"<li><strong>{escape_html(item.get('title',''))}</strong><div>{escape_html(item.get('one_line',''))}</div></li>" for item in profile.get('careers', [])[:12]])
    links_html = ''.join([f'<li><a href="{escape_html(item.get("original_url",""))}" target="_blank" rel="noreferrer">{escape_html(item.get("title") or item.get("social_label") or "링크")}</a></li>' for item in profile.get("links", [])[:12]])
    robots = "index,follow" if profile.get("search_engine_indexing") else "noindex,nofollow"
    og_image_tag = f'<meta property="og:image" content="{og_image}" />' if og_image else ""
    twitter_image_tag = f'<meta name="twitter:image" content="{og_image}" />' if og_image else ""
    json_ld = json.dumps({"@context": "https://schema.org", "@type": "Person", "name": owner.get("nickname") if owner else profile.get("title"), "description": seo["description"], "url": seo["canonical_url"], "image": seo["og_image_url"]}, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{escape_html(seo['title'])}</title>
<meta name="description" content="{escape_html(seo['description'])}"/>
<meta name="robots" content="{robots}"/>
<link rel="canonical" href="{escape_html(seo['canonical_url'])}"/>
<meta property="og:type" content="profile"/>
<meta property="og:title" content="{escape_html(seo['title'])}"/>
<meta property="og:description" content="{escape_html(seo['description'])}"/>
<meta property="og:url" content="{escape_html(seo['canonical_url'])}"/>
{og_image_tag}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="{escape_html(seo['title'])}"/>
<meta name="twitter:description" content="{escape_html(seo['description'])}"/>
{twitter_image_tag}
<script type="application/ld+json">{json_ld}</script>
<style>body{{font-family:Arial,sans-serif;background:#f5f7fb;color:#111;margin:0}}main{{max-width:900px;margin:0 auto;padding:24px}}section{{background:#fff;border:1px solid #d9e0ef;border-radius:18px;padding:20px;margin-bottom:16px}}h1{{margin:0 0 8px}}.meta{{color:#475569}}ul{{padding-left:18px}}a{{color:#2563eb;text-decoration:none}}.chips span{{display:inline-block;border:1px solid #cbd5e1;border-radius:999px;padding:6px 10px;margin:4px 6px 0 0;font-size:13px}}</style>
</head>
<body>
<main>
<section><h1>{escape_html(profile.get('title',''))}</h1><div class="meta">{escape_html(profile.get('headline',''))}</div><p>{escape_html(profile.get('bio',''))}</p><div class="chips"><span>{escape_html(profile.get('current_work','직무 미입력'))}</span><span>{escape_html(profile.get('industry_category','업종 미입력'))}</span><span>{escape_html(profile.get('location','지역 미입력'))}</span></div><p><a href="{escape_html(seo['canonical_url'])}">앱 프로필로 이동</a></p></section>
<section><h2>한줄 경력</h2><ul>{careers_html or '<li>등록된 경력이 없습니다.</li>'}</ul></section>
<section><h2>링크 허브</h2><ul>{links_html or '<li>등록된 링크가 없습니다.</li>'}</ul></section>
</main>
</body>
</html>"""


def write_public_profile_static_snapshot(profile: dict, owner: dict | None = None) -> str:
    slug = (profile.get("slug") or "").strip()
    if not slug:
        return ""
    out = STATIC_PROFILE_DIR / f"{slug}.html"
    out.write_text(render_public_profile_full_html(profile, owner), encoding="utf-8")
    return f"/static/public_profiles/{slug}.html"


def update_public_profile_snapshot(conn, slug: str) -> str:
    if not slug:
        return ""
    row = conn.execute("SELECT * FROM app_profiles WHERE slug = ? LIMIT 1", (slug,)).fetchone()
    if not row:
        return ""
    profile_row = row_to_dict(row)
    profile = serialize_profile(conn, profile_row, include_private=False if profile_publicly_visible(profile_row) else True)
    owner = conn.execute("SELECT * FROM users WHERE id = ?", (profile["user_id"],)).fetchone()
    owner_public = user_public_dict(owner) if owner else None
    return write_public_profile_static_snapshot(profile, owner_public)


@app.on_event("startup")
def on_startup() -> None:
    STARTUP_STATE["started_at"] = utcnow()
    STARTUP_STATE["db_ready"] = False
    STARTUP_STATE["startup_error"] = ""
    try:
        init_db()
        with get_conn() as conn:
            ensure_profile_tables(conn)
            ensure_demo_accounts(conn)
            for phone in RESETTABLE_SIGNUP_PHONES:
                release_signup_phone(conn, phone)
            users = [row_to_dict(item) for item in conn.execute("SELECT id, nickname FROM users ORDER BY id").fetchall()]
            for item in users:
                create_default_profile(conn, int(item["id"]), item.get("nickname") or f"user-{item['id']}")
            with suppress(Exception):
                for p in [row_to_dict(r) for r in conn.execute("SELECT slug FROM app_profiles WHERE COALESCE(slug, '') <> ''").fetchall()]:
                    update_public_profile_snapshot(conn, p.get("slug") or "")
        STARTUP_STATE["db_ready"] = True
        logger.info("started db_engine=%s db=%s", DB_ENGINE, DB_LABEL)
    except Exception as exc:
        STARTUP_STATE["startup_error"] = f"{exc.__class__.__name__}: {exc}"
        logger.exception("startup failed db_engine=%s db=%s", DB_ENGINE, DB_LABEL)


@app.get("/")
def root_health():
    return {
        "ok": True,
        "app": "historyprofile_app",
        "db_engine": DB_ENGINE,
        "db_ready": STARTUP_STATE.get("db_ready", False),
        "startup_error": STARTUP_STATE.get("startup_error", ""),
    }


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "app": "historyprofile_app",
        "db_engine": DB_ENGINE,
        "db_ready": STARTUP_STATE.get("db_ready", False),
        "startup_error": STARTUP_STATE.get("startup_error", ""),
    }


@app.get("/api/health")
def api_health():
    return healthz()


@app.post("/api/auth/phone/request-code")
def request_phone_code(payload: PhoneCodeRequestIn, request: Request):
    verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    phone = normalize_phone(payload.phone)
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="휴대폰 번호를 정확히 입력해주세요.")
    now_dt = utcnow_datetime()
    code = f"{random.randint(0, 999999):06d}"
    verification_token = hashlib.sha256(f"{phone}|{code}|{now_dt.isoformat()}|{random.random()}".encode("utf-8")).hexdigest()[:32]
    expires_at = (now_dt + timedelta(minutes=PHONE_CODE_EXPIRE_MINUTES)).isoformat()
    with get_conn() as conn:
        formatted = format_phone(phone)
        conn.execute("DELETE FROM app_phone_verifications WHERE phone = ? OR phone = ?", (phone, formatted))
        conn.execute("INSERT INTO app_phone_verifications(phone, code, verification_token, is_verified, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)", (phone, code, verification_token, now_dt.isoformat(), expires_at))
    provider = send_sms_verification_code(phone, code, normalize_phone)
    return {"ok": True, "expires_in_minutes": PHONE_CODE_EXPIRE_MINUTES, "verification_token": verification_token, "debug_code": code if provider.get("provider") == "demo" else "", "provider": provider.get("provider"), "sms_status": provider.get("status")}


@app.post("/api/auth/phone/verify-code")
def verify_phone_code(payload: PhoneCodeVerifyIn, request: Request):
    verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    phone = normalize_phone(payload.phone)
    code = (payload.code or "").strip()
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="휴대폰 번호를 정확히 입력해주세요.")
    if not code:
        raise HTTPException(status_code=400, detail="인증번호를 입력해주세요.")
    with get_conn() as conn:
        formatted = format_phone(phone)
        row = conn.execute("SELECT * FROM app_phone_verifications WHERE (phone = ? OR phone = ?) AND code = ? ORDER BY id DESC LIMIT 1", (phone, formatted, code)).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="인증번호가 올바르지 않습니다.")
        item = row_to_dict(row)
        expires_at = parse_iso_datetime(item.get("expires_at"))
        if expires_at and expires_at < utcnow_datetime():
            raise HTTPException(status_code=400, detail="인증번호가 만료되었습니다. 다시 요청해주세요.")
        if not verify_sms_code_provider(phone, code, normalize_phone):
            raise HTTPException(status_code=400, detail="SMS 인증 확인에 실패했습니다. 다시 시도해주세요.")
        conn.execute("UPDATE app_phone_verifications SET is_verified = 1 WHERE id = ?", (item["id"],))
        return {"ok": True, "verification_token": item["verification_token"], "phone_masked": mask_phone(phone)}


@app.post("/api/auth/signup")
def signup(payload: SignupIn, request: Request):
    verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    email = payload.email.strip().lower()
    recovery_email = payload.recovery_email.strip().lower()
    nickname = payload.nickname.strip() or (email.split("@")[0] if "@" in email else email)
    phone = normalize_phone(payload.phone)
    if len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="비밀번호는 4자 이상이어야 합니다.")
    if len(phone) < 10:
        raise HTTPException(status_code=400, detail="휴대폰 번호 인증이 필요합니다.")
    with get_conn() as conn:
        verification = conn.execute("SELECT * FROM app_phone_verifications WHERE phone = ? AND verification_token = ? AND is_verified = 1 ORDER BY id DESC LIMIT 1", (phone, payload.phone_verification_token)).fetchone()
        if not verification:
            raise HTTPException(status_code=400, detail="휴대폰 인증을 완료해주세요.")
        existing = conn.execute("SELECT id FROM users WHERE email = ? LIMIT 1", (email,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="이미 사용 중인 아이디입니다.")
        existing_phone = conn.execute("SELECT id FROM users WHERE phone = ? AND COALESCE(phone, '') <> '' LIMIT 1", (format_phone(phone),)).fetchone()
        if existing_phone:
            raise HTTPException(status_code=409, detail="이미 가입에 사용된 연락처입니다. 연락처 1개당 계정 1개만 생성할 수 있습니다.")
        now = utcnow()
        conn.execute(
            "INSERT INTO users(email, recovery_email, password_hash, nickname, phone, role, grade, created_at, extra_profile_slots, storage_quota_override_bytes, phone_verified_at, account_status, warning_count, suspended_reason, last_warning_at, chat_media_quota_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (email, recovery_email, hash_password(payload.password), nickname, format_phone(phone), "user", 6, now, 0, 0, now, "active", 0, "", "", CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES),
        )
        user_row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        user = row_to_dict(user_row)
        with suppress(Exception):
            unique_id = generate_account_unique_id(conn, email, user["id"])
            conn.execute("UPDATE users SET account_unique_id = ? WHERE id = ?", (unique_id, user["id"]))
            user = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        conn.execute("DELETE FROM app_phone_verifications WHERE phone = ? OR phone = ?", (phone, format_phone(phone)))
        create_default_profile(conn, int(user["id"]), nickname)
        token = make_token()
        conn.execute("INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)", (token, user["id"], now))
        return {"token": token, "access_token": token, "user": user_public_dict(user)}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request):
    verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    email = payload.email.strip().lower()
    demo_specs = {item["email"]: item for item in DEMO_ACCOUNTS}
    with get_conn() as conn:
        if email in demo_specs:
            ensure_demo_accounts(conn)
        row = conn.execute("SELECT * FROM users WHERE email = ? LIMIT 1", (email,)).fetchone()
        if email in demo_specs:
            spec = demo_specs[email]
            if payload.password == spec["password"]:
                if not row:
                    ensure_demo_accounts(conn)
                    row = conn.execute("SELECT * FROM users WHERE email = ? LIMIT 1", (email,)).fetchone()
                if row and row["password_hash"] != hash_password(spec["password"]):
                    conn.execute("UPDATE users SET password_hash = ?, approved = 1, account_status = 'active', suspended_reason = '', warning_count = 0 WHERE id = ?", (hash_password(spec["password"]), row["id"]))
                    row = conn.execute("SELECT * FROM users WHERE email = ? LIMIT 1", (email,)).fetchone()
        if not row or row["password_hash"] != hash_password(payload.password):
            raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
        user = row_to_dict(row)
        ensure_active_account(user)
        token = make_token()
        conn.execute("INSERT INTO auth_tokens(token, user_id, created_at) VALUES (?, ?, ?)", (token, row["id"], utcnow()))
        return {"token": token, "access_token": token, "user": user_public_dict(row)}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    with get_conn() as conn:
        row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        usage = get_user_storage_usage(conn, row["id"])
        chat_usage = get_user_chat_media_usage(conn, row["id"])
        return {"user": user_public_dict(row), "plan": user_plan_dict(row, usage["total_bytes"], chat_usage["monthly_bytes"])}


@app.get("/api/plan")
def plan_info(user=Depends(current_user)):
    with get_conn() as conn:
        row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        usage = get_user_storage_usage(conn, row["id"])
        chat_usage = get_user_chat_media_usage(conn, row["id"])
        return {"plan": user_plan_dict(row, usage["total_bytes"], chat_usage["monthly_bytes"]), "usage": {**usage, **chat_usage}}


@app.post("/api/uploads/file")
def upload_file(
    category: str = Query(default="general"),
    profile_id: int | None = Query(default=None),
    file: UploadFile = File(...),
    user=Depends(current_user),
):
    content_type = (file.content_type or "").lower()
    media_kind = media_kind_from_content_type(content_type)
    max_bytes = MAX_VIDEO_UPLOAD_BYTES if media_kind == "video" else MAX_IMAGE_UPLOAD_BYTES
    with get_conn() as conn:
        if profile_id:
            profile_owner_or_404(conn, profile_id, user["id"])
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        usage = get_user_storage_usage(conn, user["id"])
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size > max_bytes:
            limit_mb = round(max_bytes / 1024 / 1024)
            raise HTTPException(status_code=400, detail=f"단일 업로드 최대 용량은 {limit_mb}MB 입니다.")
        if usage["total_bytes"] + size > get_storage_limit_bytes(user_row):
            raise HTTPException(status_code=400, detail="계정 전체 업로드 한도 1GB를 초과합니다. 추가 용량 플랜이 필요합니다.")
        if media_kind == "video" and usage["daily_video_bytes"] + size > DAILY_VIDEO_LIMIT_BYTES:
            raise HTTPException(status_code=400, detail="영상 업로드는 계정당 하루 총 100MB까지 가능합니다.")
        try:
            uploaded = save_upload(file, category=category, max_bytes=max_bytes)
        except StorageError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        now = utcnow()
        moderation_status = "approved" if media_kind in {"image", "file"} else "pending"
        moderation_note = "자동 승인: 이미지" if media_kind == "image" else ("자동 승인: 문서/일반 파일" if media_kind == "file" else "자동 검수 대기: 영상")
        conn.execute(
            """
            INSERT INTO app_uploads(user_id, profile_id, category, media_kind, key, url, preview_key, preview_url, content_type, name, size_bytes, moderation_status, moderation_note, created_at, report_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user["id"], profile_id, category, media_kind, uploaded["key"], uploaded["url"], uploaded.get("preview_key", ""), uploaded.get("preview_url", ""), uploaded["content_type"], uploaded["name"], uploaded["size"], moderation_status, moderation_note, now, 0),
        )
        usage_after = get_user_storage_usage(conn, user["id"])
        chat_usage = get_user_chat_media_usage(conn, user["id"])
        row = row_to_dict(conn.execute("SELECT * FROM app_uploads WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user["id"],)).fetchone())
        return {"item": serialize_upload(row), "usage": usage_after, "plan": user_plan_dict(user_row, usage_after["total_bytes"], chat_usage["monthly_bytes"]), **uploaded}


@app.get("/uploads/{path:path}")
def local_uploads(path: str):
    file_path = settings.upload_root / path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(file_path)


@app.get("/api/home")
def home(user=Depends(current_user)):
    with get_conn() as conn:
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        profiles = [serialize_profile(conn, row_to_dict(item), include_private=True) for item in conn.execute("SELECT * FROM app_profiles WHERE user_id = ? ORDER BY id ASC", (user["id"],)).fetchall()]
        question_count = conn.execute("SELECT COUNT(*) AS c FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE p.user_id = ?", (user["id"],)).fetchone()[0]
        chat_count = conn.execute("SELECT COUNT(*) AS c FROM dm_messages WHERE sender_id = ?", (user["id"],)).fetchone()[0]
        career_count = conn.execute("SELECT COUNT(*) AS c FROM app_careers c JOIN app_profiles p ON p.id = c.profile_id WHERE p.user_id = ?", (user["id"],)).fetchone()[0]
        usage = get_user_storage_usage(conn, user["id"])
        chat_usage = get_user_chat_media_usage(conn, user["id"])
        return {
            "profiles": profiles,
            "summary": {
                "profile_count": len(profiles),
                "career_count": int(career_count),
                "question_count": int(question_count),
                "chat_count": int(chat_count),
                "storage_used_mb": round(usage["total_bytes"] / 1024 / 1024, 2),
                "daily_video_used_mb": round(usage["daily_video_bytes"] / 1024 / 1024, 2),
            },
            "plan": user_plan_dict(user_row, usage["total_bytes"], chat_usage["monthly_bytes"]),
        }


@app.get("/api/search")
def search(q: str = Query(default=""), user=Depends(current_user)):
    keyword = q.strip()
    query = f"%{keyword}%"
    with get_conn() as conn:
        people = [
            {"id": row["id"], "nickname": row["nickname"], "email": row["email"], "photo_url": row.get("photo_url") or ""}
            for row in conn.execute(
                "SELECT id, nickname, email, photo_url FROM users WHERE id <> ? AND (nickname LIKE ? OR email LIKE ?) ORDER BY id DESC LIMIT 10",
                (user["id"], query, query),
            ).fetchall()
            if not either_side_blocked(conn, user["id"], row["id"])
        ]
        profiles = [
            {
                "id": row["id"],
                "title": row["title"],
                "slug": row["slug"],
                "headline": row["headline"],
                "current_work": row.get("current_work") or "",
                "industry_category": row.get("industry_category") or "",
                "visibility_mode": row.get("visibility_mode") or "link_only",
            }
            for row in map(
                row_to_dict,
                conn.execute(
                    """
                    SELECT id, title, slug, headline, current_work, industry_category, visibility_mode
                    FROM app_profiles
                    WHERE visibility_mode = 'search'
                      AND (title LIKE ? OR headline LIKE ? OR current_work LIKE ? OR industry_category LIKE ? OR bio LIKE ?)
                    ORDER BY id DESC LIMIT 20
                    """,
                    (query, query, query, query, query),
                ).fetchall()
            )
        ]
        careers = [
            {"id": row["id"], "profile_id": row["profile_id"], "title": row["title"], "one_line": row["one_line"]}
            for row in conn.execute(
                """
                SELECT c.id, c.profile_id, c.title, c.one_line
                FROM app_careers c
                JOIN app_profiles p ON p.id = c.profile_id
                WHERE p.visibility_mode = 'search' AND (c.title LIKE ? OR c.one_line LIKE ? OR c.description LIKE ? OR c.role_name LIKE ?)
                ORDER BY c.id DESC LIMIT 20
                """,
                (query, query, query, query),
            ).fetchall()
        ]
        categories = [item[0] for item in conn.execute(
            """
            SELECT DISTINCT industry_category
            FROM app_profiles
            WHERE visibility_mode = 'search' AND industry_category <> '' AND industry_category LIKE ?
            ORDER BY industry_category ASC LIMIT 15
            """,
            (query,),
        ).fetchall()]
        return {"people": people, "profiles": profiles, "careers": careers, "categories": categories}


@app.get("/api/friends")
def friends(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, nickname, email, photo_url, one_liner FROM users WHERE id <> ? ORDER BY id DESC LIMIT 50",
            (user["id"],),
        ).fetchall()
        items = []
        for row in rows:
            item = row_to_dict(row)
            if either_side_blocked(conn, user["id"], item["id"]):
                continue
            profile = conn.execute("SELECT slug, title FROM app_profiles WHERE user_id = ? ORDER BY id ASC LIMIT 1", (item["id"],)).fetchone()
            block = user_blocks_other(conn, user["id"], item["id"])
            items.append({
                **item,
                "primary_profile_slug": profile["slug"] if profile else "",
                "primary_profile_title": profile["title"] if profile else "",
                "is_blocked": block,
            })
        return {"items": items}


@app.post("/api/blocks/{blocked_user_id}")
def create_block(blocked_user_id: int, request: Request, reason: str = Query(default=""), user=Depends(current_user)):
    if int(blocked_user_id) == int(user["id"]):
        raise HTTPException(status_code=400, detail="본인은 차단할 수 없습니다.")
    with get_conn() as conn:
        normalized = enforce_text_safety(conn, request=request, user=user, event_type="block_create", target_type="user", target_id=blocked_user_id, text_value=reason or "차단", min_length=1, burst_limit=10, day_limit=50)
        record_abuse_event(conn, client_fingerprint(request, user), "block_create", "user", blocked_user_id, normalized)
        conn.execute(
            "INSERT OR IGNORE INTO app_blocks(blocker_user_id, blocked_user_id, reason, created_at) VALUES (?, ?, ?, ?)",
            (user["id"], blocked_user_id, reason[:200], utcnow()),
        )
        return {"ok": True}


@app.delete("/api/blocks/{blocked_user_id}")
def delete_block(blocked_user_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM app_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?", (user["id"], blocked_user_id))
        return {"ok": True}


@app.get("/api/blocks")
def list_blocks(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT b.*, u.nickname, u.email FROM app_blocks b JOIN users u ON u.id = b.blocked_user_id WHERE b.blocker_user_id = ? ORDER BY b.id DESC",
            (user["id"],),
        ).fetchall()
        return {"items": [row_to_dict(row) for row in rows]}


@app.get("/api/chats")
def chats(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT u.id AS user_id, u.nickname, MAX(m.created_at) AS updated_at,
                   COALESCE((SELECT message FROM dm_messages x WHERE x.room_key = CASE WHEN u.id < ? THEN CAST(u.id AS TEXT) || ':' || CAST(? AS TEXT) ELSE CAST(? AS TEXT) || ':' || CAST(u.id AS TEXT) END ORDER BY x.id DESC LIMIT 1), '') AS last_message
            FROM users u
            LEFT JOIN dm_messages m ON m.room_key = CASE WHEN u.id < ? THEN CAST(u.id AS TEXT) || ':' || CAST(? AS TEXT) ELSE CAST(? AS TEXT) || ':' || CAST(u.id AS TEXT) END
            WHERE u.id <> ?
            GROUP BY u.id, u.nickname
            ORDER BY updated_at DESC NULLS LAST, u.id DESC
            LIMIT 50
            """,
            (user["id"], user["id"], user["id"], user["id"], user["id"], user["id"], user["id"]),
        ).fetchall()
        items = [row_to_dict(row) for row in rows if not either_side_blocked(conn, user["id"], row["user_id"])]
        return {"items": items}


@app.get("/api/chats/direct/{other_user_id}/messages")
def dm_messages(other_user_id: int, user=Depends(current_user)):
    room_key = room_key_for(user["id"], other_user_id)
    with get_conn() as conn:
        if either_side_blocked(conn, user["id"], other_user_id):
            raise HTTPException(status_code=403, detail="차단 관계에서는 채팅할 수 없습니다.")
        rows = conn.execute("SELECT * FROM dm_messages WHERE room_key = ? ORDER BY id ASC", (room_key,)).fetchall()
        return {"items": [serialize_dm_message(row_to_dict(row)) for row in rows]}


@app.post("/api/chats/direct/{other_user_id}/messages")
async def dm_send(other_user_id: int, payload: MessageIn, user=Depends(current_user)):
    text = payload.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="메시지를 입력해주세요.")
    room_key = room_key_for(user["id"], other_user_id)
    with get_conn() as conn:
        if either_side_blocked(conn, user["id"], other_user_id):
            raise HTTPException(status_code=403, detail="차단 관계에서는 채팅할 수 없습니다.")
        now = utcnow()
        conn.execute(
            "INSERT INTO dm_messages(room_key, sender_id, message, created_at, message_type, attachment_url, attachment_preview_url, attachment_name, attachment_size_bytes) VALUES (?, ?, ?, ?, 'text', '', '', '', 0)",
            (room_key, user["id"], text, now),
        )
        message_row = serialize_dm_message(row_to_dict(conn.execute("SELECT * FROM dm_messages WHERE room_key = ? ORDER BY id DESC LIMIT 1", (room_key,)).fetchone()))
    await manager.broadcast(room_key, {"type": "message", "item": message_row})
    return {"ok": True, "item": message_row}


@app.post("/api/chats/direct/{other_user_id}/attachments")
def dm_send_attachment(
    other_user_id: int,
    file: UploadFile = File(...),
    user=Depends(current_user),
):
    room_key = room_key_for(user["id"], other_user_id)
    content_type = (file.content_type or "").lower()
    if not (content_type.startswith("image/") or content_type.startswith("video/")):
        raise HTTPException(status_code=400, detail="채팅에는 사진 또는 영상만 전송할 수 있습니다.")
    media_kind = media_kind_from_content_type(content_type)
    max_bytes = MAX_VIDEO_UPLOAD_BYTES if media_kind == "video" else MAX_IMAGE_UPLOAD_BYTES
    with get_conn() as conn:
        if either_side_blocked(conn, user["id"], other_user_id):
            raise HTTPException(status_code=403, detail="차단 관계에서는 채팅할 수 없습니다.")
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        chat_usage = get_user_chat_media_usage(conn, user["id"])
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size > max_bytes:
            raise HTTPException(status_code=400, detail=f"채팅 첨부 단일 파일 최대 용량은 {round(max_bytes / 1024 / 1024)}MB 입니다.")
        chat_limit = int(user_row.get("chat_media_quota_bytes") or CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES)
        if chat_usage["monthly_bytes"] + size > chat_limit:
            raise HTTPException(status_code=400, detail="이번 달 채팅 미디어 전송 한도를 초과했습니다. 추후 유료 미디어 확장팩 연결 예정입니다.")
        uploaded = save_upload(file, category="chat", max_bytes=max_bytes)
        now = utcnow()
        conn.execute(
            "INSERT INTO dm_messages(room_key, sender_id, message, created_at, message_type, attachment_url, attachment_preview_url, attachment_name, attachment_size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (room_key, user["id"], file.filename or media_kind, now, media_kind, uploaded["url"], uploaded.get("preview_url", ""), uploaded.get("name", file.filename or media_kind), uploaded["size"]),
        )
        message_row = serialize_dm_message(row_to_dict(conn.execute("SELECT * FROM dm_messages WHERE room_key = ? ORDER BY id DESC LIMIT 1", (room_key,)).fetchone()))
    return {"ok": True, "item": message_row, "plan_hint": "월간 채팅 미디어 한도 초과 시 추후 유료 확장팩 연결 예정"}


@app.websocket("/ws/chats/{other_user_id}")
async def ws_chat(websocket: WebSocket, other_user_id: int, token: str = Query(default="")):
    if not token:
        await websocket.close(code=4401)
        return
    with get_conn() as conn:
        row = get_user_by_token(conn, token)
        if not row:
            await websocket.close(code=4401)
            return
        user = row_to_dict(row)
        if either_side_blocked(conn, user["id"], other_user_id):
            await websocket.close(code=4403)
            return
    room_key = room_key_for(user["id"], other_user_id)
    await manager.connect(room_key, websocket)
    await websocket.send_json({"type": "ready", "room_key": room_key})
    try:
        while True:
            raw = await websocket.receive_text()
            text = raw.strip()
            if not text:
                continue
            with get_conn() as conn:
                now = utcnow()
                conn.execute(
                    "INSERT INTO dm_messages(room_key, sender_id, message, created_at, message_type, attachment_url, attachment_preview_url, attachment_name, attachment_size_bytes) VALUES (?, ?, ?, ?, 'text', '', '', '', 0)",
                    (room_key, user["id"], text, now),
                )
                message_row = serialize_dm_message(row_to_dict(conn.execute("SELECT * FROM dm_messages WHERE room_key = ? ORDER BY id DESC LIMIT 1", (room_key,)).fetchone()))
            await manager.broadcast(room_key, {"type": "message", "item": message_row})
    except WebSocketDisconnect:
        manager.disconnect(room_key, websocket)


@app.get("/api/profiles")
def get_profiles(user=Depends(current_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM app_profiles WHERE user_id = ? ORDER BY id ASC", (user["id"],)).fetchall()
        return {"items": [serialize_profile(conn, row_to_dict(row), include_private=True) for row in rows]}


@app.post("/api/profiles")
def create_profile(payload: ProfileIn, user=Depends(current_user)):
    visibility_mode = sanitize_visibility_mode(payload.visibility_mode)
    question_permission = sanitize_question_permission(payload.question_permission)
    with get_conn() as conn:
        user_row = row_to_dict(conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone())
        count = int(conn.execute("SELECT COUNT(*) FROM app_profiles WHERE user_id = ?", (user["id"],)).fetchone()[0] or 0)
        allowed = get_allowed_profile_count(user_row)
        if count >= allowed:
            raise HTTPException(status_code=400, detail=f"현재 플랜에서는 프로필을 최대 {allowed}개까지 생성할 수 있습니다. 3개 이상은 결제 플랜이 필요합니다.")
        now = utcnow()
        base_slug = slugify(payload.slug or payload.title or user["nickname"])
        slug = base_slug
        index = 1
        while conn.execute("SELECT id FROM app_profiles WHERE slug = ? LIMIT 1", (slug,)).fetchone():
            index += 1
            slug = f"{base_slug}-{index}"
        conn.execute(
            """
            INSERT INTO app_profiles(user_id, title, slug, display_name, gender, birth_year, feed_profile_public, profile_image_url, cover_image_url, headline, bio, location, current_work, industry_category, is_public, allow_anonymous_questions, theme_color, visibility_mode, question_permission, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user["id"], payload.title.strip(), slug, (payload.display_name or payload.title).strip(), payload.gender.strip(), str(payload.birth_year or '').strip()[:4], 1 if payload.feed_profile_public else 0, payload.profile_image_url, payload.cover_image_url,
                payload.headline, payload.bio, payload.location, payload.current_work, payload.industry_category,
                1 if visibility_mode != "private" else 0,
                1 if question_permission == "any" else 0,
                payload.theme_color, visibility_mode, question_permission, now, now,
            ),
        )
        row = conn.execute("SELECT * FROM app_profiles WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user["id"],)).fetchone()
        if row:
            maybe_award_profile_completion(conn, int(user['id']), int(row['id']))
        return {"item": serialize_profile(conn, row_to_dict(row), include_private=True)}


@app.patch("/api/profiles/{profile_id}")
def update_profile(profile_id: int, payload: ProfileIn, user=Depends(current_user)):
    visibility_mode = sanitize_visibility_mode(payload.visibility_mode)
    question_permission = sanitize_question_permission(payload.question_permission)
    with get_conn() as conn:
        current = profile_owner_or_404(conn, profile_id, user["id"])
        slug = slugify(payload.slug or current["slug"])
        slug_row = conn.execute("SELECT id FROM app_profiles WHERE slug = ? AND id <> ? LIMIT 1", (slug, profile_id)).fetchone()
        if slug_row:
            slug = f"{slug}-{profile_id}"
        conn.execute(
            """
            UPDATE app_profiles
            SET title = ?, slug = ?, display_name = ?, gender = ?, birth_year = ?, feed_profile_public = ?, profile_image_url = ?, cover_image_url = ?, headline = ?, bio = ?, location = ?, current_work = ?, industry_category = ?,
                is_public = ?, allow_anonymous_questions = ?, theme_color = ?, visibility_mode = ?, question_permission = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload.title.strip(), slug, (payload.display_name or payload.title).strip(), payload.gender.strip(), str(payload.birth_year or '').strip()[:4], 1 if payload.feed_profile_public else 0, payload.profile_image_url, payload.cover_image_url, payload.headline,
                payload.bio, payload.location, payload.current_work, payload.industry_category, 1 if visibility_mode != "private" else 0,
                1 if question_permission == "any" else 0, payload.theme_color, visibility_mode, question_permission,
                utcnow(), profile_id,
            ),
        )
        row = conn.execute("SELECT * FROM app_profiles WHERE id = ?", (profile_id,)).fetchone()
        maybe_award_profile_completion(conn, int(user['id']), profile_id)
        return {"item": serialize_profile(conn, row_to_dict(row), include_private=True)}


@app.delete("/api/profiles/{profile_id}")
def delete_profile(profile_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        profile_owner_or_404(conn, profile_id, user["id"])
        count = conn.execute("SELECT COUNT(*) FROM app_profiles WHERE user_id = ?", (user["id"],)).fetchone()[0]
        if int(count) <= 1:
            raise HTTPException(status_code=400, detail="최소 1개의 프로필은 유지해야 합니다.")
        conn.execute("DELETE FROM app_profiles WHERE id = ?", (profile_id,))
        return {"ok": True}


@app.post("/api/profiles/{profile_id}/careers")
def create_career(profile_id: int, payload: CareerIn, user=Depends(current_user)):
    with get_conn() as conn:
        profile_owner_or_404(conn, profile_id, user["id"])
        now = utcnow()
        conn.execute(
            """
            INSERT INTO app_careers(profile_id, title, one_line, period, role_name, description, review_text, image_url, gallery_json, media_items_json, is_public, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                profile_id, payload.title, payload.one_line, payload.period, payload.role_name, payload.description,
                payload.review_text, payload.image_url, json.dumps(payload.gallery_json, ensure_ascii=False),
                json.dumps(payload.media_items, ensure_ascii=False), int(payload.is_public), payload.sort_order, now, now,
            ),
        )
        row = conn.execute("SELECT * FROM app_careers WHERE profile_id = ? ORDER BY id DESC LIMIT 1", (profile_id,)).fetchone()
        return {"item": serialize_career(row_to_dict(row))}


@app.patch("/api/careers/{career_id}")
def update_career(career_id: int, payload: CareerIn, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT c.*, p.user_id FROM app_careers c JOIN app_profiles p ON p.id = c.profile_id WHERE c.id = ?",
            (career_id,),
        ).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="경력을 찾을 수 없습니다.")
        conn.execute(
            """
            UPDATE app_careers
            SET title = ?, one_line = ?, period = ?, role_name = ?, description = ?, review_text = ?, image_url = ?,
                gallery_json = ?, media_items_json = ?, is_public = ?, sort_order = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                payload.title, payload.one_line, payload.period, payload.role_name, payload.description, payload.review_text,
                payload.image_url, json.dumps(payload.gallery_json, ensure_ascii=False), json.dumps(payload.media_items, ensure_ascii=False),
                int(payload.is_public), payload.sort_order, utcnow(), career_id,
            ),
        )
        updated = conn.execute("SELECT * FROM app_careers WHERE id = ?", (career_id,)).fetchone()
        return {"item": serialize_career(row_to_dict(updated))}


@app.delete("/api/careers/{career_id}")
def delete_career(career_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT c.id, p.user_id FROM app_careers c JOIN app_profiles p ON p.id = c.profile_id WHERE c.id = ?", (career_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="경력을 찾을 수 없습니다.")
        conn.execute("DELETE FROM app_careers WHERE id = ?", (career_id,))
        return {"ok": True}


@app.post("/api/profiles/{profile_id}/introductions")
def create_intro(profile_id: int, payload: IntroductionIn, user=Depends(current_user)):
    with get_conn() as conn:
        profile_owner_or_404(conn, profile_id, user["id"])
        now = utcnow()
        conn.execute(
            "INSERT INTO app_introductions(profile_id, title, category, content, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (profile_id, payload.title, payload.category, payload.content, int(payload.is_public), now, now),
        )
        row = conn.execute("SELECT * FROM app_introductions WHERE profile_id = ? ORDER BY id DESC LIMIT 1", (profile_id,)).fetchone()
        return {"item": serialize_intro(row_to_dict(row))}


@app.delete("/api/introductions/{intro_id}")
def delete_intro(intro_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT i.id, p.user_id FROM app_introductions i JOIN app_profiles p ON p.id = i.profile_id WHERE i.id = ?", (intro_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="자기소개서를 찾을 수 없습니다.")
        conn.execute("DELETE FROM app_introductions WHERE id = ?", (intro_id,))
        return {"ok": True}


@app.post("/api/profiles/{profile_id}/links")
def create_link(profile_id: int, payload: LinkIn, user=Depends(current_user)):
    with get_conn() as conn:
        profile_owner_or_404(conn, profile_id, user["id"])
        code = slugify(payload.short_code)[:16] if payload.short_code else new_short_code()
        while conn.execute("SELECT id FROM app_links WHERE short_code = ? LIMIT 1", (code,)).fetchone():
            code = new_short_code()
        now = utcnow()
        conn.execute(
            "INSERT INTO app_links(profile_id, title, original_url, short_code, link_type, is_public, click_count, created_at, updated_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (profile_id, payload.title, payload.original_url, code, payload.link_type, int(payload.is_public), 0, now, now, now),
        )
        row = conn.execute("SELECT * FROM app_links WHERE profile_id = ? ORDER BY id DESC LIMIT 1", (profile_id,)).fetchone()
        return {"item": serialize_link(row_to_dict(row))}


@app.delete("/api/links/{link_id}")
def delete_link(link_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT l.id, p.user_id FROM app_links l JOIN app_profiles p ON p.id = l.profile_id WHERE l.id = ?", (link_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="링크를 찾을 수 없습니다.")
        conn.execute("DELETE FROM app_links WHERE id = ?", (link_id,))
        return {"ok": True}


@app.get("/r/{short_code}")
def short_redirect(short_code: str):
    with get_conn() as conn:
        cleanup_expired_marketing_assets(conn)
        row = conn.execute("SELECT id, original_url, click_count FROM app_links WHERE short_code = ? LIMIT 1", (short_code,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="링크를 찾을 수 없습니다.")
        conn.execute("UPDATE app_links SET click_count = ?, last_accessed_at = ? WHERE id = ?", (int(row["click_count"] or 0) + 1, utcnow(), row["id"]))
        return RedirectResponse(url=row["original_url"], status_code=307)


@app.post("/api/profiles/{profile_id}/qrs")
def create_qr(profile_id: int, payload: QrIn, user=Depends(current_user)):
    with get_conn() as conn:
        profile_owner_or_404(conn, profile_id, user["id"])
        now = utcnow()
        conn.execute(
            "INSERT INTO app_qr_codes(profile_id, title, target_url, is_public, scan_count, created_at, updated_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (profile_id, payload.title, payload.target_url, int(payload.is_public), 0, now, now, now),
        )
        row = conn.execute("SELECT * FROM app_qr_codes WHERE profile_id = ? ORDER BY id DESC LIMIT 1", (profile_id,)).fetchone()
        return {"item": serialize_qr(row_to_dict(row))}


@app.get("/qr/{qr_id}")
def qr_redirect(qr_id: int):
    with get_conn() as conn:
        cleanup_expired_marketing_assets(conn)
        row = conn.execute("SELECT id, target_url, scan_count FROM app_qr_codes WHERE id = ? LIMIT 1", (qr_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="QR 항목을 찾을 수 없습니다.")
        conn.execute("UPDATE app_qr_codes SET scan_count = ?, last_accessed_at = ? WHERE id = ?", (int(row["scan_count"] or 0) + 1, utcnow(), row["id"]))
        return RedirectResponse(url=row["target_url"], status_code=307)

@app.delete("/api/qrs/{qr_id}")
def delete_qr(qr_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.user_id FROM app_qr_codes q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ?", (qr_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="QR 항목을 찾을 수 없습니다.")
        conn.execute("DELETE FROM app_qr_codes WHERE id = ?", (qr_id,))
        return {"ok": True}


@app.get("/api/rewards/summary")
def rewards_summary(user=Depends(current_user)):
    with get_conn() as conn:
        return reward_summary_payload(conn, int(user["id"]))


@app.post("/api/rewards/profile-share")
def rewards_profile_share(payload: RewardActionIn, user=Depends(current_user)):
    profile_id = int(payload.profile_id or 0)
    if not profile_id:
        raise HTTPException(status_code=400, detail="공유할 프로필을 선택해 주세요.")
    with get_conn() as conn:
        profile = conn.execute("SELECT id FROM app_profiles WHERE id = ? AND user_id = ?", (profile_id, user["id"])).fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        today_key = datetime.now().strftime('%Y-%m-%d')
        awarded = award_points(conn, int(user['id']), 'share_profile', source_type='profile', source_id=profile_id, source_key=f'share_profile:{user["id"]}:{profile_id}:{today_key}', description='공개 프로필을 공유해 포인트가 적립되었습니다.')
        summary = reward_summary_payload(conn, int(user['id']))
        return {"ok": True, "awarded": awarded, "summary": summary}


@app.post("/api/rewards/profile-completion-check")
def rewards_profile_completion(payload: RewardActionIn, user=Depends(current_user)):
    profile_id = int(payload.profile_id or 0)
    if not profile_id:
        raise HTTPException(status_code=400, detail="프로필을 선택해 주세요.")
    with get_conn() as conn:
        awarded = maybe_award_profile_completion(conn, int(user['id']), profile_id)
        summary = reward_summary_payload(conn, int(user['id']))
        return {"ok": True, "awarded": awarded, "summary": summary}


@app.post("/api/rewards/withdrawals")
def create_reward_withdrawal(payload: RewardWithdrawalIn, user=Depends(current_user)):
    account_holder = (payload.account_holder or '').strip()
    bank_name = (payload.bank_name or '').strip()
    account_number = re.sub(r'\s+', '', payload.account_number or '')
    if not account_holder or not bank_name or not account_number:
        raise HTTPException(status_code=400, detail="예금주, 은행명, 계좌번호를 모두 입력해 주세요.")
    with get_conn() as conn:
        ensure_reward_tables(conn)
        balance = get_reward_balance(conn, int(user['id']))
        month_count = monthly_withdraw_count(conn, int(user['id']))
        if month_count >= REWARD_MONTHLY_WITHDRAW_LIMIT:
            raise HTTPException(status_code=400, detail="이번 달 출금 신청은 이미 완료되었습니다.")
        if balance['available'] < REWARD_MIN_WITHDRAW_POINTS:
            raise HTTPException(status_code=400, detail=f"최소 출금 가능 포인트는 {REWARD_MIN_WITHDRAW_POINTS:,}P 입니다.")
        conn.execute(
            "INSERT INTO app_withdrawal_requests(user_id, points_amount, cash_amount, status, account_holder, bank_name, account_number, note, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
            (int(user['id']), REWARD_MIN_WITHDRAW_POINTS, REWARD_MIN_WITHDRAW_POINTS, account_holder[:40], bank_name[:40], account_number[:60], (payload.note or '').strip()[:200], utcnow()),
        )
        return {"ok": True, "summary": reward_summary_payload(conn, int(user['id']))}


@app.get("/api/profiles/{profile_id}/questions")
def questions(profile_id: int, status: str = Query("all"), user=Depends(current_user_optional)):
    with get_conn() as conn:
        profile = conn.execute("SELECT * FROM app_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        profile_dict = row_to_dict(profile)
        is_owner = bool(user and int(profile_dict.get("user_id") or 0) == int(user.get("id") or 0))
        if not is_owner and not profile_publicly_visible(profile_dict):
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        where = ["profile_id = ?", "COALESCE(deleted_at, '') = ''"]
        params = [profile_id]
        if status == "feed":
            where.append("status = 'answered'")
        elif status == "new":
            where.append("status = 'pending'")
        elif status == "rejected":
            where.append("status = 'rejected'")
        rows = conn.execute(f"SELECT * FROM app_questions WHERE {' AND '.join(where)} ORDER BY id DESC", tuple(params)).fetchall()
        return {"items": [serialize_question(row_to_dict(row)) for row in rows], "is_owner": is_owner}


@app.post("/api/profiles/{profile_id}/questions")
def ask_question(profile_id: int, payload: QuestionAskIn, request: Request, user=Depends(current_user_optional)):
    if not user:
        verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    with get_conn() as conn:
        profile = conn.execute("SELECT * FROM app_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        profile_dict = row_to_dict(profile)
        permission = sanitize_question_permission(profile_dict.get("question_permission") or ("any" if to_bool(profile_dict.get("allow_anonymous_questions")) else "none"))
        if permission == "none":
            raise HTTPException(status_code=400, detail="이 프로필은 질문을 받지 않습니다.")
        if permission == "members" and not user:
            raise HTTPException(status_code=401, detail="이 프로필은 로그인 사용자만 질문할 수 있습니다.")
        normalized = enforce_text_safety(conn, request=request, user=user, event_type="question_create", target_type="profile", target_id=profile_id, text_value=payload.question_text, min_length=QUESTION_MIN_LENGTH, burst_limit=settings.question_rate_limit_15m, day_limit=settings.question_rate_limit_day)
        nickname = payload.nickname.strip() or (user.get("nickname") if user else "익명") or "익명"
        public_alias = nickname[:30] if nickname.strip() and nickname.strip() != "익명" else random_anonymous_alias()
        record_abuse_event(conn, client_fingerprint(request, user), "question_create", "profile", profile_id, normalized)
        conn.execute(
            "INSERT INTO app_questions(profile_id, nickname, question_text, created_at, asker_user_id, public_alias) VALUES (?, ?, ?, ?, ?, ?)",
            (profile_id, nickname[:30], payload.question_text.strip()[:1000], utcnow(), user.get("id") if user else None, public_alias[:30]),
        )
        row = conn.execute("SELECT * FROM app_questions WHERE profile_id = ? ORDER BY id DESC LIMIT 1", (profile_id,)).fetchone()
        return {"item": serialize_question(row_to_dict(row))}


@app.post("/api/questions/{question_id}/answer")
def answer_question(question_id: int, payload: QuestionAnswerIn, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.user_id FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ?", (question_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        conn.execute("UPDATE app_questions SET answer_text = ?, status = ?, answered_at = ? WHERE id = ?", (payload.answer_text.strip(), payload.status, utcnow(), question_id))
        award_points(conn, int(user['id']), 'answer_question', source_type='question', source_id=question_id, source_key=f'answer_question:{question_id}', description='질문에 답변을 등록해 포인트가 적립되었습니다.')
        updated = conn.execute("SELECT * FROM app_questions WHERE id = ?", (question_id,)).fetchone()
        return {"item": serialize_question(row_to_dict(updated))}


@app.post("/api/questions/{question_id}/reject")
def reject_question(question_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.user_id FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ?", (question_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        conn.execute("UPDATE app_questions SET status = 'rejected', rejected_at = ?, answered_at = '' WHERE id = ?", (utcnow(), question_id))
        updated = conn.execute("SELECT * FROM app_questions WHERE id = ?", (question_id,)).fetchone()
        return {"item": serialize_question(row_to_dict(updated))}


@app.delete("/api/questions/{question_id}")
def delete_question(question_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, q.asker_user_id, p.user_id FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ?", (question_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        profile_owner_id = int(row["user_id"] or 0)
        asker_user_id = int(row["asker_user_id"] or 0) if row["asker_user_id"] else 0
        current_user_id = int(user["id"])
        if current_user_id not in {profile_owner_id, asker_user_id}:
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        conn.execute("UPDATE app_questions SET deleted_at = ? WHERE id = ?", (utcnow(), question_id))
        return {"ok": True}


@app.post("/api/questions/{question_id}/hide")
def hide_question(question_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.user_id FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ?", (question_id,)).fetchone()
        if not row or int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        conn.execute("UPDATE app_questions SET is_hidden = 1 WHERE id = ?", (question_id,))
        return {"ok": True}


@app.get("/api/questions/{question_id}/comments")
def question_comments(question_id: int, user=Depends(current_user_optional)):
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.visibility_mode, p.user_id FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ? AND COALESCE(q.deleted_at, '') = ''", (question_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        profile_owner = int(row["user_id"])
        if not user and not profile_publicly_visible({"visibility_mode": row["visibility_mode"]}):
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        comments = conn.execute("SELECT * FROM app_question_comments WHERE question_id = ? ORDER BY id ASC", (question_id,)).fetchall()
        return {"items": [serialize_question_comment(row_to_dict(item)) for item in comments], "is_owner": bool(user and int(user.get('id') or 0)==profile_owner)}


@app.post("/api/questions/{question_id}/comments")
def add_question_comment(question_id: int, payload: QuestionCommentIn, request: Request, user=Depends(current_user_optional)):
    if not user:
        verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    with get_conn() as conn:
        row = conn.execute("SELECT q.id, p.visibility_mode FROM app_questions q JOIN app_profiles p ON p.id = q.profile_id WHERE q.id = ? AND COALESCE(q.deleted_at, '') = ''", (question_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        text_value = (payload.comment_text or '').strip()
        if len(text_value) < 1:
            raise HTTPException(status_code=400, detail="댓글을 입력해주세요.")
        nickname = payload.nickname.strip() or (user.get("nickname") if user else "익명") or "익명"
        conn.execute("INSERT INTO app_question_comments(question_id, user_id, nickname, comment_text, created_at) VALUES (?, ?, ?, ?, ?)", (question_id, user.get('id') if user else None, nickname[:30], text_value[:1000], utcnow()))
        conn.execute("UPDATE app_questions SET comments_count = comments_count + 1 WHERE id = ?", (question_id,))
        item = conn.execute("SELECT * FROM app_question_comments WHERE question_id = ? ORDER BY id DESC LIMIT 1", (question_id,)).fetchone()
        return {"item": serialize_question_comment(row_to_dict(item))}


@app.post("/api/questions/{question_id}/engage")
def engage_question(question_id: int, action: str = Query(...), user=Depends(current_user_optional)):
    if action not in {"like", "bookmark", "share"}:
        raise HTTPException(status_code=400, detail="지원하지 않는 동작입니다.")
    column = {"like": "liked_count", "bookmark": "bookmarked_count", "share": "shared_count"}[action]
    with get_conn() as conn:
        exists = conn.execute("SELECT id FROM app_questions WHERE id = ? AND COALESCE(deleted_at, '') = ''", (question_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="질문을 찾을 수 없습니다.")
        conn.execute(f"UPDATE app_questions SET {column} = COALESCE({column}, 0) + 1 WHERE id = ?", (question_id,))
        row = conn.execute("SELECT * FROM app_questions WHERE id = ?", (question_id,)).fetchone()
        return {"item": serialize_question(row_to_dict(row))}


@app.post("/api/reports")
def create_report(payload: ReportIn, request: Request, user=Depends(current_user_optional)):
    if not user:
        verify_turnstile_token(payload.captcha_token, request.client.host if request.client else "")
    if payload.target_type not in REPORT_TARGET_TYPES:
        raise HTTPException(status_code=400, detail="지원하지 않는 신고 대상입니다.")
    with get_conn() as conn:
        normalized = enforce_text_safety(conn, request=request, user=user, event_type="report_create", target_type=payload.target_type, target_id=payload.target_id, text_value=payload.reason + " " + payload.details, min_length=REPORT_REASON_MIN_LENGTH, burst_limit=max(2, settings.report_rate_limit_day // 2), day_limit=settings.report_rate_limit_day)
        record_abuse_event(conn, client_fingerprint(request, user), "report_create", payload.target_type, payload.target_id, normalized)
        conn.execute(
            "INSERT INTO app_reports(reporter_user_id, target_type, target_id, reason, details, status, resolution_note, created_at, resolved_at, resolved_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user["id"] if user else None, payload.target_type, payload.target_id, payload.reason[:120], payload.details[:1000], "pending", "", utcnow(), "", None),
        )
        if payload.target_type == "question":
            with suppress(Exception):
                current_count = int(conn.execute("SELECT reporter_count FROM app_questions WHERE id = ?", (payload.target_id,)).fetchone()[0] or 0)
                conn.execute("UPDATE app_questions SET reporter_count = ? WHERE id = ?", (current_count + 1, payload.target_id))
        elif payload.target_type == "upload":
            with suppress(Exception):
                current_count = int(conn.execute("SELECT report_count FROM app_uploads WHERE id = ?", (payload.target_id,)).fetchone()[0] or 0)
                conn.execute("UPDATE app_uploads SET report_count = ? WHERE id = ?", (current_count + 1, payload.target_id))
        elif payload.target_type == "profile":
            with suppress(Exception):
                current_count = int(conn.execute("SELECT report_count FROM app_profiles WHERE id = ?", (payload.target_id,)).fetchone()[0] or 0)
                conn.execute("UPDATE app_profiles SET report_count = ? WHERE id = ?", (current_count + 1, payload.target_id))
        auto_moderate_after_report(conn, payload.target_type, payload.target_id)
        row = conn.execute("SELECT * FROM app_reports ORDER BY id DESC LIMIT 1").fetchone()
        return {"item": row_to_dict(row)}




@app.get("/api/feed/stories")
def feed_stories(limit: int = Query(default=20, ge=1, le=50), user=Depends(current_user_optional)):
    with get_conn() as conn:
        viewer_id = int(user['id']) if user and user.get('id') else 0
        now_value = utcnow()
        rows = [row_to_dict(r) for r in conn.execute("SELECT * FROM feed_stories WHERE expires_at > ? ORDER BY created_at DESC, id DESC", (now_value,)).fetchall()]
        items: list[dict] = []
        seen_users: set[int] = set()
        own_story = None
        for row in rows:
            owner_id = int(row.get('user_id') or 0)
            if not owner_id:
                continue
            if viewer_id and owner_id == viewer_id:
                own_story = serialize_feed_story(conn, row, user)
                continue
            if owner_id in seen_users:
                continue
            if viewer_id and either_side_blocked(conn, viewer_id, owner_id):
                continue
            items.append(serialize_feed_story(conn, row, user))
            seen_users.add(owner_id)
            if len(items) >= limit:
                break
        return {'items': items, 'my_story': own_story}


@app.post("/api/feed/stories")
def create_feed_story(payload: FeedStoryCreateIn, request: Request, user=Depends(current_user)):
    title = (payload.title or '').strip()[:120]
    content = (payload.content or '').strip()[:2000]
    image_url = (payload.image_url or '').strip()[:1000]
    if not title and not content and not image_url:
        raise HTTPException(status_code=400, detail="숏토리 내용 또는 이미지를 입력해주세요.")
    with get_conn() as conn:
        normalized = enforce_text_safety(conn, request=request, user=user, event_type="feed_story_create", target_type="feed_story", target_id=0, text_value=(title + "\n" + content).strip() or title or "story", min_length=1, burst_limit=30, day_limit=200)
        if image_url and not image_url.startswith(('http://', 'https://', '/uploads/')):
            image_url = ''
        created_at = utcnow()
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        conn.execute(
            "INSERT INTO feed_stories(user_id, title, content, image_url, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user['id'], title, content if content else normalized, image_url, created_at, expires_at),
        )
        row = conn.execute("SELECT * FROM feed_stories WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user['id'],)).fetchone()
        return {"item": serialize_feed_story(conn, row_to_dict(row), user)}


@app.get("/api/feed/posts")
def feed_posts(limit: int = Query(default=10, ge=1, le=20), offset: int = Query(default=0, ge=0, le=500), keyword: str = Query(default=''), user=Depends(current_user_optional)):
    with get_conn() as conn:
        items = fetch_feed_posts(conn, user, limit=limit, offset=offset, keyword=keyword)
        total = int(conn.execute("SELECT COUNT(*) FROM feed_posts").fetchone()[0] or 0)
        return {"items": items, "next_offset": offset + len(items), "has_more": total > offset + len(items)}


@app.post("/api/feed/posts")
def create_feed_post(payload: FeedPostCreateIn, request: Request, user=Depends(current_user)):
    title = (payload.title or '').strip()[:120]
    content = (payload.content or '').strip()[:5000]
    image_url = (payload.image_url or '').strip()[:1000]
    if not title and not content:
        raise HTTPException(status_code=400, detail="제목 또는 내용을 입력해주세요.")
    with get_conn() as conn:
        normalized = enforce_text_safety(conn, request=request, user=user, event_type="feed_post_create", target_type="feed_post", target_id=0, text_value=(title + "\n" + content).strip() or title, min_length=2, burst_limit=20, day_limit=200)
        if image_url and not image_url.startswith(('http://', 'https://', '/uploads/')):
            image_url = ''
        conn.execute(
            "INSERT INTO feed_posts(user_id, title, content, image_url, created_at) VALUES (?, ?, ?, ?, ?)",
            (user['id'], title, content if content else normalized, image_url, utcnow()),
        )
        row = conn.execute("SELECT * FROM feed_posts WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user['id'],)).fetchone()
        return {"item": serialize_feed_post(conn, row_to_dict(row), user)}


@app.post("/api/friends/requests/{target_user_id}")
def create_friend_request(target_user_id: int, request: Request, user=Depends(current_user)):
    if int(target_user_id) == int(user['id']):
        raise HTTPException(status_code=400, detail="본인에게는 친구요청을 보낼 수 없습니다.")
    with get_conn() as conn:
        target = conn.execute("SELECT id FROM users WHERE id = ? LIMIT 1", (target_user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="상대 사용자를 찾을 수 없습니다.")
        if either_side_blocked(conn, int(user['id']), int(target_user_id)):
            raise HTTPException(status_code=403, detail="차단 상태에서는 친구요청을 보낼 수 없습니다.")
        if are_friends(conn, int(user['id']), int(target_user_id)):
            return {"ok": True, "status": "friends"}
        incoming = conn.execute(
            "SELECT id FROM friend_requests WHERE requester_id = ? AND target_user_id = ? AND status = 'pending' LIMIT 1",
            (target_user_id, user['id']),
        ).fetchone()
        if incoming:
            raise HTTPException(status_code=409, detail="상대방이 먼저 보낸 친구요청이 있습니다. 친구 화면에서 수락해주세요.")
        record_abuse_event(conn, client_fingerprint(request, user), 'friend_request', 'user', target_user_id, 'friend request')
        conn.execute(
            "INSERT OR IGNORE INTO friend_requests(requester_id, target_user_id, status, created_at, responded_at) VALUES (?, ?, 'pending', ?, '')",
            (user['id'], target_user_id, utcnow()),
        )
        return {"ok": True, "status": get_friend_request_status(conn, int(user['id']), int(target_user_id))}


@app.get("/api/friends/requests")
def list_friend_requests(user=Depends(current_user)):
    with get_conn() as conn:
        incoming_rows = conn.execute(
            "SELECT fr.*, u.nickname, u.name, u.photo_url FROM friend_requests fr JOIN users u ON u.id = fr.requester_id WHERE fr.target_user_id = ? AND fr.status = 'pending' ORDER BY fr.id DESC",
            (user['id'],),
        ).fetchall()
        outgoing_rows = conn.execute(
            "SELECT fr.*, u.nickname, u.name, u.photo_url FROM friend_requests fr JOIN users u ON u.id = fr.target_user_id WHERE fr.requester_id = ? AND fr.status = 'pending' ORDER BY fr.id DESC",
            (user['id'],),
        ).fetchall()
        return {
            'incoming': [row_to_dict(r) for r in incoming_rows],
            'outgoing': [row_to_dict(r) for r in outgoing_rows],
        }


@app.post("/api/friends/requests/{request_id}/respond")
def respond_friend_request(request_id: int, payload: FriendRequestActionIn, user=Depends(current_user)):
    action = (payload.action or 'accept').strip().lower()
    if action not in {'accept', 'reject'}:
        raise HTTPException(status_code=400, detail='허용되지 않는 처리입니다.')
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM friend_requests WHERE id = ? AND target_user_id = ? AND status = 'pending' LIMIT 1",
            (request_id, user['id']),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='처리할 친구 요청이 없습니다.')
        request_row = row_to_dict(row)
        status = 'accepted' if action == 'accept' else 'rejected'
        conn.execute("UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?", (status, utcnow(), request_id))
        if action == 'accept':
            now = utcnow()
            conn.execute("INSERT OR IGNORE INTO friends(user_id, friend_id, created_at) VALUES (?, ?, ?)", (request_row['requester_id'], request_row['target_user_id'], now))
            conn.execute("INSERT OR IGNORE INTO friends(user_id, friend_id, created_at) VALUES (?, ?, ?)", (request_row['target_user_id'], request_row['requester_id'], now))
        return {'ok': True, 'status': status}


@app.get("/api/community/posts")
def list_community_posts(primary_category: str = Query(default='전체'), secondary_category: str = Query(default='전체'), keyword: str = Query(default=''), user=Depends(current_user_optional)):
    with get_conn() as conn:
        return {'items': fetch_community_posts(conn, primary_category, secondary_category, keyword)}


@app.post("/api/community/posts")
def create_community_post(payload: CommunityPostCreateIn, request: Request, user=Depends(current_user)):
    primary_category = (payload.primary_category or '일반').strip()[:40] or '일반'
    secondary_category = (payload.secondary_category or '자유').strip()[:40] or '자유'
    category = primary_category
    title = (payload.title or '').strip()[:120]
    content = (payload.content or '').strip()[:4000]
    attachment_url = (payload.attachment_url or '').strip()[:1000]
    if not title or not content:
        raise HTTPException(status_code=400, detail='제목과 내용을 입력해주세요.')
    with get_conn() as conn:
        normalized = enforce_text_safety(conn, request=request, user=user, event_type='community_post_create', target_type='community_post', target_id=0, text_value=f"{title}\n{content}", min_length=2, burst_limit=20, day_limit=200)
        if attachment_url and not attachment_url.startswith(('http://', 'https://', '/uploads/')):
            attachment_url = ''
        conn.execute("INSERT INTO community_posts(user_id, category, primary_category, secondary_category, title, content, attachment_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (user['id'], category, primary_category, secondary_category, title, normalized or content, attachment_url, utcnow()))
        row = conn.execute("SELECT * FROM community_posts WHERE user_id = ? ORDER BY id DESC LIMIT 1", (user['id'],)).fetchone()
        return {'item': serialize_community_post(conn, row_to_dict(row))}


@app.post("/api/community/posts/{post_id}/comments")
def create_community_comment(post_id: int, payload: CommunityCommentCreateIn, request: Request, user=Depends(current_user)):
    content = (payload.content or '').strip()[:1000]
    if not content:
        raise HTTPException(status_code=400, detail='댓글 내용을 입력해주세요.')
    with get_conn() as conn:
        post_row = conn.execute("SELECT id FROM community_posts WHERE id = ? LIMIT 1", (post_id,)).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail='게시글을 찾을 수 없습니다.')
        normalized = enforce_text_safety(conn, request=request, user=user, event_type='community_comment_create', target_type='community_post', target_id=post_id, text_value=content, min_length=1, burst_limit=30, day_limit=400)
        conn.execute("INSERT INTO community_comments(post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)", (post_id, user['id'], normalized or content, utcnow()))
        row = conn.execute("SELECT * FROM community_comments WHERE post_id = ? ORDER BY id DESC LIMIT 1", (post_id,)).fetchone()
        comment = row_to_dict(row)
        author_row = conn.execute("SELECT * FROM users WHERE id = ? LIMIT 1", (comment['user_id'],)).fetchone()
        return {'item': {'id': comment['id'], 'content': comment['content'], 'created_at': comment['created_at'], 'author': user_public_dict(author_row) if author_row else None}}


@app.get("/api/feed/profiles")
def feed_profiles(limit: int = Query(default=20, ge=1, le=50), user=Depends(current_user_optional)):
    with get_conn() as conn:
        params: list[object] = []
        where_clauses = [
            "COALESCE(feed_profile_public, 0) = 1",
            "COALESCE(visibility_mode, 'link_only') <> 'private'",
        ]
        if user:
            where_clauses.insert(0, "user_id <> ?")
            params.append(user["id"])
        params.append(limit)
        rows = conn.execute(
            f"""
            SELECT * FROM app_profiles
            WHERE {' AND '.join(where_clauses)}
            ORDER BY RANDOM()
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()
        items = []
        for row in rows:
            profile = serialize_profile(conn, row_to_dict(row), include_private=False)
            owner = conn.execute("SELECT id, nickname, email FROM users WHERE id = ?", (profile["user_id"],)).fetchone()
            items.append({"profile": profile, "owner": user_public_dict(owner) if owner else None})
        return {"items": items}


@app.get("/api/profiles/{profile_id}/view")
def get_profile_view(profile_id: int, user=Depends(current_user_optional)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_profiles WHERE id = ? LIMIT 1", (profile_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        profile_row = row_to_dict(row)
        is_owner = bool(user and int(user.get("id") or 0) == int(profile_row.get("user_id") or 0))
        can_view = is_owner or to_bool(profile_row.get("feed_profile_public")) or profile_publicly_visible(profile_row)
        if not can_view:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        owner = conn.execute("SELECT * FROM users WHERE id = ?", (profile_row["user_id"],)).fetchone()
        owner_id = int(profile_row.get("user_id") or 0)
        viewer_id = int(user.get("id") or 0) if user else 0
        viewer_following = False
        viewer_followed_by = False
        if viewer_id and owner_id and viewer_id != owner_id:
            viewer_following = bool(conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ? LIMIT 1", (viewer_id, owner_id)).fetchone())
            viewer_followed_by = bool(conn.execute("SELECT 1 FROM follows WHERE from_user_id = ? AND to_user_id = ? LIMIT 1", (owner_id, viewer_id)).fetchone())
        return {
            "profile": serialize_profile(conn, profile_row, include_private=is_owner),
            "owner": user_public_dict(owner),
            "is_owner": is_owner,
            "viewer": {
                "is_following": viewer_following,
                "is_followed_by": viewer_followed_by,
            },
        }


@app.post("/api/profiles/{profile_id}/follow")
def follow_profile_owner(profile_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT user_id FROM app_profiles WHERE id = ? LIMIT 1", (profile_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        target_user_id = int(row[0])
        viewer_id = int(user.get("id") or 0)
        if not viewer_id or viewer_id == target_user_id:
            raise HTTPException(status_code=400, detail="자기 자신은 팔로우할 수 없습니다.")
        conn.execute(
            "INSERT OR IGNORE INTO follows(from_user_id, to_user_id, created_at) VALUES (?, ?, ?)",
            (viewer_id, target_user_id, utcnow()),
        )
        follower_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE to_user_id = ?", (target_user_id,)).fetchone()[0] or 0)
        following_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE from_user_id = ?", (target_user_id,)).fetchone()[0] or 0)
        return {"ok": True, "is_following": True, "follower_count": follower_count, "following_count": following_count}


@app.delete("/api/profiles/{profile_id}/follow")
def unfollow_profile_owner(profile_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT user_id FROM app_profiles WHERE id = ? LIMIT 1", (profile_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="프로필을 찾을 수 없습니다.")
        target_user_id = int(row[0])
        viewer_id = int(user.get("id") or 0)
        if not viewer_id or viewer_id == target_user_id:
            raise HTTPException(status_code=400, detail="자기 자신은 언팔로우할 수 없습니다.")
        conn.execute("DELETE FROM follows WHERE from_user_id = ? AND to_user_id = ?", (viewer_id, target_user_id))
        follower_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE to_user_id = ?", (target_user_id,)).fetchone()[0] or 0)
        following_count = int(conn.execute("SELECT COUNT(*) FROM follows WHERE from_user_id = ?", (target_user_id,)).fetchone()[0] or 0)
        return {"ok": True, "is_following": False, "follower_count": follower_count, "following_count": following_count}


@app.get("/api/profile-public/{slug}")
def public_profile(slug: str):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_profiles WHERE slug = ? LIMIT 1", (slug,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="공개 프로필을 찾을 수 없습니다.")
        profile_row = row_to_dict(row)
        if not profile_publicly_visible(profile_row):
            raise HTTPException(status_code=404, detail="공개 프로필을 찾을 수 없습니다.")
        profile = serialize_profile(conn, profile_row, include_private=False)
        owner = conn.execute("SELECT * FROM users WHERE id = ?", (profile["user_id"],)).fetchone()
        owner_public = user_public_dict(owner)
        static_path = ""
        with suppress(Exception):
            static_path = write_public_profile_static_snapshot(profile, owner_public)
        return {"profile": profile, "owner": owner_public, "seo": build_profile_seo_payload(profile, owner_public), "static_path": static_path}


@app.get("/api/profile-public/{slug}/seo")
def public_profile_seo(slug: str):
    data = public_profile(slug)
    return data["seo"]


@app.get("/share/p/{slug}", response_class=HTMLResponse)
def public_profile_share_page(slug: str):
    data = public_profile(slug)
    return HTMLResponse(render_public_profile_share_html(data["profile"], data["owner"]))


@app.get("/api/public/sitemap.xml")
def public_profiles_sitemap():
    with get_conn() as conn:
        rows = [row_to_dict(item) for item in conn.execute("SELECT slug, updated_at FROM app_profiles WHERE visibility_mode = 'search' ORDER BY updated_at DESC LIMIT 1000").fetchall()]
    urls = ''.join([f"<url><loc>{escape_html(settings.app_public_url.rstrip('/') + '/p/' + row['slug'])}</loc><lastmod>{escape_html((row.get('updated_at') or row.get('created_at') or utcnow())[:10])}</lastmod></url>" for row in rows])
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    return Response(content=xml, media_type='application/xml')


@app.get("/robots.txt")
def robots_txt():
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/auth/\n"
        "Disallow: /api/admin/\n"
        "Disallow: /api/chats/\n"
        f"Sitemap: {settings.api_public_url.rstrip('/')}/api/public/sitemap.xml\n"
    )
    return Response(content=body, media_type='text/plain')



@app.get("/api/public/config")
def public_runtime_config():
    return {"turnstile_site_key": settings.turnstile_site_key, "turnstile_enabled": settings.turnstile_enabled, "sms_provider": "twilio_verify" if settings.twilio_verify_enabled else "demo"}


@app.get("/public/p/{slug}", response_class=HTMLResponse)
def public_profile_static_page(slug: str):
    path = STATIC_PROFILE_DIR / f"{slug}.html"
    with get_conn() as conn:
        update_public_profile_snapshot(conn, slug)
    if path.exists():
        return HTMLResponse(path.read_text(encoding="utf-8"))
    data = public_profile(slug)
    return HTMLResponse(render_public_profile_full_html(data["profile"], data["owner"]))


@app.post("/api/admin/public-profiles/{slug}/rebuild")
def admin_rebuild_public_profile(slug: str, user=Depends(admin_user)):
    with get_conn() as conn:
        static_path = update_public_profile_snapshot(conn, slug)
        row = conn.execute("SELECT id FROM app_profiles WHERE slug = ? LIMIT 1", (slug,)).fetchone()
        if row:
            log_moderation_note(conn, "profile", int(row[0]), f"정적 공개 프로필 재생성 by admin#{user['id']}")
    return {"ok": True, "static_path": static_path}


@app.get("/api/admin/integrations/status")
def admin_integrations_status(user=Depends(admin_user)):
    data = integration_status()
    data["app_public_url"] = settings.app_public_url
    data["api_public_url"] = settings.api_public_url
    return data


@app.get("/api/admin/cost-protection/guide")
def admin_cost_protection_guide(user=Depends(admin_user)):
    return {
        "summary": {
            "headline": "트래픽 폭주·크롤링·봇성 접근으로 인한 과금 리스크를 낮추기 위한 기본 보호 구성이 적용되어 있습니다.",
            "cost_protection_enabled": settings.cost_protection_enabled,
            "global_per_ip": {"window_seconds": settings.ip_rate_limit_window_seconds, "max_requests": settings.ip_rate_limit_requests},
            "auth_per_ip": {"window_seconds": settings.auth_rate_limit_window_seconds, "max_requests": settings.auth_rate_limit_requests},
            "public_page_per_ip": {"window_seconds": settings.public_page_rate_limit_window_seconds, "max_requests": settings.public_page_rate_limit_requests},
            "api_read_per_ip": {"window_seconds": settings.api_read_rate_limit_window_seconds, "max_requests": settings.api_read_rate_limit_requests},
            "blocked_user_agents": settings.bot_block_user_agents,
        },
        "examples": [
            {
                "title": "로그인/회원가입 폭주 차단",
                "problem": "짧은 시간에 로그인·회원가입 요청이 몰리면 DB와 SMS/캡차 비용이 동시에 증가할 수 있습니다.",
                "solution": "인증 관련 경로를 별도 버킷으로 분리해 IP당 요청 횟수를 강하게 제한합니다.",
                "example": f"현재 기본값: {settings.auth_rate_limit_window_seconds}초 동안 IP당 {settings.auth_rate_limit_requests}회",
            },
            {
                "title": "공개 프로필/질문 페이지 대량 조회 차단",
                "problem": "공개 페이지를 자동 수집하면 대역폭, DB 조회, 이미지 트래픽 비용이 커집니다.",
                "solution": "공개 페이지와 공개 API에 별도 조회 제한을 두고, robots.txt로 검색 엔진 외 민감 API 수집을 억제합니다.",
                "example": f"현재 기본값: 공개 페이지 {settings.public_page_rate_limit_window_seconds}초/{settings.public_page_rate_limit_requests}회, 공개 API {settings.api_read_rate_limit_window_seconds}초/{settings.api_read_rate_limit_requests}회",
            },
            {
                "title": "명백한 자동화 도구 차단",
                "problem": "python-requests, curl, scrapy 같은 도구는 비정상 대량 호출에 자주 사용됩니다.",
                "solution": "대표적인 자동화 User-Agent를 차단합니다. 정상 브라우저 사용자는 영향이 적고, 악성 자동 조회를 초기에 줄일 수 있습니다.",
                "example": "차단 키워드 예시: python-requests, curl, wget, scrapy, selenium",
            },
            {
                "title": "업로드/동영상 비용 관리",
                "problem": "대용량 업로드는 저장소·전송비를 빠르게 키웁니다.",
                "solution": "현재 프로젝트는 업로드 용량 제한, 일일 동영상 용량 제한, 검수 흐름을 함께 사용합니다.",
                "example": f"현재 최대 업로드 크기: {settings.max_upload_mb}MB",
            },
        ],
        "recommended_actions": [
            "Cloudflare WAF에서 국가·ASN·봇 점수 기반 규칙 추가",
            "Cloudflare Rate Limiting으로 /api/auth/*, /api/public/*, /p/* 별도 정책 적용",
            "R2 또는 CDN 캐시를 활용해 정적 공개 프로필과 이미지 응답 캐시",
            "비회원 기능에는 Turnstile을 기본 적용하고, SMS 인증 요청 횟수는 더 강하게 제한",
            "서버 로그에서 429/403 급증 시 자동 알림을 붙여 이상 트래픽을 조기 탐지",
            "Railway/DB 레벨에서는 커넥션 수와 쿼리 시간을 점검해 비정상 급증 시 즉시 차단",
        ],
    }


@app.post("/api/admin/integrations/twilio/send-test")
def admin_twilio_send_test(payload: IntegrationSmsTestIn, user=Depends(admin_user)):
    phone = normalize_phone(payload.phone)
    if not phone:
        raise HTTPException(status_code=400, detail="휴대폰 번호를 입력해주세요.")
    code = f"{random.randint(100000, 999999)}"
    result = send_sms_verification_code(phone, code, normalize_phone)
    return {"ok": True, "provider": result.get("provider"), "status": result.get("status"), "debug_code": result.get("debug_code", "")}


@app.post("/api/admin/reports/bulk-resolve")
def admin_bulk_resolve_reports(payload: BulkReportResolveIn, user=Depends(admin_user)):
    ids = [int(x) for x in payload.report_ids if int(x) > 0]
    if not ids:
        raise HTTPException(status_code=400, detail="처리할 신고를 선택해주세요.")
    placeholders = ",".join(["?"] * len(ids))
    note = (payload.resolution_note or f"{payload.status} 일괄 처리")[:1000]
    with get_conn() as conn:
        existing = conn.execute(f"SELECT id FROM app_reports WHERE id IN ({placeholders})", tuple(ids)).fetchall()
        found_ids = [int(r[0]) for r in existing]
        if not found_ids:
            raise HTTPException(status_code=404, detail="대상 신고를 찾을 수 없습니다.")
        placeholders2 = ",".join(["?"] * len(found_ids))
        conn.execute(f"UPDATE app_reports SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by_user_id = ? WHERE id IN ({placeholders2})", tuple([payload.status, note, utcnow(), user["id"], *found_ids]))
        for report_id in found_ids:
            conn.execute("INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)", (user["id"], "report", report_id, note, utcnow()))
    return {"ok": True, "count": len(found_ids)}


@app.post("/api/admin/uploads/bulk-review")
def admin_bulk_review_uploads(payload: BulkUploadReviewIn, user=Depends(admin_user)):
    ids = [int(x) for x in payload.upload_ids if int(x) > 0]
    if not ids:
        raise HTTPException(status_code=400, detail="처리할 업로드를 선택해주세요.")
    if payload.moderation_status not in MODERATION_STATUS_VALUES:
        raise HTTPException(status_code=400, detail="지원하지 않는 검수 상태입니다.")
    placeholders = ",".join(["?"] * len(ids))
    note = (payload.moderation_note or f"{payload.moderation_status} 일괄 처리")[:500]
    with get_conn() as conn:
        existing = conn.execute(f"SELECT id FROM app_uploads WHERE id IN ({placeholders})", tuple(ids)).fetchall()
        found_ids = [int(r[0]) for r in existing]
        if not found_ids:
            raise HTTPException(status_code=404, detail="대상 업로드를 찾을 수 없습니다.")
        placeholders2 = ",".join(["?"] * len(found_ids))
        conn.execute(f"UPDATE app_uploads SET moderation_status = ?, moderation_note = ? WHERE id IN ({placeholders2})", tuple([payload.moderation_status, note, *found_ids]))
        for upload_id in found_ids:
            conn.execute("INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)", (user["id"], "upload", upload_id, f"{payload.moderation_status}: {note}", utcnow()))
    return {"ok": True, "count": len(found_ids)}


@app.get("/api/admin/moderation/queue")
def admin_moderation_queue(user=Depends(admin_user)):
    with get_conn() as conn:
        reports = [row_to_dict(r) for r in conn.execute("SELECT * FROM app_reports WHERE status = 'pending' ORDER BY id DESC LIMIT 100").fetchall()]
        uploads = [row_to_dict(r) for r in conn.execute("SELECT * FROM app_uploads WHERE moderation_status = 'pending' ORDER BY id DESC LIMIT 100").fetchall()]
        notes = [row_to_dict(r) for r in conn.execute("SELECT * FROM app_moderation_notes ORDER BY id DESC LIMIT 200").fetchall()]
        return {"reports": reports, "uploads": uploads, "notes": notes}


@app.get("/api/admin/moderation/history")
def admin_moderation_history(user=Depends(admin_user), target_type: str = Query(default=""), target_id: int = Query(default=0)):
    with get_conn() as conn:
        if target_type and target_id:
            rows = conn.execute("SELECT * FROM app_moderation_notes WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 200", (target_type, target_id)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM app_moderation_notes ORDER BY id DESC LIMIT 200").fetchall()
        return {"items": [row_to_dict(r) for r in rows]}

@app.get("/api/admin/rewards/overview")
def admin_rewards_overview(user=Depends(admin_user)):
    with get_conn() as conn:
        return admin_reward_overview_payload(conn)


@app.post("/api/admin/rewards/withdrawals/{withdrawal_id}/process")
def admin_process_reward_withdrawal(withdrawal_id: int, payload: AdminRewardWithdrawalProcessIn, user=Depends(admin_user)):
    next_status = (payload.status or 'approved').strip().lower()
    if next_status not in {'approved', 'rejected', 'paid'}:
        raise HTTPException(status_code=400, detail='처리 상태가 올바르지 않습니다.')
    with get_conn() as conn:
        ensure_reward_tables(conn)
        row = conn.execute("SELECT * FROM app_withdrawal_requests WHERE id = ?", (withdrawal_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='출금 요청을 찾을 수 없습니다.')
        current = row_to_dict(row)
        rejection_reason = (payload.rejection_reason or '').strip()[:200]
        note = (payload.note or '').strip()[:200]
        if next_status == 'rejected' and not rejection_reason:
            rejection_reason = note or '관리자 반려'
        conn.execute(
            "UPDATE app_withdrawal_requests SET status = ?, note = ?, rejection_reason = ?, processed_at = ? WHERE id = ?",
            (next_status, note or current.get('note') or '', rejection_reason, utcnow(), withdrawal_id),
        )
        with suppress(Exception):
            conn.execute("INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)", (user['id'], 'reward_withdrawal', withdrawal_id, f'{next_status}: {note or rejection_reason or "정산 처리"}', utcnow()))
        return {"ok": True, "overview": admin_reward_overview_payload(conn)}


@app.get("/api/admin/overview")
def admin_overview(user=Depends(admin_user)):
    with get_conn() as conn:
        pending_reports = int(conn.execute("SELECT COUNT(*) FROM app_reports WHERE status = 'pending'").fetchone()[0] or 0)
        pending_uploads = int(conn.execute("SELECT COUNT(*) FROM app_uploads WHERE moderation_status = 'pending'").fetchone()[0] or 0)
        blocked_count = int(conn.execute("SELECT COUNT(*) FROM app_blocks").fetchone()[0] or 0)
        profile_count = int(conn.execute("SELECT COUNT(*) FROM app_profiles").fetchone()[0] or 0)
        auto_hidden_questions = int(conn.execute("SELECT COUNT(*) FROM app_questions WHERE is_hidden = 1 AND status = 'hidden'").fetchone()[0] or 0)
        auto_private_profiles = int(conn.execute("SELECT COUNT(*) FROM app_profiles WHERE visibility_mode = 'private' AND auto_private_reason <> ''").fetchone()[0] or 0)
        warned_users = int(conn.execute("SELECT COUNT(*) FROM users WHERE account_status = 'warned'").fetchone()[0] or 0)
        suspended_users = int(conn.execute("SELECT COUNT(*) FROM users WHERE account_status = 'suspended'").fetchone()[0] or 0)
        moderation_notes = int(conn.execute("SELECT COUNT(*) FROM app_moderation_notes").fetchone()[0] or 0)
        return {
            "pending_reports": pending_reports,
            "pending_uploads": pending_uploads,
            "blocked_count": blocked_count,
            "profile_count": profile_count,
            "auto_hidden_questions": auto_hidden_questions,
            "auto_private_profiles": auto_private_profiles,
            "warned_users": warned_users,
            "suspended_users": suspended_users,
            "moderation_notes": moderation_notes,
        }


@app.get("/api/admin/reports")
def admin_reports(user=Depends(admin_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM app_reports ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 200").fetchall()
        return {"items": [row_to_dict(row) for row in rows]}


@app.post("/api/admin/reports/{report_id}/resolve")
def admin_resolve_report(report_id: int, payload: ResolveReportIn, user=Depends(admin_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_reports WHERE id = ?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="신고를 찾을 수 없습니다.")
        conn.execute("UPDATE app_reports SET status = ?, resolution_note = ?, resolved_at = ?, resolved_by_user_id = ? WHERE id = ?", (payload.status, payload.resolution_note[:1000], utcnow(), user["id"], report_id))
        conn.execute("INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)", (user["id"], "report", report_id, payload.resolution_note[:1000], utcnow()))
        updated = conn.execute("SELECT * FROM app_reports WHERE id = ?", (report_id,)).fetchone()
        return {"item": row_to_dict(updated)}


@app.get("/api/admin/uploads")
def admin_uploads(user=Depends(admin_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM app_uploads ORDER BY CASE WHEN moderation_status = 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 200").fetchall()
        return {"items": [serialize_upload(row_to_dict(row)) for row in rows]}


@app.post("/api/admin/uploads/{upload_id}/review")
def admin_review_upload(upload_id: int, payload: UploadReviewIn, user=Depends(admin_user)):
    if payload.moderation_status not in MODERATION_STATUS_VALUES:
        raise HTTPException(status_code=400, detail="지원하지 않는 검수 상태입니다.")
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM app_uploads WHERE id = ?", (upload_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="업로드를 찾을 수 없습니다.")
        conn.execute("UPDATE app_uploads SET moderation_status = ?, moderation_note = ? WHERE id = ?", (payload.moderation_status, payload.moderation_note[:500], upload_id))
        conn.execute("INSERT INTO app_moderation_notes(admin_user_id, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?)", (user["id"], "upload", upload_id, f"{payload.moderation_status}: {payload.moderation_note[:500]}", utcnow()))
        updated = conn.execute("SELECT * FROM app_uploads WHERE id = ?", (upload_id,)).fetchone()
        return {"item": serialize_upload(row_to_dict(updated))}


@app.get("/api/admin/users")
def admin_users(user=Depends(admin_user)):
    with get_conn() as conn:
        rows = conn.execute("SELECT id, email, nickname, phone, role, grade, extra_profile_slots, storage_quota_override_bytes, chat_media_quota_bytes, account_status, warning_count, suspended_reason, phone_verified_at, created_at FROM users ORDER BY id DESC LIMIT 200").fetchall()
        return {"items": [row_to_dict(row) for row in rows]}


@app.patch("/api/admin/users/{target_user_id}")
def admin_update_user(target_user_id: int, payload: AdminUserUpdateIn, user=Depends(admin_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="회원을 찾을 수 없습니다.")
        current = row_to_dict(row)
        role = payload.role if payload.role is not None else current.get("role") or "user"
        grade = payload.grade if payload.grade is not None else int(current.get("grade") or 6)
        account_status = payload.account_status if payload.account_status in ACCOUNT_STATUS_VALUES else (current.get("account_status") or "active")
        chat_media_quota_bytes = int(current.get("chat_media_quota_bytes") or CHAT_MEDIA_MONTHLY_FREE_LIMIT_BYTES)
        if payload.chat_media_quota_mb is not None:
            chat_media_quota_bytes = max(int(payload.chat_media_quota_mb), 10) * 1024 * 1024
        conn.execute("UPDATE users SET extra_profile_slots = ?, role = ?, grade = ?, account_status = ?, suspended_reason = ?, chat_media_quota_bytes = ? WHERE id = ?", (max(payload.extra_profile_slots, 0), role, grade, account_status, payload.suspended_reason[:300], chat_media_quota_bytes, target_user_id))
        updated = conn.execute("SELECT id, email, nickname, phone, role, grade, extra_profile_slots, storage_quota_override_bytes, chat_media_quota_bytes, account_status, warning_count, suspended_reason, phone_verified_at, created_at FROM users WHERE id = ?", (target_user_id,)).fetchone()
        return {"item": row_to_dict(updated)}


@app.get("/api/work-schedule")
def list_work_schedule(start_date: str = Query(...), days: int = Query(default=42, ge=1, le=93), user=Depends(current_user)):
    base_date = datetime.strptime(start_date[:10], "%Y-%m-%d").date()
    end_date = base_date + timedelta(days=max(days - 1, 0))
    with get_conn() as conn:
        entry_rows = conn.execute(
            """
            SELECT id, schedule_date, schedule_time, customer_name, memo, created_at, updated_at
            FROM work_schedule_entries
            WHERE user_id = ? AND schedule_date >= ? AND schedule_date <= ?
            ORDER BY schedule_date ASC, schedule_time ASC, id ASC
            """,
            (user["id"], base_date.isoformat(), end_date.isoformat()),
        ).fetchall()
        note_rows = conn.execute(
            """
            SELECT schedule_date, day_memo, updated_at
            FROM work_schedule_day_notes
            WHERE user_id = ? AND schedule_date >= ? AND schedule_date <= ?
            ORDER BY schedule_date ASC
            """,
            (user["id"], base_date.isoformat(), end_date.isoformat()),
        ).fetchall()
    items = []
    for row in entry_rows:
        item = row_to_dict(row)
        item["title"] = item.get("customer_name") or "일정"
        items.append(item)
    day_notes = {}
    for row in note_rows:
        item = row_to_dict(row)
        day_notes[str(item.get("schedule_date") or "")] = item
    return {"items": items, "day_notes": day_notes}


@app.post("/api/work-schedule")
def create_work_schedule(payload: dict[str, Any], user=Depends(current_user)):
    schedule_date = str(payload.get("schedule_date") or "").strip()[:10]
    if not schedule_date:
        raise HTTPException(status_code=400, detail="일정 날짜가 필요합니다.")
    try:
        datetime.strptime(schedule_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다.")
    schedule_time = str(payload.get("schedule_time") or "").strip()[:5]
    customer_name = str(payload.get("customer_name") or payload.get("title") or "").strip()[:120]
    memo = str(payload.get("memo") or "").strip()[:1000]
    if not customer_name:
        raise HTTPException(status_code=400, detail="일정명은 필수입니다.")
    now = utcnow()
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO work_schedule_entries(user_id, schedule_date, schedule_time, customer_name, representative_names, staff_names, memo, created_at, updated_at)
            VALUES (?, ?, ?, ?, '', '', ?, ?, ?)
            """,
            (user["id"], schedule_date, schedule_time, customer_name, memo, now, now),
        )
        row = conn.execute(
            "SELECT id, schedule_date, schedule_time, customer_name, memo, created_at, updated_at FROM work_schedule_entries WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    item = row_to_dict(row)
    item["title"] = item.get("customer_name") or "일정"
    return {"item": item}


@app.put("/api/work-schedule/day-note")
def upsert_work_schedule_day_note(payload: dict[str, Any], user=Depends(current_user)):
    schedule_date = str(payload.get("schedule_date") or "").strip()[:10]
    if not schedule_date:
        raise HTTPException(status_code=400, detail="날짜가 필요합니다.")
    try:
        datetime.strptime(schedule_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식이 올바르지 않습니다.")
    day_memo = str(payload.get("day_memo") or "").strip()[:1000]
    now = utcnow()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM work_schedule_day_notes WHERE user_id = ? AND schedule_date = ?",
            (user["id"], schedule_date),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE work_schedule_day_notes SET day_memo = ?, updated_at = ? WHERE id = ?",
                (day_memo, now, existing[0]),
            )
            row_id = existing[0]
        else:
            cursor = conn.execute(
                """
                INSERT INTO work_schedule_day_notes(user_id, schedule_date, excluded_business, excluded_staff, excluded_business_details, excluded_staff_details, available_vehicle_count, status_a_count, status_b_count, status_c_count, day_memo, is_handless_day, created_at, updated_at)
                VALUES (?, ?, '', '', '[]', '[]', 0, 0, 0, 0, ?, 0, ?, ?)
                """,
                (user["id"], schedule_date, day_memo, now, now),
            )
            row_id = cursor.lastrowid
        row = conn.execute(
            "SELECT schedule_date, day_memo, updated_at FROM work_schedule_day_notes WHERE id = ?",
            (row_id,),
        ).fetchone()
    return {"item": row_to_dict(row)}
