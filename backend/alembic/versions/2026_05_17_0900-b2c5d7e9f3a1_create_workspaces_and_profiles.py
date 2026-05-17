"""create workspaces and profiles tables

Revision ID: b2c5d7e9f3a1
Revises: c7e9b1d3f5a8
Create Date: 2026-05-17 09:00:00.000000+00:00

First slice of the host-profile / @handle / Salon platform layer.

`workspaces` is the multi-tenant root from §8 of the architecture doc.
Every B2C signup gets an invisible personal workspace; Phase II
white-label customers (members clubs, wedding planners) get a
multi-user workspace with custom domain + branding.

`profiles` is the public-facing identity record keyed by Supabase
user id. Carries the @handle, bio, photo, and visibility flag.
Provisioned lazily by GET /api/profiles/me — see app/routers/profiles.

`workspace_id` is intentionally NOT being added to existing tables
in this migration. The schema-wide rollout happens in Phase I-B
when workspace-scoped queries actually exist; doing it now would
be a half-day of column-adds + backfills for tables that won't
yet read from those columns.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c5d7e9f3a1'
down_revision: Union[str, None] = 'c7e9b1d3f5a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Defensive cleanup. The prior failed deploy of f3c0cf7 errored on
    # an op.create_index with sa.text("lower(handle)") (Alembic+SA 2.0
    # f405 quirk on Postgres). Despite "Will assume transactional DDL",
    # the profiles table was left committed while alembic_version was
    # NOT advanced — so subsequent retries trip on DuplicateTable.
    # Dropping defensively before the create_tables makes this migration
    # idempotent across the orphan-state scenario. Safe because nothing
    # ever auto-provisioned into these tables (the API was unreachable
    # in the broken state). CASCADE handles any orphan FKs cleanly.
    op.execute("DROP TABLE IF EXISTS profiles CASCADE")
    op.execute("DROP TABLE IF EXISTS workspaces CASCADE")

    op.create_table(
        'workspaces',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('slug', sa.String(length=80), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        # plan_tier and is_white_label are Phase II levers — kept here
        # so we don't have to migrate later. Default tier is 'personal'.
        sa.Column('plan_tier', sa.String(length=40), nullable=False, server_default='personal'),
        sa.Column('is_white_label', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('custom_domain', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('slug', name='uq_workspaces_slug'),
    )
    op.create_index('ix_workspaces_custom_domain', 'workspaces', ['custom_domain'], unique=True)

    op.create_table(
        'profiles',
        # Supabase user UUID — same shape used everywhere else.
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        sa.Column('handle', sa.String(length=30), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=False),
        sa.Column('photo_url', sa.String(length=500), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('city', sa.String(length=120), nullable=True),
        # public / unlisted / private — see §6 of the architecture doc.
        # 'public'   — indexable, anyone can view
        # 'unlisted' — direct link only, not indexed
        # 'private'  — 404 to non-members
        sa.Column('visibility', sa.String(length=20), nullable=False, server_default='public'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('user_id'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name='fk_profiles_workspace'),
        # Plain UNIQUE — case-insensitivity is enforced by the handle
        # service normalizing to lowercase before any write, so a
        # functional index on lower(handle) would just be redundant
        # work for the DB. (And Alembic/SQLAlchemy 2.0's create_index
        # with sa.text(...) trips on Postgres — see the f405 deploy
        # failure in commit f3c0cf7.)
        sa.UniqueConstraint('handle', name='uq_profiles_handle'),
    )
    op.create_index('ix_profiles_workspace', 'profiles', ['workspace_id'])


def downgrade() -> None:
    op.drop_index('ix_profiles_workspace', table_name='profiles')
    op.drop_table('profiles')
    op.drop_index('ix_workspaces_custom_domain', table_name='workspaces')
    op.drop_table('workspaces')
