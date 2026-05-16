"""
Name card design generation via NanoBanana (Gemini image models).

Single API call returns a grid image. Pillow splits it into
6 horizontal strips — one per design. Each strip shows all 3 views
(front, back, table setting) side by side.
"""

import asyncio as _aio
import base64
import io
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel

from app.auth import get_current_user
from app.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("name_cards")

# Router-level auth dep — each request fans out to several Gemini calls
# (3 designs × 2 views = 6 by default), each of which is billable.
# Leaving this open would let any visitor burn Gemini budget at will.
router = APIRouter(
    prefix="/api/cards",
    tags=["cards"],
    dependencies=[Depends(get_current_user)],
)

NANOBANANA_MODELS = [
    "gemini-3.1-flash-image-preview",   # Nano Banana 2 (fast previews)
    "gemini-2.5-flash-image",           # Nano Banana (fallback)
]

EVENT_STYLE_MAP = {
    "conference": "corporate business event",
    "corporate": "corporate business event",
    "wedding": "elegant wedding",
    "retreat": "outdoor retreat",
    "social": "casual social event",
}

EVENT_STYLE_DIRECTIVES = {
    "conference": (
        "Use clean, modern, minimalist design. Focus on excellent typography with strong hierarchy. "
        "Do NOT include any logos, icons, symbols, or decorative clip-art. "
        "Rely on whitespace, subtle color accents, and refined type treatments to create distinction between designs. "
        "Think high-end conference badge meets luxury stationery."
    ),
    "corporate": (
        "Use clean, modern, minimalist design. Focus on excellent typography with strong hierarchy. "
        "Do NOT include any logos, icons, symbols, or decorative clip-art. "
        "Rely on whitespace, subtle color accents, and refined type treatments to create distinction between designs. "
        "Think high-end conference badge meets luxury stationery."
    ),
    "wedding": (
        "Use romantic, elegant design with refined typography. "
        "Incorporate tasteful flourishes such as delicate borders, soft textures, or watercolor accents. "
        "Avoid cartoonish clip-art. Each design should feel like premium wedding stationery."
    ),
    "retreat": (
        "Use warm, natural, organic design with earthy tones and relaxed typography. "
        "Incorporate subtle nature-inspired textures like linen, kraft paper, or botanical line art. "
        "Keep it approachable but polished."
    ),
    "social": (
        "Use fun, vibrant design with bold typography and playful color combinations. "
        "Keep layouts clean but energetic. Avoid generic clip-art — use color blocking, "
        "geometric patterns, or gradient accents instead."
    ),
}


