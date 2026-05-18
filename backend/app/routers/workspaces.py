"""
Workspace + membership endpoints.

  GET    /api/workspaces/me/members           — Users panel data for caller's workspace
  POST   /api/workspaces/me/invites           — invite an email; existing user OR signup
  DELETE /api/workspaces/me/members/{id}      — remove a member (admin+ only)
  GET    /api/workspaces/me/pending-invites   — invites the caller has been offered
  POST   /api/workspaces/pending-invites/{id}/accept
  POST   /api/workspaces/pending-invites/{id}/decline

All routes are authenticated. "Caller's workspace" = the personal
workspace the caller owns (created lazily). Phase II will introduce
real workspace switching for users in multiple workspaces.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models.profile import Profile
from app.models.workspace import Workspace
from app.models.workspace_member import WorkspaceMember
from app.schemas.workspace import (
    InviteRequest,
    InviteResponse,
    PendingInviteResponse,
    WorkspaceMemberResponse,
)
from app.services.supabase_admin import find_user_id_by_email, send_signup_invite
from app.services.workspace_access import (
    can_manage_members,
    ensure_personal_workspace,
    membership_role,
)

logger = logging.getLogger("workspaces")

router = APIRouter(
    prefix="/api/workspaces",
    tags=["workspaces"],
    dependencies=[Depends(get_current_user)],
)


_VALID_INVITE_ROLES = {"admin", "editor", "viewer"}


# ── Helpers ──────────────────────────────────────────────────────────


def _member_to_response(member: WorkspaceMember, db: Session) -> WorkspaceMemberResponse:
    """Resolve display-name + email from the invitee's profile when
    they have one. Falls back to the invited_email captured at invite
    time (covers pending invites where the user_id is still NULL).
    """
    profile: Optional[Profile] = None
    if member.user_id:
        profile = db.query(Profile).filter(Profile.user_id == member.user_id).first()
    return WorkspaceMemberResponse(
        id=member.id,
        workspace_id=member.workspace_id,
        user_id=member.user_id,
        email=member.invited_email,
        display_name=profile.display_name if profile else None,
        role=member.role,
        status=member.status,
        created_at=member.created_at.isoformat(),
        accepted_at=member.accepted_at.isoformat() if member.accepted_at else None,
        invited_by_user_id=member.invited_by_user_id,
    )


# ── Members of caller's workspace ────────────────────────────────────


@router.get("/me/members", response_model=List[WorkspaceMemberResponse])
def list_members(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    ws = ensure_personal_workspace(db, user)
    db.commit()  # ensure_personal_workspace may have created the workspace/owner row
    members = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == ws.id)
        .order_by(WorkspaceMember.created_at.asc())
        .all()
    )
    return [_member_to_response(m, db) for m in members]


@router.post("/me/invites", response_model=InviteResponse)
def invite_to_workspace(
    payload: InviteRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invite someone (by email) to the caller's personal workspace.

    Three branches based on the email:
      A. Email belongs to an existing PlaceCard user → drop a pending
         workspace_members row with their user_id set. They see it in
         their app's pending-invites list and accept/decline there.
      B. Email is new (no PlaceCard account) → fire Supabase's
         signup-invite magic link AND drop a pending row with
         user_id=NULL + invited_email set. On first signup we resolve
         user_id from the email.
      C. Caller is already inviting this same email and an active or
         pending row exists → 400.
    """
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    email = (payload.email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    role = (payload.role or "viewer").lower()
    if role not in _VALID_INVITE_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"role must be one of {sorted(_VALID_INVITE_ROLES)}.",
        )

    ws = ensure_personal_workspace(db, user)
    # Owner can always invite into their own workspace; admin can too.
    if not can_manage_members(membership_role(db, user, ws.id)):
        raise HTTPException(status_code=403, detail="You don't have permission to invite members.")

    # Look up the invitee in Supabase. None = email has no PlaceCard account.
    invitee_user_id = find_user_id_by_email(email)
    logger.info(
        "Invite to workspace %s by %s: email=%s, existing_user=%s",
        ws.id, user.id, email, invitee_user_id is not None,
    )

    # Can't invite yourself.
    if invitee_user_id == user.id:
        raise HTTPException(status_code=400, detail="You can't invite yourself.")

    # Dedupe: if there's already an active or pending row for this email
    # / user_id in this workspace, reject.
    existing_q = db.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == ws.id,
        WorkspaceMember.status.in_(["pending", "active"]),
    )
    if invitee_user_id:
        existing = existing_q.filter(WorkspaceMember.user_id == invitee_user_id).first()
    else:
        existing = existing_q.filter(WorkspaceMember.invited_email == email).first()
    if existing:
        if existing.status == "active":
            raise HTTPException(status_code=400, detail="That person is already a member.")
        raise HTTPException(status_code=400, detail="An invite for that email is already pending.")

    member = WorkspaceMember(
        workspace_id=ws.id,
        user_id=invitee_user_id,
        invited_email=email,
        role=role,
        status="pending",
        invited_by_user_id=user.id,
    )
    db.add(member)
    db.flush()

    # For brand-new emails, ask Supabase to send the signup magic link
    # too. If that call fails we leave the pending row in place so the
    # owner can re-trigger via a follow-up email; the row is the source
    # of truth for the membership state.
    if invitee_user_id is None:
        send_signup_invite(email)

    # Send the PlaceCard-branded invite email regardless of branch
    # (existing user OR new). Branch (A) gets a "log in to accept"
    # CTA; branch (B) gets a "sign up to claim your invite" CTA.
    # Email send is best-effort — never blocks the API response.
    try:
        from app.services.email import send_workspace_invite
        inviter_profile = (
            db.query(Profile).filter(Profile.user_id == user.id).first()
        )
        send_workspace_invite(
            to_email=email,
            inviter_name=inviter_profile.display_name if inviter_profile else (user.email or "A PlaceCard host"),
            workspace_name=ws.name,
            role=role,
            existing_user=invitee_user_id is not None,
        )
    except Exception:
        logger.exception("Failed to send workspace-invite email to %s", email)

    db.commit()
    db.refresh(member)
    return InviteResponse(
        member=_member_to_response(member, db),
        existing_user=invitee_user_id is not None,
    )


