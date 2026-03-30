from __future__ import annotations

import json
import logging
import random
import re
import threading
from dataclasses import dataclass
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .db import get_conn, utcnow
from .settings import get_settings

logger = logging.getLogger('icj24app.settlement_sync')


def _runtime_settings():
    return get_settings()


def _kst():
    cfg = _runtime_settings()
    return ZoneInfo(cfg.schedule_timezone or 'Asia/Seoul')


@dataclass
class SyncResult:
    ok: bool
    platform: str
    value: int
    detail: list[dict[str, Any]]
    message: str
    updated_at: str


PLATFORM_KEY_MAP: dict[str, dict[str, str]] = {
    '숨고': {
        'email_secret': 'soomgo_email',
        'password_secret': 'soomgo_password',
        'auth_state_secret': 'soomgo_storage_state',
        'auth_state_path_attr': 'settlement_auth_state_path',
        'email_attr': 'soomgo_email',
        'password_attr': 'soomgo_password',
        'email_env_attr': 'soomgo_email_env_name',
        'password_env_attr': 'soomgo_password_env_name',
    },
    '오늘': {
        'email_secret': 'ohou_email',
        'password_secret': 'ohou_password',
        'auth_state_secret': 'ohou_storage_state',
        'auth_state_path_attr': 'settlement_ohou_auth_state_path',
        'email_attr': 'ohou_email',
        'password_attr': 'ohou_password',
        'email_env_attr': 'ohou_email_env_name',
        'password_env_attr': 'ohou_password_env_name',
    },
}


def _platform_config(platform: str) -> dict[str, str]:
    if platform not in PLATFORM_KEY_MAP:
        raise RuntimeError(f'지원하지 않는 플랫폼입니다: {platform}')
    return PLATFORM_KEY_MAP[platform]


def _safe_int_from_text(text: str) -> int:
    digits = re.findall(r"\d+", text.replace(',', ''))
    if not digits:
        raise ValueError(f'숫자를 찾지 못했습니다: {text!r}')
    return int(''.join(digits))


def _load_saved_credentials(platform: str = '숨고') -> tuple[str, str]:
    cfg = _platform_config(platform)
    try:
        with get_conn() as conn:
            rows = conn.execute(
                'SELECT secret_key, secret_value FROM app_secrets WHERE secret_key IN (?, ?)',
                (cfg['email_secret'], cfg['password_secret']),
            ).fetchall()
    except Exception:
        logger.exception('failed to load saved settlement credentials platform=%s', platform)
        return '', ''
    values = {row['secret_key']: (row['secret_value'] or '').strip() for row in rows}
    return values.get(cfg['email_secret'], ''), values.get(cfg['password_secret'], '')


def _load_saved_auth_state(platform: str = '숨고') -> str:
    cfg = _platform_config(platform)
    try:
        with get_conn() as conn:
            row = conn.execute(
                'SELECT secret_value FROM app_secrets WHERE secret_key = ?',
                (cfg['auth_state_secret'],),
            ).fetchone()
    except Exception:
        logger.exception('failed to load saved settlement auth state platform=%s', platform)
        return ''
    return (row['secret_value'] or '').strip() if row else ''


def save_auth_state_json(raw_text: str, platform: str = '숨고') -> dict[str, Any]:
    text = (raw_text or '').strip()
    if not text:
        raise RuntimeError('인증 세션 JSON이 비어 있습니다.')
    try:
        data = json.loads(text)
    except Exception as exc:
        raise RuntimeError('인증 세션 JSON 형식이 올바르지 않습니다.') from exc
    if not isinstance(data, dict):
        raise RuntimeError('인증 세션 JSON 루트는 객체여야 합니다.')
    cookies = data.get('cookies') or []
    origins = data.get('origins') or []
    if not isinstance(cookies, list) or not isinstance(origins, list):
        raise RuntimeError('인증 세션 JSON 형식이 올바르지 않습니다.')
    compact = json.dumps({'cookies': cookies, 'origins': origins}, ensure_ascii=False)
    now_iso = utcnow()
    cfg = _platform_config(platform)
    with get_conn() as conn:
        conn.execute(
            'INSERT OR REPLACE INTO app_secrets(secret_key, secret_value, updated_at) VALUES (?, ?, ?)',
            (cfg['auth_state_secret'], compact, now_iso),
        )
    runtime = _runtime_settings()
    auth_state_path = Path(getattr(runtime, cfg['auth_state_path_attr']))
    auth_state_path.parent.mkdir(parents=True, exist_ok=True)
    auth_state_path.write_text(compact, encoding='utf-8')
    return {
        'saved': True,
        'platform': platform,
        'updated_at': now_iso,
        'cookie_count': len(cookies),
        'origin_count': len(origins),
    }




