from __future__ import annotations

import mimetypes
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import UploadFile

from .settings import settings

try:
    import boto3  # type: ignore
except Exception:  # pragma: no cover - optional for local dev
    boto3 = None


class StorageError(RuntimeError):
    pass


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename or '').suffix.lower()
    return suffix[:10]


def _safe_name(filename: str) -> str:
    stem = Path(filename or 'file').stem
    cleaned = ''.join(ch for ch in stem if ch.isalnum() or ch in {'-', '_'}).strip('._-')
    return cleaned[:40] or 'file'


def _build_key(category: str, filename: str) -> str:
    now = datetime.utcnow()
    return f"{category}/{now:%Y/%m}/{uuid.uuid4().hex}-{_safe_name(filename)}{_safe_suffix(filename)}"


def _infer_content_type(upload: UploadFile) -> str:
    return upload.content_type or mimetypes.guess_type(upload.filename or '')[0] or 'application/octet-stream'


def save_upload(upload: UploadFile, category: str = 'general') -> dict:
    data = upload.file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise StorageError(f'업로드 가능한 최대 용량은 {settings.max_upload_mb}MB 입니다.')

    key = _build_key(category, upload.filename or 'file')
    content_type = _infer_content_type(upload)

    if settings.r2_enabled:
        if boto3 is None:
            raise StorageError('R2 사용이 설정되었지만 boto3 가 설치되지 않았습니다.')
        client = boto3.client(
            's3',
            endpoint_url=settings.resolved_r2_endpoint,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name='auto',
        )
        client.put_object(
            Bucket=settings.r2_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        url = f"{settings.r2_public_base_url}/{key}"
        return {
            'storage': 'r2',
            'key': key,
            'url': url,
            'content_type': content_type,
            'name': upload.filename or Path(key).name,
            'size': len(data),
        }

    settings.upload_root.mkdir(parents=True, exist_ok=True)
    file_path = settings.upload_root / key
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(data)
    return {
        'storage': 'local',
        'key': key,
        'url': f"/uploads/{key}",
        'content_type': content_type,
        'name': upload.filename or Path(key).name,
        'size': len(data),
    }
