from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Salon(Base):
    """Recurring container under a User (in their host role). §3.2 of
    the architecture doc — replaces Luma's "Calendar" concept and is
    invite-only by default.

    A User can own many Salons (Weekly Dinners, Book Club, Holiday
    Series). Events belong to at most one Salon via
    `events.salon_id` (nullable). Members come in Phase I-C.

    Slug is unique per host so /@dani/dinners and /@anna/dinners can
    coexist. The host_user_id is the Supabase auth UUID, same as
    `events.user_id` / `profiles.user_id`.
    """
    __tablename__ = "salons"
    __table_args__ = (
        UniqueConstraint("host_user_id", "slug", name="uq_salons_host_slug"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    host_user_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id"), index=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cover_image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # public / unlisted / private — same semantics as profiles.visibility.
    visibility: Mapped[str] = mapped_column(String(20), default="public", nullable=False)
    # closed | request_to_join | open — see §6 of the architecture doc.
    join_mode: Mapped[str] = mapped_column(String(40), default="request_to_join", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    events = relationship("Event", back_populates="salon")
