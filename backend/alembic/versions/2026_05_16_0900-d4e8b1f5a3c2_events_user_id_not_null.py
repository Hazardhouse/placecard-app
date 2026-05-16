"""tighten events.user_id to NOT NULL

Revision ID: d4e8b1f5a3c2
Revises: c1e8a7d2f5b9
Create Date: 2026-05-16 09:00:00.000000+00:00

Follow-up to migration c1e8a7d2f5b9, which added events.user_id as
nullable to land safely on a populated DB. Now that:

  - prod has been backfilled via
    supabase/migrations/20260515_003_backfill_events_user_id.sql
    (verified 2026-05-15: unscoped_events count = 0)
  - app code in events.create_event always writes a user_id (the
    sentinel string 'anonymous' in dev when require_auth=False,
    the JWT sub in prod)

we can flip the column to NOT NULL. Any remaining NULLs from local
SQLite dev (events created before this column existed) are
backfilled to the 'anonymous' sentinel inside the migration itself
so the constraint can be added safely on either dialect.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e8b1f5a3c2'
down_revision: Union[str, None] = 'c1e8a7d2f5b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Defence-in-depth backfill. Prod is already clean; this only matters
    # for local SQLite databases that pre-date the user_id column.
    op.execute("UPDATE events SET user_id = 'anonymous' WHERE user_id IS NULL")
    op.alter_column(
        'events',
        'user_id',
        existing_type=sa.String(length=36),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'events',
        'user_id',
        existing_type=sa.String(length=36),
        nullable=True,
    )
