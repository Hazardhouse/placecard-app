"""
Email subscribers model — maps to the `email_subscribers` table that
also exists in Supabase (the marketing waitlist created in
`supabase/migrations/20260416_002_create_waitlist_referrals.sql`).

We keep the same shape here so backend code can upsert via SQLAlchemy
without round-tripping through Supabase's REST API. The table is created
idempotently in Alembic with `IF NOT EXISTS` so the migration is a
no-op on the production Postgres that already has the row.

Subscribed = true means the email holder has opted in to marketing
messages (event recap newsletters, new-feature emails, etc).
Transactional reminders are governed separately by
`attendees.email_unsubscribed_at`, so a guest can opt out of one
without affecting the other.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EmailSubscriber(Base):
    __tablename__ = "email_subscribers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    subscribed: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(100), default="signup")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
