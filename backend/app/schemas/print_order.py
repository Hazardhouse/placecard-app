from typing import List, Optional

from pydantic import BaseModel


# ── Shared sub-shapes ──────────────────────────────────────────────────

class DesignViewSnapshot(BaseModel):
    image_b64: str
    mime_type: str
    label: Optional[str] = None


class DesignSnapshot(BaseModel):
    """Frozen design payload the customer selected at order time."""
    image_b64: str
    mime_type: str
    description: Optional[str] = None
    views: Optional[List[DesignViewSnapshot]] = None


class ShippingAddress(BaseModel):
    name: str
    email: str
    company: Optional[str] = None
    address1: str
    address2: Optional[str] = None
    city: str
    state: Optional[str] = None  # required for US, optional in UK
    zip: str
    country: str  # ISO 3166-1 alpha-2: 'US' or 'GB'


# ── Pricing quote ──────────────────────────────────────────────────────

class QuoteRequest(BaseModel):
    country: str = "GB"
    content_type: str = "tented-name-cards"
    quantity: int
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    rush: bool = False
    remove_branding: bool = False


class QuoteResponse(BaseModel):
    country: str
    currency: str  # 'USD' or 'GBP'
    quantity_tier: int
    base_amount: float
    rush_amount: float
    remove_branding_amount: float
    shipping_amount: float
    total_amount: float


# ── Stripe PaymentIntent creation ──────────────────────────────────────

class AttendeeSnapshot(BaseModel):
    """Frozen attendee row captured at order time — what goes on the
    printed card. We snapshot rather than reference the live event
    attendees so later edits / deletions don't change the print job
    after payment.
    """
    name: str
    table_name: Optional[str] = None
    dietary: Optional[str] = None


class CreateIntentRequest(BaseModel):
    event_id: int
    content_type: str
    quantity: int
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    turnaround_days: int = 7
    rush: bool = False
    remove_branding: bool = False
    design: DesignSnapshot
    attendees: List[AttendeeSnapshot]
    shipping: ShippingAddress


class CreateIntentResponse(BaseModel):
    client_secret: str
    order_id: int
    total_amount_cents: int
    currency: str  # lowercase ISO ('usd' or 'gbp') — Stripe convention


# ── Order status (for the success page) ────────────────────────────────

class PrintOrderResponse(BaseModel):
    id: int
    status: str
    total_amount_cents: int
    currency: str
    content_type: str
    quantity: int
    quantity_tier: int
    created_at: str
    paid_at: Optional[str] = None
