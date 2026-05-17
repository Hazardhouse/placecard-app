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
    # Price-breakdown line items so the payment step can show
    # shipping + addons alongside the total. Without these the
    # customer sees only the summed total and can't tell what's
    # included.
    base_amount_cents: int
    rush_amount_cents: int
    remove_branding_amount_cents: int
    shipping_amount_cents: int
    quantity_tier: int


# ── Order status (for the success page + list view) ────────────────────

class PrintOrderResponse(BaseModel):
    """Slim row-shaped payload for /print/orders. Doesn't carry the design
    base64 or the full address — those live on PrintOrderDetailResponse
    behind /print/orders/{id}.
    """
    id: int
    status: str  # 'pending' | 'paid' | 'failed' | 'fulfilled'
    total_amount_cents: int
    currency: str
    content_type: str
    quantity: int
    quantity_tier: int
    event_id: int
    event_name: Optional[str] = None
    shipping_name: str
    shipping_city: str
    shipping_country: str
    tracking_number: Optional[str] = None
    tracking_carrier: Optional[str] = None
    tracking_url: Optional[str] = None
    created_at: str
    paid_at: Optional[str] = None
    fulfilled_at: Optional[str] = None


# ── Order detail (for the order popup) ─────────────────────────────────

class PrintOrderDetailResponse(PrintOrderResponse):
    """Full order payload with price breakdown, addons, design preview,
    attendees count, and full shipping address. Used by the order detail
    modal — not the list view, because we don't want to ship the base64
    design with every row.
    """
    # Print specs
    paper_stock: str
    finish: str
    color_spec: str
    turnaround_days: int
    rush: bool
    remove_branding: bool

    # Price breakdown (already-charged amounts, integers in minor units)
    base_amount_cents: int
    rush_amount_cents: int
    remove_branding_amount_cents: int
    shipping_amount_cents: int

    # Design snapshot — front face only for preview. The full views array
    # would balloon the response; the modal just needs one image.
    design_image_b64: str
    design_mime_type: str

    # Attendee count (the printed quantity is order.quantity; this is the
    # count of attendee rows captured at order time — sometimes lower
    # since users round up to the next print tier).
    attendees_count: int

    # Full shipping address
    shipping_email: Optional[str] = None
    shipping_company: Optional[str] = None
    shipping_address1: str
    shipping_address2: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_zip: str