@router.delete("/me/members/{member_id}", status_code=204)
def remove_member(
    member_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    member = db.query(WorkspaceMember).filter(WorkspaceMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if not can_manage_members(membership_role(db, user, member.workspace_id)):
        raise HTTPException(status_code=403, detail="You don't have permission to remove members.")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="The workspace owner can't be removed.")
    if member.user_id == user.id:
        raise HTTPException(status_code=400, detail="Use 'leave workspace' to remove yourself.")
    member.status = "removed"
    db.commit()


# ── Pending invites (notifications for the invitee) ──────────────────


@router.get("/me/pending-invites", response_model=List[PendingInviteResponse])
def list_my_pending_invites(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        return []
    rows = (
        db.query(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .filter(
            WorkspaceMember.user_id == user.id,
            WorkspaceMember.status == "pending",
        )
        .order_by(WorkspaceMember.created_at.desc())
        .all()
    )
    out: List[PendingInviteResponse] = []
    for member, workspace in rows:
        inviter_profile = None
        if member.invited_by_user_id:
            inviter_profile = (
                db.query(Profile)
                .filter(Profile.user_id == member.invited_by_user_id)
                .first()
            )
        out.append(PendingInviteResponse(
            id=member.id,
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            role=member.role,
            invited_by_email=None,
            invited_by_display_name=inviter_profile.display_name if inviter_profile else None,
            created_at=member.created_at.isoformat(),
        ))
    return out


@router.post("/pending-invites/{member_id}/accept", response_model=WorkspaceMemberResponse)
def accept_pending_invite(
    member_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    member = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.id == member_id)
        .first()
    )
    if not member or member.user_id != user.id or member.status != "pending":
        # 404 on every non-match — don't leak existence to non-invitees.
        raise HTTPException(status_code=404, detail="Invite not found")
    member.status = "active"
    member.accepted_at = datetime.utcnow()
    db.commit()
    db.refresh(member)
    return _member_to_response(member, db)


@router.post("/pending-invites/{member_id}/decline", status_code=204)
def decline_pending_invite(
    member_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.is_anonymous:
        raise HTTPException(status_code=401, detail="Authentication required")
    member = (
        db.query(WorkspaceMember)
        .filter(WorkspaceMember.id == member_id)
        .first()
    )
    if not member or member.user_id != user.id or member.status != "pending":
        raise HTTPException(status_code=404, detail="Invite not found")
    member.status = "declined"
    db.commit()
