"""create print_orders table

Revision ID: a5e9b3d8c7f4
Revises: f1a3b5d7c9e2
Create Date: 2026-05-16 11:00:00.000000+00:00

Backs app.models.print_order.PrintOrder — the persistent order record
created when a customer confirms a print checkout. Started as
'pending' alongside a Stripe PaymentIntent, flipped to 'paid' by the
Stripe webhook on payment_intent.succeeded, finalised to 'fulfilled'
once the cards ship.

Frozen design + attendees snapshot are kept on the row so the order
record survives later edits or deletions to the source event.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5e9b3d8c7f4'
down_revision: Union[str, None] = 'f1a3b5d7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'print_orders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('content_type', sa.String(length=40), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('quantity_tier', sa.Integer(), nullable=False),
        sa.Column('paper_stock', sa.String(length=50), nullable=False),
        sa.Column('finish', sa.String(length=50), nullable=False),
        sa.Column('color_spec', sa.String(length=20), nullable=False),
        sa.Column('turnaround_days', sa.Integer(), nullable=False),
        sa.Column('rush', sa.Boolean(), nullable=False),
        sa.Column('remove_branding', sa.Boolean(), nullable=False),
        sa.Column('design_image_b64', sa.Text(), nullable=False),
        sa.Column('design_mime_type', sa.String(length=50), nullable=False),
        sa.Column('design_views_json', sa.JSON(), nullable=True),
        sa.Column('attendees_json', sa.JSON(), nullable=False),
        sa.Column('shipping_name', sa.String(length=255), nullable=False),
        sa.Column('shipping_email', sa.String(length=255), nullable=False),
        sa.Column('shipping_company', sa.String(length=255), nullable=True),
        sa.Column('shipping_address1', sa.String(length=255), nullable=False),
        sa.Column('shipping_address2', sa.String(length=255), nullable=True),
        sa.Column('shipping_city', sa.String(length=100), nullable=False),
        sa.Column('shipping_state', sa.String(length=100), nullable=True),
        sa.Column('shipping_zip', sa.String(length=20), nullable=False),
        sa.Column('shipping_country', sa.String(length=2), nullable=False),
        sa.Column('base_amount_cents', sa.Integer(), nullable=False),
        sa.Column('rush_amount_cents', sa.Integer(), nullable=False),
        sa.Column('remove_branding_amount_cents', sa.Integer(), nullable=False),
        sa.Column('shipping_amount_cents', sa.Integer(), nullable=False),
        sa.Column('total_amount_cents', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('stripe_payment_intent_id', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('fulfillment_notified_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('paid_at', sa.DateTime(), nullable=True),
        sa.Column('fulfilled_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stripe_payment_intent_id'),
    )
    op.create_index(op.f('ix_print_orders_id'), 'print_orders', ['id'])
    op.create_index(op.f('ix_print_orders_user_id'), 'print_orders', ['user_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_print_orders_user_id'), table_name='print_orders')
    op.drop_index(op.f('ix_print_orders_id'), table_name='print_orders')
    op.drop_table('print_orders')
