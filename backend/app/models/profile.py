from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Profile(Base):
    """Public-facing host identity. Keyed by Supabase user_id (UUID),
    1:1 with the auth user.

    Provisioned lazily by GET /api/profiles/me — the first authenticated
    request from a user with no profile row triggers creation of a
    personal workspace + a profile with an auto-generated handle derived
    from display_name. Users can edit the handle later from the account
    profile settings.

    Visibility:
      - public:   discoverable, indexable
      - unlisted: accessible by direct link only, not surfaced
      - private:  returns 404 to non-members (Phase II Salon-members gating)
    """
    __tablename__ = "profiles"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), nullable=False, index=True)
    handle: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    photo_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    visibility: Mapped[str] = mapped_column(String(20), default="public", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    workspace = relationship("Workspace")
