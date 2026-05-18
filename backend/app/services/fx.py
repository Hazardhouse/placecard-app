"""
Foreign-exchange rate lookup with a daily cache.

Currently used by pricing.py for GB tented-name-cards: the customer's
GBP price is derived from the USD pricing × today's USD→GBP rate.
Once Dani's UK printer pricing is finalised, the GB tented entries
should be put back into pricing.py directly and this dispatcher
removed.

Source: ECB rates via frankfurter.app. Free, no API key, no rate
limit. Returns the closing rate for the previous business day on
weekends + holidays — which is the right behaviour for our use
case (we want a stable daily rate, not intraday volatility).
"""
from __future__ import annotations

import logging
import threading
from datetime import date
from typing import Optional

import httpx

logger = logging.getLogger("fx")

_cache: dict[tuple[str, str], tuple[date, float]] = {}
_cache_lock = threading.Lock()

# Fallback used when the API is unreachable (network blip, rate-limit,
# etc). Set conservatively so we don't underprice if the lookup fails.
# Tune periodically against the actual ECB rate.
FALLBACK_USD_TO_GBP = 0.79


def _fetch_rate(base: str, quote: str) -> Optional[float]:
    """Hit frankfurter.dev for the ECB closing rate. follow_redirects
    handles their occasional .app → .dev migration without us tracking
    the canonical host.
    """
    try:
        with httpx.Client(timeout=5, follow_redirects=True) as client:
            resp = client.get(
                "https://api.frankfurter.dev/v1/latest",
                params={"base": base, "symbols": quote},
            )
        if resp.status_code != 200:
            logger.warning(
                "frankfurter returned %d for %s→%s: %s",
                resp.status_code, base, quote, resp.text[:200],
            )
            return None
        data = resp.json()
        rate = data.get("rates", {}).get(quote)
        if rate is None:
            logger.warning("frankfurter response missing %s rate: %r", quote, data)
            return None
        return float(rate)
    except Exception:
        logger.exception("FX fetch failed for %s→%s", base, quote)
        return None


def usd_to_gbp_rate() -> float:
    """Return today's USD→GBP rate, cached once per calendar day.

    Falls back to FALLBACK_USD_TO_GBP if the API is unreachable, so
    pricing never blocks on a transient outage — customers just see
    a slightly stale rate.
    """
    today = date.today()
    with _cache_lock:
        cached = _cache.get(("USD", "GBP"))
        if cached and cached[0] == today:
            return cached[1]

    rate = _fetch_rate("USD", "GBP")
    if rate is None:
        logger.warning("Falling back to %.4f USD→GBP rate", FALLBACK_USD_TO_GBP)
        return FALLBACK_USD_TO_GBP

    with _cache_lock:
        _cache[("USD", "GBP")] = (today, rate)
    logger.info("Fetched USD→GBP rate %.4f for %s", rate, today.isoformat())
    return rate
