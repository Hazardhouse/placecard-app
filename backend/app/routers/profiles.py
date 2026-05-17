"""
Host profile endpoints — the public-facing identity layer.

  GET    /api/profiles/me                  — auth, auto-provisions on first call
  PATCH  /api/profiles/me                  — auth, update bio/handle/visibility/etc.
  POST   /api/profiles/me/photo            — auth, upload base64 → Supabase Storage
  GET    /api/profiles/handle/available    — auth, candidate handle availability
  GET    /api/profiles/handle/{handle}     — public, returns the profile + hosted events

The auto-provisioning shape (creating a personal workspace + a default
profile + an auto-generated handle on first authenticated request) is
intentional: it means the frontend never has to call a "create profile"
endpoint, and there's never a window where an authenticated user has no
identity row. Visibility for new profiles defaults to 'public' — the
user can dial it down from the account screen.
"""
from __future__ import annotations

import base64
import logging
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models.event import Event
from app.models.profile import Profile
from app.models.workspace import Workspace
from app.schemas.profile import (
    HandleAvailabilityResponse,
    HostedEventSummary,
    ProfilePhotoUploadRequest,
    ProfilePhotoUploadResponse,
    ProfileResponse,
    ProfileUpdateRequest,
    PublicProfileResponse,
)
from app.services import handles
from app.services.supabase_storage import ensure_bucket, upload_object

logger = logging.getLogger("profiles")

PROFILE_PHOTOS_BUCKET = "profile-photos"
_VALID_VISIBILITY = {"public", "unlisted", "private"}
_MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB — generous; we resize client-side

# Authenticated routes — me/* and handle availability.
router = APIRouter(
    prefix="/api/profiles",
    tags=["profiles"],
    dependencies=[Depends(get_current_user)],
)

# Public route — reading a profile by handle. Separated so the
# router-level auth dep doesn't apply.
public_router = APIRouter(prefix="/api/profiles", tags=["profiles"])


# ── Helpers ────────────────────────────────────────────────────────────


def _profile_to_response(p: Profile) -> ProfileResponse:
    return ProfileResponse(
        user_id=p.user_id,
        handle=p.handle,
        display_name=p.display_name,
        photo_url=p.photo_url,
        bio=p.bio,
        city=p.city,
        visibility=p.visibility,
        created_at=p.created_at.isoformat(),
    )


def _derive_display_name(user: CurrentUser, override: Optional[str]) -> str:
    if override and override.strip():
        return override.strip()[:120]
    if user.email:
        # `dani@hazardhouse.co` → `Dani`. Crude but fine until the user edits.
        local = user.email.split("@")[0]
        local = re.sub(r"[^A-Za-z\s]", " ", local).strip() or local
        return local[:120].title()
    return "Host"


def _ensure_personal_workspace(db: Session, user: CurrentUser) -> Workspace:
    """Find or create the user's invisible personal workspace.

    Slug is `user-{first 8 of UUID}` — readable enough to recognise in
    admin tools, unique enough across all users (UUID prefix collision
    risk is negligible at our scale).
    """
    slug = f"user-{user.id[:8]}"
    ws = db.query(Workspace).filter(Workspace.slug == slug).first()
    if ws:
        return ws
    ws = Workspace(slug=slug, name=f"Personal — {user.id[:8]}", plan_tier="personal")
    db.add(ws)
    db.flush()
    return ws


def _provision_profile(db: Session, user: CurrentUser, display_name_hint: Optional[str]) -> Profile:
    """Create the workspace + profile pair on first authenticated load.
    Caller commits.
    """
    ws = _ensure_personal_workspace(db, user)
    display_name = _derive_display_name(user, display_name_hint)
    handle = handles.auto_generate_handle(db, display_name)
    profile = Profile(
        user_id=user.id,
        workspace_id=ws.id,
        handle=handle,
        display_name=display_name,
        visibility="public",
    )
    db.add(profile)
    db.flush()
    logger.info("Provisioned profile for user %s with handle %s", user.id, handle)
    return profile


def _get_or_provision(
    db: Session, user: CurrentUser, display_name_hint: Optional[str] = None
) -> Profile:
    profile = db.query(Profile).filter(Profile.user_id == user.id).first()
    if profile:
        return profile
    profile = _provision_profile(db, user, display_name_hint)
    db.commit()
    db.refresh(profile)
    return profile


def _event_to_summary(event: Event) -> HostedEventSummary:
    return HostedEventSummary(
        id=event.id,
        name=event.name,
        public_token=event.public_token,
        start_date=event.start_date.isoformat() if event.start_date else None,
        end_date=event.end_date.isoformat() if event.end_date else None,
        location=event.location,
        venue=event.venue,
        image_data=event.image_data,
        is_private=False,  # Phase I-B will wire this up
    )


# ── /me endpoints ──────────────────────────────────────────────────────