class ScheduleItemForPrompt(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    venue_name: Optional[str] = None
    location: Optional[str] = None


class SampleGuestMeal(BaseModel):
    venue: Optional[str] = None
    entree: Optional[str] = None
    main: Optional[str] = None
    dessert: Optional[str] = None
    drink: Optional[str] = None


class NameCardGenerateRequest(BaseModel):
    event_type: str
    content_type: Optional[str] = "tented-name-cards"  # "tented-name-cards" | "name-cards" | "programs"
    brand_colors: List[str] = []
    brand_font: Optional[str] = None
    event_name: Optional[str] = None
    prompt: Optional[str] = None  # Optional free-text direction from the organizer
    # Preview guest — rendered onto name card previews so they match the
    # "Previewing with: X" label in the UI.
    sample_guest_name: Optional[str] = None
    sample_guest_table: Optional[str] = None
    sample_guest_dietary: Optional[str] = None
    sample_guest_meal: Optional[SampleGuestMeal] = None
    schedule_items: Optional[List[ScheduleItemForPrompt]] = None  # Only used for "programs"


# Canonical print specs per content type — kept in sync with frontend CONTENT_SPECS
CONTENT_SPECS = {
    "tented-name-cards": {
        "label": "folded tent place card",
        "size_desc": "4 inches wide by 3.5 inches tall flat, folds in half to 2 inches wide by 3.5 inches tall",
        "views": "FRONT (guest name + table number), BACK (dietary requirements + meal selection), TABLE SETTING (the folded card standing on a styled table)",
        "guidance": "The designs should work as folded tent cards. Keep the name/table info readable on both sides of the fold.",
    },
    "name-cards": {
        "label": "flat business-card style name card",
        "size_desc": "3.5 inches wide by 2 inches tall, single-sided or flat double-sided",
        "views": "FRONT (guest name + table number), BACK (dietary requirements + meal selection), TABLE SETTING (the card placed on a styled table)",
        "guidance": "These are flat cards, not folded. Typography and layout should feel premium but the format is a simple 3.5 x 2 card.",
    },
    "programs": {
        "label": "event program",
        "size_desc": "4.25 inches wide by 5.5 inches tall, portrait orientation, printed flat cardstock — front and back only, NOT folded",
        "views": "FRONT (event name + date), BACK (order of events / schedule)",
        "guidance": "This is a flat printed cardstock program at quarter-letter size (4.25\" x 5.5\"). Two sides only — no folds, no inside panels. Typography should feel premium with clean hierarchy between event title on the front and the ordered schedule on the back.",
    },
}


class DesignView(BaseModel):
    image_b64: str
    mime_type: str
    label: Optional[str] = None  # e.g. "Front", "Back"


class GeneratedDesign(BaseModel):
    # First view — kept at the top level for backward compatibility with existing clients
    image_b64: str
    mime_type: str
    description: Optional[str] = None
    # Optional: when a content type has multiple distinct views per design
    # (e.g. programs = front + back), this carries them all
    views: Optional[List[DesignView]] = None


class NameCardGenerateResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    designs: List[GeneratedDesign]
    model_used: str


def _build_prompt(req: NameCardGenerateRequest) -> str:
    """Single prompt — asks for a 6-row grid image, branched by content_type."""
    event_style = EVENT_STYLE_MAP.get(
        req.event_type.lower(),
        EVENT_STYLE_MAP["corporate"],
    )

    brand_str = ""
    if req.brand_colors or req.brand_font:
        parts = []
        if req.brand_colors:
            parts.append(f"brand colors {', '.join(req.brand_colors)}")
        if req.brand_font:
            parts.append(f"the font {req.brand_font}")
        brand_str = f"\n\nIncorporate the following into every design: {' and '.join(parts)}."

    style_directive = EVENT_STYLE_DIRECTIVES.get(
        req.event_type.lower(),
        EVENT_STYLE_DIRECTIVES["conference"],
    )

    organizer_note = ""
    if req.prompt and req.prompt.strip():
        organizer_note = f"\n\nAdditional direction from the organizer: \"{req.prompt.strip()}\""

    spec = CONTENT_SPECS.get(req.content_type or "tented-name-cards", CONTENT_SPECS["tented-name-cards"])

    # Tented and flat name cards share the "card with guest name" framing
    if req.content_type in (None, "tented-name-cards", "name-cards"):
        return f"""Generate 6 unique {spec['label']} designs for a {event_style}.

Format: {spec['size_desc']}.

Stack all 6 designs vertically from top to bottom in a single column. Do NOT place two designs side by side on the same row.

Each design takes one row showing three views side by side:
- FRONT: The front of a {spec['label']} on a white background with the guest name "Jane Smith" and table number "Table 4".
- BACK: The back of the same card on a white background showing dietary requirements "Vegetarian" and meal selection "Herb-Crusted Salmon".
- TABLE SETTING: The same card displayed on a table styled for a {event_style}.

Row 1 = Design 1 only. Row 2 = Design 2 only. Row 3 = Design 3 only. Row 4 = Design 4 only. Row 5 = Design 5 only. Row 6 = Design 6 only.

{spec['guidance']}

Style direction: {style_directive}

Each design should be visually distinct from the others.

Generate this as a single tall high-resolution image.{brand_str}{organizer_note}"""

    # Programs — flat cardstock, front + back only, with real schedule data
    if req.content_type == "programs":
        event_display_name = req.event_name or "Your Event"

        # Build fully-detailed schedule lines including time range, venue, date, notes
        from datetime import datetime as _dt

        def _parse(ts: Optional[str]) -> Optional[_dt]:
            if not ts:
                return None
            try:
                return _dt.fromisoformat(ts.replace("Z", "+00:00"))
            except Exception:
                return None

        schedule_lines: List[str] = []
        event_dates: List[str] = []

        if req.schedule_items:
            for si in req.schedule_items:
                start = _parse(si.start_time)
                end = _parse(si.end_time)

                time_label = ""
                if start and end:
                    if start.date() == end.date():
                        time_label = f"{start.strftime('%-I:%M %p')} – {end.strftime('%-I:%M %p')}"
                    else:
                        time_label = f"{start.strftime('%b %-d, %-I:%M %p')} – {end.strftime('%b %-d, %-I:%M %p')}"
                elif start:
                    time_label = start.strftime("%-I:%M %p")

                # Collect unique date strings for the event-date header on the front
                if start:
                    d = start.strftime("%B %-d, %Y")
                    if d not in event_dates:
                        event_dates.append(d)

                # Build one line per schedule item with every known detail
                parts = [f'"{si.title}"']
                if time_label:
                    parts.append(time_label)
                venue_line = si.venue_name or si.location
                if venue_line:
                    parts.append(f"at {venue_line}")
                if si.description and si.description.strip():
                    parts.append(f"— {si.description.strip()}")
                schedule_lines.append(" ".join(parts))

        date_header = ""
        if event_dates:
            if len(event_dates) == 1:
                date_header = event_dates[0]
            else:
                date_header = f"{event_dates[0]} – {event_dates[-1]}"

        if schedule_lines:
            schedule_block = "\n".join(f"  • {l}" for l in schedule_lines)
            schedule_instruction = (
                "Use EXACTLY these schedule entries on the BACK (in this order, do not invent or omit details). "
                "Each entry's title, time, location, and description must be included and legible:\n"
                f"{schedule_block}"
            )
        else:
            schedule_instruction = (
                "The BACK should show a placeholder line such as "
                '"Schedule to be announced" — do not invent fictional events.'
            )

        date_instruction = (
            f"\n\nThe FRONT should include the event date(s): {date_header}." if date_header else ""
        )

        return f"""Generate 6 unique event program designs for a {event_style}.

Format: each program is a FLAT portrait cardstock piece, 4.25 inches wide by 5.5 inches tall. NOT folded. Each design has exactly two sides: a FRONT and a BACK. Every card you render must visibly be in portrait orientation (taller than wide, with a 4.25:5.5 aspect ratio).

Output layout: 6 rows stacked vertically, 2 columns wide. Each row is ONE design. Left column = that design's FRONT. Right column = that design's BACK. Both cells in a row must be the same portrait-oriented 4.25 x 5.5 card — do not crop, stretch, or rotate.

Content:
- FRONT (left column): The front of the printed program on a white background. Feature the event name "{event_display_name}" prominently.{date_instruction}
- BACK (right column): The back of the same card on a white background, showing the full order of events with every listed detail below.

{schedule_instruction}

Row 1 = Design 1. Row 2 = Design 2. Row 3 = Design 3. Row 4 = Design 4. Row 5 = Design 5. Row 6 = Design 6.

Do NOT include a "table setting" view, a folded tent view, or any third panel. Each row has exactly two portrait cards (front and back) — nothing else.

{spec['guidance']}

Style direction: {style_directive}

Each design should be visually distinct from the others.

Generate this as a single tall high-resolution image at least 2048px wide so each portrait card has room to render clearly.{brand_str}{organizer_note}"""

    # Fallback
    return _build_prompt.__wrapped__ if False else f"Generate 6 unique designs for a {event_style}."


def _split_rows(image_b64: str, mime_type: str, rows: int = 6) -> List[GeneratedDesign]:
    """Split composite image into horizontal row strips — one per design.

    Uses Pillow getbbox to trim outer whitespace first, then divides
    the content area into equal rows.
    """
    image_data = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(image_data))
    w, h = img.size
    logger.info(f"[name_cards] Original image: {w}x{h}")

    # Trim outer whitespace so equal division lands on content
    gray = img.convert("L")
    thresh = gray.point(lambda p: 0 if p > 245 else 255)
    bbox = thresh.getbbox()
    if bbox:
        img = img.crop(bbox)
        w, h = img.size
        logger.info(f"[name_cards] After trim: {w}x{h}")

    row_h = h / rows
    fmt = "JPEG" if "jpeg" in mime_type.lower() else "PNG"
    out_mime = "image/jpeg" if fmt == "JPEG" else "image/png"

    strips: List[GeneratedDesign] = []
    for r in range(rows):
        y1 = int(r * row_h)
        y2 = int((r + 1) * row_h)
        strip = img.crop((0, y1, w, y2))

        buf = io.BytesIO()
        strip.save(buf, format=fmt, quality=92)
        strips.append(GeneratedDesign(
            image_b64=base64.b64encode(buf.getvalue()).decode(),
            mime_type=out_mime,
        ))

    logger.info(f"[name_cards] Split into {len(strips)} row strips ({w}x{int(row_h)} each)")
    return strips


