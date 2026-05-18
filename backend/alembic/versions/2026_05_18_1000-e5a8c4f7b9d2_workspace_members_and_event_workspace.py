"""workspace_members table + workspace_id on events + backfill

Revision ID: e5a8c4f7b9d2
Revises: d3e8f6a9c2b4
Create Date: 2026-05-18 10:00:00.000000+00:00

Slice 1 of the multi-user collaboration build (per Dani's
2026-05-18 directive: "We need... a memberships table, scope every
query by workspace membership, an invite-existing-user flow").

What this ships:
  1. `workspace_members` table — (workspace_id, user_id, role,
     status, invited_by, invited_email, timestamps). Replaces the
     stub Users panel's frontend-only state with real persistence.
  2. `events.workspace_id` (nullable initially for backfill safety;
     a follow-up migration will tighten to NOT NULL once we're
     confident every row is set).
  3. Backfill: for every distinct user_id in events, ensure a
     personal workspace exists, give the user an 'owner' membership
     there, then point all of that user's events at it.

After this lands, the events router can scope reads by membership
(slice 1, next file) instead of `WHERE user_id = me`. The invite
flow + frontend follow in slices 2-3.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5a8c4f7b9d2'
down_revision: Union[str, None] = 'd3e8f6a9c2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── workspace_members ────────────────────────────────────────────
    op.create_table(
        'workspace_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('workspace_id', sa.Integer(), nullable=False),
        # Supabase auth UUID of the member. Nullable to support
        # pending invites where the invitee doesn't have a PlaceCard
        # account yet (we resolve to a real user_id on first signup).
        sa.Column('user_id', sa.String(length=36), nullable=True),
        # Email the invite was sent to. Set when this row was created
        # via an invite call (so we can match the row to a user when
        # they sign up later, even if user_id is NULL today). NULL for
        # owner rows that were backfilled from pre-existing events —
        # owners weren't "invited."
        sa.Column('invited_email', sa.String(length=255), nullable=True),
        # 'owner' | 'admin' | 'editor' | 'viewer'
        sa.Column('role', sa.String(length=20), nullable=False, server_default='viewer'),
        # 'pending'  — invite sent, not yet accepted
        # 'active'   — accepted, full member
        # 'declined' — invitee rejected
        # 'removed'  — was a member, owner removed them
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('invited_by_user_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('accepted_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name='fk_members_workspace'),
    )
    op.create_index('ix_members_workspace', 'workspace_members', ['workspace_id'])
    op.create_index('ix_members_user', 'workspace_members', ['user_id'])
    op.create_index('ix_members_email', 'workspace_members', ['invited_email'])
    # A given user can only have one active membership per workspace.
    # Pending/declined/removed rows can coexist (re-invite cycle).
    op.create_index(
        'uq_members_workspace_user_active',
        'workspace_members',
        ['workspace_id', 'user_id'],
        unique=True,
        postgresql_where=sa.text("status = 'active' AND user_id IS NOT NULL"),
    )

    # ── events.workspace_id ──────────────────────────────────────────
    op.add_column(
        'events',
        sa.Column('workspace_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_events_workspace',
        'events', 'workspaces',
        ['workspace_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index('ix_events_workspace', 'events', ['workspace_id'])

    # ── Backfill ─────────────────────────────────────────────────────
    # For every user with at least one event:
    #   (a) ensure a personal workspace exists, slugged `user-{prefix}`
    #   (b) make them the 'owner' of that workspace in workspace_members
    #   (c) point all their events at that workspace
    # Done in raw SQL so we don't need to import the SQLAlchemy models
    # (which would create import-order coupling with the alembic env).
    conn = op.get_bind()

    # Step a + c: ensure personal workspace, then bulk-update events.
    distinct_users = conn.execute(sa.text(
        "SELECT DISTINCT user_id FROM events WHERE user_id IS NOT NULL"
    )).fetchall()

    for (user_id,) in distinct_users:
        slug = f"user-{user_id[:8]}"
        # INSERT ... ON CONFLICT DO NOTHING — workspace might already
        # exist from when the user first opened /account/profile.
        conn.execute(
            sa.text(
                "INSERT INTO workspaces (slug, name, plan_tier, is_white_label) "
                "VALUES (:slug, :name, 'personal', false) "
                "ON CONFLICT (slug) DO NOTHING"
            ),
            {"slug": slug, "name": f"Personal — {user_id[:8]}"},
        )
        ws_row = conn.execute(
            sa.text("SELECT id FROM workspaces WHERE slug = :slug"),
            {"slug": slug},
        ).fetchone()
        workspace_id = ws_row[0]

        # Owner membership row. Skip if it somehow exists already.
        # invited_email left NULL — owner wasn't invited.
        #
        # Casts on :user_id are required: Postgres can't deduce a
        # consistent type for the parameter when it appears in both a
        # SELECT projection (defaults to `text`) and a WHERE comparison
        # against the varchar user_id column. Without explicit casts
        # the statement preparation errors with f405 "AmbiguousParameter
        # — inconsistent types deduced for parameter $2 (text vs varchar)".
        conn.execute(
            sa.text(
                "INSERT INTO workspace_members "
                "(workspace_id, user_id, role, status, accepted_at) "
                "SELECT :workspace_id, CAST(:user_id AS VARCHAR), 'owner', 'active', NOW() "
                "WHERE NOT EXISTS ("
                "  SELECT 1 FROM workspace_members "
                "  WHERE workspace_id = :workspace_id AND user_id = CAST(:user_id AS VARCHAR)"
                ")"
            ),
            {"workspace_id": workspace_id, "user_id": user_id},
        )

        # Point all this user's events at the workspace.
        conn.execute(
            sa.text(
                "UPDATE events SET workspace_id = :workspace_id "
                "WHERE user_id = :user_id AND workspace_id IS NULL"
            ),
            {"workspace_id": workspace_id, "user_id": user_id},
        )


def downgrade() -> None:
    op.drop_index('ix_events_workspace', table_name='events')
    op.drop_constraint('fk_events_workspace', 'events', type_='foreignkey')
    op.drop_column('events', 'workspace_id')

    op.drop_index('uq_members_workspace_user_active', table_name='workspace_members')
    op.drop_index('ix_members_email', table_name='workspace_members')
    op.drop_index('ix_members_user', table_name='workspace_members')
    op.drop_index('ix_members_workspace', table_name='workspace_members')
    op.drop_table('workspace_members')