@router.get("/me", response_model=ProfileResponse)
def get_my_profile(
    request: Request,
    display_name_hint: Optional[str] = Query(
        None,
        description=(
            "Optional display-name seed used the very first time a profile is "
            "auto-provisioned. The frontend passes the Supabase user metadata "
            "full_name here so the auto-handle isn't derived from an email "
            "local-part. Ignored once a profile exists."
        ),
    ),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the caller's profile. Provisions one on first call (and
    creates the user's invisible personal workspace alongside).
    """
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    profile = _get_or_provision(db, user, display_name_hint)
    return _profile_to_response(profile)


@router.patch("/me", response_model=ProfileResponse)
def update_my_profile(
    payload: ProfileUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    profile = _get_or_provision(db, user)

    if payload.display_name is not None:
        cleaned = payload.display_name.strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        profile.display_name = cleaned[:120]

    if payload.handle is not None:
        candidate = handles.normalize_handle(payload.handle)
        reason = handles.reason_unavailable(db, candidate, exclude_user_id=user.id)
        if reason:
            raise HTTPException(status_code=400, detail=reason)
        profile.handle = candidate

    if payload.bio is not None:
        # 280 chars matches the "short bio" framing in the architecture doc.
        # Bumping the cap later costs a migration only because of the Text
        # column type — we still want to discourage essays.
        profile.bio = payload.bio.strip()[:280] or None

    if payload.city is not None:
        profile.city = payload.city.strip()[:120] or None

    if payload.visibility is not None:
        if payload.visibility not in _VALID_VISIBILITY:
            raise HTTPException(
                status_code=400,
                detail=f"visibility must be one of {sorted(_VALID_VISIBILITY)}",
            )
        profile.visibility = payload.visibility

    db.commit()
    db.refresh(profile)
    return _profile_to_response(profile)


@router.post("/me/photo", response_model=ProfilePhotoUploadResponse)
def upload_my_photo(
    payload: ProfilePhotoUploadRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Decode + persist a base64 profile photo to Supabase Storage.

    The bucket is public-read, so the returned URL is shareable
    directly without signing (avatars are the canonical "no privacy
    needed" asset).
    """
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not settings.supabase_url or not settings.supabase_service_key:
        raise HTTPException(
            status_code=500,
            detail="Profile photo uploads require Supabase Storage to be configured.",
        )

    mime = payload.mime_type.lower()
    if mime not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        raise HTTPException(
            status_code=400,
            detail="Photo must be a JPEG, PNG, or WebP image.",
        )
    try:
        raw = base64.b64decode(payload.image_b64, validate=True)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="image_b64 is not valid base64.")
    if len(raw) > _MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Photo too large ({len(raw)} bytes; max {_MAX_PHOTO_BYTES}).",
        )

    profile = _get_or_provision(db, user)
    ensure_bucket(PROFILE_PHOTOS_BUCKET, public=True)
    # Timestamp suffix breaks browser cache on photo replacement; without
    # it the same URL gets re-served from disk cache after a swap.
    ext = "jpg" if mime in {"image/jpeg", "image/jpg"} else mime.split("/")[1]
    key = f"{user.id}/avatar-{int(time.time())}.{ext}"
    upload_object(PROFILE_PHOTOS_BUCKET, key, raw, content_type=mime)

    photo_url = (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/"
        f"{PROFILE_PHOTOS_BUCKET}/{key}"
    )
    profile.photo_url = photo_url
    db.commit()
    return ProfilePhotoUploadResponse(photo_url=photo_url)


@router.get("/handle/available", response_model=HandleAvailabilityResponse)
def check_handle_available(
    candidate: str = Query(..., min_length=1, max_length=60),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Live availability check for the profile editor's handle field.

    Returns `{available, reason}` rather than a 4xx so the editor can
    render a non-error hint as the user types.
    """
    normalized = handles.normalize_handle(candidate)
    exclude = user.id if not user.is_anonymous else None
    reason = handles.reason_unavailable(db, normalized, exclude_user_id=exclude)
    if reason is None:
        return HandleAvailabilityResponse(available=True)
    return HandleAvailabilityResponse(available=False, reason=reason)


# ── Public route ───────────────────────────────────────────────────────


@public_router.get("/handle/{handle}", response_model=PublicProfileResponse)
def get_profile_by_handle(
    handle: str,
    db: Session = Depends(get_db),
):
    """Look up a profile by its public @handle.

    Visibility:
      - public:    full response
      - unlisted:  full response (direct-link sharing is the point)
      - private:   404 — same as no profile, so existence doesn't leak
    """
    normalized = handles.normalize_handle(handle)
    profile = (
        db.query(Profile)
        .filter(Profile.handle == normalized)  # stored as normalized form
        .first()
    )
    if not profile or profile.visibility == "private":
        raise HTTPException(status_code=404, detail="Profile not found")

    # Hosted events: every event the user owns, newest first. Phase I-B
    # will add an event-level visibility column and filter unlisted/
    # private out for non-owners.
    # Portable NULLS-LAST: order by `is_null` first (False < True), then
    # by date desc. Avoids SQLite/Postgres divergence on .nulls_last().
    hosted = (
        db.query(Event)
        .filter(Event.user_id == profile.user_id)
        .order_by(Event.start_date.is_(None), Event.start_date.desc(), Event.created_at.desc())
        .all()
    )

    base = _profile_to_response(profile)
    return PublicProfileResponse(
        **base.model_dump(),
        hosted_events=[_event_to_summary(e) for e in hosted],
    )
