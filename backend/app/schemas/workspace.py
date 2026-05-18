from typing import Optional

from pydantic import BaseModel


# ── Membership rows (Account → Users panel) ──────────────────────────


class WorkspaceMemberResponse(BaseModel):
    """One row in the Users panel."""
    id: int
    workspace_id: int
    user_id: Optional[str] = None
    email: Optional[str] = None
    display_name: Optional[str] = None
    role: str  # owner | admin | editor | viewer
    status: str  # pending | active | declined | removed
    created_at: str
    accepted_at: Optional[str] = None
    invited_by_user_id: Optional[str] = None


# ── Invite flow ──────────────────────────────────────────────────────


class InviteRequest(BaseModel):
    email: str
    role: str = "viewer"  # 'owner' is reserved for the workspace creator


class InviteResponse(BaseModel):
    """Returned by POST /api/workspaces/{id}/invites.
    `existing_user` tells the frontend which email branch fired so the
    UI can show the right toast ("invite sent" vs "added to workspace").
    """
    member: WorkspaceMemberResponse
    existing_user: bool


# ── Pending-invites list (notification UX) ───────────────────────────


class PendingInviteResponse(BaseModel):
    """Invite that the current user has been offered and not yet
    accepted or declined.
    """
    id: int
    workspace_id: int
    workspace_name: str
    role: str
    invited_by_email: Optional[str] = None
    invited_by_display_name: Optional[str] = None
    created_at: str
