import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

/**
 * Post-purchase confirmation page reached at /orders/:orderId/success.
 *
 * Two jobs:
 *   1. UX — show the buyer their order summary so they have a sense
 *      of "yes, the payment landed". The Stripe + Resend receipts go
 *      to their inbox separately; this is the in-app acknowledgement.
 *   2. Google Ads — a unique URL ONLY reached after a successful
 *      payment, so the Google Ads campaign's URL-based conversion
 *      tracking can fire when a real user lands here. The campaign
 *      config points at /orders/*​/success as the purchase signal.
 *
 * Status note: Stripe's payment_intent.succeeded webhook is what
 * actually flips the order to 'paid' server-side. The PaymentElement
 * reports success client-side a moment earlier, so when this page
 * mounts the status might still be 'pending'. We poll a few times
 * to wait for the webhook to catch up before deciding whether the
 * order is genuinely paid.
 */

type OrderSummary = {
  id: number;
  status: string;
  total_amount_cents: number;
  currency: string;
  content_type: string;
  quantity: number;
  event_id: number;
  event_name: string | null;
  shipping_name: string;
  shipping_city: string;
  shipping_country: string;
  created_at: string;
  paid_at: string | null;
};

function formatMoney(cents: number, currency: string): string {
  const symbol = currency.toUpperCase() === "GBP" ? "£" : "$";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  "tented-name-cards": "Tented place cards",
  "name-cards": "Flat name cards",
  programs: "Programs",
};

export default function OrderSuccessPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll up to ~6 seconds for the Stripe webhook to flip status to
  // 'paid'. The first fetch happens immediately so the page paints
  // with whatever the server currently has; subsequent fetches only
  // run while status is still 'pending'.
  useEffect(() => {
    if (!orderId) {
      setError("No order ID in URL.");
      return;
    }
    const id = Number(orderId);
    if (!Number.isFinite(id)) {
      setError("Invalid order ID.");
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const fetchOnce = async () => {
      try {
        const data = await api.getPrintOrder(id);
        if (cancelled) return;
        setOrder(data);
        // Stop polling once the webhook has caught up OR after 6 tries.
        if (data.status !== "pending" || attempts >= 6) return;
        attempts += 1;
        setTimeout(fetchOnce, 1000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load order.");
      }
    };
    void fetchOnce();
    return () => { cancelled = true; };
  }, [orderId]);

  // Google Ads conversion tag fires once the order is genuinely paid.
  // Guarded against firing on a pending-but-never-confirmed order so
  // we don't report bogus conversions to Google. (Real wiring of the
  // gtag/AW-XXX snippet happens after the Google Ads campaign exists
  // and Dani has the conversion ID — see comment block below the
  // Order Summary card.)
  useEffect(() => {
    if (!order || order.status !== "paid") return;
    // Once the Google Ads campaign is live, paste the snippet here:
    //   window.gtag?.("event", "conversion", {
    //     send_to: "AW-XXXXXXXXX/abcDEFghi",
    //     value: order.total_amount_cents / 100,
    //     currency: order.currency.toUpperCase(),
    //     transaction_id: String(order.id),
    //   });
    // Leaving this as a no-op for now so the page is visible / testable
    // BEFORE the Google Ads campaign exists; safe to add the call
    // without changing anything else here.
  }, [order]);

  if (error) {
    return (
      <div className="order-success-page">
        <div className="order-success-card">
          <h1>Couldn't load this order</h1>
          <p className="order-success-error">{error}</p>
          <Link to="/" className="btn btn-primary">Back to events</Link>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="order-success-page">
        <div className="order-success-card">
          <p className="order-success-loading">Loading your order…</p>
        </div>
      </div>
    );
  }

  const isPaid = order.status === "paid" || order.status === "fulfilled";
  const isPending = order.status === "pending";

  return (
    <div className="order-success-page">
      <div className="order-success-card">
        <div className={`order-success-icon ${isPaid ? "" : "order-success-icon-pending"}`}>
          {isPaid ? "✓" : "⏳"}
        </div>
        <h1>{isPaid ? "Your print order is in!" : "Confirming your payment…"}</h1>
        <p className="order-success-subhead">
          {isPaid
            ? "Thanks for ordering with PlaceCard. We'll send a receipt to your email shortly."
            : isPending
              ? "Payment received — just waiting for confirmation. This usually takes a few seconds."
              : "Something went wrong with this order. Please check your email or contact us."}
        </p>

        <div className="order-success-summary">
          <div className="order-success-row">
            <span>Order</span>
            <strong>#{order.id}</strong>
          </div>
          {order.event_name && (
            <div className="order-success-row">
              <span>Event</span>
              <strong>{order.event_name}</strong>
            </div>
          )}
          <div className="order-success-row">
            <span>Item</span>
            <strong>
              {order.quantity} × {CONTENT_TYPE_LABELS[order.content_type] ?? order.content_type}
            </strong>
          </div>
          <div className="order-success-row">
            <span>Total paid</span>
            <strong>{formatMoney(order.total_amount_cents, order.currency)}</strong>
          </div>
          <div className="order-success-row">
            <span>Ship to</span>
            <strong>{order.shipping_name} · {order.shipping_city}, {order.shipping_country}</strong>
          </div>
        </div>

        {isPaid && (
          <p className="order-success-note">
            Estimated delivery: 2–3 business days. You'll get an email with tracking
            details once your prints ship.
          </p>
        )}

        <div className="order-success-actions">
          <Link to={`/events/${order.event_id}`} className="btn btn-primary">
            Back to event
          </Link>
          <Link to="/account/orders" className="btn">
            View all orders
          </Link>
        </div>
      </div>
    </div>
  );
}
