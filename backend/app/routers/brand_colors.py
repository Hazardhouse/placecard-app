"""
Brand color + font extraction endpoint.

Two-step process:
  1. Screenshot the homepage → Gemini identifies the 4 most prominent colors visually
  2. Compare those visual colors to the site's actual CSS hex codes → snap to exact match
"""

import asyncio as _aio
import base64
import ipaddress
import json as _json
import logging
import re
import socket
from collections import Counter
from typing import List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("brand_colors")

from app.auth import get_current_user
from app.config import settings

# Router-level auth dep — this endpoint fetches arbitrary user-provided
# URLs server-side and calls Gemini for visual analysis. Without auth
# it's an open SSRF + Gemini-budget burner.
router = APIRouter(
    prefix="/api/brand",
    tags=["brand"],
    dependencies=[Depends(get_current_user)],
)


# ── SSRF protection ─────────────────────────────────────────────────────
#
# The user-supplied URL flows into httpx fetches with follow_redirects=True.
# Without validation a caller could point us at:
#   - http://127.0.0.1:8000     → probe our own internal API
#   - http://10.x / 172.16.x / 192.168.x → internal services
#   - http://169.254.169.254    → cloud metadata (AWS/GCP IMDS)
#   - file://, gopher://, etc.  → file/protocol smuggling
#
# We block all of those on the *initial* hostname. Redirects after the
# initial hop are still followed by httpx — a fully redirect-aware
# SSRF guard would require disabling follow_redirects and walking each
# hop manually. Captured as a follow-up in the launch checklist.

ALLOWED_SCHEMES = {"http", "https"}


def _is_safe_url(url: str) -> Tuple[bool, str]:
    """Return (is_safe, reason) for an outbound fetch URL."""
    try:
        parsed = urlparse(url)
    except Exception as exc:
        return False, f"Invalid URL ({exc})"

    scheme = (parsed.scheme or "").lower()
    if scheme not in ALLOWED_SCHEMES:
        return False, f"Only http/https URLs allowed (got {scheme!r})"

    host = parsed.hostname
    if not host:
        return False, "URL has no hostname"

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        return False, f"Could not resolve hostname ({exc})"

    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f"URL resolves to restricted address {ip_str}"

    return True, ""

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"]


class ColorExtractRequest(BaseModel):
    url: str


class BrandColor(BaseModel):
    hex: str
    role: str
    label: str


class ColorExtractResponse(BaseModel):
    colors: List[BrandColor]
    font: Optional[str] = None
    source_url: str


# ---------------------------------------------------------------------------
# Color utilities
# ---------------------------------------------------------------------------