def get_auth_session_guide(platform: str = '숨고') -> dict[str, Any]:
    runtime = _runtime_settings()
    cfg = _platform_config(platform)
    auth_state_path = Path(getattr(runtime, cfg['auth_state_path_attr']))
    script_name = 'soomgo_capture_auth_state.py' if platform == '숨고' else 'ohou_capture_auth_state.py'
    login_url = runtime.soomgo_login_url if platform == '숨고' else runtime.ohou_login_url
    target_url = (runtime.soomgo_target_urls[0] if platform == '숨고' and runtime.soomgo_target_urls else '') or (runtime.ohou_target_url if platform == '오늘' else '')
    file_name = auth_state_path.name
    title = f'{platform} 인증세션 저장 설명서'
    summary = (
        f'{platform} 로그인 쿠키와 세션 정보를 Playwright storage_state JSON으로 만든 뒤, '
        '결산자료 > 설정 > 인증세션 화면에서 JSON 내용을 붙여 넣어 저장하는 절차입니다.'
    )
    required_materials = [
        f'{platform} 로그인 가능한 계정',
        'Windows PowerShell 또는 VS Code 터미널',
        'backend 가상환경(.venv)과 requirements 설치',
        '브라우저에서 실제 로그인을 마칠 수 있는 시간',
        '생성된 JSON 파일 내용을 복사할 수 있는 메모장 또는 VS Code',
    ]
    paths = [
        '프로젝트 루트: C:\\Users\\icj24\\Downloads\\icjapp',
        f'인증세션 생성 스크립트: backend\\scripts\\{script_name}',
        f'생성될 인증세션 파일 기본 경로: {auth_state_path}',
        '앱 내 저장 위치: 결산자료 > 설정 > 해당 플랫폼 인증세션 > JSON 입력칸',
        f'접속 확인 URL: {target_url or login_url}',
    ]
    commands = [
        'cd C:\\Users\\icj24\\Downloads\\icjapp',
        '.\\backend\\.venv\\Scripts\\python.exe -m pip install -r .\\backend\\requirements.txt',
        '.\\backend\\.venv\\Scripts\\python.exe -m playwright install chromium',
        f'.\\backend\\.venv\\Scripts\\python.exe .\\backend\\scripts\\{script_name}',
    ]
    if platform == '숨고':
        steps = [
            '터미널에서 프로젝트 루트로 이동합니다.',
            'backend 가상환경과 requirements, playwright chromium 이 설치되어 있는지 확인합니다.',
            f'`{script_name}` 스크립트를 실행하면 브라우저가 열립니다.',
            f'{login_url} 에서 숨고 계정으로 로그인합니다.',
            '추가 인증이나 캡차가 나오면 모두 직접 완료합니다.',
            '로그인이 끝나면 브라우저가 자동으로 storage_state JSON 을 저장합니다.',
            f'{file_name} 파일을 VS Code 또는 메모장으로 열어 JSON 전체를 복사합니다.',
            '앱의 결산자료 > 설정 > 숨고 인증세션 화면으로 이동합니다.',
            '복사한 JSON 을 입력칸에 붙여 넣고, 필요하면 같은 화면에서 아이디/비밀번호도 저장합니다.',
            '마지막으로 숨고 인증세션 저장 버튼을 눌러 서버 DB와 런타임 경로에 반영합니다.',
        ]
        timing = '로컬 브라우저에서 로그인이 끝나고, 생성된 soomgo storage_state JSON 전체를 복사한 직후에 눌러야 합니다. JSON 생성 전에 누르면 저장할 데이터가 없습니다.'
    else:
        steps = [
            '터미널에서 프로젝트 루트로 이동합니다.',
            'backend 가상환경과 requirements, playwright chromium 이 설치되어 있는지 확인합니다.',
            f'`{script_name}` 스크립트를 실행하면 브라우저가 열립니다.',
            f'{login_url} 로 접근해 오늘의집 파트너 계정으로 로그인합니다.',
            f'로그인 후 반드시 {target_url} 화면까지 최종 접근되었는지 확인합니다.',
            'moving/payment/cash 화면이 열린 상태에서 브라우저를 닫거나 스크립트 안내에 따라 종료해 storage_state JSON 을 생성합니다.',
            f'{file_name} 파일을 열어 JSON 전체를 복사합니다.',
            '앱의 결산자료 > 설정 > 오늘 인증세션 화면으로 이동합니다.',
            '복사한 JSON 을 입력칸에 붙여 넣고, 필요하면 오늘의집 아이디/비밀번호도 같이 저장합니다.',
            '마지막으로 오늘 인증세션 저장 버튼을 눌러 서버 DB와 런타임 경로에 반영합니다.',
            '그 다음 결산자료 화면의 데이터 연동 버튼을 눌러 실제 수집이 되는지 확인합니다.',
        ]
        timing = '오늘의집 로그인 후 moving/payment/cash 최종 페이지 접근까지 확인하고, 생성된 ohou storage_state JSON 전체를 복사한 직후에 눌러야 합니다. 즉, 로그인 검증이 끝난 뒤가 저장 타이밍입니다.'
    return {
        'platform': platform,
        'title': title,
        'summary': summary,
        'required_materials': required_materials,
        'paths': paths,
        'commands': commands,
        'steps': steps,
        'timing': timing,
    }
