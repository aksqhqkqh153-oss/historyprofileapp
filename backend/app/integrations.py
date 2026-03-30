from __future__ import annotations
import base64, json, logging, urllib.parse, urllib.request
from typing import Any
from fastapi import HTTPException
from .constants import TURNSTILE_VERIFY_URL
from .settings import settings

logger = logging.getLogger("historyprofile_app.integrations")


def phone_to_e164(value: str, normalizer) -> str:
    digits = normalizer(value)
    if digits.startswith("82"):
        return f"+{digits}"
    if digits.startswith("0"):
        return "+82" + digits[1:]
    return "+" + digits


def verify_turnstile_token(token: str, remote_ip: str = "", expected_hostname: str = "") -> dict[str, Any]:
    if not settings.turnstile_enabled:
        return {"success": True, "skipped": True}
    if not token:
        raise HTTPException(status_code=400, detail="보안 확인이 필요합니다. CAPTCHA를 완료해주세요.")
    payload = urllib.parse.urlencode({"secret": settings.turnstile_secret_key, "response": token, "remoteip": remote_ip}).encode("utf-8")
    req = urllib.request.Request(TURNSTILE_VERIFY_URL, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        logger.exception("turnstile verification failed")
        raise HTTPException(status_code=502, detail=f"CAPTCHA 검증 중 오류가 발생했습니다: {exc}")
    if not data.get("success"):
        raise HTTPException(status_code=400, detail="보안 확인에 실패했습니다. 다시 시도해주세요.")
    hostname = str(data.get("hostname") or "")
    allowed = {h.strip() for h in settings.turnstile_allowed_hostnames if h.strip()}
    if expected_hostname:
        allowed.add(expected_hostname)
    if hostname and allowed and hostname not in allowed:
        raise HTTPException(status_code=400, detail="허용되지 않은 호스트의 CAPTCHA 응답입니다.")
    return data


def _twilio_request(path: str, payload: dict[str, str]) -> dict[str, Any]:
    service_sid = settings.twilio_verify_service_sid
    url = f"https://verify.twilio.com/v2/Services/{service_sid}/{path}"
    auth = base64.b64encode(f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode("utf-8")).decode("ascii")
    encoded = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(url, data=encoded, headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def send_sms_verification_code(phone: str, code: str, normalizer) -> dict[str, Any]:
    if not settings.twilio_verify_enabled:
        return {"provider": "demo", "status": "pending", "debug_code": code}
    try:
        data = _twilio_request("Verifications", {"To": phone_to_e164(phone, normalizer), "Channel": "sms", "CustomCode": code})
        return {"provider": "twilio_verify", "status": data.get("status", "pending"), "sid": data.get("sid", "")}
    except Exception as exc:
        logger.exception("sms send failed")
        raise HTTPException(status_code=502, detail=f"SMS 발송 중 오류가 발생했습니다: {exc}")


def verify_sms_code_provider(phone: str, code: str, normalizer) -> bool:
    if not settings.twilio_verify_enabled:
        return True
    try:
        data = _twilio_request("VerificationCheck", {"To": phone_to_e164(phone, normalizer), "Code": code})
        return data.get("status") == "approved" or bool(data.get("valid"))
    except Exception as exc:
        logger.exception("sms verify failed")
        raise HTTPException(status_code=502, detail=f"SMS 인증 확인 중 오류가 발생했습니다: {exc}")


def integration_status() -> dict[str, Any]:
    return {
        "turnstile": {
            "enabled": settings.turnstile_enabled,
            "site_key_configured": bool(settings.turnstile_site_key),
            "secret_configured": bool(settings.turnstile_secret_key),
            "allowed_hostnames": settings.turnstile_allowed_hostnames,
        },
        "twilio_verify": {
            "enabled": settings.twilio_verify_enabled,
            "account_sid_configured": bool(settings.twilio_account_sid),
            "auth_token_configured": bool(settings.twilio_auth_token),
            "service_sid_configured": bool(settings.twilio_verify_service_sid),
        },
    }
