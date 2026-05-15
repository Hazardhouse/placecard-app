import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import type { ScheduleItem, SeatingArrangement, Table, Attendee } from "../types";

interface Props {
  scheduleItems: ScheduleItem[];
  arrangements: SeatingArrangement[];
  tables: Table[];
  attendees: Attendee[];
  eventCategory?: string | null;
  eventVenueType?: string | null;
  eventName?: string | null;
  brandUrl: string;
  onBrandUrlChange: (url: string) => void;
  brandColors: string[];
  onBrandColorsChange: (colors: string[]) => void;
  brandFont: string | null;
  onBrandFontChange: (font: string | null) => void;
  // Optional controlled state for generated designs. When supplied, the
  // parent owns the data so it survives tab switches. Falls back to local
  // state otherwise.
  designsByType?: DesignsByType;
  onDesignsByTypeChange?: React.Dispatch<React.SetStateAction<DesignsByType>>;
  selectedDesignByType?: SelectedDesignByType;
  onSelectedDesignByTypeChange?: React.Dispatch<React.SetStateAction<SelectedDesignByType>>;
}

type DesignCategory = "corporate" | "retreat" | "wedding" | "social";

// Map event category or venue type to design category
function detectCategory(eventCategory: string | null | undefined, venueType?: string | null): DesignCategory {
  // Prefer explicit event category
  if (eventCategory) {
    const c = eventCategory.toLowerCase();
    if (c === "conference") return "corporate";
    if (c === "retreat") return "retreat";
    if (c === "wedding") return "wedding";
    if (c === "social") return "social";
  }
  // Fallback to venue type
  if (venueType) {
    const v = venueType.toLowerCase();
    if (["conference centre", "hotel", "ballroom"].includes(v)) return "corporate";
    if (["park", "garden", "vineyard", "beach", "rooftop", "farm"].includes(v)) return "retreat";
    if (["museum", "gallery", "private club"].includes(v)) return "wedding";
    if (["restaurant", "pub", "bar"].includes(v)) return "social";
  }
  return "corporate";
}