def _restore_auth_state_file(platform: str = '숨고') -> bool:
    runtime = _runtime_settings()
    cfg = _platform_config(platform)
    auth_state_path = Path(getattr(runtime, cfg['auth_state_path_attr']))
    raw = _load_saved_auth_state(platform)
    if not raw:
        return auth_state_path.exists()
    auth_state_path.parent.mkdir(parents=True, exist_ok=True)
    auth_state_path.write_text(raw, encoding='utf-8')
    return True


def _credential_summary(platform: str = '숨고') -> dict[str, str | bool]:
    runtime = _runtime_settings()
    cfg = _platform_config(platform)
    email = (getattr(runtime, cfg['email_attr']) or '').strip()
    password = (getattr(runtime, cfg['password_attr']) or '').strip()
    email_source = getattr(runtime, cfg['email_env_attr']) or ''
    password_source = getattr(runtime, cfg['password_env_attr']) or ''
    if not email or not password:
        saved_email, saved_password = _load_saved_credentials(platform)
        if saved_email:
            email = saved_email
            email_source = 'db_saved'
        if saved_password:
            password = saved_password
            password_source = 'db_saved'
    auth_state_present = bool(_load_saved_auth_state(platform))
    return {
        'platform': platform,
        'configured': bool(email and password),
        'email_env': email_source,
        'password_env': password_source,
        'email_present': bool(email),
        'password_present': bool(password),
        'auth_state_present': auth_state_present,
    }


