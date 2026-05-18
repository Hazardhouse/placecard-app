from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class WorkspaceMember(Base):
    """Membership of a user in a workspace.

    Single source of truth for "who can see / edit this workspace's
    events." Replaces the previous `events.user_id`-only access model.

    Role semantics:
      - owner:  full control, can invite/remove others, can delete the workspace
      - admin:  invite/remove members + everything editor can do
      - editor: create/edit events, attendees, seating
      - viewer: read-only access to everything in the workspace

    Status lifecycle:
      pending → active (on accept) | declined (on decline)
                 active → removed (on owner kick)
    """
    __tablename__ = "workspace_members"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=False)
    # Supabase auth UUID. Nullable so we can store pending invites
    # for emails that don't yet have a PlaceCard account — we fill
    # this in on first signup of that email.
    user_id: Mapped[Optional[str]] = mapped_column(String(36), index=True, nullable=True)
    # Email the invite was addressed to. NULL for owner rows that
    # were backfilled from existing events (owners weren't "invited").
    invited_email: Mapped[Optional[str]] = mapped_column(String(255), index=True, nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="viewer", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    invited_by_user_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
