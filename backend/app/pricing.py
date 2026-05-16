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
    currency: str  # 'USD' or 'GBP'


# Card base prices keyed by country → content_type → quantity tier.
# Quantity tiers are inclusive ceilings: a quantity of 75 rounds up
# to the 100 tier and is priced as 100 cards.
PRINT_PRICING: Dict[str, Dict[str, Dict[int, CardPrice]]] = {
    "US": {
        "tented-name-cards": {
            50: CardPrice(base=59.95, currency="USD"),
            100: CardPrice(base=79.95, currency="USD"),
            250: CardPrice(base=119.95, currency="USD"),
            500: CardPrice(base=159.95, currency="USD"),
            1000: CardPrice(base=219.95, currency="USD"),
            2500: CardPrice(base=349.95, currency="USD"),
            5000: CardPrice(base=549.95, currency="USD"),
        },
        "name-cards": {
            50: CardPrice(base=49.95, currency="USD"),
            100: CardPrice(base=64.95, currency="USD"),
            250: CardPrice(base=99.95, currency="USD"),
            500: CardPrice(base=139.95, currency="USD"),
            1000: CardPrice(base=189.95, currency="USD"),
        },
        "programs": {
            50: CardPrice(base=89.95, currency="USD"),
            100: CardPrice(base=119.95, currency="USD"),
            250: CardPrice(base=169.95, currency="USD"),
            500: CardPrice(base=229.95, currency="USD"),
            1000: CardPrice(base=329.95, currency="USD"),
        },
    },
    "GB": {
        # ── PLACEHOLDER — replace with your UK printer's actual rates ──
        # Numbers below are rough conversions from the US tier; fix
        # before launch once you've agreed terms with the UK printer.
        "tented-name-cards": {
            50: CardPrice(base=49.95, currency="GBP"),
            100: CardPrice(base=69.95, currency="GBP"),
            250: CardPrice(base=99.95, currency="GBP"),
            500: CardPrice(base=139.95, currency="GBP"),
            1000: CardPrice(base=189.95, currency="GBP"),
        },
        "name-cards": {
            50: CardPrice(base=39.95, currency="GBP"),
            100: CardPrice(base=54.95, currency="GBP"),
            250: CardPrice(base=84.95, currency="GBP"),
            500: CardPrice(base=119.95, currency="GBP"),
            1000: CardPrice(base=164.95, currency="GBP"),
        },
        "programs": {
            50: CardPrice(base=74.95, currency="GBP"),
            100: CardPrice(base=104.95, currency="GBP"),
            250: CardPrice(base=149.95, currency="GBP"),
            500: CardPrice(base=199.95, currency="GBP"),
            1000: CardPrice(base=289.95, currency="GBP"),
        },
    },
}


# Per-country add-on prices.
ADDONS: Dict[str, Dict[str, float]] = {
    "rush": {"US": 60.00, "GB": 55.00},
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
    """Round the quantity up to the smallest tier that fits."""
    tiers = PRINT_PRICING[country][content_type]
    for tier_qty in sorted(tiers.keys()):
        if quantity <= tier_qty:
            return tier_qty, tiers[tier_qty]
    largest = max(tiers.keys())
    return largest, tiers[largest]


def quote_card_base(
    *,
    country: str,
    content_type: str,
    quantity: int,
    paper_stock: str,
    finish: str,
    color_spec: str,
) -> Tuple[int, float, str]:
    """Compute the base card price (no rush / branding / shipping).

    Returns: (quantity_tier_charged, base_price, currency).
    Raises KeyError if country / content_type isn't in the price list.
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
    return tier_qty, round(base, 2), price.currency


def addon_price(name: str, country: str) -> float:
    """Returns the addon price in the country's currency (0 if missing)."""
    return ADDONS.get(name, {}).get(country, 0.0)


def shipping_price(country: str) -> Tuple[float, str]:
    """Returns (amount, currency_iso_4217) for shipping to this country."""
    return SHIPPING.get(country, (0.0, "USD"))
