"""rename "Personal — UUID8" workspaces to "{display_name}'s PlaceCard"

Revision ID: f4b8d2e6a9c3
Revises: e5a8c4f7b9d2
Create Date: 2026-05-18 12:00:00.000000+00:00

Per Dani's 2026-05-18 feedback after the multi-user collab ship:
"'Personal — 380b276d' needs to be updated to 'Dani Bradford's
PlaceCard' OR the name of a specific salon."

The original Slice 1 migration created personal workspaces with the
placeholder name `Personal — {first 8 of user UUID}`. That label
leaks through into the workspace-invite email and the AccountPage
"Pending invites for you" line, both of which read awful.

This migration backfills existing rows by joining workspaces ↔
profiles on workspace_id and rewriting any row that still carries
the legacy placeholder. Future creates use the new naming helper
(`workspace_access.personal_workspace_name`) and start out correct.

Rows with no profile (somehow) keep the placeholder — they'd render
ugly in the UI but at least don't crash. We can re-run a follow-up
backfill once those profiles materialise.

Idempotent. Safe to re-run.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4b8d2e6a9c3'
down_revision: Union[str, None] = 'e5a8c4f7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Match the exact "Personal — {8 hex chars}" placeholder produced by
    # the original Slice 1 helper. Stricter than a `LIKE 'Personal —%'`
    # would be — we don't want to clobber any hand-edited workspace
    # names that happen to start with "Personal".
    # Note on the literal: SQL escapes a single quote by doubling it.
    # `'''s PlaceCard'` is the literal string `'s PlaceCard` — open
    # quote + escaped quote + payload + close quote. The result column
    # ends up like "Dani Bradford's PlaceCard".
    op.execute(sa.text("""
        UPDATE workspaces
           SET name = profiles.display_name || '''s PlaceCard'
          FROM profiles
         WHERE workspaces.id = profiles.workspace_id
           AND workspaces.name ~ '^Personal — [0-9a-f]{8}$'
           AND profiles.display_name IS NOT NULL
           AND profiles.display_name <> '';
    """))


def downgrade() -> None:
    # Reverting the rename would lose information — every renamed
    # workspace would need to be recomputed from `id[:8]`, but we no
    # longer know the original suffix for sure (UUID prefix vs custom).
    # Practical no-op: the placeholder format is meaningless to revert
    # back to once display-named.
    pass
