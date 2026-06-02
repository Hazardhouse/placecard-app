"""per-arrangement custom seating layouts

Revision ID: b8e4d7c2f6a3
Revises: a7c3f2e8b5d4
Create Date: 2026-05-20 15:00:00.000000+00:00

Per Dani's 2026-05-20 directive: most events use ONE shared table
layout across every schedule item (current behavior). For the rare
case where one schedule item happens on a yacht and another on a
hotel terrace, the user opts a specific schedule item into a
"custom layout" — its tables clone from the event default at that
moment and diverge from then on.

Schema:
  - `seating_arrangements.uses_custom_layout` boolean default FALSE.
    Flips to TRUE when the user clicks "Use a different layout for
    this schedule item" from the Seating tab.
  - `tables.arrangement_id` nullable FK to seating_arrangements.
    NULL = event-default table (shared across arrangements that
    haven't opted into custom). Non-NULL = a clone scoped to one
    arrangement.

Backfill is implicit: every existing arrangement has uses_custom_layout
defaulting to false; every existing table has arrangement_id defaulting
to NULL (event default). No data movement needed — the current behavior
maps exactly onto the new "everyone shares the default" state.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e4d7c2f6a3'
down_revision: Union[str, None] = 'a7c3f2e8b5d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # uses_custom_layout — NOT NULL with server-side default so existing
    # rows are backfilled atomically as part of the column add.
    op.add_column(
        'seating_arrangements',
        sa.Column(
            'uses_custom_layout',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )

    # tables.arrangement_id — nullable FK. SET NULL on arrangement delete
    # rather than cascade so an accidental arrangement delete doesn't
    # wipe customised tables silently (we'd notice the table existing
    # with a null arrangement_id and can decide what to do).
    op.add_column(
        'tables',
        sa.Column('arrangement_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_tables_arrangement',
        'tables', 'seating_arrangements',
        ['arrangement_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_tables_arrangement', 'tables', ['arrangement_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_tables_arrangement', table_name='tables')
    op.drop_constraint('fk_tables_arrangement', 'tables', type_='foreignkey')
    op.drop_column('tables', 'arrangement_id')
    op.drop_column('seating_arrangements', 'uses_custom_layout')