def _split_grid_with_views(
    image_b64: str,
    mime_type: str,
    rows: int,
    cols: int,
    view_labels: Optional[List[str]] = None,
) -> List[GeneratedDesign]:
    """Split into rows × cols cells. Each row becomes one design whose `views`
    list contains `cols` images (one per column). Useful for programs where each
    design has front + back cards rendered side-by-side in a row.
    """
    image_data = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(image_data))
    w, h = img.size
    logger.info(f"[name_cards] Original image: {w}x{h}")

    gray = img.convert("L")
    thresh = gray.point(lambda p: 0 if p > 245 else 255)
    bbox = thresh.getbbox()
    if bbox:
        img = img.crop(bbox)
        w, h = img.size
        logger.info(f"[name_cards] After trim: {w}x{h}")

    row_h = h / rows
    col_w = w / cols
    fmt = "JPEG" if "jpeg" in mime_type.lower() else "PNG"
    out_mime = "image/jpeg" if fmt == "JPEG" else "image/png"

    designs: List[GeneratedDesign] = []
    for r in range(rows):
        y1 = int(r * row_h)
        y2 = int((r + 1) * row_h)
        views: List[DesignView] = []
        for c in range(cols):
            x1 = int(c * col_w)
            x2 = int((c + 1) * col_w)
            cell = img.crop((x1, y1, x2, y2))
            buf = io.BytesIO()
            cell.save(buf, format=fmt, quality=92)
            views.append(DesignView(
                image_b64=base64.b64encode(buf.getvalue()).decode(),
                mime_type=out_mime,
                label=view_labels[c] if view_labels and c < len(view_labels) else None,
            ))
        first = views[0]
        designs.append(GeneratedDesign(
            image_b64=first.image_b64,
            mime_type=first.mime_type,
            views=views,
        ))

    logger.info(
        f"[name_cards] Split into {rows}x{cols} grid ({len(designs)} designs, "
        f"each with {cols} views, cell ~{int(col_w)}x{int(row_h)})"
    )
    return designs


