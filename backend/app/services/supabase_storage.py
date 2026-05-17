"""
Supabase Storage helpers — upload + signed URL via HTTP.

We use httpx directly rather than the supabase Python SDK to keep
the dependency footprint small (httpx + the service-role key is
all we need; the SDK adds 20MB+ for features we don't use).

Authentication: the SUPABASE_SERVICE_KEY env var (already present
in the codebase for other purposes). It bypasses RLS and grants
read/write across all buckets in the project.

Usage:
    from app.services.supabase_storage import upload_object, create_signed_url

    upload_object("print-orders", "orders/123/jane-front.jpg", jpg_bytes, "image/jpeg")
    url = create_signed_url("print-orders", "orders/123/jane-front.jpg", expires_in=86400)
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("supabase_storage")


def _base_url() -> str:
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return settings.supabase_url.rstrip("/")


def _service_key() -> str:
    if not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not configured")
    return settings.supabase_service_key


def _headers(extra: Optional[dict] = None) -> dict:
    key = _service_key()
    base = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }
    if extra:
        base.update(extra)
    return base


def ensure_bucket(bucket_id: str, *, public: bool = False) -> None:
    """Idempotently create a bucket. No-op if it already exists.

    Buckets persist across restarts so this only does HTTP work on
    the first run after a clean install. We swallow the "already
    exists" response so calling this on every job is safe.
    """
    url = f"{_base_url()}/storage/v1/bucket"
    payload = {"id": bucket_id, "name": bucket_id, "public": public}
    with httpx.Client(timeout=10) as client:
        resp = client.post(url, headers=_headers({"Content-Type": "application/json"}), json=payload)
    if resp.status_code in (200, 201):
        logger.info("Created Supabase Storage bucket %r", bucket_id)
        return
    # Bucket already exists → Supabase returns 400 / 409 with a
    # "duplicate" error in the body. Treat as success.
    body = resp.text.lower()
    if "already exists" in body or "duplicate" in body or resp.status_code == 409:
        return
    raise RuntimeError(
        f"Failed to ensure bucket {bucket_id!r}: HTTP {resp.status_code} — {resp.text[:200]}"
    )


def upload_object(
    bucket_id: str,
    path: str,
    content: bytes,
    content_type: str = "application/octet-stream",
) -> None:
    """Upload bytes to `{bucket_id}/{path}`. Upserts on conflict so
    retries are idempotent.
    """
    url = f"{_base_url()}/storage/v1/object/{bucket_id}/{path.lstrip('/')}"
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            url,
            headers=_headers({
                "Content-Type": content_type,
                "x-upsert": "true",
            }),
            content=content,
        )
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"Failed to upload to {bucket_id}/{path}: HTTP {resp.status_code} — {resp.text[:200]}"
        )


def create_signed_url(bucket_id: str, path: str, *, expires_in: int = 86400) -> str:
    """Generate a time-limited URL for downloading a private object.

    Default 24h expiry. Each call generates a fresh token even for
    the same path — Supabase doesn't deduplicate, and there's no
    cost to regenerating.
    """
    url = f"{_base_url()}/storage/v1/object/sign/{bucket_id}/{path.lstrip('/')}"
    with httpx.Client(timeout=10) as client:
        resp = client.post(
            url,
            headers=_headers({"Content-Type": "application/json"}),
            json={"expiresIn": expires_in},
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to sign {bucket_id}/{path}: HTTP {resp.status_code} — {resp.text[:200]}"
        )
    data = resp.json()
    signed_path = data.get("signedURL") or data.get("signed_url") or data.get("signedUrl")
    if not signed_path:
        raise RuntimeError(f"Sign response missing signedURL: {data!r}")
    if signed_path.startswith("http"):
        return signed_path
    # Supabase's signed-URL response sometimes omits the "/storage/v1"
    # gateway prefix and returns just "/object/sign/...". Without the
    # prefix the URL hits Supabase's main HTTP layer which doesn't know
    # how to route /object/* and returns {"error":"requested path is
    # invalid"}. Prepend defensively when missing.
    if not signed_path.startswith("/storage/v1"):
        signed_path = f"/storage/v1{signed_path}"
    return f"{_base_url()}{signed_path}"
