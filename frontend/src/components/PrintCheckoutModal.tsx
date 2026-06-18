/**
 * PrintCheckoutModal — Stripe-Elements-based checkout for print orders.
 *
 * 3 internal steps:
 *   1. Address — name, email, shipping fields, country (UK default)
 *   2. Payment — Stripe PaymentElement (card only on v1, no redirects)
 *   3. Success — order confirmation
 *
 * The PaymentIntent is created server-side on Continue from step 1.
 * Server recomputes the amount from pricing.py — client-sent totals
 * are ignored. On payment_intent.succeeded the backend's Stripe
 * webhook fires the operator fulfillment email with design files +
 * attendee CSV attached.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api } from "../api/client";

const stripePublishableKey =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ?? "";

// Module-level — loadStripe returns a Promise we want to reuse across renders.
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;

type ContentType = "tented-name-cards" | "name-cards" | "programs";

export interface PrintCheckoutDesign {
  image_b64: string;
  mime_type: string;
  description?: string | null;
  views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
}

export interface PrintCheckoutAttendee {
  name: string;
  table_name?: string | null;
  dietary?: string | null;
}

/**
 * One content type's worth of cart input. Multiple CartItem entries
 * can ship in a single checkout (tented place cards + programs in the
 * same charge). The order-level fields (rush, remove_branding,
 * shipping) live on the modal itself, not per item.
 */
export interface CartItem {
  contentType: ContentType;
  design: PrintCheckoutDesign;
  // Per-attendee personalization payload. Tented place cards: one
  // entry per guest (the event's attendee list). Programs: empty —
  // programs are batch-identical, no per-attendee CSV needed.
  attendees: PrintCheckoutAttendee[];
  // For tented: equals attendees.length (no picker, derived from
  // the guest list). For programs: chosen from a tier dropdown —
  // CollateralTab seeds with the smart default (closest tier ≥
  // attendee count, floor 50).
  quantity: number;
}

interface Props {
  eventId: number;
  items: CartItem[];
  // Initial value for the order-level "Remove branding" tick. The
  // user can still toggle inside the modal; this prop just seeds.
  initialRemoveBranding?: boolean;
  onClose: () => void;
}

type Step = "options" | "address" | "payment" | "success";

// Tier ladder for the program quantity picker. Mirrors the keys in
// pricing.PRINT_PRICING[country]["programs"] — keep these in sync
// when the backend ladder changes.
const PROGRAM_TIERS = [50, 100, 250, 500, 1000];

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  "tented-name-cards": "Tented place cards",
  "name-cards": "Flat name cards",
  programs: "Programs",
};


function formatCurrency(amount: number, currency: string): string {
  const symbol = currency.toUpperCase() === "GBP" ? "£" : "$";
  return `${symbol}${amount.toFixed(2)}`;
}