async def _call_nanobanana(
    prompt: str,
    aspect_ratio: Optional[str] = None,
    reference_image: Optional["DesignView"] = None,
) -> Optional[dict]:
    """Single API call to NanoBanana, with model fallback.

    Tries each model in ``NANOBANANA_MODELS`` in order. The primary (3.1 flash
    image preview) is preview-grade and occasionally hangs or returns no image
    under Google's load — when that happens we fall back to 2.5 flash image,
    which is stable.

    ``aspect_ratio`` is a Gemini-supported ratio string like "9:16", "3:4",
    "1:1", "4:3", "16:9".

    ``reference_image``, when provided, is included as an inline image input
    so the call becomes image-to-image (used for back-view matching).
    """
    if not settings.gemini_api_key:
        return None

    generation_config: dict = {
        "responseModalities": ["TEXT", "IMAGE"],
        "temperature": 1.0,
    }
    if aspect_ratio:
        generation_config["imageConfig"] = {"aspectRatio": aspect_ratio}

    parts: list[dict] = []
    if reference_image is not None:
        parts.append({
            "inlineData": {
                "mimeType": reference_image.mime_type,
                "data": reference_image.image_b64,
            }
        })
    parts.append({"text": prompt})

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": generation_config,
    }

    # Shorter per-attempt timeout (45s) so a hanging model fails fast and we
    # roll to the fallback within one call rather than waiting two minutes.
    async with httpx.AsyncClient(timeout=45) as client:
        for model in NANOBANANA_MODELS:
            try:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": settings.gemini_api_key,
                    },
                    json=body,
                )
            except httpx.TimeoutException:
                logger.warning(f"[name_cards] {model} timed out — trying next model")
                continue
            except httpx.HTTPError as e:
                logger.warning(f"[name_cards] {model} transport error: {e} — trying next model")
                continue

            logger.info(
                f"[name_cards] {model} status: {resp.status_code} "
                f"(aspect_ratio={aspect_ratio or 'default'}, "
                f"with_ref={'yes' if reference_image else 'no'})"
            )
            if resp.status_code == 200:
                return {"data": resp.json(), "model": model}

            # 4xx/5xx — log and try next model
            logger.error(f"[name_cards] {model} error: {resp.text[:300]}")

    return None


