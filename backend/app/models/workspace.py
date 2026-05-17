from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Workspace(Base):
    """Multi-tenant root from §8 of the architecture doc.

    B2C signups get an invisible personal workspace (`plan_tier='personal'`,
    `is_white_label=False`, no `custom_domain`). Phase II white-label
    customers — members clubs, wedding planning agencies, hotel groups —
    get a multi-user workspace with branding + custom domain.

    Workspace IS the unit handles are scoped to in the doc. Today we
    have one public workspace plus N personal workspaces; handles only
    need to be globally unique on the public workspace. We enforce
    global uniqueness on `profiles.handle` until the multi-workspace
    case actually exists.
    """
    __tablename__ = "workspaces"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_tier: Mapped[str] = mapped_column(String(40), default="personal", nullable=False)
    is_white_label: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    custom_domain: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