def _hex_to_rgb(hex_c: str) -> Tuple[int, int, int]:
    h = hex_c.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _color_distance(c1: str, c2: str) -> float:
    r1, g1, b1 = _hex_to_rgb(c1)
    r2, g2, b2 = _hex_to_rgb(c2)
    return ((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) ** 0.5


def _normalize_hex(raw: str) -> Optional[str]:
    raw = raw.strip().lower()
    if not raw.startswith('#'):
        raw = '#' + raw
    h = raw.lstrip('#')
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    if len(h) != 6 or not all(c in '0123456789abcdef' for c in h):
        return None
    return f"#{h}"


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def _is_boring(hex_c: str) -> bool:
    r, g, b = _hex_to_rgb(hex_c)
    brightness = (r * 299 + g * 587 + b * 114) / 1000
    if brightness > 240 or brightness < 15:
        return True
    if max(r, g, b) - min(r, g, b) < 8 and brightness > 200:
        return True
    return False


def _extract_all_hex(text: str) -> List[str]:
    colors: List[str] = []
    for m in re.findall(r'#([0-9a-fA-F]{6})\b', text):
        colors.append(f"#{m.lower()}")
    for m in re.findall(r'#([0-9a-fA-F]{3})\b', text):
        h = m.lower()
        colors.append(f"#{h[0]*2}{h[1]*2}{h[2]*2}")
    for m in re.finditer(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', text):
        r, g, b = int(m.group(1)), int(m.group(2)), int(m.group(3))
        colors.append(_rgb_to_hex(r, g, b))
    # Also extract CSS custom properties (--color-brand: #xxx)
    for m in re.finditer(r'--[\w-]+\s*:\s*#([0-9a-fA-F]{6})\b', text):
        colors.append(f"#{m.group(1).lower()}")
    for m in re.finditer(r'--[\w-]+\s*:\s*#([0-9a-fA-F]{3})\b', text):
        h = m.group(1).lower()
        colors.append(f"#{h[0]*2}{h[1]*2}{h[2]*2}")
    return colors


def _count_colors(colors: List[str]) -> List[Tuple[str, int]]:
    counts = Counter(colors)
    boring = {c for c in counts if _is_boring(c)}
    for b in boring:
        counts.pop(b, None)
    return counts.most_common(40)


# ---------------------------------------------------------------------------
# Font extraction
# ---------------------------------------------------------------------------

def _extract_fonts(html: str, css: str) -> Optional[str]:
    combined = html + "\n" + css
    gf_match = re.search(
        r'fonts\.googleapis\.com/css2?\?family=([^&"\'>\s]+)', html, re.IGNORECASE
    )
    if gf_match:
        from urllib.parse import unquote
        font_name = unquote(gf_match.group(1).split(':')[0].replace('+', ' '))
        if font_name and len(font_name) > 1:
            return font_name

    for m in re.finditer(
        r'@font-face\s*\{[^}]*font-family\s*:\s*["\']?([^"\'};]+)["\']?\s*;',
        combined, re.IGNORECASE
    ):
        name = m.group(1).strip()
        if not re.search(r'icon|awesome|material|glyph|symbol|icomoon|fa-|webfont', name, re.IGNORECASE):
            if len(name) > 1:
                return name

    for sel in [r'body', r'html', r':root', r'\*']:
        for m in re.finditer(sel + r'\s*\{([^}]*font-family[^}]*)\}', combined, re.IGNORECASE):
            ff = re.search(r'font-family\s*:\s*([^;]+)', m.group(1), re.IGNORECASE)
            if ff:
                first = ff.group(1).strip().split(',')[0].strip().strip("'\"")
                if first and not re.search(
                    r'^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|-apple-system|BlinkMacSystemFont|Segoe UI)$',
                    first, re.IGNORECASE
                ):
                    return first

    fc: Counter = Counter()
    for m in re.finditer(r'font-family\s*:\s*([^;}{]+)', combined, re.IGNORECASE):
        first = m.group(1).strip().split(',')[0].strip().strip("'\"")
        if first and not re.search(
            r'^(sans-serif|serif|monospace|cursive|fantasy|system-ui|inherit|initial|-apple-system|BlinkMacSystemFont|Segoe UI)$',
            first, re.IGNORECASE
        ) and not re.search(r'icon|awesome|material|glyph|symbol|icomoon', first, re.IGNORECASE):
            fc[first] += 1
    if fc:
        return fc.most_common(1)[0][0]
    return None


# ---------------------------------------------------------------------------
# Page + CSS fetching
# ---------------------------------------------------------------------------

async def _fetch_page(url: str) -> str:
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        resp = await client.get(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; PlaceCard/1.0)"
        })
        resp.raise_for_status()
        return resp.text


async def _fetch_css(html: str, base_url: str) -> str:
    css_text = ""
    css_urls = re.findall(r'href=["\']([^"\']+\.css[^"\']*?)["\']', html)
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        for css_url in css_urls[:5]:
            if css_url.startswith("//"):
                css_url = "https:" + css_url
            elif not css_url.startswith("http"):
                css_url = urljoin(base_url, css_url)
            try:
                resp = await client.get(css_url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; PlaceCard/1.0)"
                })
                css_text += resp.text + "\n"
            except Exception:
                continue
    return css_text


# ---------------------------------------------------------------------------
# Step 1: Screenshot → Gemini visual identification
# ---------------------------------------------------------------------------

async def _capture_screenshot(url: str) -> Optional[Tuple[str, str]]:
    """Take a screenshot of the URL via thum.io. Returns (base64_data, mime_type)."""
    screenshot_url = f"https://image.thum.io/get/width/800/crop/600/{url}"
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            resp = await client.get(screenshot_url)
            if resp.status_code != 200:
                logger.warning(f"[brand] Screenshot failed: HTTP {resp.status_code}")
                return None
            content_type = resp.headers.get("content-type", "image/png")
            if "gif" in content_type:
                mime = "image/gif"
            elif "jpeg" in content_type or "jpg" in content_type:
                mime = "image/jpeg"
            else:
                mime = "image/png"
            data_b64 = base64.b64encode(resp.content).decode()
            logger.info(f"[brand] Step 1: Screenshot captured ({len(resp.content)} bytes)")
            return data_b64, mime
    except Exception as e:
        logger.error(f"[brand] Screenshot error: {e}")
        return None


