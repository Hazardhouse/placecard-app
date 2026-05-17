"""
Salon endpoints — the recurring container under a host (§3.2 of the
architecture doc).

  GET    /api/salons/me                            — auth, list my salons
  POST   /api/salons                               — auth, create
  PATCH  /api/salons/{id}                          — auth, update (host only)
  DELETE /api/salons/{id}                          — auth, delete (host only)
  GET    /api/salons/by-host/{handle}              — public, list a host's public salons
  GET    /api/salons/by-host/{handle}/{salon_slug} — public, salon detail page

Slug uniqueness is per-host (so two different hosts can both have a
"dinners" salon). Auto-generated from the name on create; the user
can override via the slug field.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models.event import Event
from app.models.profile import Profile
from app.models.salon import Salon
from app.models.workspace import Workspace
from app.schemas.salon import (
    SalonCreateRequest,
    SalonDetailResponse,
    SalonEventSummary,
    SalonResponse,
    SalonUpdateRequest,
)
from app.services import handles as handle_service

logger = logging.getLogger("salons")

_VALID_VISIBILITY = {"public", "unlisted", "private"}
_VALID_JOIN_MODES = {"closed", "request_to_join", "open"}


router = APIRouter(
    prefix="/api/salons",
    tags=["salons"],
    dependencies=[Depends(get_current_user)],
)
public_router = APIRouter(prefix="/api/salons", tags=["salons"])


# ── Helpers ────────────────────────────────────────────────────────────


def _salon_to_response(salon: Salon, *, event_count: int) -> SalonResponse:
    return SalonResponse(
        id=salon.id,
        host_user_id=salon.host_user_id,
        slug=salon.slug,
        name=salon.name,
        description=salon.description,
        cover_image_url=salon.cover_image_url,
        visibility=salon.visibility,
        join_mode=salon.join_mode,
        created_at=salon.created_at.isoformat(),
        event_count=event_count,
    )


def _event_count_for(db: Session, salon_id: int) -> int:
    return (
        db.query(func.count(Event.id))
        .filter(Event.salon_id == salon_id)
        .scalar()
        or 0
    )


def _slug_taken_for_host(
    db: Session, host_user_id: str, slug: str, *, exclude_salon_id: Optional[int] = None
) -> bool:
    q = db.query(Salon).filter(
        Salon.host_user_id == host_user_id,
        func.lower(Salon.slug) == slug.lower(),
    )
    if exclude_salon_id is not None:
        q = q.filter(Salon.id != exclude_salon_id)
    return db.query(q.exists()).scalar() or False


def _unique_salon_slug(db: Session, host_user_id: str, base: str) -> str:
    """Pick an available slug for this host, suffixing -2, -3, ... on
    collision. Uses the same slugify rules as profile handles so the
    URL shape is consistent.
    """
    base = handle_service.slugify_for_handle(base) or "salon"
    if not _slug_taken_for_host(db, host_user_id, base):
        return base
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if not _slug_taken_for_host(db, host_user_id, candidate):
            return candidate
    # Backstop — practically unreachable.
    import secrets
    return f"{base}-{secrets.token_hex(2)}"


def _require_host_workspace(db: Session, user: CurrentUser) -> int:
    """Return the user's personal workspace id, creating the row if it
    doesn't exist yet. Mirrors _ensure_personal_workspace in profiles.py
    so the user doesn't need to have opened the profile page first.
    """
    slug = f"user-{user.id[:8]}"
    ws = db.query(Workspace).filter(Workspace.slug == slug).first()
    if ws:
        return ws.id
    ws = Workspace(slug=slug, name=f"Personal — {user.id[:8]}", plan_tier="personal")
    db.add(ws)
    db.flush()
    return ws.id


def _own_salon_or_404(db: Session, salon_id: int, user: CurrentUser) -> Salon:
    salon = db.query(Salon).filter(Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(status_code=404, detail="Salon not found")
    if not user.is_anonymous and salon.host_user_id != user.id:
        # 404 not 403 — don't leak existence to a non-owner.
        raise HTTPException(status_code=404, detail="Salon not found")
    return salon


def _event_to_summary(event: Event) -> SalonEventSummary:
    return SalonEventSummary(
        id=event.id,
        name=event.name,
        public_token=event.public_token,
        start_date=event.start_date.isoformat() if event.start_date else None,
        end_date=event.end_date.isoformat() if event.end_date else None,
        location=event.location,
        venue=event.venue,
        image_data=event.image_data,
    )


# ── Authenticated endpoints ────────────────────────────────────────────


@router.get("/me", response_model=List[SalonResponse])
def list_my_salons(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    salons = (
        db.query(Salon)
        .filter(Salon.host_user_id == user.id)
        .order_by(Salon.created_at.desc())
        .all()
    )
    return [_salon_to_response(s, event_count=_event_count_for(db, s.id)) for s in salons]


@router.post("", response_model=SalonResponse)
def create_salon(
    payload: SalonCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Salon name is required.")
    if payload.visibility and payload.visibility not in _VALID_VISIBILITY:
        raise HTTPException(status_code=400, detail=f"visibility must be one of {sorted(_VALID_VISIBILITY)}")
    if payload.join_mode and payload.join_mode not in _VALID_JOIN_MODES:
        raise HTTPException(status_code=400, detail=f"join_mode must be one of {sorted(_VALID_JOIN_MODES)}")

    # Slug: explicit input wins, otherwise auto-derive from name.
    raw_slug = payload.slug or name
    normalized = handle_service.slugify_for_handle(raw_slug)
    if not normalized:
        normalized = "salon"
    if payload.slug:
        # If the user typed a slug explicitly and it collides, reject
        # rather than silently suffix — they had intent.
        if _slug_taken_for_host(db, user.id, normalized):
            raise HTTPException(status_code=400, detail="You already have a salon with that slug.")
        slug = normalized
    else:
        slug = _unique_salon_slug(db, user.id, normalized)

    workspace_id = _require_host_workspace(db, user)
    salon = Salon(
        host_user_id=user.id,
        workspace_id=workspace_id,
        slug=slug,
        name=name[:255],
        description=(payload.description or None),
        cover_image_url=payload.cover_image_url,
        visibility=payload.visibility or "public",
        join_mode=payload.join_mode or "request_to_join",
    )
    db.add(salon)
    db.commit()
    db.refresh(salon)
    return _salon_to_response(salon, event_count=0)


@router.patch("/{salon_id}", response_model=SalonResponse)
def update_salon(
    salon_id: int,
    payload: SalonUpdateRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    salon = _own_salon_or_404(db, salon_id, user)

    if payload.name is not None:
        cleaned = payload.name.strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="Salon name cannot be empty.")
        salon.name = cleaned[:255]

    if payload.slug is not None:
        normalized = handle_service.slugify_for_handle(payload.slug)
        if not normalized:
            raise HTTPException(status_code=400, detail="Slug cannot be empty.")
        if _slug_taken_for_host(db, user.id, normalized, exclude_salon_id=salon.id):
            raise HTTPException(status_code=400, detail="You already have a salon with that slug.")
        salon.slug = normalized

    if payload.description is not None:
        salon.description = (payload.description.strip() or None)

    if payload.cover_image_url is not None:
        salon.cover_image_url = payload.cover_image_url or None

    if payload.visibility is not None:
        if payload.visibility not in _VALID_VISIBILITY:
            raise HTTPException(status_code=400, detail=f"visibility must be one of {sorted(_VALID_VISIBILITY)}")
        salon.visibility = payload.visibility

    if payload.join_mode is not None:
        if payload.join_mode not in _VALID_JOIN_MODES:
            raise HTTPException(status_code=400, detail=f"join_mode must be one of {sorted(_VALID_JOIN_MODES)}")
        salon.join_mode = payload.join_mode

    db.commit()
    db.refresh(salon)
    return _salon_to_response(salon, event_count=_event_count_for(db, salon.id))


@router.delete("/{salon_id}", status_code=204)
def delete_salon(
    salon_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    salon = _own_salon_or_404(db, salon_id, user)
    # Events under this salon detach automatically because of
    # ondelete=SET NULL on the FK. We don't delete the events.
    db.delete(salon)
    db.commit()


# ── Public endpoints ───────────────────────────────────────────────────


@public_router.get("/by-host/{handle}", response_model=List[SalonResponse])
def list_host_salons(
    handle: str,
    db: Session = Depends(get_db),
):
    """Public salons for a given host @handle. Used by the profile page
    to render the "Salons" section without an extra round-trip per
    salon.
    """
    normalized = handle_service.normalize_handle(handle)
    profile = db.query(Profile).filter(Profile.handle == normalized).first()
    if not profile or profile.visibility == "private":
        # Same shape as a host with zero public salons — don't leak
        # whether a private profile exists.
        return []
    salons = (
        db.query(Salon)
        .filter(Salon.host_user_id == profile.user_id)
        .filter(Salon.visibility != "private")
        .order_by(Salon.created_at.desc())
        .all()
    )
    return [_salon_to_response(s, event_count=_event_count_for(db, s.id)) for s in salons]


@public_router.get("/by-host/{handle}/{salon_slug}", response_model=SalonDetailResponse)
def get_salon_detail(
    handle: str,
    salon_slug: str,
    db: Session = Depends(get_db),
):
    normalized_handle = handle_service.normalize_handle(handle)
    profile = db.query(Profile).filter(Profile.handle == normalized_handle).first()
    if not profile or profile.visibility == "private":
        raise HTTPException(status_code=404, detail="Salon not found")

    normalized_slug = handle_service.slugify_for_handle(salon_slug)
    salon = (
        db.query(Salon)
        .filter(Salon.host_user_id == profile.user_id)
        .filter(func.lower(Salon.slug) == normalized_slug)
        .first()
    )
    if not salon or salon.visibility == "private":
        raise HTTPException(status_code=404, detail="Salon not found")

    events = (
        db.query(Event)
        .filter(Event.salon_id == salon.id)
        .order_by(Event.start_date.is_(None), Event.start_date.desc(), Event.created_at.desc())
        .all()
    )

    base = _salon_to_response(salon, event_count=len(events))
    return SalonDetailResponse(
        **base.model_dump(),
        host_handle=profile.handle,
        host_display_name=profile.display_name,
        host_photo_url=profile.photo_url,
        events=[_event_to_summary(e) for e in events],
    )