def _extract_first_image(result: dict) -> Optional[GeneratedDesign]:
    """Pull the first inline image from the response."""
    try:
        parts = result["data"]["candidates"][0]["content"]["parts"]
        for part in parts:
            if "inlineData" in part:
                inline = part["inlineData"]
                logger.info(
                    f"[name_cards] Image: {inline.get('mimeType')}, "
                    f"{len(inline.get('data', ''))} b64 chars"
                )
                return GeneratedDesign(
                    image_b64=inline["data"],
                    mime_type=inline.get("mimeType", "image/png"),
                )
    except Exception as e:
        logger.error(f"[name_cards] Parse error: {e}")
    return None


# ────────────────────────────────────────────────────────────────────────────
# Parallel per-view generation (replaces the single-call grid-split approach)
#
# For each of 6 designs we fire one Gemini call per view (e.g. 6 × 3 = 18 calls
# for tented name cards, 6 × 2 = 12 calls for programs), all in parallel. Each
# call returns a native-aspect image so there's no Pillow cropping downstream.
# A shared "design brief" per design keeps the views of a single design
# stylistically cohesive.
# ────────────────────────────────────────────────────────────────────────────

# 6 distinct style directions per event category. Each is a concise brief that
# gets injected into every view call for that design index.
DESIGN_BRIEFS: dict[str, List[str]] = {
    "corporate": [
        "Minimal white background, navy serif typography, a single thin gold rule as accent. Clean hierarchy.",
        "Monochrome clean sans-serif in slate grey, generous whitespace, no ornament.",
        "Bold uppercase sans-serif wordmark in deep navy, subtle charcoal divider line.",
        "Classical serif with centered layout, ivory background, refined letter-spacing.",
        "Modern asymmetric grid layout with a single muted blue accent bar.",
        "Editorial look: small cap serif title with a tiny geometric dot ornament, cream background.",
    ],
    "wedding": [
        "Elegant flowing script headline, soft ivory background, brushed gold accents.",
        "Watercolor floral corner accents in blush pink, clean serif body, cream background.",
        "Art deco geometry: monochrome fan motif, thin gold outline, ivory background.",
        "Delicate botanical line art in sage green, graceful serif typography.",
        "Modern minimalist: charcoal type on warm cream, no ornament, generous whitespace.",
        "Classic formal: engraved-style serif, thin double-rule border, champagne tones.",
    ],
    "retreat": [
        "Earthy kraft paper texture, hand-drawn style title, warm terracotta ink.",
        "Subtle mountain silhouette, muted slate blue and moss green palette.",
        "Botanical line art leaves, warm cream background, forest green serif.",
        "Linen-textured background, deep forest green sans-serif headline, copper accent.",
        "Sunset gradient bar along the top, clean sans-serif below.",
        "Minimalist off-white card, warm brown serif, a single small leaf icon.",
    ],
    "social": [
        "Bold color block: bright mustard yellow and black, chunky sans-serif.",
        "Retro chrome typography on a soft gradient background (peach to lilac).",
        "Playful hand-lettered headline, coral and cream palette.",
        "Geometric pattern border in teal and hot pink, clean type in the center.",
        "Neon glow effect: cyan headline on dark navy background.",
        "Scattered confetti illustration, friendly rounded sans-serif.",
    ],
}


def _briefs_for_event_type(event_type: str) -> List[str]:
    key = event_type.lower()
    if key in DESIGN_BRIEFS:
        return DESIGN_BRIEFS[key]
    if key == "conference":
        return DESIGN_BRIEFS["corporate"]
    return DESIGN_BRIEFS["corporate"]


# Structural variations used when the organizer has typed a prompt. These
# describe layout/composition only, so they can run alongside any style
# direction without conflicting with it.
STRUCTURAL_VARIATIONS: List[str] = [
    "Centered, symmetrical composition with generous whitespace.",
    "Asymmetric layout with the name anchored to the left and the supporting lines aligned beneath.",
    "Purely typographic composition with a single thin horizontal rule separating the name from the supporting lines.",
    "Stacked-line composition with tight letter-spacing and all copy vertically centered.",
    "Name set on a single baseline with supporting copy tucked into a top-right corner caption.",
    "Classic nameplate layout with the guest name set in the upper third and supporting copy in the lower third.",
]


