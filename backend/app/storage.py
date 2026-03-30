from __future__ import annotations

import mimetypes
import subprocess
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import UploadFile

from .settings import settings

try:
    import boto3  # type: ignore
except Exception:  # pragma: no cover - optional for local dev
    boto3 = None

try:
    from PIL import Image, ImageOps
except Exception:  # pragma: no cover
    Image = None
    ImageOps = None


class StorageError(RuntimeError):
    pass


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename or '').suffix.lower()
    return suffix[:10]


def _safe_name(filename: str) -> str:
    stem = Path(filename or 'file').stem
    cleaned = ''.join(ch for ch in stem if ch.isalnum() or ch in {'-', '_'})
    cleaned = cleaned.strip('._-')
    return cleaned[:40] or 'file'


def _build_key(category: str, filename: str) -> str:
    now = datetime.utcnow()
    return f"{category}/{now:%Y/%m}/{uuid.uuid4().hex}-{_safe_name(filename)}{_safe_suffix(filename)}"


def _infer_content_type(upload: UploadFile) -> str:
    return upload.content_type or mimetypes.guess_type(upload.filename or '')[0] or 'application/octet-stream'


def _preview_key_for(key: str, suffix: str = '.jpg') -> str:
    path = Path(key)
    preview_name = f"{path.stem}-preview{suffix}"
    return str(path.with_name(preview_name)).replace('\\', '/')


def _build_image_preview(data: bytes) -> tuple[bytes, str] | tuple[None, None]:
    if Image is None:
        return None, None
    try:
        with Image.open(tempfile.SpooledTemporaryFile()) as _:  # pragma: no cover
            pass
    except Exception:
        pass
    try:
        import io
        im = Image.open(io.BytesIO(data))
        if ImageOps is not None:
            im = ImageOps.exif_transpose(im)
        im = im.convert('RGB')
        im.thumbnail((960, 960))
        buf = io.BytesIO()
        im.save(buf, format='JPEG', quality=82, optimize=True)
        return buf.getvalue(), 'image/jpeg'
    except Exception:
        return None, None


def _build_video_preview(data: bytes, suffix: str) -> tuple[bytes, str] | tuple[None, None]:
    try:
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / f'video{suffix or ".mp4"}'
            out = Path(td) / 'preview.jpg'
            src.write_bytes(data)
            cmd = [
                'ffmpeg', '-y', '-i', str(src), '-ss', '00:00:01.000', '-vframes', '1',
                '-vf', 'scale=960:-1:force_original_aspect_ratio=decrease', str(out)
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if out.exists() and out.stat().st_size > 0:
                return out.read_bytes(), 'image/jpeg'
    except Exception:
        return None, None
    return None, None


def _upload_bytes_to_r2(*, key: str, body: bytes, content_type: str) -> str:
    if boto3 is None:
        raise StorageError('R2 사용이 설정되었지만 boto3 가 설치되지 않았습니다.')
    client = boto3.client(
        's3',
        endpoint_url=settings.resolved_r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name='auto',
    )
    client.put_object(Bucket=settings.r2_bucket, Key=key, Body=body, ContentType=content_type)
    return f"{settings.r2_public_base_url}/{key}"


def save_upload(upload: UploadFile, category: str = 'general', max_bytes: int | None = None) -> dict:
    data = upload.file.read()
    effective_max_bytes = max_bytes if max_bytes is not None else settings.max_upload_mb * 1024 * 1024
    if len(data) > effective_max_bytes:
        raise StorageError(f'업로드 가능한 최대 용량은 {round(effective_max_bytes / 1024 / 1024)}MB 입니다.')

    key = _build_key(category, upload.filename or 'file')
    content_type = _infer_content_type(upload)
    suffix = _safe_suffix(upload.filename or '')

    preview_bytes = None
    preview_content_type = None
    if content_type.startswith('image/'):
        preview_bytes, preview_content_type = _build_image_preview(data)
    elif content_type.startswith('video/'):
        preview_bytes, preview_content_type = _build_video_preview(data, suffix)
    preview_key = _preview_key_for(key, '.jpg') if preview_bytes else ''

    if settings.r2_enabled:
        file_url = _upload_bytes_to_r2(key=key, body=data, content_type=content_type)
        preview_url = _upload_bytes_to_r2(key=preview_key, body=preview_bytes, content_type=preview_content_type) if preview_bytes and preview_content_type else ''
        return {
            'storage': 'r2',
            'key': key,
            'url': file_url,
            'preview_key': preview_key,
            'preview_url': preview_url,
            'content_type': content_type,
            'name': upload.filename or Path(key).name,
            'size': len(data),
        }

    settings.upload_root.mkdir(parents=True, exist_ok=True)
    file_path = settings.upload_root / key
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(data)
    preview_url = ''
    if preview_bytes:
        preview_path = settings.upload_root / preview_key
        preview_path.parent.mkdir(parents=True, exist_ok=True)
        preview_path.write_bytes(preview_bytes)
        preview_url = f"/uploads/{preview_key}"
    return {
        'storage': 'local',
        'key': key,
        'url': f"/uploads/{key}",
        'preview_key': preview_key,
        'preview_url': preview_url,
        'content_type': content_type,
        'name': upload.filename or Path(key).name,
        'size': len(data),
    }
