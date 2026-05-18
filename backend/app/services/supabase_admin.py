"""
Supabase Auth admin lookups (server-side, service-role-key auth).

Used by the workspace invite flow: when Dani invites an email, we
look up whether that email already has a PlaceCard account so we can
either (a) drop a pending-membership row tied to their user_id and
notify them in-app, or (b) fall back to sending a magic-link signup.

The service-role key bypasses RLS and grants admin access — keep
these calls strictly server-side.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger("supabase_admin")


def _headers() -> dict:
    if not settings.supabase_service_key:
        raise RuntimeError("SUPABASE_SERVICE_KEY is not configured")
    return {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
    }


def find_user_id_by_email(email: str) -> Optional[str]:
    """Return the Supabase auth UUID for the user with this email, or
    None if no such user exists.

    Implementation: Supabase's admin/users endpoint does NOT actually
    filter by the `email` query param (it's silently ignored in current
    GoTrue). We list users page-by-page and match client-side. Cap at
    50 pages × 1000 per page (50k users) — well beyond any plausible
    workspace size and far cheaper than firing a wrong-path invite.
    """
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
    target = email.strip().lower()
    try:
        with httpx.Client(timeout=10) as client:
            for page in range(1, 51):
                resp = client.get(
                    url,
                    headers=_headers(),
                    params={"page": page, "per_page": 1000},
                )
                if resp.status_code != 200:
                    logger.warning(
                        "admin/users page %d returned %d: %s",
                        page, resp.status_code, resp.text[:200],
                    )
                    return None
                data = resp.json()
                users = data.get("users") if isinstance(data, dict) else None
                if not users:
                    return None
                for u in users:
                    if (u.get("email") or "").strip().lower() == target:
                        return u.get("id")
                # Short page = no more results.
                if len(users) < 1000:
                    return None
        logger.warning("admin/users lookup for %r exceeded page cap", email)
        return None
    except Exception:
        logger.exception("Supabase admin lookup failed for %r", email)
        return None


def send_signup_invite(email: str, redirect_to: Optional[str] = None) -> bool:
    """Send the Supabase Auth signup-invite magic link to an email
    that has NO PlaceCard account yet. Returns True on success.

    Caller still needs to drop a pending workspace_members row (with
    user_id=NULL) so the invite resolves on first signup.
    """
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/invite"
    payload: dict = {"email": email}
    if redirect_to:
        payload["redirect_to"] = redirect_to
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(url, headers=_headers(), json=payload)
        if resp.status_code >= 400:
            logger.warning(
                "signup-invite for %r returned %d: %s",
                email, resp.status_code, resp.text[:200],
            )
            return False
        return True
    except Exception:
        logger.exception("Supabase signup-invite failed for %r", email)
        return False
