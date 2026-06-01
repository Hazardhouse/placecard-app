"""
Print-order endpoints: pricing quotes + Stripe PaymentIntent creation
+ order status lookup.

Authenticated. The webhook lives separately in `stripe_webhook.py`
since it uses signature-based auth rather than JWT.

No print-vendor API integration here — manual fulfillment via the
notification email fired by the webhook on payment_intent.succeeded.
Pricing is dialed in from `app/pricing.py` (a flat config file edited
in-repo) until volume justifies a DB-backed pricing table.
"""
from __future__ import annotations

import logging
from typing import List, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.config import settings
from app.database import get_db
from app.models.event import Event
from app.models.print_order import PrintOrder
from app import pricing
from app.schemas.print_order import (
    CreateIntentRequest,
    CreateIntentResponse,
    ItemBreakdown,
    ItemSnapshot,
    PrintOrderDetailResponse,
    PrintOrderResponse,
    QuoteRequest,
    QuoteResponse,
)

logger = logging.getLogger("printing")

router = APIRouter(
    prefix="/api/print",
    tags=["print"],
    dependencies=[Depends(get_current_user)],
)


# ── Helpers ────────────────────────────────────────────────────────────


def _user_event(event_id: int, user: CurrentUser, db: Session) -> Event:
    """Mirror of routers/events.get_user_event but takes event_id from
    the request body instead of the URL path. Returns 404 (not 403)
    for both missing and not-owner cases so existence doesn't leak.
    """
    q = db.query(Event).filter(Event.id == event_id)
    if not user.is_anonymous:
        q = q.filter(Event.user_id == user.id)
    event = q.first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _compute_pricing(
    *,
    country: str,
    content_type: str,
    quantity: int,
    paper_stock: str,
    finish: str,
    color_spec: str,
    rush: bool,
    remove_branding: bool,
) -> dict:
    """Server-side authoritative pricing. The client's quoted amount is
    never trusted — every checkout call recomputes from pricing.py.
    """
    if country not in pricing.SUPPORTED_COUNTRIES:
        raise HTTPException(
            status_code=400,
            detail=f"Shipping not yet available to {country!r}. Supported: {pricing.SUPPORTED_COUNTRIES}",
        )

    try:
        quantity_tier, base, rush_surcharge, currency = pricing.quote_card_base(
            country=country,
            content_type=content_type,
            quantity=quantity,
            paper_stock=paper_stock,
            finish=finish,
            color_spec=color_spec,
        )
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        # Quantity exceeded the largest tier. Return 400 with the
        # printer-friendly message from pricing.py rather than a 500.
        raise HTTPException(status_code=400, detail=str(exc))

    # rush_amount + remove_branding_amount are ALWAYS the surcharge
    # for the current tier — the options-step UI needs to display the
    # addon prices next to each checkbox regardless of whether they're
    # currently selected. The `total_amount` still respects the actual
    # flags so the server stays authoritative on what would be billed.
    # The create_intent caller zeroes these out for billing when the
    # corresponding flag is False (see comment there).
    rush_amount = rush_surcharge
    remove_branding_amount = pricing.addon_price("remove_branding", country)
    shipping_amount, _ = pricing.shipping_price(country)

    total = (
        base
        + (rush_amount if rush else 0.0)
        + (remove_branding_amount if remove_branding else 0.0)
        + shipping_amount
    )

    return {
        "country": country,
        "currency": currency,
        "quantity_tier": quantity_tier,
        "base_amount": round(base, 2),
        "rush_amount": round(rush_amount, 2),
        "remove_branding_amount": round(remove_branding_amount, 2),
        "shipping_amount": round(shipping_amount, 2),
        "total_amount": round(total, 2),
    }


# ── Endpoints ──────────────────────────────────────────────────────────


@router.post("/quote", response_model=QuoteResponse)
def get_quote(req: QuoteRequest):
    """Pricing-only quote. Used to preview the price before the user
    enters their full shipping details.
    """
    breakdown = _compute_pricing(
        country=req.country,
        content_type=req.content_type,
        quantity=req.quantity,
        paper_stock=req.paper_stock,
        finish=req.finish,
        color_spec=req.color_spec,
        rush=req.rush,
        remove_branding=req.remove_branding,
    )
    return QuoteResponse(**breakdown)


