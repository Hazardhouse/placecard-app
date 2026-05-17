"""create salons table and link events to salons

Revision ID: d3e8f6a9c2b4
Revises: b2c5d7e9f3a1
Create Date: 2026-05-17 10:00:00.000000+00:00

Phase I-B of the host-profile platform layer: recurring containers
under a User in their host role (§3.2 of the architecture doc).

Salons replace Luma's "Calendar" concept and are invite-only by
default. One User has many Salons; each Salon owns its visibility,
join_mode, and (later) member list. Events publish into a Salon
via the new nullable `events.salon_id` FK — standalone events
(weddings, one-offs) keep salon_id NULL.

`SalonMember` is intentionally NOT in this migration. Membership +
request-to-join + approval flow ship in Phase I-C.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e8f6a9c2b4'
down_revision: Union[str, None] = 'b2c5d7e9f3a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'salons',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('host_user_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('cover_image_url', sa.String(length=500), nullable=True),
        # public / unlisted / private — same vocab as profiles.visibility.
        sa.Column('visibility', sa.String(length=20), nullable=False, server_default='public'),
        # closed (manual add only) / request_to_join (default, host approves)
        # / open (anyone can join). See §6 of the architecture doc.
        sa.Column('join_mode', sa.String(length=40), nullable=False, server_default='request_to_join'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name='fk_salons_workspace'),
        # Slug is unique per host so /@dani/dinners and /@anna/dinners can
        # coexist. Global uniqueness on slug would conflict with that.
        sa.UniqueConstraint('host_user_id', 'slug', name='uq_salons_host_slug'),
    )
    op.create_index('ix_salons_host', 'salons', ['host_user_id'])
    op.create_index('ix_salons_workspace', 'salons', ['workspace_id'])

    # Nullable FK from events → salons. Existing rows stay NULL
    # (standalone events). No backfill needed.
    op.add_column(
        'events',
        sa.Column('salon_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_events_salon',
        'events', 'salons',
        ['salon_id'], ['id'],
        ondelete='SET NULL',  # deleting a salon orphans events back to standalone
    )
    op.create_index('ix_events_salon', 'events', ['salon_id'])


def downgrade() -> None:
    op.drop_index('ix_events_salon', table_name='events')
    op.drop_constraint('fk_events_salon', 'events', type_='foreignkey')
    op.drop_column('events', 'salon_id')

    op.drop_index('ix_salons_workspace', table_name='salons')
    op.drop_index('ix_salons_host', table_name='salons')
    op.drop_table('salons')
