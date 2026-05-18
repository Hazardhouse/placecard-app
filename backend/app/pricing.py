"""
Central price list for print orders.

Edit + commit + push to apply; Render redeploys in ~2 minutes. Single
source of truth — no API integration with any specific print vendor.
Pricing is dialed in manually against whichever local printer you're
working with in each country.

When you grow beyond two countries, want non-engineers to change
prices, or want price A/B testing, migrate this to a DB-backed
`print_pricing` table with an admin UI. Captured in the launch
checklist.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Tuple


@dataclass(frozen=True)
class CardPrice:
    base: float
    rush: float  # rush surcharge for this tier (added when rush=True)
    currency: str  # 'USD' or 'GBP'


# Card base + rush prices keyed by country → content_type → quantity tier.
# Quantity tiers are inclusive ceilings: a quantity of 75 rounds up to
# the 100 tier and is priced as 100 cards. Orders exceeding the largest
# tier raise ValueError — they need a manual quote, not silent capping.
#
# tented-name-cards has tier-dependent rush surcharges per Dani's
# 2026-05-18 printer-quoted pricing. Other content types use a single
# flat rush per country (same value at every tier).
PRINT_PRICING: Dict[str, Dict[str, Dict[int, CardPrice]]] = {
    "US": {
        "tented-name-cards": {
            # Capped at 100 until pricing for larger orders is finalised.
            25: CardPrice(base=65.52, rush=60.00, currency="USD"),
            50: CardPrice(base=78.32, rush=60.00, currency="USD"),
            75: CardPrice(base=86.32, rush=70.00, currency="USD"),
            100: CardPrice(base=143.92, rush=279.92, currency="USD"),
        },
        "name-cards": {
            50: CardPrice(base=49.95, rush=60.00, currency="USD"),
            100: CardPrice(base=64.95, rush=60.00, currency="USD"),
            250: CardPrice(base=99.95, rush=60.00, currency="USD"),
            500: CardPrice(base=139.95, rush=60.00, currency="USD"),
            1000: CardPrice(base=189.95, rush=60.00, currency="USD"),
        },
        "programs": {
            50: CardPrice(base=89.95, rush=60.00, currency="USD"),
            100: CardPrice(base=119.95, rush=60.00, currency="USD"),
            250: CardPrice(base=169.95, rush=60.00, currency="USD"),
            500: CardPrice(base=229.95, rush=60.00, currency="USD"),
            1000: CardPrice(base=329.95, rush=60.00, currency="USD"),
        },
    },
    "GB": {
        "tented-name-cards": {
            # PLACEHOLDER — Dani is using the same USD numbers in GBP
            # until her UK printer's rates are finalised. Will diverge.
            25: CardPrice(base=65.52, rush=60.00, currency="GBP"),
            50: CardPrice(base=78.32, rush=60.00, currency="GBP"),
            75: CardPrice(base=86.32, rush=70.00, currency="GBP"),
            100: CardPrice(base=143.92, rush=279.92, currency="GBP"),
        },
        "name-cards": {
            50: CardPrice(base=39.95, rush=55.00, currency="GBP"),
            100: CardPrice(base=54.95, rush=55.00, currency="GBP"),
            250: CardPrice(base=84.95, rush=55.00, currency="GBP"),
            500: CardPrice(base=119.95, rush=55.00, currency="GBP"),
            1000: CardPrice(base=164.95, rush=55.00, currency="GBP"),
        },
        "programs": {
            50: CardPrice(base=74.95, rush=55.00, currency="GBP"),
            100: CardPrice(base=104.95, rush=55.00, currency="GBP"),
            250: CardPrice(base=149.95, rush=55.00, currency="GBP"),
            500: CardPrice(base=199.95, rush=55.00, currency="GBP"),
            1000: CardPrice(base=289.95, rush=55.00, currency="GBP"),
        },
    },
}


# Per-country add-on prices. Rush used to live here as a flat per-country
# fee — it's now per-tier (CardPrice.rush) since tented-name-cards has
# varying rush by tier and the other types fit naturally into the same
# shape with one rush value across all their tiers.
ADDONS: Dict[str, Dict[str, float]] = {
    "remove_branding": {"US": 12.00, "GB": 10.00},
}


# Flat shipping rate per country.
SHIPPING: Dict[str, Tuple[float, str]] = {
    "US": (9.95, "USD"),
    "GB": (6.95, "GBP"),
}


# Stock / finish / color-spec multipliers (applied to the card base).
PAPER_STOCK_MULTIPLIERS = {
    "14PT C2S": 1.00,
    "14PT Uncoated": 1.00,
    "16PT C2S": 1.15,
    "18PT C1S": 1.25,
    "100LB Cover Linen": 1.30,
}

FINISH_MULTIPLIERS = {
    "No coating": 1.00,
    "UV Front": 1.12,
    "Matte": 1.10,
    "Aqueous": 1.08,
    "Satin Aqueous": 1.10,
}

COLOR_SPEC_MULTIPLIERS = {
    "4/0": 0.75,
    "4/1": 0.85,
    "4/4": 1.00,
}


SUPPORTED_COUNTRIES = ("US", "GB")
DEFAULT_COUNTRY = "GB"  # UK default per the 2026-05-16 launch decision


def _nearest_tier(country: str, content_type: str, quantity: int) -> Tuple[int, CardPrice]:
    """Round the quantity up to the smallest tier that fits.

    Raises ValueError if quantity exceeds the largest defined tier —
    orders past the price list need a manual quote, not silent capping
    that would underprice the order.
    """
    tiers = PRINT_PRICING[country][content_type]
    for tier_qty in sorted(tiers.keys()):
        if quantity <= tier_qty:
            return tier_qty, tiers[tier_qty]
    largest = max(tiers.keys())
    raise ValueError(
        f"Orders of {quantity} {content_type} exceed the maximum supported "
        f"tier of {largest} in {country}. Please contact us for a custom quote."
    )


def quote_card_base(
    *,
    country: str,
    content_type: str,
    quantity: int,
    paper_stock: str,
    finish: str,
    color_spec: str,
) -> Tuple[int, float, float, str]:
    """Compute the base card price and rush surcharge for the chosen tier.

    Returns: (quantity_tier_charged, base_price, rush_surcharge, currency).
    `rush_surcharge` is the flat USD/GBP amount added on top when the
    customer chose rush; caller applies the addition if the rush flag is on.

    Raises KeyError if country / content_type isn't in the price list.
    Raises ValueError if quantity exceeds the largest tier (see _nearest_tier).
    """
    if country not in PRINT_PRICING:
        raise KeyError(f"No pricing configured for country {country!r}")
    if content_type not in PRINT_PRICING[country]:
        raise KeyError(f"No pricing for {content_type!r} in {country!r}")

    tier_qty, price = _nearest_tier(country, content_type, quantity)
    base = price.base
    base *= PAPER_STOCK_MULTIPLIERS.get(paper_stock, 1.00)
    base *= FINISH_MULTIPLIERS.get(finish, 1.00)
    base *= COLOR_SPEC_MULTIPLIERS.get(color_spec, 1.00)
    return tier_qty, round(base, 2), price.rush, price.currency


def addon_price(name: str, country: str) -> float:
    """Returns the addon price in the country's currency (0 if missing)."""
    return ADDONS.get(name, {}).get(country, 0.0)


def shipping_price(country: str) -> Tuple[float, str]:
    """Returns (amount, currency_iso_4217) for shipping to this country."""
    return SHIPPING.get(country, (0.0, "USD"))