export default function PrintCheckoutModal({
  eventId,
  items,
  initialRemoveBranding = false,
  onClose,
}: Props) {
  const { user: authUser, myProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("options");
  // Rush is intentionally removed for the launch window — UK printer
  // doesn't offer next-day. Pricing table still carries per-tier rush
  // values for when a US printer with rush support comes online; the
  // frontend just doesn't surface the tick. Backend `rush` flag always
  // sends false from here.
  const [removeBranding, setRemoveBranding] = useState(initialRemoveBranding);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [currency, setCurrency] = useState("gbp");
  // Server-authoritative breakdown returned alongside the PaymentIntent.
  // Drives the line-item summary on the Payment step so the customer
  // can see per-content-type pricing alongside shipping + addons.
  const [breakdown, setBreakdown] = useState<{
    rush_amount_cents: number;
    remove_branding_amount_cents: number;
    shipping_amount_cents: number;
    items: {
      content_type: string;
      quantity: number;
      quantity_tier: number;
      base_amount_cents: number;
      rush_amount_cents: number;
    }[];
  } | null>(null);

  // Per-item program quantity state. Tented quantities are fixed
  // (attendees.length); only programs have a user-pickable quantity
  // from the tier dropdown. Keyed by item index to handle the case
  // where the user selected multiple programs designs (rare today
  // but cheap to support). Seeded from each item's initial quantity.
  const [itemQuantities, setItemQuantities] = useState<number[]>(
    () => items.map(it => it.quantity),
  );

  // Per-item quote results for the Options-step preview. One quote
  // per item, fetched in parallel. The order is the same as `items`
  // / `itemQuantities` so we can zip them by index.
  const [optionsQuotes, setOptionsQuotes] = useState<({
    base_amount: number;
    remove_branding_amount: number;
    currency: string;
  } | null)[]>(() => items.map(() => null));
  // Caps + tier-not-found errors from the quote endpoint. One slot per
  // item — surfaced inline so the user knows which item is the problem.
  const [optionsQuoteErrors, setOptionsQuoteErrors] = useState<(string | null)[]>(
    () => items.map(() => null),
  );

  // Re-quote every item whenever its quantity changes (programs picker
  // moves a tier) or addon ticks change. Each item gets its own quote
  // call; we don't sum on the frontend — server is the pricer.
  useEffect(() => {
    if (step !== "options") return;
    let cancelled = false;
    setOptionsQuoteErrors(items.map(() => null));
    Promise.all(
      items.map((item, idx) =>
        api.getPrintQuote({
          country: "GB",
          content_type: item.contentType,
          quantity: itemQuantities[idx] || 1,
          rush: false,
          remove_branding: removeBranding,
        })
          .then(q => ({ ok: true as const, idx, q }))
          .catch((err: Error) => ({ ok: false as const, idx, err })),
      ),
    ).then(results => {
      if (cancelled) return;
      const nextQuotes: ({
        base_amount: number;
        remove_branding_amount: number;
        currency: string;
      } | null)[] = items.map(() => null);
      const nextErrors: (string | null)[] = items.map(() => null);
      for (const r of results) {
        if (r.ok) {
          nextQuotes[r.idx] = {
            base_amount: r.q.base_amount,
            remove_branding_amount: r.q.remove_branding_amount,
            currency: r.q.currency,
          };
        } else {
          nextErrors[r.idx] = r.err.message || "Could not calculate pricing.";
        }
      }
      setOptionsQuotes(nextQuotes);
      setOptionsQuoteErrors(nextErrors);
    });
    return () => { cancelled = true; };
  }, [step, removeBranding, items, itemQuantities]);

  // Shipping fields. UK default per the 2026-05-16 launch decision.
  // Pre-populate from the logged-in PlaceCard account. Profile display
  // name wins because the user has explicitly chosen it; falls back to
  // auth metadata then the email local-part. Email comes from auth
  // (Supabase verified address). Lazy initialiser so user edits stick.
  const [name, setName] = useState(() => {
    if (myProfile?.display_name) return myProfile.display_name;
    const meta = (authUser?.user_metadata as { full_name?: string } | undefined)?.full_name;
    if (meta) return meta;
    if (authUser?.email) return authUser.email.split("@")[0];
    return "";
  });
  const [email, setEmail] = useState(() => authUser?.email ?? "");

  // If myProfile resolves after the modal mounts, fill the empty
  // defaults — without clobbering anything the user has typed.
  useEffect(() => {
    if (!name && myProfile?.display_name) setName(myProfile.display_name);
    if (!email && authUser?.email) setEmail(authUser.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myProfile, authUser]);
  const [company, setCompany] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [zip, setZip] = useState("");
  const [country, setCountry] = useState<"US" | "GB">("GB");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmitAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.createPrintIntent({
        event_id: eventId,
        items: items.map((it, idx) => ({
          content_type: it.contentType,
          quantity: itemQuantities[idx] || 1,
          design: it.design,
          // Programs are batch-identical so send an empty attendees
          // array; only tented passes the personalization list.
          attendees: it.contentType === "programs" ? [] : it.attendees,
        })),
        // Rush is off everywhere for the launch window — UK printer
        // doesn't offer next-day. turnaround_days stays at the standard
        // value; backend ignores the rush field's effect on pricing
        // when the flag is false.
        turnaround_days: 7,
        rush: false,
        remove_branding: removeBranding,
        shipping: {
          name,
          email,
          company: company || null,
          address1,
          address2: address2 || null,
          city,
          state: country === "US" ? stateField : null,
          zip,
          country,
        },
      });
      setClientSecret(result.client_secret);
      setOrderId(result.order_id);
      setTotalCents(result.total_amount_cents);
      setCurrency(result.currency);
      setBreakdown({
        rush_amount_cents: result.rush_amount_cents,
        remove_branding_amount_cents: result.remove_branding_amount_cents,
        shipping_amount_cents: result.shipping_amount_cents,
        items: result.items,
      });
      setStep("payment");
    } catch (err: any) {
      setError(err?.message ?? "Could not start checkout");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="order-modal">
        <div className="order-modal-header">
          <h3>
            {step === "options" && "Print options"}
            {step === "address" && "Shipping address"}
            {step === "payment" && "Payment"}
            {step === "success" && "Order placed"}
          </h3>
          <button className="invite-close" onClick={onClose}>×</button>
        </div>

        <div className="order-modal-body">
          {/* Cart items strip at the top of every step — one row per
              item so the user always sees what they're ordering. For
              tented this shows the design + N cards; for programs it
              shows the design + the quantity picker (Options step only;
              read-only on later steps). */}
          <div className="order-cart-strip">
            {items.map((it, idx) => {
              const quote = optionsQuotes[idx];
              const qty = itemQuantities[idx] || 0;
              const label = CONTENT_TYPE_LABELS[it.contentType];
              return (
                <div key={idx} className="order-cart-item">
                  <img
                    src={`data:${it.design.mime_type};base64,${it.design.image_b64}`}
                    alt={`${label} design`}
                    className="order-cart-item-image"
                  />
                  <div className="order-cart-item-info">
                    <div className="order-cart-item-label">{label}</div>
                    <div className="order-cart-item-qty">
                      {qty} {it.contentType === "programs" ? "programs" : `card${qty === 1 ? "" : "s"}`}
                    </div>
                    {quote && (
                      <div className="order-cart-item-price">
                        {formatCurrency(quote.base_amount, quote.currency)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="order-cart-meta">2–3 day turnaround</div>
          </div>

          {step === "options" && (
            <div className="order-field">
              {/* Per-item errors (caps / tier-not-found). One block per
                  item that erred — the user can tell which item is the
                  problem and adjust its quantity / picker before
                  Continue is re-enabled. */}
              {optionsQuoteErrors.some(e => e) && (
                <div
                  style={{
                    padding: 12, background: "#fef2f2", border: "1px solid #fecaca",
                    color: "#991b1b", borderRadius: 8, marginBottom: 12,
                    fontSize: 14, lineHeight: 1.5,
                  }}
                >
                  {optionsQuoteErrors.map((err, idx) =>
                    err ? (
                      <div key={idx}>
                        {CONTENT_TYPE_LABELS[items[idx].contentType]}: {err}
                      </div>
                    ) : null,
                  )}
                </div>
              )}

              {/* Programs quantity picker — one dropdown per program item.
                  Tented uses attendees.length and isn't picker-able. */}
              {items.map((it, idx) =>
                it.contentType === "programs" ? (
                  <div
                    key={`qty-${idx}`}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 12, padding: 14, border: "1px solid var(--border)",
                      borderRadius: 8, marginBottom: 10,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        Programs quantity
                      </div>
                      <div style={{ fontSize: 13, color: "#64748b" }}>
                        Programs are batch-printed in fixed tier sizes — pick the
                        one that fits your guest count.
                      </div>
                    </div>
                    <select
                      value={itemQuantities[idx]}
                      onChange={e => {
                        const next = Number(e.target.value);
                        setItemQuantities(prev =>
                          prev.map((q, i) => (i === idx ? next : q)),
                        );
                      }}
                      style={{
                        // Override the global `select { width: 100% }`
                        // rule in App.css so the dropdown shrinks to its
                        // content (just the tier number + chevron) rather
                        // than blowing out the row.
                        width: "auto",
                        padding: "8px 12px",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {PROGRAM_TIERS.map(tier => (
                        <option key={tier} value={tier}>{tier}</option>
                      ))}
                    </select>
                  </div>
                ) : null,
              )}

              {/* Remove-branding tick — applies to the whole order, not
                  per item. Rush tick is intentionally absent for launch
                  (UK printer doesn't offer it). */}
              <label
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12, padding: 14,
                  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer",
                  marginBottom: 16,
                }}
              >
                <input
                  type="checkbox"
                  checked={removeBranding}
                  onChange={e => setRemoveBranding(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Remove PlaceCard branding</div>
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    Strip the "Hosted via PlaceCard" mark from the print.
                  </div>
                </div>
                <div style={{ fontWeight: 600, color: "#1b4fff", whiteSpace: "nowrap" }}>
                  {/* The remove-branding addon is the same value on every
                      item's quote (it's a per-country flat fee), so we
                      can read it off the first item that has a quote. */}
                  {optionsQuotes.find(q => q) ? (
                    `+${formatCurrency(optionsQuotes.find(q => q)!.remove_branding_amount, optionsQuotes.find(q => q)!.currency)}`
                  ) : "+…"}
                </div>
              </label>

              {/* Subtotal — one line per item plus optional branding addon.
                  Shipping intentionally not shown here — it's address-
                  dependent and not known until the next step. */}
              {optionsQuotes.some(q => q) && (
                <div
                  style={{
                    background: "#f8fafc", borderRadius: 8, padding: 14,
                    fontSize: 14,
                  }}
                >
                  {items.map((it, idx) => {
                    const quote = optionsQuotes[idx];
                    if (!quote) return null;
                    return (
                      <div
                        key={idx}
                        style={{
                          display: "flex", justifyContent: "space-between",
                          marginBottom: 6,
                        }}
                      >
                        <span>{CONTENT_TYPE_LABELS[it.contentType]}</span>
                        <span>{formatCurrency(quote.base_amount, quote.currency)}</span>
                      </div>
                    );
                  })}
                  {removeBranding && optionsQuotes.find(q => q) && (
                    <div
                      style={{
                        display: "flex", justifyContent: "space-between",
                        marginBottom: 6, color: "#475569",
                      }}
                    >
                      <span>Remove PlaceCard branding</span>
                      <span>+{formatCurrency(optionsQuotes.find(q => q)!.remove_branding_amount, optionsQuotes.find(q => q)!.currency)}</span>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", borderTop: "1px solid #e2e8f0",
                      paddingTop: 8, marginTop: 8,
                    }}
                  >
                    <span>
                      Subtotal
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                        Shipping calculated at the next step
                      </div>
                    </span>
                    <strong style={{ fontSize: 18 }}>
                      {(() => {
                        const anyQuote = optionsQuotes.find(q => q)!;
                        const totalBase = optionsQuotes.reduce(
                          (acc, q) => acc + (q?.base_amount ?? 0),
                          0,
                        );
                        const brandingAddon = removeBranding ? anyQuote.remove_branding_amount : 0;
                        return formatCurrency(totalBase + brandingAddon, anyQuote.currency);
                      })()}
                    </strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "address" && (
            <form id="pcm-address-form" onSubmit={handleSubmitAddress}>
              <div className="order-field">
                <label className="order-label">Country</label>
                <select
                  className="order-select"
                  value={country}
                  onChange={(e) => setCountry(e.target.value as "US" | "GB")}
                >
                  <option value="GB">United Kingdom</option>
                  <option value="US">United States</option>
                </select>
              </div>
              <div className="order-field">
                <label className="order-label">Shipping address</label>
                <div className="order-address-grid">
                  <input
                    className="order-input"
                    required
                    placeholder="Recipient name *"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    className="order-input"
                    required
                    type="email"
                    placeholder="Email *"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <input
                    className="order-input order-input-full"
                    placeholder="Company (optional)"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                  <input
                    className="order-input order-input-full"
                    required
                    placeholder="Address line 1 *"
                    value={address1}
                    onChange={(e) => setAddress1(e.target.value)}
                  />
                  <input
                    className="order-input order-input-full"
                    placeholder="Address line 2"
                    value={address2}
                    onChange={(e) => setAddress2(e.target.value)}
                  />
                  <input
                    className="order-input"
                    required
                    placeholder="City *"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  {country === "US" && (
                    <input
                      className="order-input order-input-sm"
                      required
                      placeholder="State *"
                      value={stateField}
                      onChange={(e) => setStateField(e.target.value)}
                    />
                  )}
                  <input
                    className="order-input order-input-sm"
                    required
                    placeholder={country === "US" ? "ZIP *" : "Postcode *"}
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                  />
                </div>
              </div>
              {error && <div className="order-price-error">{error}</div>}
            </form>
          )}

          {step === "payment" && clientSecret && stripePromise && (
            <Elements
              stripe={stripePromise}
              options={{ clientSecret, appearance: { theme: "stripe" } }}
            >
              <PaymentStep
                totalCents={totalCents}
                currency={currency}
                breakdown={breakdown}
                removeBranding={removeBranding}
                onSuccess={() => {
                  // Navigate to the dedicated confirmation route
                  // instead of switching to an internal modal step.
                  // The unique URL is what Google Ads' URL-based
                  // conversion tracker keys on; staying in-modal
                  // wouldn't change the URL and wouldn't fire the
                  // conversion. Modal unmounts via the route
                  // transition — no need for onClose().
                  if (orderId) {
                    navigate(`/orders/${orderId}/success`);
                  } else {
                    // Defensive: if orderId somehow missing, fall
                    // back to the old in-modal success step rather
                    // than navigating to /orders/undefined/success.
                    setStep("success");
                  }
                }}
                onError={(msg) => setError(msg)}
              />
            </Elements>
          )}

          {step === "payment" && !stripePromise && (
            <div className="order-price-error">
              Stripe publishable key is not configured.
              Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in Cloudflare Pages env, then redeploy.
            </div>
          )}

          {step === "success" && (
            <div className="order-confirmation">
              <div className="order-confirmation-icon">✓</div>
              <p className="order-confirmation-title">
                Your print order has been placed.
              </p>
              <div className="order-confirmation-details">
                <div className="order-detail-row">
                  <span>Order</span>
                  <strong>#{orderId}</strong>
                </div>
                <div className="order-detail-row">
                  <span>Receipt</span>
                  <strong>{email}</strong>
                </div>
                <p className="order-mock-notice" style={{ marginTop: 12 }}>
                  You'll receive a Stripe receipt by email and we'll get your
                  print files into production. Estimated delivery: 7 business days.
                </p>
              </div>
            </div>
          )}
        </div>

        {step === "options" && (
          <div className="order-modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep("address")}
              disabled={optionsQuoteErrors.some(e => e)}
            >
              Continue →
            </button>
          </div>
        )}

        {step === "address" && (
          <div className="order-modal-footer">
            <button type="button" className="btn" onClick={() => setStep("options")}>← Back</button>
            <button
              type="submit"
              form="pcm-address-form"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Starting…" : "Continue to payment →"}
            </button>
          </div>
        )}

        {step === "success" && (
          <div className="order-modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </>
  );
}

function PaymentStep({
  totalCents,
  currency,
  breakdown,
  removeBranding,
  onSuccess,
  onError,
}: {
  totalCents: number;
  currency: string;
  breakdown: {
    rush_amount_cents: number;
    remove_branding_amount_cents: number;
    shipping_amount_cents: number;
    items: {
      content_type: string;
      quantity: number;
      quantity_tier: number;
      base_amount_cents: number;
      rush_amount_cents: number;
    }[];
  } | null;
  removeBranding: boolean;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState("");

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setLocalError("");

    const { error: submitError } = await elements.submit();
    if (submitError) {
      const msg = submitError.message ?? "Invalid card details";
      setLocalError(msg);
      onError(msg);
      setSubmitting(false);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      // No-redirect path: if the user picks a payment method that
      // requires off-site auth (rare with card-only), we send them
      // back to the same page rather than to a separate success page.
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmError) {
      const msg = confirmError.message ?? "Payment failed";
      setLocalError(msg);
      onError(msg);
      setSubmitting(false);
      return;
    }

    if (paymentIntent && paymentIntent.status === "succeeded") {
      onSuccess();
      return;
    }

    const msg = `Unexpected payment status: ${paymentIntent?.status ?? "unknown"}`;
    setLocalError(msg);
    onError(msg);
    setSubmitting(false);
  };

  const symbol = currency.toLowerCase() === "gbp" ? "£" : "$";
  const fmt = (cents: number) => `${symbol}${(cents / 100).toFixed(2)}`;

  return (
    <>
      <div className="order-price-area">
        <div className="order-price-display">
          {breakdown && (
            <>
              {/* One row per cart item — gives the customer a per-content-
                  type price split before the addons + shipping totals. */}
              {breakdown.items.map((item, idx) => (
                <div key={idx} className="order-price-row">
                  <span>{CONTENT_TYPE_LABELS[item.content_type as ContentType] ?? item.content_type}</span>
                  <span>{fmt(item.base_amount_cents)}</span>
                </div>
              ))}
              {breakdown.rush_amount_cents > 0 && (
                <div className="order-price-row">
                  <span>Rush turnaround</span>
                  <span>{fmt(breakdown.rush_amount_cents)}</span>
                </div>
              )}
              {removeBranding && breakdown.remove_branding_amount_cents > 0 && (
                <div className="order-price-row">
                  <span>Remove PlaceCard branding</span>
                  <span>{fmt(breakdown.remove_branding_amount_cents)}</span>
                </div>
              )}
              <div className="order-price-row">
                <span>Shipping</span>
                <span>{fmt(breakdown.shipping_amount_cents)}</span>
              </div>
            </>
          )}
          <div className="order-price-row order-price-total">
            <span>Total</span>
            <strong>{fmt(totalCents)}</strong>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <PaymentElement />
      </div>
      {localError && <div className="order-price-error">{localError}</div>}
      <div className="order-modal-footer" style={{ marginTop: 16 }}>
        <button
          className="btn btn-primary"
          onClick={handlePay}
          disabled={!stripe || !elements || submitting}
          style={{ minWidth: 180 }}
        >
          {submitting ? "Processing…" : `Pay ${fmt(totalCents)}`}
        </button>
      </div>
    </>
  );
}
