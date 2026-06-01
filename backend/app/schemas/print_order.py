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


class ItemSnapshot(BaseModel):
    """One content-type's worth of cart input. Multiple ItemSnapshot
    entries can ship in a single order (tented name cards + programs
    bundled together for one Stripe charge). Per-item state lives here;
    order-level state (shipping address, rush, remove_branding) is on
    the CreateIntentRequest itself.
    """
    content_type: str  # 'tented-name-cards' | 'programs'
    quantity: int
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    design: DesignSnapshot
    # Only tented-name-cards carries an attendees list. Programs are
    # batch-identical so a single design prints N copies with no per-
    # attendee personalization — its attendees array stays empty.
    attendees: List[AttendeeSnapshot] = []


class ItemBreakdown(BaseModel):
    """Per-item pricing breakdown returned in CreateIntentResponse so the
    Payment-step modal can render a line per content type."""
    content_type: str
    quantity: int
    quantity_tier: int
    base_amount_cents: int
    rush_amount_cents: int  # 0 unless order-level rush is on AND this content_type has a per-tier rush surcharge


class CreateIntentRequest(BaseModel):
    event_id: int
    # Multi-item shape (Slice 2 of the 2026-05-20 rebuild): the frontend
    # sends one entry per content type the user picked. Order-level
    # state (rush, remove_branding, shipping) lives below — applied
    # once, not per-item, because the operator ships one parcel and
    # rush is a single production-window upgrade for the whole job.
    items: Optional[List[ItemSnapshot]] = None
    # ── Legacy single-item fields (deprecated, kept for backward compat) ──
    # If `items` is omitted, the handler reconstructs a 1-item cart
    # from these. Lets a stale frontend deploy keep checking out during
    # the Slice-3 rollout without dropping in-flight requests.
    content_type: Optional[str] = None
    quantity: Optional[int] = None
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    design: Optional[DesignSnapshot] = None
    attendees: List[AttendeeSnapshot] = []
    # ── Order-level addons + shipping ──
    turnaround_days: int = 7
    rush: bool = False
    remove_branding: bool = False
    shipping: ShippingAddress


class CreateIntentResponse(BaseModel):
    client_secret: str
    order_id: int
    total_amount_cents: int
    currency: str  # lowercase ISO ('usd' or 'gbp') — Stripe convention
    # Order-level totals so the Payment-step modal can render shipping
    # + addons alongside the grand total.
    rush_amount_cents: int
    remove_branding_amount_cents: int
    shipping_amount_cents: int
    # Per-item breakdown so the modal renders one price row per content
    # type ("Tented name cards · £45", "Programs · £62.97", ...). For
    # single-item legacy callers this is a 1-element array.
    items: List[ItemBreakdown] = []
    # ── Legacy single-item fields (deprecated, kept for compat) ──
    # Mirror item 1's values. Pre-Slice-3 frontends still read these.
    base_amount_cents: int
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
