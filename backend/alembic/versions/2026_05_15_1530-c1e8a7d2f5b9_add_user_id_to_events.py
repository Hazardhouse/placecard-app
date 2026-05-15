"""add user_id to events for per-user data isolation

Revision ID: c1e8a7d2f5b9
Revises: a4f3e9c1b720
Create Date: 2026-05-15 15:30:00.000000+00:00

Closes the broken-access-control hole where every events endpoint
returned/mutated data unscoped by user. Pairs with the auth-wiring
changes in `app/routers/events.py` (and cascade into the child
routers via the new `get_user_event` dependency).

Notes:
- `user_id` stores the Supabase auth UUID as String(36) for
  cross-dialect portability (SQLite dev, Postgres prod). The FK to
  `auth.users(id)` is intentionally NOT enforced at the alembic
  level — that schema only exists in Supabase/Postgres and the
  migration must run on both.
- The column is nullable initially. Production must backfill the
  existing rows before we can tighten this to NOT NULL in a
  follow-up. See `SOP-SECURITY-RUNBOOK.md §2` for the backfill SQL.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1e8a7d2f5b9'
down_revision: Union[str, None] = 'a4f3e9c1b720'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'events',
        sa.Column('user_id', sa.String(length=36), nullable=True),
    )
    op.create_index('ix_events_user_id', 'events', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_events_user_id', table_name='events')
    op.drop_column('events', 'user_id')