def _briefs_for_request(req: NameCardGenerateRequest, count: int) -> List[str]:
    """Pick `count` briefs for the generation run.

    If the organizer typed a prompt, treat that as the dominant style and
    return structural variations as the per-design briefs. Otherwise use the
    preset event-type style briefs.
    """
    typed = (req.prompt or "").strip() if req else ""
    if typed:
        # Structural variations won't fight with the typed style. The
        # organizer's prompt is injected in the main style slot elsewhere.
        return [STRUCTURAL_VARIATIONS[i % len(STRUCTURAL_VARIATIONS)] for i in range(count)]
    base = _briefs_for_event_type(req.event_type)
    return [base[i % len(base)] for i in range(count)]


def _schedule_summary(req: NameCardGenerateRequest) -> tuple[str, str]:
    """Return (date_header, schedule_block) for the programs prompt."""
    from datetime import datetime as _dt

    def _parse(ts: Optional[str]) -> Optional[_dt]:
        if not ts:
            return None
        try:
            return _dt.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None

    schedule_lines: List[str] = []
    event_dates: List[str] = []

    if req.schedule_items:
        for si in req.schedule_items:
            start = _parse(si.start_time)
            end = _parse(si.end_time)

            time_label = ""
            if start and end:
                if start.date() == end.date():
                    time_label = f"{start.strftime('%-I:%M %p')} – {end.strftime('%-I:%M %p')}"
                else:
                    time_label = f"{start.strftime('%b %-d, %-I:%M %p')} – {end.strftime('%b %-d, %-I:%M %p')}"
            elif start:
                time_label = start.strftime("%-I:%M %p")

            if start:
                d = start.strftime("%B %-d, %Y")
                if d not in event_dates:
                    event_dates.append(d)

            parts = [f'"{si.title}"']
            if time_label:
                parts.append(time_label)
            venue_line = si.venue_name or si.location
            if venue_line:
                parts.append(f"at {venue_line}")
            if si.description and si.description.strip():
                parts.append(f"— {si.description.strip()}")
            schedule_lines.append(" ".join(parts))

    date_header = ""
    if event_dates:
        date_header = event_dates[0] if len(event_dates) == 1 else f"{event_dates[0]} – {event_dates[-1]}"

    schedule_block = "\n".join(f"  • {l}" for l in schedule_lines) if schedule_lines else ""
    return date_header, schedule_block


def _brand_snippet(req: NameCardGenerateRequest) -> str:
    if not (req.brand_colors or req.brand_font):
        return ""
    parts = []
    if req.brand_colors:
        parts.append(f"use the brand colors {', '.join(req.brand_colors)}")
    if req.brand_font:
        parts.append(f"use a typeface similar to {req.brand_font}")
    return f"\nBrand requirements: {' and '.join(parts)}."


def _organizer_snippet(req: NameCardGenerateRequest) -> str:
    if req.prompt and req.prompt.strip():
        return f'\nAdditional direction from the organizer: "{req.prompt.strip()}"'
    return ""


