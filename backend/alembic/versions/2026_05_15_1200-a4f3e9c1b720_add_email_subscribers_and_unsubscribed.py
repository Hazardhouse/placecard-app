"""add email_subscribers and attendees.email_unsubscribed_at

Revision ID: a4f3e9c1b720
Revises: 27bdb0d866dd
Create Date: 2026-05-15 12:00:00.000000+00:00

Notes:
- `email_subscribers` already exists in Supabase (created via
  `supabase/migrations/20260416_002_create_waitlist_referrals.sql`).
  We use `IF NOT EXISTS` in raw SQL so this migration is a no-op on
  production but still bootstraps the table on local SQLite/Postgres dev.
- `attendees.email_unsubscribed_at` is brand new — set when a guest
  clicks an unsubscribe link in an event reminder email. Suppresses
  future event-reminder emails without revoking marketing subscription.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4f3e9c1b720'
down_revision: Union[str, None] = '27bdb0d866dd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # ── email_subscribers (idempotent — may already exist via Supabase) ──
    if dialect == "postgresql":
        op.execute("""
            CREATE TABLE IF NOT EXISTS email_subscribers (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                subscribed BOOLEAN NOT NULL DEFAULT TRUE,
                source VARCHAR(100) NOT NULL DEFAULT 'signup',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_email_subscribers_email ON email_subscribers (email)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_email_subscribers_id ON email_subscribers (id)")
    else:
        # SQLite (local dev) — same shape, slightly different syntax
        op.execute("""
            CREATE TABLE IF NOT EXISTS email_subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email VARCHAR(255) NOT NULL UNIQUE,
                subscribed BOOLEAN NOT NULL DEFAULT 1,
                source VARCHAR(100) NOT NULL DEFAULT 'signup',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        op.execute("CREATE INDEX IF NOT EXISTS ix_email_subscribers_email ON email_subscribers (email)")
        op.execute("CREATE INDEX IF NOT EXISTS ix_email_subscribers_id ON email_subscribers (id)")

    # ── attendees.email_unsubscribed_at ──
    # Use add_column with a check so re-running on dev DBs doesn't blow
    # up. Alembic doesn't ship an `add_column_if_not_exists`, so use
    # batch_alter_table on SQLite or raw IF NOT EXISTS on Postgres.
    if dialect == "postgresql":
        op.execute("""
            ALTER TABLE attendees
            ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMP NULL
        """)
    else:
        # SQLite — we can't easily check, so guard manually via PRAGMA.
        cols = [
            row[1] for row in bind.execute(sa.text("PRAGMA table_info(attendees)")).fetchall()
        ]
        if "email_unsubscribed_at" not in cols:
            op.add_column(
                "attendees",
                sa.Column("email_unsubscribed_at", sa.DateTime(), nullable=True),
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        op.execute("ALTER TABLE attendees DROP COLUMN IF EXISTS email_unsubscribed_at")
    else:
        with op.batch_alter_table("attendees") as batch:
            batch.drop_column("email_unsubscribed_at")

    # email_subscribers is shared with Supabase — leave it in place.
    # The downgrade intentionally does not drop it.