async def _gemini_visual_colors(screenshot: Tuple[str, str]) -> Optional[List[dict]]:
    """Step 1: Send screenshot to Gemini, get approximate visual colors."""
    if not settings.gemini_api_key:
        return None

    prompt = """Look at this screenshot of a website homepage.

Scan the ENTIRE page — header, navigation, backgrounds, buttons, text, logos, accents.

Identify the 4 most prominent colors you can see (not white, not black):

1. **primary** — The single most dominant brand color (the color that defines this brand).
2. **secondary** — The second most prominent accent color, visually distinct from primary.
3. **cta** — The color used for buttons or call-to-action elements.
4. **neutral** — The main body text color (typically a dark gray or charcoal).

Be precise with the hex codes — try to match exactly what you see.
All 4 must be visually different from each other.
6-digit lowercase hex. No #ffffff or #000000.

Return ONLY this JSON:
[
  {"hex": "#xxxxxx", "role": "primary", "label": "Primary"},
  {"hex": "#xxxxxx", "role": "secondary", "label": "Secondary"},
  {"hex": "#xxxxxx", "role": "cta", "label": "CTA Color"},
  {"hex": "#xxxxxx", "role": "neutral", "label": "Neutral Color"}
]"""

    try:
        b64_data, mime_type = screenshot
        parts = [
            {"inlineData": {"mimeType": mime_type, "data": b64_data}},
            {"text": prompt},
        ]

        data = None
        # Try each model in the fallback chain
        for model in GEMINI_MODELS:
            model_ok = False
            for attempt in range(2):
                try:
                    logger.info(f"[brand] Step 1: {model} attempt {attempt + 1}/2")
                    async with httpx.AsyncClient(timeout=60) as client:
                        resp = await client.post(
                            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                            headers={
                                "Content-Type": "application/json",
                                "x-goog-api-key": settings.gemini_api_key,
                            },
                            json={
                                "contents": [{"parts": parts}],
                                "generationConfig": {
                                    "responseModalities": ["TEXT"],
                                    "temperature": 0,
                                },
                            },
                        )
                        logger.info(f"[brand] Step 1: {model} status {resp.status_code}")
                        if resp.status_code in (429, 503):
                            logger.warning(f"[brand] {model} {resp.status_code} — will try next model")
                            break  # Move to next model immediately
                        if resp.status_code != 200:
                            logger.error(f"[brand] {model} error: {resp.text[:300]}")
                            break
                        data = resp.json()
                        model_ok = True
                        break
                except httpx.TimeoutException:
                    if attempt < 1:
                        await _aio.sleep(5)
                except Exception as e:
                    logger.error(f"[brand] {model} error: {e}")
                    break
            if model_ok:
                logger.info(f"[brand] Step 1: Using {model}")
                break

        if not data:
            return None

        text = data["candidates"][0]["content"]["parts"][0]["text"]
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        text = text.strip()
        logger.info(f"[brand] Step 1 Gemini visual colors: {text[:500]}")

        return _json.loads(text)

    except Exception as e:
        logger.error(f"[brand] Step 1 error: {e}")
        return None


# ---------------------------------------------------------------------------
# Step 2: Snap visual colors → nearest CSS hex code
# ---------------------------------------------------------------------------

SNAP_MAX_DISTANCE = 50  # If closest CSS color is farther than this, keep Gemini's color


def _snap_to_css(
    visual_colors: List[dict],
    css_palette: List[str],
) -> List[BrandColor]:
    """Match each Gemini visual color to the nearest actual CSS hex code.

    If the closest CSS color is too far (> SNAP_MAX_DISTANCE), keep Gemini's
    approximate color — it's more accurate than a wrong match.
    """
    used: set = set()
    result: List[BrandColor] = []

    for vc in visual_colors[:4]:
        approx_hex = _normalize_hex(vc["hex"]) or vc["hex"].lower()
        role = vc.get("role", "unknown")
        label = vc.get("label", role)

        # Find the closest CSS color not yet used
        best_match = approx_hex
        best_dist = float('inf')
        for css_hex in css_palette:
            if css_hex in used:
                continue
            d = _color_distance(approx_hex, css_hex)
            if d < best_dist:
                best_dist = d
                best_match = css_hex

        # Only snap if the match is close enough; otherwise keep Gemini's color
        if best_dist <= SNAP_MAX_DISTANCE:
            logger.info(f"[brand] Step 2: {role} visual {approx_hex} → CSS {best_match} (dist {best_dist:.0f}) ✓ snapped")
            used.add(best_match)
            result.append(BrandColor(hex=best_match, role=role, label=label))
        else:
            logger.info(f"[brand] Step 2: {role} visual {approx_hex} → kept (nearest CSS {best_match} dist {best_dist:.0f} > {SNAP_MAX_DISTANCE})")
            result.append(BrandColor(hex=approx_hex, role=role, label=label))

    return result


