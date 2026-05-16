import { useState, useEffect, useRef } from "react";
import { api } from "../api/client";
import type { ScheduleItem, SeatingArrangement, Table, Attendee } from "../types";
import PrintCheckoutModal from "./PrintCheckoutModal";

interface Props {
  eventId: number;
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
  // Session-scoped count of designs in the most recent generation per
  // content_type. The PlaceCard AI tab slices the top N of designsByType
  // using this; the My Designs tab ignores it and shows the whole gallery.
  latestGenerationCountByType?: LatestGenerationCountByType;
  onLatestGenerationCountByTypeChange?: React.Dispatch<React.SetStateAction<LatestGenerationCountByType>>;
  // Lift the "generation in flight" flag so it survives CollateralTab
  // unmounting (e.g. when the user switches to Attendees mid-generation).
  // Without this, the loading state vanishes when the user navigates
  // away and they can't tell whether their Gemini call is still
  // running when they come back.
  generating?: boolean;
  onGeneratingChange?: React.Dispatch<React.SetStateAction<boolean>>;
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

export type ContentType = "tented-name-cards" | "name-cards" | "programs";


// (REMOVE_BRANDING_FEE / getPrintTier / formatPrice / PRINT_TIERS were
//  pricing helpers for the legacy PrintPopup, which is now gone. Real
//  pricing is computed server-side via app/pricing.py and displayed
//  inside PrintCheckoutModal.)

export type DesignView = { image_b64: string; mime_type: string; label: string | null };
export type Design = {
  image_b64: string;
  mime_type: string;
  description: string | null;
  views?: DesignView[] | null;
};
export type DesignsByType = Record<ContentType, Design[]>;
export type SelectedDesignByType = Record<ContentType, number | null>;
// Count of designs in the most recent generation per content_type.
// The PlaceCard AI tab shows only this top slice (just-generated); the
// My Designs tab reads the full accumulating gallery from DesignsByType.
// Session-scoped — resets on EventDetail unmount.
export type LatestGenerationCountByType = Record<ContentType, number>;

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

export default function CollateralTab({ eventId, scheduleItems, arrangements, tables, attendees, eventCategory, eventVenueType, eventName, brandColors, brandFont, designsByType: designsByTypeProp, onDesignsByTypeChange, selectedDesignByType: selectedDesignByTypeProp, onSelectedDesignByTypeChange, latestGenerationCountByType: latestGenerationCountByTypeProp, onLatestGenerationCountByTypeChange, generating: generatingProp, onGeneratingChange }: Props) {
  // activeView used to drive the standalone name-cards gallery view;
  // that view was retired in favour of the inline PrintCheckoutModal,
  // so this stays null. The conditional renders that reference it
  // (sticky CTA hide-in-name-cards) are kept harmless.
  const activeView: string | null = null;
  const [selectedArrangementId] = useState<number>(
    arrangements.length > 0 ? arrangements[0].id : 0
  );
  const [selectedCategory] = useState<DesignCategory>(detectCategory(eventCategory, eventVenueType));
  // Holds the AI-generated design the user is currently ordering.
  // null = no checkout open; non-null = PrintCheckoutModal renders.
  const [checkoutAiDesign, setCheckoutAiDesign] = useState<Design | null>(null);

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
  // baseTotalPrice / baseQuantity / basePriceLoading used to drive the
  // header price preview inside the retired name-cards gallery view.
  // Removed along with the view itself.
  // (Popup-related state — orderAllEvents, printPopupOpen, printSetMode,
  // printRushSelected, printRemoveBranding — all removed with the legacy
  // PrintPopup. The rush + remove-branding ticks now live inside
  // PrintCheckoutModal's options step, owned per-checkout-session.)

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
  const [internalLatestCount, setInternalLatestCount] = useState<LatestGenerationCountByType>({
    "tented-name-cards": 0,
    "name-cards": 0,
    programs: 0,
  });
  const latestGenerationCountByType = latestGenerationCountByTypeProp ?? internalLatestCount;
  const setLatestGenerationCountByType = onLatestGenerationCountByTypeChange ?? setInternalLatestCount;
  const [internalGenerating, setInternalGenerating] = useState(false);
  const generating = generatingProp ?? internalGenerating;
  const setGenerating = onGeneratingChange ?? setInternalGenerating;
  const [generateError, setGenerateError] = useState("");

  // Auto-scroll the results into view when designs first appear after a
  // generation. The results panel can render below the fold, so without this
  // the user might not realize anything happened.
  const resultsRef = useRef<HTMLDivElement>(null);
  const prevDesignCount = useRef(0);

  // Derived views for the currently-active chip.
  // generatedDesigns drives the PlaceCard AI results panel — it's the
  // top slice of the accumulating gallery, sized to the most recent
  // generation. Resets to length 0 on a fresh component mount so the
  // AI tab doesn't show stale results from earlier sessions; My Designs
  // (which reads designsByType directly) is unaffected.
  const generatedDesigns = designsByType[contentType].slice(
    0,
    latestGenerationCountByType[contentType],
  );
  const selectedDesign = selectedDesignByType[contentType];
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
      // Prepend the freshly-generated set so the newest designs land
      // at the top of "My Designs" — the user can see what they just
      // paid for without scrolling. Prior designs stay underneath.
      setDesignsByType(prev => ({
        ...prev,
        [contentType]: [...result.designs, ...prev[contentType]],
      }));
      // Mark this generation's size so the PlaceCard AI panel shows
      // only THESE designs, not the full accumulating gallery. The
      // count maps to the slice taken at the top of designsByType
      // since we just prepended, so index 0..n-1 of the slice are
      // exactly the new designs.
      setLatestGenerationCountByType(prev => ({
        ...prev,
        [contentType]: result.designs.length,
      }));

      // Persist server-side so the accumulated set survives navigation,
      // refresh, and session timeouts. Each Gemini call costs real
      // budget — we want every generation to land in the DB exactly once.
      // Fire-and-forget; a network blip on the save shouldn't block
      // the UI while the user is still admiring the result.
      api
        .appendDesigns(eventId, contentType, result.designs)
        .catch(err => {
          console.warn("Failed to persist generated designs:", err);
        });
    } catch (err: any) {
      setGenerateError(err.message || "Failed to generate designs");
    } finally {
      setGenerating(false);
    }
  };


  // Click handler shared by both "Go to Print" surfaces (header CTA + sticky
  // FAB). Opens PrintCheckoutModal directly at its "options" step — the
  // rush + remove-branding ticks now live INSIDE the checkout modal so
  // there's no intermediate popup-to-modal handoff.
  const openPrintFlow = () => {
    const selectedIdx = selectedDesignByType[contentType];
    if (selectedIdx === null) return;
    const aiDesign = designsByType[contentType][selectedIdx];
    if (!aiDesign) return;
    setCheckoutAiDesign(aiDesign);
  };


  // (Header price-preview useEffect retired with the name-cards view.
  //  Real pricing is computed inside PrintCheckoutModal on every step.)

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

  // Use first seated guest for design previews. If no seating yet,
  // fall back to the first attendee in the event so the preview still
  // uses a real name from the guest list. The synthetic Jane Smith
  // placeholder is the last resort — only when the event has zero
  // attendees at all.
  const sampleGuest: GuestCardData = guestCards[0]
    ?? (attendees[0]
      ? {
          name: attendees[0].name,
          tableName: tables[0]?.name ?? "Table 1",
          dietary: attendees[0].dietary_requirements ?? null,
          meal: firstMealOrNull((attendees[0] as any)?.responses),
        }
      : { name: "Jane Smith", tableName: "Table 1", dietary: "Vegetarian" });


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

      {/* Print checkout modal — top-level so the new flow doesn't
          depend on activeView being set to anything in particular.
          openPrintFlow sets checkoutAiDesign; this renders the
          single-window 4-step checkout (Options → Address →
          Payment → Success) on top of whatever screen you're on. */}
      {checkoutAiDesign && (
        <PrintCheckoutModal
          eventId={eventId}
          contentType={contentType}
          design={{
            image_b64: checkoutAiDesign.image_b64,
            mime_type: checkoutAiDesign.mime_type,
            description: checkoutAiDesign.description,
            views: checkoutAiDesign.views ?? null,
          }}
          attendees={
            guestCards.length > 0
              ? guestCards.map(g => ({
                  name: g.name,
                  table_name: g.tableName,
                  dietary: g.dietary ?? null,
                }))
              : attendees.map(a => ({
                  name: a.name,
                  table_name: null,
                  dietary: a.dietary_requirements ?? null,
                }))
          }
          onClose={() => setCheckoutAiDesign(null)}
        />
      )}

    </div>
  );
}