def _build_view_prompt(
    req: NameCardGenerateRequest,
    content_type: str,
    design_idx: int,
    view_label: str,
    design_brief: str,
) -> str:
    """Short, conversational prompt for a single view.

    Philosophy: image models (including Gemini) do better with concise,
    natural descriptions than with long structured specs. One sentence of
    subject, one listing of required text, one line of style — that's it.
    No CAPS-LOCK commands, no section headers, no redundant clauses.
    """
    event_name = (req.event_name or "Your Event").strip()
    brand_str = _brand_snippet(req).strip()
    organizer_note = _organizer_snippet(req).strip()

    # ── PROGRAMS ────────────────────────────────────────────────────────
    if content_type == "programs":
        date_header, schedule_block = _schedule_summary(req)
        typed_program = (req.prompt or "").strip() if req else ""
        style_for_program = (
            f"Style: {typed_program.rstrip('.')}.  Layout variation: {design_brief.rstrip('.')}."
            if typed_program
            else f"Design style: {design_brief.rstrip('.')}."
        )
        if view_label == "Front":
            lines = [
                f"A minimalist product photo of the front cover of a printed event program on a clean "
                f"neutral surface. Portrait 4.25\"×5.5\" cardstock, not folded.",
                f"Printed on the card: event name \"{event_name}\" as the hero line"
                + (f", event date \"{date_header}\" as a smaller supporting line." if date_header else "."),
                style_for_program,
            ]
        else:  # Back
            if schedule_block:
                lines = [
                    f"A minimalist product photo of the back of a printed event program on a clean neutral "
                    f"surface. Portrait 4.25\"×5.5\" cardstock, not folded. Same paper as the front of this "
                    f"design.",
                    f"Printed on the card: the order of events below, verbatim. Include every entry's title, "
                    f"time, location, and description. Render as a clean typographic list, in this order, "
                    f"nothing added, nothing omitted:\n{schedule_block}",
                    style_for_program,
                ]
            else:
                lines = [
                    f"A minimalist product photo of the back of a printed event program on a clean neutral "
                    f"surface. Portrait 4.25\"×5.5\" cardstock, not folded. Same paper as the front.",
                    "Printed on the card: a single centered line reading \"Schedule to be announced\".",
                    style_for_program,
                ]

    # ── TENTED + FLAT NAME CARDS ────────────────────────────────────────
    else:
        sample_name = (req.sample_guest_name or "Jane Smith").strip()
        sample_table = (req.sample_guest_table or "Table 4").strip()
        sample_dietary = (req.sample_guest_dietary or "Vegetarian").strip()
        style = design_brief.rstrip(".")

        card_kind = (
            "folded tent place card standing upright" if content_type == "tented-name-cards"
            else "flat name card lying flat"
        )

        # Determine the dominant style: organizer's typed prompt wins over
        # the preset event-type brief when present. The `design_brief` at
        # this point is either a style brief or a structural variation,
        # depending on whether the organizer typed anything.
        typed = (req.prompt or "").strip() if req else ""
        if typed:
            style_sentence = f"Style: {typed.rstrip('.')}.  Layout variation: {style}."
        else:
            style_sentence = f"Style: {style}."

        if view_label == "Front":
            lines = [
                f"Product photo, landscape 4:3. A {card_kind} on a neutral surface.",
                f'The card shows: "{sample_name}" as the focal point, with smaller "{event_name}" '
                f'and "{sample_table}" nearby.',
                style_sentence,
            ]
        else:  # Back — sent WITH the front image as a reference.
            lines = [
                "Using the attached image as the reference for paper, lighting, camera angle, and "
                "surface, generate a matching photo that shows the BACK of the same card in the same "
                "scene. Landscape 4:3.",
                f'The back face shows only: "{sample_dietary}", centered, as a single line. '
                f"No other text.",
            ]

    # Optional: brand colours/font. The organizer's typed prompt is now baked
    # into the Style line above, so it's NOT appended at the end.
    if brand_str:
        lines.append(brand_str.lstrip(". ").strip().rstrip(".") + ".")

    return " ".join(line.rstrip() for line in lines)


def _extract_single_view(result: dict) -> Optional[DesignView]:
    """Pull the first inline image from a Gemini response as a DesignView."""
    try:
        parts = result["data"]["candidates"][0]["content"]["parts"]
        for part in parts:
            if "inlineData" in part:
                inline = part["inlineData"]
                return DesignView(
                    image_b64=inline["data"],
                    mime_type=inline.get("mimeType", "image/png"),
                )
    except Exception as e:
        logger.error(f"[name_cards] Parse error: {e}")
    return None


