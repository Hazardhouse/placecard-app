"""
Per-attendee print-file rendering pipeline.

Triggered as an APScheduler background job from the Stripe webhook
after `payment_intent.succeeded`. For each attendee on a paid print
order:

  1. Call Gemini (Nano Banana) image-to-image with the chosen
     design as reference + the attendee's printed text (name,
     table, event, dietary) baked into the prompt.
  2. Resize to print dimensions at 300 DPI, convert to JPG-95.
  3. Upload to Supabase Storage at
     `print-orders/orders/{order_id}/{slug}-{front|back}.jpg`.

When the batch finishes (or partially finishes), the fulfillment
email fires to the operator with signed download URLs for every
attendee's files + low-res inline previews of the source design.

Why background and not synchronous in the webhook:
  - Stripe gives webhook handlers ~10s before retrying. 35 attendees
    × 2 faces × ~5-10s each Gemini call is 5+ minutes even in
    parallel batches.
  - The webhook flips status to 'paid' immediately and returns 200.
    This job picks up the rest asynchronously.

Failure handling: per-attendee try/except. If a single render fails,
log + carry on; the email reports what succeeded vs failed so the
operator knows what to manually regenerate.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Tuple

from PIL import Image

from app.database import SessionLocal
from app.models.event import Event
from app.models.print_order import PrintOrder
from app.routers.name_cards import (
    DesignView,
    _call_nanobanana,
    _extract_single_view,
)
from app.services.email import send_print_order_fulfillment
from app.services.supabase_storage import (
    create_signed_url,
    ensure_bucket,
    upload_object,
)

logger = logging.getLogger("print_rendering")

BUCKET_ID = "print-orders"

# Per-content-type, per-face target print dimensions (300 DPI, in pixels).
# Tented + flat name cards are both 3.5" × 2" landscape per face.
# (Tented cards fold along the long edge, so each face shows landscape
# when standing upright on a table.)
# Programs are 4.25" × 5.5" portrait.
TARGETS: dict[str, Tuple[int, int, str]] = {
    "tented-name-cards": (1050, 600, "16:9"),
    "name-cards": (1050, 600, "16:9"),
    "programs": (1275, 1650, "3:4"),
}


@dataclass
class RenderResult:
    attendee_name: str
    front_url: Optional[str]
    back_url: Optional[str]
    error: Optional[str]


# ── Public entry point (APScheduler-friendly sync wrapper) ─────────────


def render_print_files_and_notify(order_id: int) -> None:
    """Sync wrapper for the async pipeline. Used as the APScheduler
    job target since BackgroundScheduler runs jobs in thread pool
    and can't await coroutines directly.
    """
    try:
        asyncio.run(_render_and_notify(order_id))
    except Exception:
        logger.exception("Print-rendering job for order %s failed", order_id)


# ── Async pipeline ─────────────────────────────────────────────────────


async def _render_and_notify(order_id: int) -> None:
    db = SessionLocal()
    try:
        order = db.query(PrintOrder).filter(PrintOrder.id == order_id).first()
        if not order:
            logger.error("Order %s not found", order_id)
            return
        if order.status != "paid":
            logger.warning(
                "Order %s status is %r, not 'paid' — skipping render",
                order_id, order.status,
            )
            return

        event = db.query(Event).filter(Event.id == order.event_id).first()
        event_name = event.name if event else ""

        # Lazy-create the bucket the first time we ever upload.
        try:
            ensure_bucket(BUCKET_ID, public=False)
        except Exception:
            logger.exception("Could not ensure bucket %r — uploads will likely fail", BUCKET_ID)

        # Build front/back reference views from the chosen design.
        front_ref = DesignView(
            image_b64=order.design_image_b64,
            mime_type=order.design_mime_type,
            label="Front",
        )
        back_ref: Optional[DesignView] = None
        if order.design_views_json:
            for v in order.design_views_json:
                lbl = (v.get("label") or "").lower()
                if "back" in lbl:
                    back_ref = DesignView(
                        image_b64=v["image_b64"],
                        mime_type=v.get("mime_type", "image/png"),
                        label=v.get("label", "Back"),
                    )
                    break

        results = await _render_all(order, event_name, front_ref, back_ref)

        # Fire the fulfillment email with the signed URLs.
        try:
            ok = send_print_order_fulfillment(order, render_results=results)
            if ok:
                order.fulfillment_notified_at = datetime.utcnow()
                db.commit()
        except Exception:
            logger.exception("Fulfillment email failed for order %s", order_id)
    finally:
        db.close()


async def _render_all(
    order: PrintOrder,
    event_name: str,
    front_ref: DesignView,
    back_ref: Optional[DesignView],
) -> List[RenderResult]:
    """Fan out per-attendee front+back rendering with bounded concurrency."""
    sem = asyncio.Semaphore(4)
    attendees = order.attendees_json or []

    async def render_one(attendee: dict) -> RenderResult:
        async with sem:
            return await _render_attendee(
                order=order,
                event_name=event_name,
                attendee=attendee,
                front_ref=front_ref,
                back_ref=back_ref,
            )

    results = await asyncio.gather(
        *(render_one(a) for a in attendees),
        return_exceptions=True,
    )

    final: List[RenderResult] = []
    for i, r in enumerate(results):
        attendee = attendees[i]
        name = attendee.get("name", f"Guest {i + 1}")
        if isinstance(r, Exception):
            logger.exception("Render exception for attendee %r", name, exc_info=r)
            final.append(RenderResult(attendee_name=name, front_url=None, back_url=None, error=str(r)))
        else:
            final.append(r)
    return final


async def _render_attendee(
    *,
    order: PrintOrder,
    event_name: str,
    attendee: dict,
    front_ref: DesignView,
    back_ref: Optional[DesignView],
) -> RenderResult:
    name = (attendee.get("name") or "Guest").strip()
    table = (attendee.get("table_name") or "").strip()
    dietary = (attendee.get("dietary") or "").strip()
    slug = _slugify(name) or f"guest-{order.id}"

    target = TARGETS.get(order.content_type, TARGETS["tented-name-cards"])
    target_w, target_h, aspect_ratio = target

    front_url: Optional[str] = None
    back_url: Optional[str] = None
    error: Optional[str] = None

    # ── Front ──
    try:
        front_prompt = _build_print_prompt(
            content_type=order.content_type,
            face="front",
            name=name,
            table=table,
            event_name=event_name,
        )
        front_view = await _generate_face(front_prompt, aspect_ratio, front_ref)
        if front_view:
            jpg_bytes = _resize_to_jpg(front_view, target_w, target_h)
            path = f"orders/{order.id}/{slug}-front.jpg"
            upload_object(BUCKET_ID, path, jpg_bytes, "image/jpeg")
            front_url = create_signed_url(BUCKET_ID, path)
        else:
            error = "front: no image returned"
    except Exception as exc:
        logger.exception("Front render failed for %r", name)
        error = f"front: {exc}"

    # ── Back ──
    try:
        back_prompt = _build_print_prompt(
            content_type=order.content_type,
            face="back",
            name=name,
            table=table,
            dietary=dietary,
            event_name=event_name,
        )
        ref_for_back = back_ref or front_ref
        back_view = await _generate_face(back_prompt, aspect_ratio, ref_for_back)
        if back_view:
            jpg_bytes = _resize_to_jpg(back_view, target_w, target_h)
            path = f"orders/{order.id}/{slug}-back.jpg"
            upload_object(BUCKET_ID, path, jpg_bytes, "image/jpeg")
            back_url = create_signed_url(BUCKET_ID, path)
        else:
            error = (error + "; " if error else "") + "back: no image returned"
    except Exception as exc:
        logger.exception("Back render failed for %r", name)
        error = (error + "; " if error else "") + f"back: {exc}"

    return RenderResult(
        attendee_name=name,
        front_url=front_url,
        back_url=back_url,
        error=error,
    )


async def _generate_face(prompt: str, aspect_ratio: str, ref: DesignView) -> Optional[DesignView]:
    """Single Gemini call with up to 2 retries on transient failure."""
    for attempt in range(3):
        result = await _call_nanobanana(prompt, aspect_ratio=aspect_ratio, reference_image=ref)
        if result:
            view = _extract_single_view(result)
            if view:
                return view
        if attempt < 2:
            await asyncio.sleep(1.5 * (2 ** attempt))
    return None


def _build_print_prompt(
    *,
    content_type: str,
    face: str,  # "front" | "back"
    name: str,
    table: str = "",
    dietary: str = "",
    event_name: str = "",
) -> str:
    """Print-ready prompt — asks for a FLAT 2D layout, not a 3D
    product photo. Reference image carries the design's visual
    style (typography, palette, ornamentation); the prompt overrides
    the printed text only.
    """
    if content_type == "programs":
        face_size = "4.25 inches wide by 5.5 inches tall portrait"
    elif content_type == "name-cards":
        face_size = "3.5 inches wide by 2 inches tall landscape"
    else:  # tented-name-cards
        face_size = "2 inches wide by 3.5 inches tall portrait (one folded face)"

    style_note = (
        "Match the typography, color palette, layout, and decorative elements from "
        "the attached reference image. But render as a flat 2D print artwork, NOT a "
        "3D product photo: no surface, no lighting, no shadow, no perspective. "
        "Plain background (white or the design's intended background colour). "
        "Edge-to-edge artwork sized to the card face."
    )

    if face == "front":
        text_block_lines = [f'Guest name (most prominent): "{name}"']
        if event_name:
            text_block_lines.append(f'Event name (smaller, secondary): "{event_name}"')
        if table:
            text_block_lines.append(f'Table assignment (small): "{table}"')
        text_block = "\n".join(f"  • {l}" for l in text_block_lines)
        return (
            f"Generate a FLAT print-ready artwork of the FRONT of a name card. "
            f"Card size: {face_size}.\n\n"
            f"Printed text (use these exact strings, nothing else):\n{text_block}\n\n"
            f"{style_note}"
        )

    # back
    back_text = (dietary or "No dietary requirements").strip()
    return (
        f"Generate a FLAT print-ready artwork of the BACK of a name card. "
        f"Card size: {face_size}.\n\n"
        f"Printed text (centered, single line, only this):\n"
        f'  • "{back_text}"\n\n'
        f"{style_note}"
    )


def _resize_to_jpg(view: DesignView, target_w: int, target_h: int) -> bytes:
    """Decode the base64 PNG/JPG from Gemini → resize to exact print
    dimensions → save as 95-quality JPG with 300 DPI metadata.
    """
    raw = base64.b64decode(view.image_b64)
    img = Image.open(io.BytesIO(raw))
    img = img.resize((target_w, target_h), Image.LANCZOS)
    if img.mode != "RGB":
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=95, dpi=(300, 300), optimize=True)
    return out.getvalue()


def _slugify(value: str) -> str:
    """ASCII slug for filenames. Strips accents + non-alphanumeric, lowercases."""
    norm = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", norm).strip("-").lower()
    return slug[:60]
