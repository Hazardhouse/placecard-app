"""add user_id to notification_settings for per-user scoping

Revision ID: e9f2a4d8c6b7
Revises: d4e8b1f5a3c2
Create Date: 2026-05-16 09:15:00.000000+00:00

Until now `notification_settings` was a single global row — every
user's sms/whatsapp toggles, reminder windows, and (more
critically) per-month message-usage counters were shared across the
whole instance. With customers about to sign up this leaks
settings and lets one tenant exhaust another's plan limits.

This migration:
  - Adds nullable `user_id String(36)` to notification_settings
  - Creates an index on user_id (lookup by current user every page)

A unique constraint and NOT NULL come in a follow-up once the prod
row has been backfilled to Dani's UUID — see
`supabase/migrations/20260516_004_backfill_notification_settings_user_id.sql`.

App code in routers/settings.py is being updated in the same
commit to filter by current_user.id, falling back to creating a
row on first read.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f2a4d8c6b7'
down_revision: Union[str, None] = 'd4e8b1f5a3c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'notification_settings',
        sa.Column('user_id', sa.String(length=36), nullable=True),
    )
    op.create_index(
        'ix_notification_settings_user_id',
        'notification_settings',
        ['user_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_notification_settings_user_id',
        table_name='notification_settings',
    )
    op.drop_column('notification_settings', 'user_id')