# ---------------------------------------------------------------------------
# Fallback — CSS frequency only
# ---------------------------------------------------------------------------

def _fallback_extract(css_palette: List[str]) -> List[BrandColor]:
    """Simple fallback: top saturated colors + a neutral."""
    used: set = set()

    def pick_saturated() -> str:
        for c in css_palette:
            if c in used:
                continue
            r, g, b = _hex_to_rgb(c)
            sat = (max(r, g, b) - min(r, g, b)) / max(max(r, g, b), 1)
            if sat > 0.15:
                return c
        for c in css_palette:
            if c not in used:
                return c
        return "#64748b"

    def pick_neutral() -> str:
        for c in css_palette:
            if c in used:
                continue
            r, g, b = _hex_to_rgb(c)
            brightness = (r * 299 + g * 587 + b * 114) / 1000
            sat = (max(r, g, b) - min(r, g, b)) / max(max(r, g, b), 1)
            if sat < 0.2 and 25 < brightness < 200:
                return c
        return "#64748b"

    p = pick_saturated(); used.add(p)
    s = pick_saturated(); used.add(s)
    c = pick_saturated(); used.add(c)
    n = pick_neutral()

    return [
        BrandColor(hex=p, role="primary", label="Primary"),
        BrandColor(hex=s, role="secondary", label="Secondary"),
        BrandColor(hex=c, role="cta", label="CTA Color"),
        BrandColor(hex=n, role="neutral", label="Neutral Color"),
    ]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/extract-colors", response_model=ColorExtractResponse)
async def extract_brand_colors(req: ColorExtractRequest):
    url = req.url
    if not url.startswith("http"):
        url = f"https://{url}"

    # SSRF guard — reject loopback / RFC1918 / link-local / cloud metadata
    # before any server-side fetch goes out. See `_is_safe_url` for full
    # rationale.
    safe, reason = _is_safe_url(url)
    if not safe:
        raise HTTPException(status_code=400, detail=f"Invalid URL: {reason}")

    # -----------------------------------------------------------
    # Kick off HTML/CSS fetch + screenshot in parallel
    # -----------------------------------------------------------
    html = ""
    css_text = ""

    async def fetch_html_css():
        nonlocal html, css_text
        try:
            html = await _fetch_page(url)
            css_text = await _fetch_css(html, url)
        except Exception as exc:
            raise HTTPException(400, f"Could not fetch website: {exc}")

    html_task = _aio.create_task(fetch_html_css())
    screenshot_task = _aio.create_task(_capture_screenshot(url))

    await html_task
    screenshot = await screenshot_task

    # -----------------------------------------------------------
    # Build CSS color palettes
    # -----------------------------------------------------------
    all_colors = _extract_all_hex(html) + _extract_all_hex(css_text)

    # Full palette (unfiltered) for snapping Gemini colors to exact hex
    full_counts = Counter(all_colors)
    full_palette = [c for c, _ in full_counts.most_common(80)]
    logger.info(f"[brand] Full palette ({len(full_palette)} colors): {full_palette[:15]}")

    # Filtered palette (no boring whites/blacks/grays) for fallback
    color_freq = _count_colors(all_colors)
    css_palette = [c[0] for c in color_freq]
    logger.info(f"[brand] Filtered palette ({len(css_palette)} colors): {css_palette[:10]}")

    # -----------------------------------------------------------
    # Extract font
    # -----------------------------------------------------------
    font = _extract_fonts(html, css_text)
    logger.info(f"[brand] Font: {font}")

    # -----------------------------------------------------------
    # Step 1: Gemini looks at the screenshot → approximate colors
    # Step 2: Snap those to the nearest real CSS hex codes
    # -----------------------------------------------------------
    colors = None
    if screenshot:
        visual_colors = await _gemini_visual_colors(screenshot)
        if visual_colors and len(visual_colors) >= 4:
            colors = _snap_to_css(visual_colors, full_palette)

    # Fallback if screenshot or Gemini failed
    if not colors:
        logger.info("[brand] Fallback to CSS frequency")
        colors = _fallback_extract(css_palette)

    return ColorExtractResponse(colors=colors, font=font, source_url=url)
