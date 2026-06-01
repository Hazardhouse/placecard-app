"""print_orders.items_json column + backfill for multi-item checkout

Revision ID: a7c3f2e8b5d4
Revises: f4b8d2e6a9c3
Create Date: 2026-05-20 10:00:00.000000+00:00

Per Dani's 2026-05-20 directive: a print-order can now bundle more
than one content type in a single Stripe charge (tented name cards +
programs in the same shipment). The existing PrintOrder columns
(`content_type`, `quantity`, `design_image_b64`, etc.) snapshot only
the FIRST item. The new `items_json` column carries the full array.

Schema choice — single JSONB column rather than a normalised
`print_order_items` table:
  * Order rows are read together with their items 99% of the time
    (fulfillment email, customer receipt, operator view) — joins
    would add round-trips for zero gain.
  * The shape mirrors what the frontend sends and the email builder
    consumes; keeping it as JSON avoids two layers of serialisation.
  * Reporting / analytics queries that need item-level rollups can
    use `jsonb_array_elements()` until volume justifies a real
    item table.

Backfill: for every existing row, build a 1-element array from the
existing single-item columns so the email builder + Account → Orders
view keep rendering historical orders correctly once they read from
items_json instead of the legacy columns.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'a7c3f2e8b5d4'
down_revision: Union[str, None] = 'f4b8d2e6a9c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # JSONB rather than JSON so Postgres can index + query inside the
    # column later without a re-cast on every read. JSONB is the right
    # default for any "we'll query into this" column in PG ≥ 9.4.
    op.add_column(
        'print_orders',
        sa.Column('items_json', JSONB, nullable=True),
    )

    # Backfill every existing row from its legacy single-item columns.
    # The shape mirrors what the frontend's items-array request payload
    # produces in Slice 2 below:
    #   [
    #     {
    #       "content_type": "tented-name-cards",
    #       "quantity": N,
    #       "quantity_tier": T,
    #       "paper_stock": "...",
    #       "finish": "...",
    #       "color_spec": "...",
    #       "design_image_b64": "...",
    #       "design_mime_type": "...",
    #       "design_views_json": [...] | null,
    #       "base_amount_cents": int
    #     }
    #   ]
    #
    # We *include* design fields here even though they're large strings —
    # the email builder reads them through items_json in Slice 2 and
    # legacy columns become read-only fallback. Slow on backfill (one
    # UPDATE that materialises all blobs into JSONB) but it's a one-off
    # and PrintOrder row count is tiny pre-launch.
    op.execute(sa.text("""
        UPDATE print_orders
           SET items_json = jsonb_build_array(
                 jsonb_build_object(
                   'content_type',       content_type,
                   'quantity',           quantity,
                   'quantity_tier',      quantity_tier,
                   'paper_stock',        paper_stock,
                   'finish',             finish,
                   'color_spec',         color_spec,
                   'design_image_b64',   design_image_b64,
                   'design_mime_type',   design_mime_type,
                   'design_views_json',  design_views_json,
                   'base_amount_cents',  base_amount_cents
                 )
               )
         WHERE items_json IS NULL;
    """))


def downgrade() -> None:
    op.drop_column('print_orders', 'items_json')
