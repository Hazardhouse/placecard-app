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

interface Props {
  eventId: number;
  contentType: ContentType;
  design: PrintCheckoutDesign;
  attendees: PrintCheckoutAttendee[];
  // Initial values for the addon ticks shown on the first step. The
  // user can still toggle them inside the modal; this prop just seeds.
  initialRush?: boolean;
  initialRemoveBranding?: boolean;
  onClose: () => void;
}

type Step = "options" | "address" | "payment" | "success";


function formatCurrency(amount: number, currency: string): string {
  const symbol = currency.toUpperCase() === "GBP" ? "£" : "$";
  return `${symbol}${amount.toFixed(2)}`;
}

export default function PrintCheckoutModal({
  eventId,
  contentType,
  design,
  attendees,
  initialRush = false,
  initialRemoveBranding = false,
  onClose,
}: Props) {
  const [step, setStep] = useState<Step>("options");
  const [rush, setRush] = useState(initialRush);
  const [removeBranding, setRemoveBranding] = useState(initialRemoveBranding);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [totalCents, setTotalCents] = useState(0);
  const [currency, setCurrency] = useState("gbp");

  // Preview quote for the options step. Refetched whenever the addon
  // ticks change — the server is the authoritative pricer. Country
  // defaults to GB (UK) since shipping isn't known yet; final pricing
  // is recomputed on the create-intent call once the address is in.
  const [optionsQuote, setOptionsQuote] = useState<{
    currency: string;
    base_amount: number;
    rush_amount: number;
    remove_branding_amount: number;
  } | null>(null);

  useEffect(() => {
    if (step !== "options") return;
    let cancelled = false;
    api.getPrintQuote({
      country: "GB",
      content_type: contentType,
      quantity: attendees.length || 1,
      rush,
      remove_branding: removeBranding,
    })
      .then(q => {
        if (!cancelled) {
          setOptionsQuote({
            currency: q.currency,
            base_amount: q.base_amount,
            rush_amount: q.rush_amount,
            remove_branding_amount: q.remove_branding_amount,
          });
        }
      })
      .catch(() => {
        // Non-fatal — the options preview just shows blanks if the
        // quote endpoint is unreachable. Real pricing is recomputed
        // server-side on Continue.
      });
    return () => { cancelled = true; };
  }, [step, rush, removeBranding, attendees.length, contentType]);

  // Shipping fields. UK default per the 2026-05-16 launch decision.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
        content_type: contentType,
        quantity: attendees.length || 1,
        // Rush shortens the production window (4 vs 7 business days)
        // AND adds the rush surcharge; both happen in tandem.
        turnaround_days: rush ? 4 : 7,
        rush,
        remove_branding: removeBranding,
        design,
        attendees,
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
          {/* Design preview at the top of every step */}
          <div className="order-design-preview">
            <img
              src={`data:${design.mime_type};base64,${design.image_b64}`}
              alt="Selected design"
              style={{ maxWidth: 200, borderRadius: 6, display: "block", margin: "0 auto" }}
            />
            <div className="order-preview-label">
              {attendees.length} card{attendees.length === 1 ? "" : "s"}
            </div>
          </div>

          {step === "options" && (
            <div className="order-field">
              <label
                style={{
                  display: "flex", alignItems: "flex-start", gap: 12, padding: 14,
                  border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                <input
                  type="checkbox"
                  checked={rush}
                  onChange={e => setRush(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Need them tomorrow?</div>
                  <div style={{ fontSize: 13, color: "#64748b" }}>Next-business-day rush printing.</div>
                </div>
                <div style={{ fontWeight: 600, color: "#1b4fff", whiteSpace: "nowrap" }}>
                  {optionsQuote ? `+${formatCurrency(optionsQuote.rush_amount, optionsQuote.currency)}` : "+…"}
                </div>
              </label>
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
                  {optionsQuote ? `+${formatCurrency(optionsQuote.remove_branding_amount, optionsQuote.currency)}` : "+…"}
                </div>
              </label>
              {optionsQuote && (
                <div
                  style={{
                    background: "#f8fafc", borderRadius: 8, padding: 12,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    fontSize: 14,
                  }}
                >
                  <span>
                    {attendees.length} card{attendees.length === 1 ? "" : "s"} · subtotal
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                      Shipping calculated at the next step
                    </div>
                  </span>
                  <strong style={{ fontSize: 18 }}>
                    {formatCurrency(
                      optionsQuote.base_amount
                      + (rush ? optionsQuote.rush_amount : 0)
                      + (removeBranding ? optionsQuote.remove_branding_amount : 0),
                      optionsQuote.currency,
                    )}
                  </strong>
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
                onSuccess={() => setStep("success")}
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
  onSuccess,
  onError,
}: {
  totalCents: number;
  currency: string;
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
  const amount = (totalCents / 100).toFixed(2);

  return (
    <>
      <div className="order-price-area">
        <div className="order-price-display">
          <div className="order-price-row order-price-total">
            <span>Total</span>
            <strong>
              {symbol}
              {amount}
            </strong>
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
          {submitting ? "Processing…" : `Pay ${symbol}${amount}`}
        </button>
      </div>
    </>
  );
}
