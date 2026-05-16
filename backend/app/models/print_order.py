from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PrintOrder(Base):
    """Frozen snapshot of a print-order placement.

    Created in 'pending' status when the user confirms checkout (before
    payment); flipped to 'paid' by the Stripe webhook on successful
    PaymentIntent capture; manually finalised to 'fulfilled' once the
    cards ship.

    The design + attendees are deep-copied at order time so later edits
    to the source event don't disturb what's actually being printed.
    """
    __tablename__ = "print_orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    user_id: Mapped[str] = mapped_column(String(36), index=True)

    # ── Print specs (snapshot at order time) ──
    content_type: Mapped[str] = mapped_column(String(40))
    quantity: Mapped[int] = mapped_column(Integer)
    quantity_tier: Mapped[int] = mapped_column(Integer)  # rounded-up tier actually charged
    paper_stock: Mapped[str] = mapped_column(String(50))
    finish: Mapped[str] = mapped_column(String(50))
    color_spec: Mapped[str] = mapped_column(String(20))
    turnaround_days: Mapped[int] = mapped_column(Integer)
    rush: Mapped[bool] = mapped_column(Boolean, default=False)
    remove_branding: Mapped[bool] = mapped_column(Boolean, default=False)

    # ── Design snapshot (survives source design deletion) ──
    design_image_b64: Mapped[str] = mapped_column(Text)
    design_mime_type: Mapped[str] = mapped_column(String(50))
    design_views_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    # ── Attendees snapshot ──
    # List of {name, table_name, dietary} dicts captured at order time
    attendees_json: Mapped[list] = mapped_column(JSON)

    # ── Shipping address ──
    shipping_name: Mapped[str] = mapped_column(String(255))
    shipping_email: Mapped[str] = mapped_column(String(255))
    shipping_company: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    shipping_address1: Mapped[str] = mapped_column(String(255))
    shipping_address2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    shipping_city: Mapped[str] = mapped_column(String(100))
    shipping_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    shipping_zip: Mapped[str] = mapped_column(String(20))
    shipping_country: Mapped[str] = mapped_column(String(2))  # ISO 3166-1 alpha-2

    # ── Pricing breakdown (cents/pence — integers, no float drift) ──
    base_amount_cents: Mapped[int] = mapped_column(Integer)
    rush_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    remove_branding_amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    shipping_amount_cents: Mapped[int] = mapped_column(Integer)
    total_amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))  # 'USD' or 'GBP'

    # ── Stripe ──
    stripe_payment_intent_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)

    # ── Lifecycle ──
    #   'pending'   — intent created, awaiting payment
    #   'paid'      — webhook fired payment_intent.succeeded
    #   'failed'    — payment_intent.payment_failed
    #   'fulfilled' — manually marked once cards ship
    status: Mapped[str] = mapped_column(String(20), default="pending")
    fulfillment_notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Shipping tracking. Set when the operator (or eventually a
    # print-vendor API) marks the order shipped. tracking_url is
    # optional convenience — the carrier's deep-link to track this
    # specific package. If absent, the frontend builds a fallback
    # search URL from carrier + tracking_number.
    tracking_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tracking_carrier: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    tracking_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    fulfilled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    event = relationship("Event", back_populates="print_orders")