const CARD_DESIGNS: Record<DesignCategory, { name: string; font: string; bg: string; color: string; accent: string }[]> = {
  corporate: [
    { name: "Executive", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#0f172a", accent: "#1e40af" },
    { name: "Boardroom", font: "'Georgia', serif", bg: "#ffffff", color: "#1e293b", accent: "#475569" },
    { name: "Modern Mono", font: "'SF Mono', 'Courier New', monospace", bg: "#ffffff", color: "#0f172a", accent: "#6366f1" },
    { name: "Navy Formal", font: "'Times New Roman', serif", bg: "#ffffff", color: "#0c4a6e", accent: "#1e3a5f" },
    { name: "Slate Clean", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#334155", accent: "#94a3b8" },
    { name: "Steel Blue", font: "'Georgia', serif", bg: "#ffffff", color: "#1e3a5f", accent: "#3b82f6" },
    { name: "Charcoal Pro", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#18181b", accent: "#52525b" },
    { name: "Carbon", font: "'Georgia', serif", bg: "#ffffff", color: "#27272a", accent: "#71717a" },
    { name: "Black & Gold", font: "'Georgia', serif", bg: "#0f0f0f", color: "#d4a574", accent: "#b8860b" },
    { name: "Midnight", font: "'Helvetica Neue', sans-serif", bg: "#0f172a", color: "#e2e8f0", accent: "#3b82f6" },
  ],
  retreat: [
    { name: "Forest", font: "'Garamond', 'Palatino', serif", bg: "#ffffff", color: "#14532d", accent: "#16a34a" },
    { name: "Earth Tone", font: "'Georgia', serif", bg: "#ffffff", color: "#78350f", accent: "#a16207" },
    { name: "Mountain", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#365314", accent: "#65a30d" },
    { name: "Desert Sand", font: "'Georgia', serif", bg: "#ffffff", color: "#7c2d12", accent: "#c2410c" },
    { name: "Ocean Breeze", font: "'Garamond', 'Palatino', serif", bg: "#ffffff", color: "#164e63", accent: "#0891b2" },
    { name: "Sage", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#3f6212", accent: "#84cc16" },
    { name: "Terracotta", font: "'Georgia', serif", bg: "#ffffff", color: "#9a3412", accent: "#ea580c" },
    { name: "Sunrise", font: "'Garamond', 'Palatino', serif", bg: "#ffffff", color: "#92400e", accent: "#f59e0b" },
    { name: "Night Sky", font: "'Garamond', 'Palatino', serif", bg: "#1a1a2e", color: "#c4b5a0", accent: "#8b7355" },
    { name: "Campfire", font: "'Georgia', serif", bg: "#1c1410", color: "#e2c28e", accent: "#c9a84c" },
  ],
  wedding: [
    { name: "Script Elegant", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#78350f", accent: "#b8860b" },
    { name: "Rose", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#881337", accent: "#e11d48" },
    { name: "Lavender", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#581c87", accent: "#a855f7" },
    { name: "Classic Ivory", font: "'Garamond', 'Palatino', serif", bg: "#ffffff", color: "#44403c", accent: "#a8a29e" },
    { name: "Script Indigo", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#312e81", accent: "#6366f1" },
    { name: "Blush", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#9f1239", accent: "#fb7185" },
    { name: "Champagne", font: "'Garamond', 'Palatino', serif", bg: "#ffffff", color: "#78716c", accent: "#d6d3d1" },
    { name: "Garden Party", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#ffffff", color: "#166534", accent: "#4ade80" },
    { name: "Gold Luxe", font: "'Brush Script MT', 'Segoe Script', cursive", bg: "#1a1814", color: "#e2c28e", accent: "#c9a84c" },
    { name: "Noir Elegance", font: "'Garamond', 'Palatino', serif", bg: "#0f0f0f", color: "#e7e5e4", accent: "#a8a29e" },
  ],
  social: [
    { name: "Bistro", font: "'Georgia', serif", bg: "#ffffff", color: "#7c2d12", accent: "#dc2626" },
    { name: "Happy Hour", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#4338ca", accent: "#818cf8" },
    { name: "Copper", font: "'Georgia', serif", bg: "#ffffff", color: "#78350f", accent: "#b45309" },
    { name: "Neon", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#701a75", accent: "#d946ef" },
    { name: "Fresh Lime", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#166534", accent: "#22c55e" },
    { name: "Warm Amber", font: "'Georgia', serif", bg: "#ffffff", color: "#92400e", accent: "#f59e0b" },
    { name: "Berry", font: "'Georgia', serif", bg: "#ffffff", color: "#831843", accent: "#ec4899" },
    { name: "Teal Pop", font: "'Helvetica Neue', sans-serif", bg: "#ffffff", color: "#134e4a", accent: "#14b8a6" },
    { name: "Dark Lounge", font: "'Georgia', serif", bg: "#1a1a1a", color: "#fbbf24", accent: "#d97706" },
    { name: "Velvet", font: "'Georgia', serif", bg: "#1c0a2e", color: "#e9d5ff", accent: "#a78bfa" },
  ],
};


interface GuestMeal {
  venue: string;
  entree?: string;
  main?: string;
  dessert?: string;
  drink?: string;
}

interface GuestCardData {
  name: string;
  tableName: string;
  dietary: string | null;
  meal?: GuestMeal | null;
}

// Pick the first meal from an attendee's responses.meal_selections that has at
// least one course filled in. Returns null if nothing usable.
function firstMealOrNull(responses: unknown): GuestMeal | null {
  if (!responses || typeof responses !== "object") return null;
  const list = (responses as any).meal_selections;
  if (!Array.isArray(list)) return null;
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const venue = typeof m.venue === "string" ? m.venue.trim() : "";
    const entree = typeof m.entree === "string" ? m.entree.trim() : "";
    const main = typeof m.main === "string" ? m.main.trim() : "";
    const dessert = typeof m.dessert === "string" ? m.dessert.trim() : "";
    const drink = typeof m.drink === "string" ? m.drink.trim() : "";
    if (entree || main || dessert || drink) {
      return {
        venue,
        entree: entree || undefined,
        main: main || undefined,
        dessert: dessert || undefined,
        drink: drink || undefined,
      };
    }
  }
  return null;
}



// Map (contentType, view label) → CSS aspect-ratio value that matches the
// real print dimensions. Used as a display clamp so every rendered preview
// is the exact shape of the printed product regardless of what Gemini returns.
function viewAspectRatio(contentType: ContentType, viewLabel: string | null | undefined): string {
  const label = (viewLabel ?? "").toLowerCase();
  if (contentType === "programs") return "4.25 / 5.5";
  if (contentType === "tented-name-cards") {
    // Match Gemini's returned 4:3 exactly so no cover-cropping happens and
    // the displayed image reads as clearly landscape rather than near-square.
    return "4 / 3";
  }
  if (contentType === "name-cards") {
    if (label.includes("setting")) return "4 / 3";
    return "3.5 / 2"; // flat landscape
  }
  return "auto";
}

function GeneratedDesignCard({ image, designNumber, selected, onToggle, groupName, contentType }: {
  image: {
    image_b64: string;
    mime_type: string;
    views?: { image_b64: string; mime_type: string; label: string | null }[] | null;
  };
  designNumber: number;
  selected: boolean;
  onToggle: () => void;
  groupName: string;
  contentType: ContentType;
}) {
  const hasViews = image.views && image.views.length > 1;
  const singleAspect = viewAspectRatio(contentType, "Front");
  return (
    <div className={`nc-design-wrapper${selected ? " nc-design-selected" : ""}`}>
      <div className="nc-design-header">
        <div className="nc-design-label">Design {designNumber}</div>
      </div>
      {hasViews ? (
        <div className="nc-gen-views">
          {image.views!.map((v, i) => (
            <div key={i} className="nc-gen-view">
              <img
                src={`data:${v.mime_type};base64,${v.image_b64}`}
                alt={`Design ${designNumber} — ${v.label ?? `view ${i + 1}`}`}
                className="nc-gen-img"
                style={{ aspectRatio: viewAspectRatio(contentType, v.label), objectFit: "cover" }}
              />
              {v.label && <div className="nc-gen-view-label">{v.label}</div>}
            </div>
          ))}
        </div>
      ) : (
        <img
          src={`data:${image.mime_type};base64,${image.image_b64}`}
          alt={`Design ${designNumber}`}
          className="nc-gen-img"
          style={{ aspectRatio: singleAspect, objectFit: "cover" }}
        />
      )}
      <label className="nc-use-design" onClick={e => e.stopPropagation()}>
        <input
          type="radio"
          name={groupName}
          checked={selected}
          onChange={onToggle}
        />
        <span>Use this design</span>
      </label>
    </div>
  );
}

// ── Order Modal ────────────────────────────────────────────────────

interface OrderModalProps {
  design: typeof CARD_DESIGNS["corporate"][0];
  guest: GuestCardData;
  attendeeCount: number;
  onClose: () => void;
}

const PAPER_STOCKS = ["14PT C2S", "14PT Uncoated", "16PT C2S", "18PT C1S", "100LB Cover Linen"];
const FINISHES = ["No coating", "UV Front", "Matte", "Aqueous", "Satin Aqueous"];
const COLOR_SPECS = [
  { value: "4/4", label: "4/4 Full Color Both Sides (recommended)" },
  { value: "4/1", label: "4/1 Full Color Front, B&W Back" },
  { value: "4/0", label: "4/0 Full Color Front Only" },
];

type QuantityMode = "exact" | "plus10" | "plus25" | "custom";

function OrderModal({ design, guest, attendeeCount, onClose }: OrderModalProps) {
  const [quantityMode, setQuantityMode] = useState<QuantityMode>("plus10");
  const [customQty, setCustomQty] = useState(attendeeCount);
  const [paperStock, setPaperStock] = useState("14PT C2S");
  const [finish, setFinish] = useState("No coating");
  const [colorSpec, setColorSpec] = useState("4/4");
  const [turnaround, setTurnaround] = useState(7);

  // Shipping address
  const [shipName, setShipName] = useState("");
  const [shipCompany, setShipCompany] = useState("");
  const [shipAddress1, setShipAddress1] = useState("");
  const [shipAddress2, setShipAddress2] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("");
  const [shipZip, setShipZip] = useState("");
  const [shipCountry, setShipCountry] = useState("US");

  // Quote state
  const [quote, setQuote] = useState<{
    total_price: number;
    per_card_price: number;
    quantity: number;
    is_mock: boolean;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Order state
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<{
    job_id: string;
    status: string;
    total_price: number;
    is_mock: boolean;
  } | null>(null);
  const [orderError, setOrderError] = useState("");

  const computedQuantity = (() => {
    switch (quantityMode) {
      case "exact": return attendeeCount;
      case "plus10": return Math.ceil(attendeeCount * 1.1);
      case "plus25": return Math.ceil(attendeeCount * 1.25);
      case "custom": return customQty;
    }
  })();

  // Auto-fetch price whenever specs change
  const fetchQuote = useCallback(async () => {
    setQuoteLoading(true);
    setQuoteError("");
    try {
      const result = await api.getPrintQuote({
        quantity: computedQuantity,
        paper_stock: paperStock,
        finish,
        color_spec: colorSpec,
        turnaround_days: turnaround,
      });
      setQuote(result);
    } catch (err: any) {
      setQuoteError(err.message || "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  }, [computedQuantity, paperStock, finish, colorSpec, turnaround]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  const handlePlaceOrder = async () => {
    setOrderSubmitting(true);
    setOrderError("");
    try {
      const result = await api.placePrintOrder({
        quantity: computedQuantity,
        paper_stock: paperStock,
        finish,
        color_spec: colorSpec,
        turnaround_days: turnaround,
        shipping_address: {
          name: shipName,
          company: shipCompany || undefined,
          address1: shipAddress1,
          address2: shipAddress2 || undefined,
          city: shipCity,
          state: shipState,
          zip: shipZip,
          country: shipCountry,
        },
        design_name: design.name,
      });
      setOrderResult(result);
    } catch (err: any) {
      setOrderError(err.message || "Failed to place order");
    } finally {
      setOrderSubmitting(false);
    }
  };

  const shippingComplete = shipName && shipAddress1 && shipCity && shipState && shipZip;

  // Order confirmation view
  if (orderResult) {
    return (
      <>
        <div className="modal-overlay" onClick={onClose} />
        <div className="order-modal">
          <div className="order-modal-header">
            <h3>Order Submitted</h3>
            <button className="invite-close" onClick={onClose}>x</button>
          </div>
          <div className="order-modal-body">
            <div className="order-confirmation">
              <div className="order-confirmation-icon">&#10003;</div>
              <p className="order-confirmation-title">Your print order has been placed!</p>
              <div className="order-confirmation-details">
                <div className="order-detail-row">
                  <span>Order ID</span>
                  <strong>{orderResult.job_id}</strong>
                </div>
                <div className="order-detail-row">
                  <span>Status</span>
                  <strong>{orderResult.status}</strong>
                </div>
                <div className="order-detail-row">
                  <span>Total</span>
                  <strong>${orderResult.total_price.toFixed(2)}</strong>
                </div>
                {orderResult.is_mock && (
                  <p className="order-mock-notice">
                    This is a test order. No payment has been charged. Connect your 4over API keys in settings to place real orders.
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="order-modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="order-modal">
        <div className="order-modal-header">
          <h3>Order Name Cards</h3>
          <button className="invite-close" onClick={onClose}>x</button>
        </div>
        <div className="order-modal-body">
          {/* Design preview */}
          <div className="order-design-preview">
            <div
              className="order-preview-card"
              style={{
                fontFamily: design.font,
                background: design.bg,
                color: design.color,
                borderColor: design.accent + "40",
              }}
            >
              <div className="order-preview-name" style={{ color: design.color }}>{guest.name}</div>
              <div className="order-preview-table" style={{ color: design.accent }}>{guest.tableName}</div>
            </div>
            <div className="order-preview-label">{design.name}</div>
          </div>

          {/* Quantity */}
          <div className="order-field">
            <label className="order-label">Quantity <span className="order-hint">({attendeeCount} attendees seated)</span></label>
            <div className="order-qty-options">
              {([
                ["exact", `Exact (${attendeeCount})`],
                ["plus10", `+10% (${Math.ceil(attendeeCount * 1.1)})`],
                ["plus25", `+25% (${Math.ceil(attendeeCount * 1.25)})`],
                ["custom", "Custom"],
              ] as [QuantityMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  className={`order-qty-btn ${quantityMode === mode ? "active" : ""}`}
                  onClick={() => setQuantityMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            {quantityMode === "custom" && (
              <input
                type="number"
                className="order-input"
                min={1}
                value={customQty}
                onChange={e => setCustomQty(Math.max(1, parseInt(e.target.value) || 1))}
              />
            )}
          </div>

          {/* Paper stock */}
          <div className="order-field">
            <label className="order-label">Paper Stock</label>
            <select className="order-select" value={paperStock} onChange={e => setPaperStock(e.target.value)}>
              {PAPER_STOCKS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Finish */}
          <div className="order-field">
            <label className="order-label">Finish</label>
            <select className="order-select" value={finish} onChange={e => setFinish(e.target.value)}>
              {FINISHES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {/* Color spec */}
          <div className="order-field">
            <label className="order-label">Color</label>
            <select className="order-select" value={colorSpec} onChange={e => setColorSpec(e.target.value)}>
              {COLOR_SPECS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Turnaround */}
          <div className="order-field">
            <label className="order-label">Turnaround Time</label>
            <div className="order-turnaround-options">
              <button
                className={`order-qty-btn ${turnaround === 7 ? "active" : ""}`}
                onClick={() => setTurnaround(7)}
              >
                7 Business Days
              </button>
              <button
                className={`order-qty-btn ${turnaround === 4 ? "active" : ""}`}
                onClick={() => setTurnaround(4)}
              >
                4 Business Days (Rush)
              </button>
            </div>
          </div>

          {/* Shipping address */}
          <div className="order-field">
            <label className="order-label">Shipping Address</label>
            <div className="order-address-grid">
              <input className="order-input" placeholder="Recipient Name *" value={shipName} onChange={e => setShipName(e.target.value)} />
              <input className="order-input" placeholder="Company (optional)" value={shipCompany} onChange={e => setShipCompany(e.target.value)} />
              <input className="order-input order-input-full" placeholder="Address Line 1 *" value={shipAddress1} onChange={e => setShipAddress1(e.target.value)} />
              <input className="order-input order-input-full" placeholder="Address Line 2" value={shipAddress2} onChange={e => setShipAddress2(e.target.value)} />
              <input className="order-input" placeholder="City *" value={shipCity} onChange={e => setShipCity(e.target.value)} />
              <input className="order-input order-input-sm" placeholder="State *" value={shipState} onChange={e => setShipState(e.target.value)} />
              <input className="order-input order-input-sm" placeholder="ZIP *" value={shipZip} onChange={e => setShipZip(e.target.value)} />
              <input className="order-input order-input-sm" placeholder="Country" value={shipCountry} onChange={e => setShipCountry(e.target.value)} />
            </div>
          </div>

          {/* Live Price area — updates automatically */}
          <div className="order-price-area">
            {quoteLoading && <div className="order-price-loading">Updating price...</div>}
            {quoteError && <div className="order-price-error">{quoteError}</div>}
            {quote && !quoteLoading && (
              <div className="order-price-display">
                <div className="order-price-row order-price-total">
                  <span>Total ({quote.quantity} cards)</span>
                  <strong>${quote.total_price.toFixed(2)}</strong>
                </div>
                <div className="order-price-row order-price-per">
                  <span>Per card</span>
                  <span>${quote.per_card_price.toFixed(2)}</span>
                </div>
                {quote.is_mock && (
                  <div className="order-mock-badge">Estimated pricing (API keys not configured)</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="order-modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!quote || !shippingComplete || orderSubmitting}
            onClick={handlePlaceOrder}
          >
            {orderSubmitting ? "Placing Order..." : "Place Order"}
          </button>
          {orderError && <div className="order-price-error">{orderError}</div>}
        </div>
      </div>
    </>
  );
}

export type ContentType = "tented-name-cards" | "name-cards" | "programs";

// Print-pricing tiers from 4over (retail prices customers see).
// Customers pay the tier price — quantities below the tier still pay the
// tier minimum. >75 currently has no published rate; UI surfaces a
// "Get a quote" CTA in that case. TODO(launch): move these to a backend
// pricing config so they're not hardcoded in the frontend.
const PRINT_TIERS = [
  { upTo: 25, retail: 65.52, rushFee: 60 },
  { upTo: 50, retail: 78.32, rushFee: 60 },
  { upTo: 75, retail: 86.32, rushFee: 70 },
] as const;

// Flat add-on price for removing the "Hosted via PlaceCard" footer/back
// branding from printed cards.
const REMOVE_BRANDING_FEE = 12;

function getPrintTier(qty: number) {
  if (qty <= 0) return null;
  return PRINT_TIERS.find(t => qty <= t.upTo) ?? null;
}

function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

export type DesignView = { image_b64: string; mime_type: string; label: string | null };
export type Design = {
  image_b64: string;
  mime_type: string;
  description: string | null;
  views?: DesignView[] | null;
};
export type DesignsByType = Record<ContentType, Design[]>;
export type SelectedDesignByType = Record<ContentType, number | null>;

interface ContentSpec {
  id: ContentType;
  label: string;
  // Canonical finished size in inches, used in both the UI and the AI prompt
  widthIn: number;
  heightIn: number;
  sizeLabel: string;        // Human-readable (e.g. "4″ × 3.5″ · folds to 2″ × 3.5″")
  aspectRatio: number;      // width / height of the visible finished face
}

const CONTENT_SPECS: Record<ContentType, ContentSpec> = {
  "tented-name-cards": {
    id: "tented-name-cards",
    label: "Tented Name Cards",
    widthIn: 4,
    heightIn: 3.5,
    sizeLabel: "4″ × 3.5″ · folds to 2″ × 3.5″",
    aspectRatio: 4 / 3.5,   // landscape, as printed flat
  },
  "name-cards": {
    id: "name-cards",
    label: "Name Cards",
    widthIn: 3.5,
    heightIn: 2,
    sizeLabel: "3.5″ × 2″",
    aspectRatio: 3.5 / 2,
  },
  programs: {
    id: "programs",
    label: "Programs",
    widthIn: 4.25,
    heightIn: 5.5,
    sizeLabel: "4.25″ × 5.5″ · front and back",
    aspectRatio: 4.25 / 5.5,
  },
};

const CONTENT_TYPES: ContentType[] = ["tented-name-cards", "programs"];

export default function CollateralTab({ scheduleItems, arrangements, tables, attendees, eventCategory, eventVenueType, eventName, brandColors, brandFont, designsByType: designsByTypeProp, onDesignsByTypeChange, selectedDesignByType: selectedDesignByTypeProp, onSelectedDesignByTypeChange }: Props) {
  const [activeView, setActiveView] = useState<string | null>(null);
  const [selectedArrangementId, setSelectedArrangementId] = useState<number>(
    arrangements.length > 0 ? arrangements[0].id : 0
  );
  const [selectedCategory] = useState<DesignCategory>(detectCategory(eventCategory, eventVenueType));
  const [orderDesign, setOrderDesign] = useState<typeof CARD_DESIGNS["corporate"][0] | null>(null);

  // Canva-style redesign state
  const [aiTab, setAiTab] = useState<"designs" | "ai">("ai");
  const [contentType, setContentType] = useState<ContentType>("tented-name-cards");
  const [prompt, setPrompt] = useState("");
  const [wildCardEnabled, setWildCardEnabled] = useState(false);
  const [showWildCardPopup, setShowWildCardPopup] = useState(false);

  // Auto-dismiss the wild-card popup after a few seconds (like the maximize-
  // conversation toast). Longer when enabling (the confetti needs a moment to
  // land); quick flash when disabling.
  useEffect(() => {
    if (!showWildCardPopup) return;
    const timeout = setTimeout(() => setShowWildCardPopup(false), wildCardEnabled ? 3200 : 1800);
    return () => clearTimeout(timeout);
  }, [showWildCardPopup, wildCardEnabled]);
  const [baseTotalPrice, setBaseTotalPrice] = useState<number | null>(null);
  const [baseQuantity, setBaseQuantity] = useState<number>(0);
  const [basePriceLoading, setBasePriceLoading] = useState(false);
  const [orderAllEvents, setOrderAllEvents] = useState(false);
  // Go-to-Print confirmation popup. When the user has more than one
  // seated schedule item, we ask whether they want unique cards per
  // sitting or a single reusable set before sending them into the print
  // flow. `setMode` is the user's pick; null = popup closed.
  const [printPopupOpen, setPrintPopupOpen] = useState(false);
  const [printSetMode, setPrintSetMode] = useState<"per-event" | "reusable">("reusable");
  const [printRushSelected, setPrintRushSelected] = useState(false);
  const [printRemoveBranding, setPrintRemoveBranding] = useState(false);

  // NanoBanana generated designs — kept separately per content type so switching
  // chips doesn't mix results from different print formats.
  // State is optionally lifted to the parent (EventDetail) so designs survive
  // tab switches; falls back to local state if the parent doesn't supply it.
  const [internalDesignsByType, setInternalDesignsByType] = useState<DesignsByType>({
    "tented-name-cards": [],
    "name-cards": [],
    programs: [],
  });
  const [internalSelectedDesignByType, setInternalSelectedDesignByType] = useState<SelectedDesignByType>({
    "tented-name-cards": null,
    "name-cards": null,
    programs: null,
  });
  const designsByType = designsByTypeProp ?? internalDesignsByType;
  const setDesignsByType = onDesignsByTypeChange ?? setInternalDesignsByType;
  const selectedDesignByType = selectedDesignByTypeProp ?? internalSelectedDesignByType;
  const setSelectedDesignByType = onSelectedDesignByTypeChange ?? setInternalSelectedDesignByType;
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  // Auto-scroll the results into view when designs first appear after a
  // generation. The results panel can render below the fold, so without this
  // the user might not realize anything happened.
  const resultsRef = useRef<HTMLDivElement>(null);
  const prevDesignCount = useRef(0);

  // Derived views for the currently-active chip
  const generatedDesigns = designsByType[contentType];
  const selectedDesign = selectedDesignByType[contentType];
  const setGeneratedDesigns = (designs: Design[]) =>
    setDesignsByType(prev => ({ ...prev, [contentType]: designs }));
  const setSelectedDesign = (updater: number | null | ((prev: number | null) => number | null)) =>
    setSelectedDesignByType(prev => ({
      ...prev,
      [contentType]: typeof updater === "function" ? updater(prev[contentType]) : updater,
    }));

  const generatingMessages = [
    "Sprinkling pixie dust",
    "Auditioning typefaces",
    "Ironing the tablecloths",
    "Asking the AI nicely",
    "Folding imaginary cards",
    "Polishing the silverware",
    "Whispering to pixels",
    "Bribing the printer",
    "Consulting the napkin oracle",
    "Lighting the virtual candles",
    "Almost plated",
  ];
  const [genMsgIdx, setGenMsgIdx] = useState(0);

  useEffect(() => {
    if (!generating) { setGenMsgIdx(0); return; }
    const interval = setInterval(() => {
      setGenMsgIdx(prev => (prev + 1) % generatingMessages.length);
    }, 3000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  // Scroll the results into view the moment designs populate after a
  // generation. Triggers on the 0 → >0 transition so it doesn't fire on
  // every chip switch.
  useEffect(() => {
    const count = generatedDesigns.length;
    if (prevDesignCount.current === 0 && count > 0 && resultsRef.current) {
      const node = resultsRef.current;
      // Defer one frame so layout has settled before measuring.
      requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const top = rect.top + window.scrollY - 80; // account for header
        window.scrollTo({ top, behavior: "smooth" });
      });
    }
    prevDesignCount.current = count;
  }, [generatedDesigns.length]);

  const handleGenerateDesigns = async () => {
    setGenerating(true);
    setGenerateError("");
    setSelectedDesign(null);
    try {
      // For programs, pull the real schedule into the prompt
      const scheduleForPrompt =
        contentType === "programs"
          ? scheduleItems
              .slice()
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map(si => ({
                title: si.title,
                description: si.description ?? null,
                start_time: si.start_time,
                end_time: si.end_time,
                venue_name: si.venue_name ?? null,
                location: si.location ?? null,
              }))
          : undefined;

      const result = await api.generateNameCards({
        event_type: selectedCategory,
        content_type: contentType,
        brand_colors: brandColors.length > 0 ? brandColors : undefined,
        brand_font: brandFont,
        event_name: eventName,
        prompt: prompt.trim() || undefined,
        sample_guest_name: sampleGuest.name,
        sample_guest_table: sampleGuest.tableName,
        sample_guest_dietary: sampleGuest.dietary,
        sample_guest_meal: sampleGuest.meal ?? null,
        schedule_items: scheduleForPrompt,
      });
      setGeneratedDesigns(result.designs);
    } catch (err: any) {
      setGenerateError(err.message || "Failed to generate designs");
    } finally {
      setGenerating(false);
    }
  };

  const seatingEventCount = scheduleItems.filter(s => s.requires_seating).length || 1;
  const cardQuantity = attendees.length * (orderAllEvents ? seatingEventCount : 1);

  // Click handler shared by both "Go to Print" surfaces (header CTA + sticky
  // FAB). The popup ALWAYS opens so the user sees the rush + remove-branding
  // upsells. When the event has only one seated sitting, the
  // reusable/per-sitting radio is hidden — there's nothing to choose
  // between, but rush printing and branding removal still apply.
  const openPrintFlow = () => {
    setPrintSetMode(orderAllEvents ? "per-event" : "reusable");
    setPrintPopupOpen(true);
  };

  const confirmPrintFlow = () => {
    // When there's only one seated sitting the radio is hidden and the
    // mode is forced to "reusable" — guarantee we don't carry a stale
    // "per-event" from earlier popup interactions.
    const effectiveMode = seatingEventCount > 1 ? printSetMode : "reusable";
    setOrderAllEvents(effectiveMode === "per-event");
    setPrintPopupOpen(false);
    setActiveView("name-cards");
  };

  // Fetch base price for attendee count when entering name cards view or toggling all events
  useEffect(() => {
    if (activeView !== "name-cards") return;
    if (cardQuantity === 0) {
      setBaseTotalPrice(0);
      setBaseQuantity(0);
      return;
    }
    setBasePriceLoading(true);
    api.getPrintQuote({
      quantity: cardQuantity,
      paper_stock: "14PT C2S",
      finish: "No coating",
      color_spec: "4/4",
      turnaround_days: 7,
    })
      .then(r => { setBaseTotalPrice(r.total_price); setBaseQuantity(r.quantity); })
      .catch(() => {})
      .finally(() => setBasePriceLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, cardQuantity]);

  // Get guest data for the selected arrangement
  const arrangement = arrangements.find(a => a.id === selectedArrangementId);
  const tableMap = new Map(tables.map(t => [t.id, t]));
  const attendeeMap = new Map(attendees.map(a => [a.id, a]));

  const guestCards: GuestCardData[] = arrangement
    ? arrangement.seat_assignments.map(sa => {
        const attendee = attendeeMap.get(sa.attendee_id);
        const table = tableMap.get(sa.table_id);
        return {
          name: attendee?.name ?? "Guest",
          tableName: table?.name ?? "Table",
          dietary: attendee?.dietary_requirements ?? null,
          meal: firstMealOrNull((attendee as any)?.responses),
        };
      })
    : [];

  // Use first guest for design previews, fallback to sample
  const sampleGuest: GuestCardData = guestCards[0] ?? { name: "Jane Smith", tableName: "Table 1", dietary: "Vegetarian" };

  // Generate custom designs from brand colors
  const brandDesigns = brandColors.map((color, i) => ({
    name: `Brand ${i + 1}`,
    font: i % 2 === 0 ? "'Georgia', serif" : "'Brush Script MT', 'Segoe Script', cursive",
    bg: "#ffffff",
    color: color,
    accent: color,
  }));

  // Combine brand designs with category-specific defaults
  const categoryDesigns = CARD_DESIGNS[selectedCategory];
  const allDesigns = brandDesigns.length > 0 ? [...brandDesigns, ...categoryDesigns] : categoryDesigns;

  if (activeView === "name-cards") {
    return (
      <div className="collateral-tab">
        <div className="nc-header">
          <div className="nc-header-left">
            <button className="nc-back-btn" onClick={() => setActiveView(null)}>←</button>
            <div>
              <h2 className="nc-title">Name Card Designs</h2>
              <p className="nc-subtitle">Tented name cards 2" x 3.5" folded</p>
            </div>
          </div>
          <div className="nc-header-right">
            {baseTotalPrice != null && (
              <span className="nc-order-info">{baseQuantity} cards · ${baseTotalPrice.toFixed(2)}</span>
            )}
            {basePriceLoading && <span className="nc-order-info">...</span>}
            <button
              className="btn btn-primary nc-order-btn-lg"
              onClick={() => setOrderDesign(allDesigns[0])}
              disabled={attendees.length === 0}
              style={attendees.length === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}}
            >
              Order Now
            </button>
          </div>
        </div>

        <div className="nc-toolbar">
          <div className="nc-toolbar-left">
            <div className="nc-select-row">
              <label className="nc-select-label">Select Event</label>
              <select
                className="nc-event-select"
                value={selectedArrangementId}
                onChange={e => setSelectedArrangementId(Number(e.target.value))}
              >
                {arrangements.map(arr => (
                  <option key={arr.id} value={arr.id}>{arr.name}</option>
                ))}
                {scheduleItems.filter(si => !arrangements.some(a => a.name === si.title)).map(si => (
                  <option key={`si-${si.id}`} value="" disabled>
                    {si.venue_type ? `${si.venue_type}: ` : ""}{si.title} (no seating)
                  </option>
                ))}
              </select>
              <button
                className={`btn btn-primary nc-create-btn${generating ? " extracting-btn" : ""}`}
                onClick={handleGenerateDesigns}
                disabled={generating}
              >
                {generating ? (
                  <span className="extracting-text">
                    <span className="extracting-dots"></span>
                    {generatingMessages[genMsgIdx]}
                  </span>
                ) : "Create"}
              </button>
            </div>
          </div>
        </div>
        <div className="nc-preview-label">
          Previewing with: <strong>{sampleGuest.name}</strong>
        </div>

        {/* Generated designs from NanoBanana */}
        {generateError && (
          <div className="nc-generate-error">{generateError}</div>
        )}
        {generatedDesigns.length > 0 && (
          <div className="nc-gen-scroll">
            {generatedDesigns.map((design, i) => (
              <GeneratedDesignCard
                key={i}
                image={design}
                designNumber={i + 1}
                selected={selectedDesign === i}
                onToggle={() => setSelectedDesign(i)}
                groupName={`design-classic-${contentType}`}
                contentType={contentType}
              />
            ))}
          </div>
        )}

        {orderDesign && (
          <OrderModal
            design={orderDesign}
            guest={sampleGuest}
            attendeeCount={guestCards.length || 1}
            onClose={() => setOrderDesign(null)}
          />
        )}
      </div>
    );
  }

  const handleSubmitPrompt = () => {
    handleGenerateDesigns();
  };

  return (
    <div className="collateral-tab pc-ai-tab">
      <div className="pc-ai-hero">
        <div className="pc-ai-tabs">
          <button
            className={`pc-ai-tab-btn ${aiTab === "designs" ? "pc-ai-tab-btn-active" : ""}`}
            onClick={() => setAiTab("designs")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            Your Designs
          </button>
          <button
            className={`pc-ai-tab-btn ${aiTab === "ai" ? "pc-ai-tab-btn-active" : ""}`}
            onClick={() => setAiTab("ai")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2z" />
            </svg>
            PlaceCard AI
          </button>
        </div>

        {aiTab === "ai" && (
          <div className="pc-ai-box">
            <div className="pc-ai-input-row">
              <textarea
                className="pc-ai-prompt"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Describe the design you want — e.g. elegant gold script for a summer wedding"
                rows={2}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitPrompt();
                  }
                }}
              />
              <div className="pc-ai-input-actions">
                <button className="pc-ai-circle-btn" title="Voice input (coming soon)" disabled>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
                <button
                  className="pc-ai-submit-btn"
                  onClick={handleSubmitPrompt}
                  disabled={generating}
                  title="Generate"
                  aria-label="Generate"
                >
                  {generating ? (
                    <span className="pc-ai-spinner" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {generating && (
              <span className="pc-ai-status" aria-live="polite">
                <span key={genMsgIdx} className="pc-ai-status-text">
                  {generatingMessages[genMsgIdx]}
                </span>
                <span className="pc-ai-status-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            )}

            <div className="pc-ai-chips-row">
              <div className="pc-ai-chips">
                {CONTENT_TYPES.map(ct => {
                  const spec = CONTENT_SPECS[ct];
                  return (
                    <button
                      key={ct}
                      className={`pc-ai-chip ${contentType === ct ? "pc-ai-chip-active" : ""}`}
                      onClick={() => setContentType(ct)}
                    >
                      {spec.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={`pc-wildcard-btn ${wildCardEnabled ? "pc-wildcard-btn-on" : ""}`}
                title={wildCardEnabled ? "Wild Card enabled" : "Enable Wild Card"}
                aria-label="Wild Card"
                aria-pressed={wildCardEnabled}
                onClick={() => {
                  setWildCardEnabled(v => !v);
                  setShowWildCardPopup(true);
                }}
              >
                <svg className="pc-wildcard-btn-star" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2" />
                </svg>
                <span>Wild Card</span>
              </button>
            </div>
            <div className="pc-ai-spec-line">
              Format: <strong>{CONTENT_SPECS[contentType].sizeLabel}</strong>
            </div>
          </div>
        )}

        {/* Wild Card popup — celebratory when enabling, simple toast when disabling */}
        {showWildCardPopup && wildCardEnabled && (
          <>
            {/* No dark backdrop — this is a brief toast, not a modal to acknowledge */}
            <div className="pc-confetti-layer" aria-hidden="true">
              {Array.from({ length: 70 }).map((_, i) => {
                // Radial burst: each particle launches outward from the popup
                // center at a random angle + distance, with a downward drift
                // so gravity reads realistically.
                const angle = Math.random() * Math.PI * 2;
                const distance = 180 + Math.random() * 380; // 180–560px outward
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance + 60 + Math.random() * 220;
                const delay = Math.random() * 0.15;
                const duration = 1.2 + Math.random() * 0.7;
                const rotate = Math.random() * 720 - 360;
                const size = 8 + Math.floor(Math.random() * 10);
                const palette = ["#f59e0b", "#ec4899", "#8b5cf6", "#3b82f6", "#10b981", "#f43f5e"];
                const color = palette[i % palette.length];
                const shape = i % 3;
                return (
                  <span
                    key={i}
                    className={`pc-confetti pc-confetti-shape-${shape}`}
                    style={{
                      animationDelay: `${delay}s`,
                      animationDuration: `${duration}s`,
                      background: shape === 2 ? "transparent" : color,
                      color,
                      width: shape === 2 ? `${size + 4}px` : `${size}px`,
                      height: shape === 2 ? `${size + 4}px` : `${size}px`,
                      "--tx": `${tx}px`,
                      "--ty": `${ty}px`,
                      "--rot": `${rotate}deg`,
                    } as React.CSSProperties}
                  >
                    {shape === 2 ? "★" : ""}
                  </span>
                );
              })}
            </div>

            <div className="pc-wildcard-popup pc-wildcard-popup-enabled">
              <div className="pc-wildcard-popup-visual">
                <div className="pc-wildcard-popup-star-big" aria-hidden="true">★</div>
                <h3 className="pc-wildcard-popup-title">Wild Card Enabled</h3>
              </div>
              <div className="pc-wildcard-popup-body">
                <p>
                  With Wild Card enabled, we'll randomize a printed star on
                  <strong> 20% of attendee cards</strong>, to enable a seating
                  change mid-meal for guests to change conversation partners.
                </p>
              </div>
            </div>
          </>
        )}

        {showWildCardPopup && !wildCardEnabled && (
          <div className="pc-wildcard-toast">Wild Card Disabled</div>
        )}

        {/* Brand panel removed for launch — preserved in git history for Phase II */}
      </div>

      {/* Inline generation error */}
      {generateError && aiTab === "ai" && (
        <div className="nc-generate-error" style={{ marginTop: 16 }}>{generateError}</div>
      )}

      {/* Generated designs render below the prompt — scoped to the active chip */}
      {aiTab === "ai" && generatedDesigns.length > 0 && (
        <div className="pc-ai-results" ref={resultsRef}>
          <div className="pc-ai-results-header">
            <div>
              <strong>Your {CONTENT_SPECS[contentType].label} Designs</strong>
              {contentType !== "programs" && (
                <span className="pc-ai-results-sub"> · Previewing with {sampleGuest.name}</span>
              )}
            </div>
            {(() => {
              const selectedCount = CONTENT_TYPES.filter(ct => selectedDesignByType[ct] !== null).length;
              if (selectedCount === 0) return null;
              return (
                <button
                  className="pc-ai-print-btn"
                  onClick={openPrintFlow}
                >
                  Go to Print ({selectedCount})
                </button>
              );
            })()}
          </div>
          <div className="nc-gen-scroll">
            {generatedDesigns.map((design, i) => (
              <GeneratedDesignCard
                key={i}
                image={design}
                designNumber={i + 1}
                selected={selectedDesign === i}
                onToggle={() => setSelectedDesign(i)}
                groupName={`design-${contentType}`}
                contentType={contentType}
              />
            ))}
          </div>
        </div>
      )}

      {/* Your Designs tab — all generated sets across content types */}
      {aiTab === "designs" && (
        <div className="pc-ai-your-designs">
          {(() => {
            const typesWithDesigns = CONTENT_TYPES.filter(ct => designsByType[ct].length > 0);
            if (typesWithDesigns.length === 0) {
              return (
                <div className="pc-ai-empty">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <h3>No designs yet</h3>
                  <p>Switch to <button className="pc-ai-empty-link" onClick={() => setAiTab("ai")}>PlaceCard AI</button> to create your first set.</p>
                </div>
              );
            }
            return typesWithDesigns.map(ct => {
              const typeDesigns = designsByType[ct];
              const typeSelected = selectedDesignByType[ct];
              return (
                <div key={ct} className="pc-ai-results" style={{ marginBottom: 24 }}>
                  <div className="pc-ai-results-header">
                    <strong>{CONTENT_SPECS[ct].label}</strong>
                    <span className="pc-ai-results-sub">
                      {typeDesigns.length} design{typeDesigns.length !== 1 ? "s" : ""} · {CONTENT_SPECS[ct].sizeLabel}
                    </span>
                  </div>
                  <div className="nc-gen-scroll">
                    {typeDesigns.map((design, i) => (
                      <GeneratedDesignCard
                        key={i}
                        image={design}
                        designNumber={i + 1}
                        selected={typeSelected === i}
                        onToggle={() =>
                          setSelectedDesignByType(prev => ({ ...prev, [ct]: i }))
                        }
                        groupName={`design-your-${ct}`}
                        contentType={ct}
                      />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Sticky bottom-right "Go to Print" CTA — appears once the user has
          selected at least one design. Hidden inside the print view itself
          since the user is already there. */}
      {(() => {
        const selectedCount = CONTENT_TYPES.filter(ct => selectedDesignByType[ct] !== null).length;
        if (selectedCount === 0) return null;
        if (activeView === "name-cards") return null;
        return (
          <button
            type="button"
            className="pc-ai-print-fab"
            onClick={openPrintFlow}
            aria-label={`Go to Print (${selectedCount} selected)`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>Go to Print</span>
            <span className="pc-ai-print-fab-count">{selectedCount}</span>
          </button>
        );
      })()}

      {/* Pre-print popup — always opens on "Go to Print" so the user sees
          the rush + branding upsells. The reusable/per-sitting radio is
          only shown when there's more than one seated sitting; otherwise
          the choice is fixed to reusable. */}
      {printPopupOpen && (() => {
        const multipleSittings = seatingEventCount > 1;
        const effectiveMode = multipleSittings ? printSetMode : "reusable";
        const reusableTotal = attendees.length;
        const perEventTotal = attendees.length * seatingEventCount;
        const reusableTier = getPrintTier(reusableTotal);
        const perEventTier = getPrintTier(perEventTotal);
        const total = effectiveMode === "per-event" ? perEventTotal : reusableTotal;
        const selectedTier = effectiveMode === "per-event" ? perEventTier : reusableTier;
        return (
          <div className="pc-print-popup-layer" role="dialog" aria-modal="true">
            <div className="pc-print-popup-backdrop" onClick={() => setPrintPopupOpen(false)} />
            <div className="pc-print-popup">
              <h2 className="pc-print-popup-title">
                {multipleSittings ? "How many sets of name cards?" : "Print name cards"}
              </h2>
              <p className="pc-print-popup-sub">
                {multipleSittings
                  ? `You have ${seatingEventCount} seated sittings and ${attendees.length} attendees.`
                  : `${attendees.length} attendee${attendees.length === 1 ? "" : "s"} — one set of cards.`}
              </p>

              {multipleSittings && (
                <>
                  <label className={`pc-print-popup-option ${printSetMode === "reusable" ? "pc-print-popup-option-active" : ""}`}>
                    <input
                      type="radio"
                      name="print-set-mode"
                      value="reusable"
                      checked={printSetMode === "reusable"}
                      onChange={() => setPrintSetMode("reusable")}
                    />
                    <div className="pc-print-popup-option-body">
                      <div className="pc-print-popup-option-label">One Reusable Set</div>
                      <div className="pc-print-popup-option-desc">
                        A single set of cards your guests pick up once and carry with them through every sitting.
                      </div>
                      <div className="pc-print-popup-option-meta">
                        <span className="pc-print-popup-option-count">{reusableTotal} cards</span>
                        <span className="pc-print-popup-option-price">
                          {reusableTier
                            ? (reusableTotal < reusableTier.upTo
                                ? `${formatPrice(reusableTier.retail)} · ${reusableTier.upTo}-card minimum`
                                : formatPrice(reusableTier.retail))
                            : "Custom quote — over 75 cards"}
                        </span>
                      </div>
                    </div>
                  </label>

                  <label className={`pc-print-popup-option ${printSetMode === "per-event" ? "pc-print-popup-option-active" : ""}`}>
                    <input
                      type="radio"
                      name="print-set-mode"
                      value="per-event"
                      checked={printSetMode === "per-event"}
                      onChange={() => setPrintSetMode("per-event")}
                    />
                    <div className="pc-print-popup-option-body">
                      <div className="pc-print-popup-option-label">Per Sitting with Seating</div>
                      <div className="pc-print-popup-option-desc">
                        A unique set for each of the {seatingEventCount} seated sittings — pre-set on tables so guests find their spot every time.
                      </div>
                      <div className="pc-print-popup-option-meta">
                        <span className="pc-print-popup-option-count">{perEventTotal} cards ({attendees.length} × {seatingEventCount})</span>
                        <span className="pc-print-popup-option-price">
                          {perEventTier
                            ? (perEventTotal < perEventTier.upTo
                                ? `${formatPrice(perEventTier.retail)} · ${perEventTier.upTo}-card minimum`
                                : formatPrice(perEventTier.retail))
                            : "Custom quote — over 75 cards"}
                        </span>
                      </div>
                    </div>
                  </label>
                </>
              )}

              {selectedTier && (
                <div className="pc-print-popup-addons">
                  <label className="pc-print-popup-addon">
                    <input
                      type="checkbox"
                      checked={printRushSelected}
                      onChange={e => setPrintRushSelected(e.target.checked)}
                    />
                    <span className="pc-print-popup-addon-body">
                      <span className="pc-print-popup-addon-label">Need them tomorrow?</span>
                      <span className="pc-print-popup-addon-desc">Next-business-day rush printing.</span>
                    </span>
                    <span className="pc-print-popup-addon-price">+{formatPrice(selectedTier.rushFee)}</span>
                  </label>
                  <label className="pc-print-popup-addon">
                    <input
                      type="checkbox"
                      checked={printRemoveBranding}
                      onChange={e => setPrintRemoveBranding(e.target.checked)}
                    />
                    <span className="pc-print-popup-addon-body">
                      <span className="pc-print-popup-addon-label">Remove PlaceCard branding</span>
                      <span className="pc-print-popup-addon-desc">Strip the "Hosted via PlaceCard" mark from the print.</span>
                    </span>
                    <span className="pc-print-popup-addon-price">+{formatPrice(REMOVE_BRANDING_FEE)}</span>
                  </label>
                </div>
              )}

              {(() => {
                const baseRetail = selectedTier?.retail ?? 0;
                const rushCost = selectedTier && printRushSelected ? selectedTier.rushFee : 0;
                const brandingCost = printRemoveBranding ? REMOVE_BRANDING_FEE : 0;
                const grandTotal = baseRetail + rushCost + brandingCost;
                return (
                  <div className="pc-print-popup-total">
                    <div className="pc-print-popup-total-row">
                      <span>{total} name cards · {printRushSelected ? "next-business-day" : "3-day turnaround"}</span>
                      <strong>{selectedTier ? formatPrice(grandTotal) : "—"}</strong>
                    </div>
                    {!selectedTier && (
                      <div className="pc-print-popup-total-rush">
                        {total} cards is above our published brackets — we'll send a custom quote.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="pc-print-popup-actions">
                <button type="button" className="btn" onClick={() => setPrintPopupOpen(false)}>Cancel</button>
                <button type="button" className="pc-ai-print-btn" onClick={confirmPrintFlow}>
                  Continue →
                </button>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
