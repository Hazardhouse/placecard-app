"""
Legacy user-invite endpoint.

Kept as a thin shim that forwards to the workspace invite endpoint so
older frontend builds (or any external callers) don't break mid-rollout.
The real invite logic lives in app.routers.workspaces.invite_to_workspace.

Once the frontend is fully migrated to /api/workspaces/me/invites,
this whole file can go.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.routers.workspaces import invite_to_workspace
from app.schemas.workspace import InviteRequest, InviteResponse

router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/invite", response_model=InviteResponse)
async def invite_user(
    payload: InviteRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Backward-compat alias for POST /api/workspaces/me/invites."""
    return invite_to_workspace(payload, user, db)
