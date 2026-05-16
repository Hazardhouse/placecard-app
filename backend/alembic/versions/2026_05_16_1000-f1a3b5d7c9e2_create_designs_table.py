"""create designs table for persisted name-card / program designs

Revision ID: f1a3b5d7c9e2
Revises: e9f2a4d8c6b7
Create Date: 2026-05-16 10:00:00.000000+00:00

Backs the new app.models.design.Design model. Designs are saved
here so generated name-card / program sets survive navigation,
refresh, and session timeouts — each regeneration costs real
Gemini API budget so re-running on every page load is wasteful.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a3b5d7c9e2'
down_revision: Union[str, None] = 'e9f2a4d8c6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'designs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('content_type', sa.String(length=40), nullable=False),
        sa.Column('design_index', sa.Integer(), nullable=False),
        sa.Column('image_b64', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.String(length=50), nullable=False),
        sa.Column('views_json', sa.JSON(), nullable=True),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_designs_id'), 'designs', ['id'])
    op.create_index(
        'ix_designs_event_id_content_type',
        'designs',
        ['event_id', 'content_type'],
    )


def downgrade() -> None:
    op.drop_index('ix_designs_event_id_content_type', table_name='designs')
    op.drop_index(op.f('ix_designs_id'), table_name='designs')
    op.drop_table('designs')