@router.post("/checkout/create-intent", response_model=CreateIntentResponse)
def create_intent(
    data: CreateIntentRequest,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a Stripe PaymentIntent + persist a pending PrintOrder.

    Returns the client_secret the frontend hands to Stripe.js. Auth
    is JWT (router-level dep), event ownership is checked here.
    Server computes the amount — client-sent totals are ignored.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    event = _user_event(data.event_id, user, db)
    country = data.shipping.country.upper()

    # ── Normalize input ───────────────────────────────────────────────
    # Slice 2 accepts both shapes:
    #   * NEW (Slice 3 frontend): `items` array — one entry per content
    #     type in the cart (tented + programs, etc.).
    #   * LEGACY (pre-Slice-3): `content_type` / `quantity` / `design` /
    #     `attendees` at the top level — we wrap them in a 1-item array
    #     so the rest of the handler stays uniform.
    # The legacy path is kept so a stale frontend deploy mid-rollout
    # doesn't drop in-flight checkouts. Once the frontend has been on
    # Slice 3 for a week, we can delete the legacy fields.
    if data.items:
        items: List[ItemSnapshot] = list(data.items)
    elif data.content_type and data.quantity and data.design:
        items = [ItemSnapshot(
            content_type=data.content_type,
            quantity=data.quantity,
            paper_stock=data.paper_stock,
            finish=data.finish,
            color_spec=data.color_spec,
            design=data.design,
            attendees=data.attendees or [],
        )]
    else:
        raise HTTPException(
            status_code=400,
            detail="Either an `items` array or legacy single-item fields are required.",
        )

    # ── Compute pricing per item, sum into order totals ───────────────
    # Rush is order-level (single production-window upgrade for the
    # whole job). remove_branding + shipping are also order-level —
    # the operator ships one parcel and the branding mark applies to
    # the whole print run, not per content type.
    item_breakdowns: List[ItemBreakdown] = []
    items_json: List[dict] = []
    total_base_cents = 0
    total_rush_cents = 0
    currency_iso: Optional[str] = None

    for item in items:
        breakdown = _compute_pricing(
            country=country,
            content_type=item.content_type,
            quantity=item.quantity,
            paper_stock=item.paper_stock,
            finish=item.finish,
            color_spec=item.color_spec,
            rush=data.rush,
            # remove_branding is applied once at order-level below; the
            # per-item compute just needs to know the base + rush.
            remove_branding=False,
        )
        item_base_cents = round(breakdown["base_amount"] * 100)
        item_rush_cents = round(breakdown["rush_amount"] * 100) if data.rush else 0
        total_base_cents += item_base_cents
        total_rush_cents += item_rush_cents
        # Currency is set by country, not content_type, so every item
        # in a single order shares the same currency. Stamp from first
        # item; assert subsequent items match (defensive — should never trip).
        if currency_iso is None:
            currency_iso = breakdown["currency"]
        elif breakdown["currency"] != currency_iso:
            raise HTTPException(
                status_code=400,
                detail=f"Cart items must share one currency; got {breakdown['currency']} and {currency_iso}.",
            )

        item_breakdowns.append(ItemBreakdown(
            content_type=item.content_type,
            quantity=item.quantity,
            quantity_tier=breakdown["quantity_tier"],
            base_amount_cents=item_base_cents,
            rush_amount_cents=item_rush_cents,
        ))
        items_json.append({
            "content_type": item.content_type,
            "quantity": item.quantity,
            "quantity_tier": breakdown["quantity_tier"],
            "paper_stock": item.paper_stock,
            "finish": item.finish,
            "color_spec": item.color_spec,
            "design_image_b64": item.design.image_b64,
            "design_mime_type": item.design.mime_type,
            "design_views_json": (
                [v.model_dump() for v in item.design.views] if item.design.views else None
            ),
            "attendees_json": [a.model_dump() for a in item.attendees],
            "base_amount_cents": item_base_cents,
            "rush_amount_cents": item_rush_cents,
        })

    # Order-level addons + shipping (charged once, not per item).
    branding_cents = (
        round(pricing.addon_price("remove_branding", country) * 100)
        if data.remove_branding else 0
    )
    shipping_amount, _shipping_currency = pricing.shipping_price(country)
    shipping_cents = round(shipping_amount * 100)
    total_cents = total_base_cents + total_rush_cents + branding_cents + shipping_cents

    # Legacy single-item columns get stamped from item 1 so existing
    # code paths (Account → Orders detail view, operator email's
    # "Print specs" section pre-Slice-2-email-refactor) keep rendering
    # something sensible. items_json is the canonical source going forward.
    first_item = items[0]
    first_item_breakdown = item_breakdowns[0]
    first_item_attendees = [a.model_dump() for a in first_item.attendees]

    # Persist the pending order BEFORE the Stripe call so we don't
    # lose the snapshot if the API trips. The placeholder
    # stripe_payment_intent_id is rewritten in the same transaction.
    order = PrintOrder(
        event_id=event.id,
        user_id=user.id,
        content_type=first_item.content_type,
        quantity=first_item.quantity,
        quantity_tier=first_item_breakdown.quantity_tier,
        paper_stock=first_item.paper_stock,
        finish=first_item.finish,
        color_spec=first_item.color_spec,
        turnaround_days=data.turnaround_days,
        rush=data.rush,
        remove_branding=data.remove_branding,
        design_image_b64=first_item.design.image_b64,
        design_mime_type=first_item.design.mime_type,
        design_views_json=(
            [v.model_dump() for v in first_item.design.views] if first_item.design.views else None
        ),
        attendees_json=first_item_attendees,
        items_json=items_json,
        shipping_name=data.shipping.name,
        shipping_email=data.shipping.email,
        shipping_company=data.shipping.company,
        shipping_address1=data.shipping.address1,
        shipping_address2=data.shipping.address2,
        shipping_city=data.shipping.city,
        shipping_state=data.shipping.state,
        shipping_zip=data.shipping.zip,
        shipping_country=country,
        base_amount_cents=total_base_cents,
        rush_amount_cents=total_rush_cents,
        remove_branding_amount_cents=branding_cents,
        shipping_amount_cents=shipping_cents,
        total_amount_cents=total_cents,
        currency=currency_iso,
        stripe_payment_intent_id="",
        status="pending",
    )
    db.add(order)
    db.flush()

    stripe.api_key = settings.stripe_secret_key
    try:
        # Description shows item 1 in the summary; for multi-item orders
        # the operator email is where the full line-by-line list lives.
        description_summary = (
            f"PlaceCard print order #{order.id} — "
            + " + ".join(f"{i.quantity} {i.content_type}" for i in items)
        )
        intent = stripe.PaymentIntent.create(
            amount=total_cents,
            currency=currency_iso.lower(),
            # Card-only on v1. With automatic_payment_methods Stripe
            # would show PayPal / iDEAL / etc., some of which redirect
            # the user away from our modal. Card stays embedded.
            # Revisit when we want Apple Pay / Google Pay / Link, all
            # of which are no-redirect but require the automatic path.
            payment_method_types=["card"],
            description=description_summary,
            metadata={
                "order_id": str(order.id),
                "event_id": str(event.id),
                "user_id": user.id,
                "country": country,
            },
            receipt_email=data.shipping.email or None,
        )
    except stripe.StripeError as exc:
        db.rollback()
        logger.exception("Stripe PaymentIntent.create failed")
        raise HTTPException(
            status_code=502,
            detail=f"Stripe error: {getattr(exc, 'user_message', None) or str(exc)}",
        )

    order.stripe_payment_intent_id = intent.id
    db.commit()
    db.refresh(order)

    return CreateIntentResponse(
        client_secret=intent.client_secret,
        order_id=order.id,
        total_amount_cents=total_cents,
        currency=currency_iso.lower(),
        rush_amount_cents=total_rush_cents,
        remove_branding_amount_cents=branding_cents,
        shipping_amount_cents=shipping_cents,
        items=item_breakdowns,
        base_amount_cents=first_item_breakdown.base_amount_cents,
        quantity_tier=first_item_breakdown.quantity_tier,
    )


def _order_to_response(order: PrintOrder, db: Session) -> PrintOrderResponse:
    event_name: Optional[str] = None
    if order.event_id:
        event = db.query(Event).filter(Event.id == order.event_id).first()
        if event:
            event_name = event.name
    return PrintOrderResponse(
        id=order.id,
        status=order.status,
        total_amount_cents=order.total_amount_cents,
        currency=order.currency,
        content_type=order.content_type,
        quantity=order.quantity,
        quantity_tier=order.quantity_tier,
        event_id=order.event_id,
        event_name=event_name,
        shipping_name=order.shipping_name,
        shipping_city=order.shipping_city,
        shipping_country=order.shipping_country,
        tracking_number=order.tracking_number,
        tracking_carrier=order.tracking_carrier,
        tracking_url=order.tracking_url,
        created_at=order.created_at.isoformat(),
        paid_at=order.paid_at.isoformat() if order.paid_at else None,
        fulfilled_at=order.fulfilled_at.isoformat() if order.fulfilled_at else None,
    )


@router.get("/orders", response_model=List[PrintOrderResponse])
def list_orders(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the caller's print orders, newest first. Drives the
    'Orders' section under Account → Billing.
    """
    q = db.query(PrintOrder)
    if not user.is_anonymous:
        q = q.filter(PrintOrder.user_id == user.id)
    orders = q.order_by(PrintOrder.created_at.desc()).all()
    return [_order_to_response(o, db) for o in orders]


def _order_to_detail(order: PrintOrder, db: Session) -> PrintOrderDetailResponse:
    event_name: Optional[str] = None
    if order.event_id:
        event = db.query(Event).filter(Event.id == order.event_id).first()
        if event:
            event_name = event.name
    attendees = order.attendees_json or []
    return PrintOrderDetailResponse(
        id=order.id,
        status=order.status,
        total_amount_cents=order.total_amount_cents,
        currency=order.currency,
        content_type=order.content_type,
        quantity=order.quantity,
        quantity_tier=order.quantity_tier,
        event_id=order.event_id,
        event_name=event_name,
        shipping_name=order.shipping_name,
        shipping_city=order.shipping_city,
        shipping_country=order.shipping_country,
        tracking_number=order.tracking_number,
        tracking_carrier=order.tracking_carrier,
        tracking_url=order.tracking_url,
        created_at=order.created_at.isoformat(),
        paid_at=order.paid_at.isoformat() if order.paid_at else None,
        fulfilled_at=order.fulfilled_at.isoformat() if order.fulfilled_at else None,
        paper_stock=order.paper_stock,
        finish=order.finish,
        color_spec=order.color_spec,
        turnaround_days=order.turnaround_days,
        rush=order.rush,
        remove_branding=order.remove_branding,
        base_amount_cents=order.base_amount_cents,
        rush_amount_cents=order.rush_amount_cents,
        remove_branding_amount_cents=order.remove_branding_amount_cents,
        shipping_amount_cents=order.shipping_amount_cents,
        design_image_b64=order.design_image_b64,
        design_mime_type=order.design_mime_type,
        attendees_count=len(attendees),
        shipping_email=order.shipping_email,
        shipping_company=order.shipping_company,
        shipping_address1=order.shipping_address1,
        shipping_address2=order.shipping_address2,
        shipping_state=order.shipping_state,
        shipping_zip=order.shipping_zip,
    )


@router.get("/orders/{order_id}", response_model=PrintOrderDetailResponse)
def get_order(
    order_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Order detail with full breakdown + design preview. Drives the
    order popup in Account → Orders and the post-checkout success page.
    """
    q = db.query(PrintOrder).filter(PrintOrder.id == order_id)
    if not user.is_anonymous:
        q = q.filter(PrintOrder.user_id == user.id)
    order = q.first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return _order_to_detail(order, db)
