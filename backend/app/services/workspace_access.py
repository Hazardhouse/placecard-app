"""
Workspace access helpers.

Everything event-related (and eventually orders, salons, profiles)
should access data through these helpers rather than filtering by
`user_id` directly. Owners of a workspace AND any members the owner
invited see the same events.

Roles (highest → lowest privilege):
  owner > admin > editor > viewer

Convention: `viewer` can read everything in the workspace but not
mutate; `editor` can mutate event content (attendees, seating,
schedule); `admin` can also manage members + billing; `owner` is
the original creator and can delete the workspace.
"""
from __future__ import annotations

from typing import Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember


ROLE_RANK = {"owner": 3, "admin": 2, "editor": 1, "viewer": 0}


def active_workspace_ids(db: Session, user: CurrentUser) -> List[int]:
    """Every workspace the user has an ACTIVE membership in.

    Anonymous users (dev mode with require_auth=False) get an empty
    list — caller decides what to do.
    """
    if user.is_anonymous:
        return []
    rows = (
        db.query(WorkspaceMember.workspace_id)
        .filter(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
        )
        .all()
    )
    return [r[0] for r in rows]


def membership_role(db: Session, user: CurrentUser, workspace_id: int) -> Optional[str]:
    """Return the user's role in this workspace, or None if not a
    member (or membership is pending/declined/removed).
    """
    if user.is_anonymous:
        return None
    row = (
        db.query(WorkspaceMember.role)
        .filter(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "active",
        )
        .first()
    )
    return row[0] if row else None


def can_edit(role: Optional[str]) -> bool:
    """Editor and above can mutate content."""
    return role in {"owner", "admin", "editor"}


def can_manage_members(role: Optional[str]) -> bool:
    """Admins and owners can invite / remove other members."""
    return role in {"owner", "admin"}


def require_edit_access(event_workspace_id: Optional[int], event_user_id: str, user: CurrentUser, db: Session) -> None:
    """Raise 403 if the caller can't mutate this event.

    Edit access = caller is an active member of the event's workspace
    with role 'owner' / 'admin' / 'editor'. OR the caller is the
    original creator (legacy fallback for events created before the
    workspace_id backfill — drop once 100% covered).

    Anonymous callers in dev mode (`require_auth=False`) bypass —
    same convention as the read-side `get_user_event` dep.
    """
    from fastapi import HTTPException
    if user.is_anonymous:
        return
    # Legacy fallback: original creator can always edit, regardless of
    # role on the workspace. Will be removed once every event has a
    # workspace_id and a proper membership row.
    if event_user_id == user.id:
        return
    if event_workspace_id is None:
        # No workspace stamp + not the creator = no edit path.
        raise HTTPException(status_code=403, detail="You don't have permission to edit this event.")
    role = membership_role(db, user, event_workspace_id)
    if not can_edit(role):
        raise HTTPException(status_code=403, detail="You don't have permission to edit this event.")


def ensure_personal_workspace(db: Session, user: CurrentUser) -> Workspace:
    """Find-or-create the user's personal workspace AND ensure they're
    an owner member of it. Idempotent — safe to call on every
    authenticated request that needs a default workspace.

    Mirrors the auto-provision in profiles.py but additionally creates
    the owner membership row so the user's own workspace shows up in
    `active_workspace_ids`.
    """
    slug = f"user-{user.id[:8]}"
    ws = db.query(Workspace).filter(Workspace.slug == slug).first()
    if ws is None:
        ws = Workspace(slug=slug, name=f"Personal — {user.id[:8]}", plan_tier="personal")
        db.add(ws)
        db.flush()
    membership = (
        db.query(WorkspaceMember)
        .filter(
            WorkspaceMember.workspace_id == ws.id,
            WorkspaceMember.user_id == user.id,
        )
        .first()
    )
    if membership is None:
        db.add(WorkspaceMember(
            workspace_id=ws.id,
            user_id=user.id,
            role="owner",
            status="active",
        ))
        db.flush()
    elif membership.status != "active":
        # Re-activate. Edge case for owners who were somehow set to
        # removed/declined — they always retain ownership of their
        # personal workspace.
        membership.status = "active"
        membership.role = "owner"
        db.flush()
    return ws
