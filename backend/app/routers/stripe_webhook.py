"""
Stripe webhook receiver — handles payment_intent.* events.

Lives in its own router because it CANNOT carry the JWT auth
dependency that every other authenticated print endpoint uses:
Stripe doesn't have our user's JWT. Instead, the webhook validates
the request via the Stripe-Signature header against
settings.stripe_webhook_secret. A request that fails signature
verification returns 400 and never touches DB state.

Configure the endpoint URL in Stripe Dashboard → Developers → Webhooks
as `https://api.placecard-events.app/api/stripe/webhook`, subscribed
to `payment_intent.succeeded` and `payment_intent.payment_failed`.
The signing secret it generates goes into Render env as
`STRIPE_WEBHOOK_SECRET`.
"""
from __future__ import annotations

import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.print_order import PrintOrder
from app.services.email import send_customer_receipt
from app.services.print_rendering import render_print_files_and_notify

logger = logging.getLogger("stripe_webhook")

# Separate router — NO auth dep. Stripe authenticates via signature.
router = APIRouter(prefix="/api/stripe", tags=["stripe"])


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """Receive + dispatch Stripe events.

    Always returns 200 once the signature has verified, even if our
    internal handler trips — Stripe retries on non-2xx and we don't
    want a Resend hiccup to cause duplicate webhook deliveries that
    each try to refire the fulfillment email.
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=500, detail="STRIPE_WEBHOOK_SECRET not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError) as exc:
        logger.warning("Webhook signature verification failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type = event["type"]
    obj = event["data"]["object"]

    if event_type == "payment_intent.succeeded":
        _handle_payment_succeeded(obj, db, request)
    elif event_type == "payment_intent.payment_failed":
        _handle_payment_failed(obj, db)
    else:
        logger.info("Ignoring unhandled webhook event type: %s", event_type)

    return {"received": True}


def _handle_payment_succeeded(intent: dict, db: Session, request: Request) -> None:
    order = (
        db.query(PrintOrder)
        .filter(PrintOrder.stripe_payment_intent_id == intent["id"])
        .first()
    )
    if order is None:
        logger.warning(
            "payment_intent.succeeded for unknown PaymentIntent %s",
            intent["id"],
        )
        return

    if order.status != "pending":
        # Idempotent: webhook might be retried by Stripe.
        logger.info("Order %s already in status %s — skipping", order.id, order.status)
        return

    order.status = "paid"
    order.paid_at = datetime.utcnow()
    db.commit()
    order_id = order.id  # capture before the session closes downstream

    # Customer receipt — fire immediately so the buyer gets confirmation
    # at payment time, not 30+ seconds later when renders finish. Never
    # blocks fulfillment; failure here just logs.
    try:
        send_customer_receipt(order)
    except Exception:
        logger.exception("Customer receipt send failed for order %s", order_id)

    # Schedule the per-attendee Gemini-rendering job on the
    # APScheduler instance attached to app.state in main.py. The job
    # takes minutes (N attendees × 2 faces × Gemini latency), which
    # is well beyond Stripe's webhook timeout — fire-and-forget here,
    # the webhook returns 200 immediately and Stripe doesn't retry.
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler is None:
        # Defensive: if APScheduler isn't running (e.g. import error
        # at boot), fall back to a thread so the order still gets
        # rendered + emailed. Slower path but won't block the webhook.
        import threading
        logger.warning("Scheduler not on app.state — running render job in a thread")
        threading.Thread(
            target=render_print_files_and_notify,
            args=(order_id,),
            daemon=True,
        ).start()
    else:
        scheduler.add_job(
            render_print_files_and_notify,
            args=(order_id,),
            id=f"render_order_{order_id}",
            replace_existing=True,
        )
        logger.info("Scheduled print-rendering job for order %s", order_id)


def _handle_payment_failed(intent: dict, db: Session) -> None:
    order = (
        db.query(PrintOrder)
        .filter(PrintOrder.stripe_payment_intent_id == intent["id"])
        .first()
    )
    if order is None:
        logger.warning(
            "payment_intent.payment_failed for unknown PaymentIntent %s",
            intent["id"],
        )
        return

    if order.status == "pending":
        order.status = "failed"
        db.commit()