class SettlementSyncService:
    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._run_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._is_running = False
        self._last_started_at = ''
        self._last_finished_at = ''
        self._last_message = '대기중'
        self._last_ok = None
        self._next_run_at = ''
        self._last_final_sync_date = ''

    def start(self):
        cfg = _runtime_settings()
        if not cfg.settlement_sync_enabled:
            logger.info('settlement sync disabled by environment')
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._plan_next_run(reason='startup')
        self._thread = threading.Thread(target=self._loop, name='settlement-sync-loop', daemon=True)
        self._thread.start()
        logger.info('settlement sync background thread started')

    def stop(self):
        self._stop_event.set()

    def status(self) -> dict[str, Any]:
        with self._state_lock:
            base = {
                'enabled': _runtime_settings().settlement_sync_enabled,
                'is_running': self._is_running,
                'last_started_at': self._last_started_at,
                'last_finished_at': self._last_finished_at,
                'last_message': self._last_message,
                'last_ok': self._last_ok,
                'next_run_at': self._next_run_at,
                'window': {
                    'timezone': _runtime_settings().schedule_timezone,
                    'weekdays': ['월', '화', '수', '목', '금'],
                    'start_hour': _runtime_settings().settlement_sync_start_hour,
                    'end_hour': _runtime_settings().settlement_sync_end_hour,
                    'random_min_minutes': _runtime_settings().settlement_sync_random_min_minutes,
                    'random_max_minutes': _runtime_settings().settlement_sync_random_max_minutes,
                },
                'configs': {
                    '숨고': _credential_summary('숨고'),
                    '오늘': _credential_summary('오늘'),
                },
            }
        base['config'] = base['configs']['숨고']
        base['platforms'] = self.fetch_latest_metrics()
        return base

    def fetch_latest_metrics(self) -> dict[str, Any]:
        items: dict[str, Any] = {}
        with get_conn() as conn:
            rows = conn.execute(
                """
                SELECT platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at
                FROM settlement_platform_metrics
                WHERE metric_key = 'platform_send_count'
                ORDER BY platform
                """
            ).fetchall()
        for row in rows:
            detail = []
            try:
                detail = json.loads(row['detail_json'] or '[]')
            except Exception:
                detail = []
            items[row['platform']] = {
                'platform': row['platform'],
                'metric_key': row['metric_key'],
                'value': int(row['metric_value'] or 0),
                'detail': detail,
                'sync_status': row['sync_status'] or 'idle',
                'sync_message': row['sync_message'] or '',
                'updated_at': row['updated_at'] or '',
            }
        for name in ('숨고', '오늘', '공홈'):
            items.setdefault(name, {
                'platform': name,
                'metric_key': 'platform_send_count',
                'value': 0,
                'detail': [],
                'sync_status': 'idle',
                'sync_message': '데이터 없음',
                'updated_at': '',
            })
        return items

    def run_once(self, trigger: str = 'manual') -> dict[str, Any]:
        cfg = _runtime_settings()
        if not cfg.settlement_sync_enabled:
            raise RuntimeError('결산 자동 연동 기능이 비활성화되어 있습니다.')
        acquired = self._run_lock.acquire(blocking=False)
        if not acquired:
            raise RuntimeError('이미 데이터 연동이 진행 중입니다. 잠시 후 다시 시도해 주세요.')
        errors: list[str] = []
        success_count = 0
        try:
            self._set_running(True, f'{trigger} 연동 시작')
            self._last_started_at = utcnow()
            for platform, sync_func in [('숨고', self._sync_soomgo_platform_count), ('오늘', self._sync_ohou_platform_count)]:
                try:
                    result = sync_func(trigger=trigger)
                    self._store_result(result, trigger=trigger)
                    success_count += 1
                except Exception as exc:
                    logger.exception('platform sync failed platform=%s error=%s', platform, exc)
                    now_iso = utcnow()
                    self._store_failure(platform, str(exc), now_iso, trigger=trigger)
                    errors.append(f'{platform}: {exc}')
            self._last_finished_at = utcnow()
            self._last_ok = not errors
            if errors and success_count:
                self._last_message = f'부분 완료 · ' + ' / '.join(errors)
            elif errors:
                self._last_message = '연동 실패 · ' + ' / '.join(errors)
                raise RuntimeError(self._last_message)
            else:
                self._last_message = '숨고/오늘 데이터 연동 완료'
            if trigger != 'manual':
                self._plan_next_run(reason='post-sync')
            return self.status()
        except Exception:
            self._last_finished_at = utcnow()
            self._last_ok = False
            if trigger != 'manual':
                self._plan_next_run(reason='error')
            raise
        finally:
            self._set_running(False, self._last_message)
            self._run_lock.release()

    def _set_running(self, running: bool, message: str):
        with self._state_lock:
            self._is_running = running
            self._last_message = message

    def _store_failure(self, platform: str, message: str, now_iso: str, trigger: str):
        detail_json = json.dumps([{'trigger': trigger, 'message': message}], ensure_ascii=False)
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO settlement_platform_metrics(platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at)
                VALUES (?, 'platform_send_count', 0, ?, 'error', ?, ?)
                """,
                (platform, detail_json, message[:500], now_iso),
            )
            conn.execute(
                """
                INSERT INTO settlement_sync_history(platform, trigger_type, sync_status, metric_value, detail_json, message, created_at)
                VALUES (?, ?, 'error', 0, ?, ?, ?)
                """,
                (platform, trigger, detail_json, message[:500], now_iso),
            )

    def _store_result(self, result: SyncResult, trigger: str):
        detail_json = json.dumps(result.detail, ensure_ascii=False)
        status = 'success' if result.ok else 'error'
        with get_conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO settlement_platform_metrics(platform, metric_key, metric_value, detail_json, sync_status, sync_message, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (result.platform, 'platform_send_count', result.value, detail_json, status, result.message[:500], result.updated_at),
            )
            conn.execute(
                """
                INSERT INTO settlement_sync_history(platform, trigger_type, sync_status, metric_value, detail_json, message, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (result.platform, trigger, status, result.value, detail_json, result.message[:500], result.updated_at),
            )

    def _loop(self):
        while not self._stop_event.is_set():
            try:
                if self._should_run_now():
                    try:
                        self.run_once(trigger='schedule')
                    except Exception:
                        pass
            except Exception:
                logger.exception('settlement sync loop error')
            self._stop_event.wait(30)

    def _now(self) -> datetime:
        return datetime.now(_kst())

    def _is_business_day(self, current: datetime) -> bool:
        return current.weekday() < 5

    def _window_open_dt(self, current: datetime) -> datetime:
        cfg = _runtime_settings()
        return current.replace(hour=cfg.settlement_sync_start_hour, minute=0, second=0, microsecond=0)

    def _window_final_dt(self, current: datetime) -> datetime:
        cfg = _runtime_settings()
        return current.replace(hour=cfg.settlement_sync_end_hour, minute=0, second=0, microsecond=0)

    def _next_business_start(self, current: datetime) -> datetime:
        probe = current
        while True:
            cfg = _runtime_settings()
            probe = (probe + timedelta(days=1)).replace(hour=cfg.settlement_sync_start_hour, minute=0, second=0, microsecond=0)
            if self._is_business_day(probe):
                return probe

    def _plan_next_run(self, reason: str):
        now = self._now()
        with self._state_lock:
            if not self._is_business_day(now):
                next_dt = self._next_business_start(now)
            else:
                start_dt = self._window_open_dt(now)
                final_dt = self._window_final_dt(now)
                if now < start_dt:
                    next_dt = start_dt + timedelta(minutes=random.randint(0, 10))
                elif now >= final_dt:
                    next_dt = self._next_business_start(now)
                else:
                    cfg = _runtime_settings()
                    delta = timedelta(minutes=random.randint(cfg.settlement_sync_random_min_minutes, cfg.settlement_sync_random_max_minutes))
                    candidate = now + delta
                    if candidate >= final_dt:
                        next_dt = final_dt
                    else:
                        next_dt = candidate
            self._next_run_at = next_dt.isoformat()
            logger.info('settlement next run planned reason=%s at=%s', reason, self._next_run_at)

    def _should_run_now(self) -> bool:
        if not _runtime_settings().settlement_sync_enabled:
            return False
        now = self._now()
        if not self._is_business_day(now):
            return False
        start_dt = self._window_open_dt(now)
        final_dt = self._window_final_dt(now)
        if now < start_dt:
            return False
        today_key = now.date().isoformat()
        if now >= final_dt:
            if self._last_final_sync_date == today_key:
                return False
            self._last_final_sync_date = today_key
            return True
        with self._state_lock:
            if not self._next_run_at:
                self._plan_next_run(reason='empty')
                return False
            try:
                next_dt = datetime.fromisoformat(self._next_run_at)
            except Exception:
                self._plan_next_run(reason='parse-fail')
                return False
        return now >= next_dt

    def _resolve_credentials(self, platform: str) -> tuple[str, str, dict[str, Any]]:
        runtime = _runtime_settings()
        cfg = _platform_config(platform)
        summary = _credential_summary(platform)
        email = (getattr(runtime, cfg['email_attr']) or '').strip()
        password = (getattr(runtime, cfg['password_attr']) or '').strip()
        if summary.get('email_env') == 'db_saved' or summary.get('password_env') == 'db_saved' or not email or not password:
            saved_email, saved_password = _load_saved_credentials(platform)
            email = email or saved_email
            password = password or saved_password
        return email, password, summary

    def _ensure_login(self, page, context):
        email, password, summary = self._resolve_credentials('숨고')
        if not email or not password:
            raise RuntimeError(
                f'숨고 계정 정보가 설정되지 않았습니다. 현재 감지된 변수: '
                f'email={summary.get("email_env") or "없음"}, password={summary.get("password_env") or "없음"}. '
                '결산자료 화면에서 숨고 계정을 직접 저장해 사용할 수 있습니다.'
            )
        cfg = _runtime_settings()
        login_url = cfg.soomgo_login_url.strip() or 'https://soomgo.com/login'
        page.goto(login_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
        page.wait_for_timeout(1500)
        email_selectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[autocomplete="username"]',
            'input[name="id"]',
            'input[placeholder*="이메일"]',
        ]
        password_selectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
        ]
        submit_selectors = [
            'button[type="submit"]',
            'button:has-text("로그인")',
            'button:has-text("Login")',
            'input[type="submit"]',
        ]
        email_filled = False
        for selector in email_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    target = loc.first
                    target.click(timeout=2000)
                    try:
                        target.press('Control+A', timeout=1000)
                        target.press('Delete', timeout=1000)
                    except Exception:
                        pass
                    target.type(email, delay=random.randint(45, 110), timeout=4000)
                    email_filled = True
                    break
                except Exception:
                    continue
        if not email_filled:
            raise RuntimeError('숨고 로그인 이메일 입력창을 찾지 못했습니다.')
        password_filled = False
        for selector in password_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    target = loc.first
                    target.click(timeout=2000)
                    try:
                        target.press('Control+A', timeout=1000)
                        target.press('Delete', timeout=1000)
                    except Exception:
                        pass
                    target.type(password, delay=random.randint(45, 110), timeout=4000)
                    password_filled = True
                    break
                except Exception:
                    continue
        if not password_filled:
            raise RuntimeError('숨고 로그인 비밀번호 입력창을 찾지 못했습니다.')
        submitted = False
        for selector in submit_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    loc.first.click(timeout=3000)
                    submitted = True
                    break
                except Exception:
                    continue
        if not submitted:
            page.keyboard.press('Enter')
        page.wait_for_timeout(3000)
        if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
            raise RuntimeError('숨고 로그인 이후에도 로그인 화면이 유지됩니다. 추가 인증/캡차 여부를 확인해 주세요.')
        auth_state_path = Path(cfg.settlement_auth_state_path)
        _restore_auth_state_file('숨고')
        auth_state_path.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(auth_state_path))
        try:
            save_auth_state_json(auth_state_path.read_text(encoding='utf-8'), platform='숨고')
        except Exception:
            logger.exception('failed to persist auth state into db after soomgo login')

    def _ensure_ohou_login(self, page, context):
        email, password, summary = self._resolve_credentials('오늘')
        if not email or not password:
            raise RuntimeError(
                f'오늘의집 계정 정보가 설정되지 않았습니다. 현재 감지된 변수: '
                f'email={summary.get("email_env") or "없음"}, password={summary.get("password_env") or "없음"}. '
                '결산자료 화면에서 오늘 계정을 직접 저장해 사용할 수 있습니다.'
            )
        cfg = _runtime_settings()
        login_url = cfg.ohou_login_url.strip() or 'https://o2o-partner.ohou.se/moving/payment/cash'
        page.goto(login_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
        page.wait_for_timeout(2000)
        email_selectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[autocomplete="username"]',
            'input[name="id"]',
            'input[placeholder*="이메일"]',
            'input[placeholder*="ID"]',
        ]
        password_selectors = [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
        ]
        submit_selectors = [
            'button[type="submit"]',
            'button:has-text("로그인")',
            'button:has-text("Login")',
            'input[type="submit"]',
        ]
        for selector, value, label in [(email_selectors, email, '이메일'), (password_selectors, password, '비밀번호')]:
            filled = False
            for item in selector:
                loc = page.locator(item)
                if loc.count() > 0:
                    try:
                        target = loc.first
                        target.click(timeout=3000)
                        try:
                            target.press('Control+A', timeout=1000)
                            target.press('Delete', timeout=1000)
                        except Exception:
                            pass
                        target.type(value, delay=random.randint(40, 100), timeout=5000)
                        filled = True
                        break
                    except Exception:
                        continue
            if not filled:
                raise RuntimeError(f'오늘의집 로그인 {label} 입력창을 찾지 못했습니다.')
        submitted = False
        for selector in submit_selectors:
            loc = page.locator(selector)
            if loc.count() > 0:
                try:
                    loc.first.click(timeout=3000)
                    submitted = True
                    break
                except Exception:
                    continue
        if not submitted:
            page.keyboard.press('Enter')
        page.wait_for_timeout(4000)
        target_url = cfg.ohou_target_url.strip() or login_url
        if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
            raise RuntimeError('오늘의집 로그인 이후에도 로그인 화면이 유지됩니다. 추가 인증 여부를 확인해 주세요.')
        if target_url:
            page.goto(target_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
            page.wait_for_timeout(2500)
            if not page.url.startswith(target_url):
                raise RuntimeError(f'오늘의집 로그인 후 최종 페이지 접근에 실패했습니다. 현재 URL: {page.url}')
        auth_state_path = Path(cfg.settlement_ohou_auth_state_path)
        _restore_auth_state_file('오늘')
        auth_state_path.parent.mkdir(parents=True, exist_ok=True)
        context.storage_state(path=str(auth_state_path))
        try:
            save_auth_state_json(auth_state_path.read_text(encoding='utf-8'), platform='오늘')
        except Exception:
            logger.exception('failed to persist auth state into db after ohou login')

    def _sync_soomgo_platform_count(self, trigger: str) -> SyncResult:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise RuntimeError('playwright 가 설치되지 않았습니다. backend requirements 설치 후 playwright install chromium 을 실행해 주세요.') from exc
        cfg = _runtime_settings()
        urls = [u.strip() for u in cfg.soomgo_target_urls if str(u).strip()]
        if not urls:
            raise RuntimeError('숨고 대상 URL이 설정되지 않았습니다.')
        auth_state_path = Path(cfg.settlement_auth_state_path)
        _restore_auth_state_file('숨고')
        screenshot_dir = Path(cfg.settlement_runtime_dir) / 'settlement_sync'
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        total = 0
        detail: list[dict[str, Any]] = []
        now_iso = utcnow()
        xpath = cfg.soomgo_value_xpath.strip() or '//*[@id="__next"]/main/div/div[2]/div[2]/div[1]/p[1]'
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=cfg.settlement_playwright_headless)
            context_kwargs: dict[str, Any] = {}
            if auth_state_path.exists():
                context_kwargs['storage_state'] = str(auth_state_path)
            context = browser.new_context(**context_kwargs)
            page = context.new_page()
            page.set_default_timeout(cfg.settlement_playwright_timeout_ms)
            for index, url in enumerate(urls):
                page.goto(url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
                page.wait_for_timeout(1500)
                if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
                    self._ensure_login(page, context)
                    page.goto(url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
                    page.wait_for_timeout(1500)
                locator = page.locator(f'xpath={xpath}')
                text = locator.first.inner_text().strip()
                value = _safe_int_from_text(text)
                total += value
                shot_path = screenshot_dir / f'soomgo_{index + 1}.png'
                try:
                    page.screenshot(path=str(shot_path), full_page=False)
                except Exception:
                    pass
                detail.append({'url': url, 'raw_text': text, 'value': value})
            context.storage_state(path=str(auth_state_path))
            try:
                save_auth_state_json(auth_state_path.read_text(encoding='utf-8'), platform='숨고')
            except Exception:
                logger.exception('failed to persist auth state into db after soomgo sync')
            context.close()
            browser.close()
        message = f'숨고 발송 건수 합계 {total}건 동기화 완료'
        return SyncResult(ok=True, platform='숨고', value=total, detail=detail, message=message, updated_at=now_iso)

    def _today_match_patterns(self) -> list[str]:
        now = self._now()
        yyyy = now.year
        m = now.month
        d = now.day
        mm = f'{m:02d}'
        dd = f'{d:02d}'
        return [
            f'{yyyy}.{m}.{d}', f'{yyyy}.{mm}.{dd}',
            f'{yyyy}-{mm}-{dd}',
            f'{m}.{d}', f'{mm}.{dd}',
            f'{m}/{d}', f'{mm}/{dd}',
            f'{m}월 {d}일', f'{mm}월 {dd}일',
        ]

    def _extract_ohou_accept_sections(self, page, section_xpath: str, accept_keyword: str, patterns: list[str]) -> tuple[int, list[dict[str, Any]]]:
        now = self._now()
        today_key = f"{now.year}-{now.month:02d}-{now.day:02d}"
        analysis: list[dict[str, Any]] = page.evaluate(
            """
            ({ sectionXPath, acceptKeyword, todayKey, patterns }) => {
              const snapshot = document.evaluate(
                sectionXPath,
                document,
                null,
                XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
                null,
              );
              const sections = [];
              const normalizedKeyword = String(acceptKeyword || '').trim();
              const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
              const parseDateKey = (value) => {
                const raw = normalizeText(value);
                const match = raw.match(/(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*\.?/);
                if (!match) return '';
                const year = match[1];
                const month = String(Number(match[2])).padStart(2, '0');
                const day = String(Number(match[3])).padStart(2, '0');
                return `${year}-${month}-${day}`;
              };
              for (let i = 0; i < snapshot.snapshotLength; i += 1) {
                const section = snapshot.snapshotItem(i);
                if (!section) continue;
                const text = normalizeText(section.innerText || section.textContent || '');
                const primaryContainer = section.querySelector('div') || section;
                const firstPNode = primaryContainer.querySelector('p:nth-of-type(1)');
                const secondPNode = primaryContainer.querySelector('p:nth-of-type(2)');
                const pTexts = Array.from(section.querySelectorAll('p'))
                  .map(node => normalizeText(node.innerText || node.textContent || ''))
                  .filter(Boolean);
                const firstPText = normalizeText(firstPNode?.innerText || firstPNode?.textContent || pTexts[0] || '');
                const secondPText = normalizeText(secondPNode?.innerText || secondPNode?.textContent || pTexts[1] || '');
                const parsedDateKey = parseDateKey(secondPText);
                const hasAcceptInText = normalizedKeyword ? text.includes(normalizedKeyword) : false;
                const hasAcceptInFirstP = normalizedKeyword ? firstPText.includes(normalizedKeyword) : false;
                const hasAcceptInPList = normalizedKeyword ? pTexts.some(item => item.includes(normalizedKeyword)) : false;
                const hasTodayInSecondP = parsedDateKey === todayKey;
                const hasTodayAnywhere = patterns.some(pattern => text.includes(pattern));
                sections.push({
                  section_index: i + 1,
                  raw_text: text.slice(0, 2000),
                  first_p_text: firstPText,
                  second_p_text: secondPText,
                  paragraph_texts: pTexts.slice(0, 8),
                  parsed_date_key: parsedDateKey,
                  has_accept_keyword: hasAcceptInText,
                  has_accept_in_first_p: hasAcceptInFirstP,
                  has_accept_in_paragraphs: hasAcceptInPList,
                  has_today_date: hasTodayInSecondP,
                  has_today_date_anywhere: hasTodayAnywhere,
                });
              }
              return sections;
            }
            """,
            {
                'sectionXPath': section_xpath,
                'acceptKeyword': accept_keyword,
                'todayKey': today_key,
                'patterns': patterns,
            },
        ) or []
        if not isinstance(analysis, list):
            analysis = []

        matched = [
            item for item in analysis
            if item.get('has_accept_in_first_p') and item.get('has_today_date')
        ]
        for item in analysis:
            item['matched'] = item in matched
            item['match_reason'] = (
                'keyword-in-first-p+exact-date(second-p)' if item in matched else
                'date-only' if item.get('has_today_date') else
                'keyword-only' if (item.get('has_accept_in_first_p') or item.get('has_accept_in_paragraphs') or item.get('has_accept_keyword')) else
                'not-matched'
            )
        return len(matched), analysis

    def _sync_ohou_platform_count(self, trigger: str) -> SyncResult:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise RuntimeError('playwright 가 설치되지 않았습니다. backend requirements 설치 후 playwright install chromium 을 실행해 주세요.') from exc
        cfg = _runtime_settings()
        auth_state_path = Path(cfg.settlement_ohou_auth_state_path)
        _restore_auth_state_file('오늘')
        screenshot_dir = Path(cfg.settlement_runtime_dir) / 'settlement_sync'
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        now_iso = utcnow()
        target_url = cfg.ohou_target_url.strip() or 'https://o2o-partner.ohou.se/moving/payment/cash'
        section_xpath = cfg.ohou_section_xpath.strip() or '//*[@id="__next"]/div[1]/main/div[2]/section/div[2]/div/div[2]/section'
        container_xpath = cfg.ohou_container_xpath.strip() or '//*[@id="__next"]/div[1]/main/div[2]/section/div[2]/div/div[2]'
        accept_keyword = (cfg.ohou_accept_keyword or '오더 수락').strip()
        detail: list[dict[str, Any]] = []
        total = 0
        patterns = self._today_match_patterns()
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=cfg.settlement_playwright_headless)
            context_kwargs: dict[str, Any] = {}
            if auth_state_path.exists():
                context_kwargs['storage_state'] = str(auth_state_path)
            context = browser.new_context()
            if context_kwargs:
                context.close()
                context = browser.new_context(**context_kwargs)
            page = context.new_page()
            page.set_default_timeout(cfg.settlement_playwright_timeout_ms)
            page.goto(target_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
            page.wait_for_timeout(2500)
            if 'login' in page.url.lower() or page.locator('input[type="password"]').count() > 0:
                self._ensure_ohou_login(page, context)
                page.goto(target_url, wait_until='domcontentloaded', timeout=cfg.settlement_playwright_timeout_ms)
                page.wait_for_timeout(2500)
            if not page.url.startswith(target_url):
                raise RuntimeError(f'오늘의집 최종 접근 URL이 예상과 다릅니다. 현재 URL: {page.url}')
            container = page.locator(f'xpath={container_xpath}').first
            container.wait_for(timeout=cfg.settlement_playwright_timeout_ms)
            page.wait_for_timeout(1500)
            try:
                container.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass
            container_text = container.inner_text().strip()
            sections = page.locator(f'xpath={section_xpath}')
            count = sections.count()
            if count <= 0:
                raise RuntimeError('오늘의집 정산 섹션을 찾지 못했습니다.')
            total, detail = self._extract_ohou_accept_sections(page, section_xpath, accept_keyword, patterns)
            shot_path = screenshot_dir / 'ohou_payment_cash.png'
            try:
                page.screenshot(path=str(shot_path), full_page=False)
            except Exception:
                pass
            context.storage_state(path=str(auth_state_path))
            try:
                save_auth_state_json(auth_state_path.read_text(encoding='utf-8'), platform='오늘')
            except Exception:
                logger.exception('failed to persist auth state into db after ohou sync')
            context.close()
            browser.close()
        if accept_keyword not in container_text:
            raise RuntimeError(f'오늘의집 데이터 영역에서 "{accept_keyword}" 문구를 찾지 못했습니다.')
        if total <= 0:
            logger.info('ohou sync completed with zero matched sections based on second p date text and keyword')
        message = f'오늘의집 당일 날짜 일치 오더 수락 섹션 {total}건 동기화 완료'
        return SyncResult(ok=True, platform='오늘', value=total, detail=detail, message=message, updated_at=now_iso)


settlement_sync_service = SettlementSyncService()
