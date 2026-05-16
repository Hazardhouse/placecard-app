"""add tracking fields to print_orders

Revision ID: c7e9b1d3f5a8
Revises: a5e9b3d8c7f4
Create Date: 2026-05-16 13:00:00.000000+00:00

Adds tracking_number, tracking_carrier, and tracking_url so the
customer's "Orders" view under Account → Billing can show shipping
status and a click-through to the carrier. Status transitions to
'fulfilled' when the operator (eventually: the print-vendor API)
sets the tracking number.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7e9b1d3f5a8'
down_revision: Union[str, None] = 'a5e9b3d8c7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('print_orders', sa.Column('tracking_number', sa.String(length=100), nullable=True))
    op.add_column('print_orders', sa.Column('tracking_carrier', sa.String(length=50), nullable=True))
    op.add_column('print_orders', sa.Column('tracking_url', sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column('print_orders', 'tracking_url')
    op.drop_column('print_orders', 'tracking_carrier')
    op.drop_column('print_orders', 'tracking_number')