async def _generate_parallel(req: NameCardGenerateRequest) -> List[GeneratedDesign]:
    """Fan-out: N designs × M views = N*M parallel Gemini calls.

    Cohesion across a design's views is handled by sharing the same per-design
    brief across all of that design's view prompts.
    """
    content_type = req.content_type or "tented-name-cards"
    # Exactly two views per design for every content type — Front + Back.
    view_labels = ["Front", "Back"]

    # Map each (content_type, view_label) → nearest Gemini-supported aspect ratio.
    # Gemini image gen accepts "1:1", "4:3", "3:4", "16:9", "9:16".
    #   Tented card is 4"×3.5" flat (landscape) → 4:3 is the closest supported.
    #     The tent stands 2"×3.5" when folded, but the user has asked for
    #     horizontal/landscape renders at the full flat ratio.
    #   Program 4.25:5.5 ≈ 0.773 → 3:4 (0.75) is the closest supported.
    #   Flat name card 3.5:2 = 1.75 → no great match; 16:9 (1.778) is closest.
    #   Table setting is a scene photo → 4:3 reads naturally.
    def _aspect_for(_view: str) -> str:
        if content_type == "programs":
            return "3:4"  # portrait, ≈ 4.25 × 5.5
        if content_type == "tented-name-cards":
            return "4:3"  # landscape, closest to the 4:3.5 flat-card spec
        if content_type == "name-cards":
            return "16:9"  # landscape, ≈ 3.5 × 2
        return "1:1"

    # 3 designs × 2 views = 6 total images. Keeps the total Gemini load
    # low enough to avoid rate-limit-flavoured empty responses.
    n_designs = 3
    briefs = _briefs_for_request(req, n_designs)

    # Reduce concurrency — pounding Gemini with too many parallel calls causes
    # rate-limit-flavoured failures where the API returns 200 but no image.
    # 4 concurrent is plenty for 6 designs to finish in reasonable time.
    sem = _aio.Semaphore(4)

    async def _call_with_retries(
        prompt: str,
        aspect: str,
        reference_image: Optional[DesignView],
        label_for_log: str,
    ) -> Optional[DesignView]:
        # Up to 3 attempts with exponential backoff. Empty-response failures
        # are almost always transient rate-limit hiccups — a short wait lets
        # them pass.
        for attempt in range(3):
            async with sem:
                result = await _call_nanobanana(prompt, aspect_ratio=aspect, reference_image=reference_image)
            if result:
                view = _extract_single_view(result)
                if view:
                    return view
            logger.warning(f"[name_cards] {label_for_log} attempt {attempt+1} returned no image")
            if attempt < 2:
                await _aio.sleep(1.5 * (2 ** attempt))  # 1.5s, then 3s
        return None

    async def _generate_one_design(d_idx: int) -> Optional[GeneratedDesign]:
        brief = briefs[d_idx]

        # 1) Front first — no reference image.
        front_prompt = _build_view_prompt(req, content_type, d_idx, "Front", brief)
        front_aspect = _aspect_for("Front")
        front = await _call_with_retries(
            front_prompt, front_aspect, reference_image=None,
            label_for_log=f"Design {d_idx+1} Front",
        )
        if not front:
            logger.warning(f"[name_cards] Design {d_idx+1} Front failed after retries — skipping back")
            return None
        front.label = "Front"

        # 2) Back using front as a visual reference so scene/paper/lighting match.
        back_prompt = _build_view_prompt(req, content_type, d_idx, "Back", brief)
        back_aspect = _aspect_for("Back")
        back = await _call_with_retries(
            back_prompt, back_aspect, reference_image=front,
            label_for_log=f"Design {d_idx+1} Back",
        )

        views: List[DesignView] = [front]
        if back:
            back.label = "Back"
            views.append(back)
        else:
            logger.warning(f"[name_cards] Design {d_idx+1} Back failed after retries — returning front only")

        return GeneratedDesign(
            image_b64=front.image_b64,
            mime_type=front.mime_type,
            views=views,
        )

    logger.info(
        f"[name_cards] Firing {n_designs} parallel designs "
        f"(each: front → back with front as reference)"
    )
    results = await _aio.gather(
        *(_generate_one_design(i) for i in range(n_designs)),
        return_exceptions=True,
    )

    designs: List[GeneratedDesign] = []
    short_designs: List[str] = []
    for d_idx, r in enumerate(results):
        if isinstance(r, Exception):
            logger.warning(f"[name_cards] Design {d_idx+1} raised: {r}")
            continue
        if r is None:
            continue
        designs.append(r)
        if r.views is None or len(r.views) < len(view_labels):
            missing = [v for v in view_labels if v not in {vv.label for vv in (r.views or [])}]
            if missing:
                short_designs.append(f"#{d_idx+1} missing {', '.join(missing)}")

    logger.info(
        f"[name_cards] Parallel generation returned {len(designs)} designs"
        + (f" · partial: {'; '.join(short_designs)}" if short_designs else "")
    )
    return designs


@router.post("/generate", response_model=NameCardGenerateResponse)
async def generate_name_cards(req: NameCardGenerateRequest):
    """Parallel per-view generation — one Gemini call per design view."""
    logger.info(
        f"[name_cards] Generating designs for event_type={req.event_type}, "
        f"content_type={req.content_type}, colors={req.brand_colors}, font={req.brand_font}"
    )

    designs = await _generate_parallel(req)

    if not designs:
        raise HTTPException(503, "Image generation service unavailable. Please try again.")

    return NameCardGenerateResponse(
        designs=designs,
        model_used=NANOBANANA_MODELS[0],
    )
