"""
4over print API proxy endpoints.

Provides quote, order, address validation and order status endpoints
that proxy to the 4over API with HMAC-SHA256 authentication and a
configurable markup.
"""

import hashlib
import hmac
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/print", tags=["print"])

# ── Config ──────────────────────────────────────────────────────────

FOUROVER_API_KEY = os.getenv("FOUROVER_API_KEY", "")
FOUROVER_PRIVATE_KEY = os.getenv("FOUROVER_PRIVATE_KEY", "")
FOUROVER_MODE = os.getenv("FOUROVER_MODE", "sandbox")

MARKUP = 0.0  # No markup — price matches NextDayFlyers retail pricing

# Placeholder UUIDs — replace with real values from your 4over account
PRODUCT_UUID = "PLACEHOLDER-PRODUCT-UUID"

RUNSIZE_UUIDS = {
    50: "PLACEHOLDER-RUNSIZE-50",
    100: "PLACEHOLDER-RUNSIZE-100",
    250: "PLACEHOLDER-RUNSIZE-250",
    500: "PLACEHOLDER-RUNSIZE-500",
    1000: "PLACEHOLDER-RUNSIZE-1000",
}

TURNAROUND_UUIDS = {
    4: "PLACEHOLDER-TURNAROUND-4BD",
    7: "PLACEHOLDER-TURNAROUND-7BD",
}

COLORSPEC_UUIDS = {
    "4/0": "PLACEHOLDER-COLORSPEC-4-0",
    "4/1": "PLACEHOLDER-COLORSPEC-4-1",
    "4/4": "PLACEHOLDER-COLORSPEC-4-4",
}

PAPERSTOCK_OPTIONS = [
    "14PT C2S",
    "14PT Uncoated",
    "16PT C2S",
    "18PT C1S",
    "100LB Cover Linen",
]

FINISH_OPTIONS = [
    "No coating",
    "UV Front",
    "Matte",
    "Aqueous",
    "Satin Aqueous",
]


# ── Helpers ─────────────────────────────────────────────────────────

def _base_url() -> str:
    if FOUROVER_MODE == "live":
        return "https://api.4over.com"
    return "https://sandbox-api.4over.com"


def _sign(method: str) -> dict:
    """Return query-string auth params for 4over HMAC-SHA256."""
    private_hash = hashlib.sha256(FOUROVER_PRIVATE_KEY.encode()).hexdigest()
    signature = hmac.new(
        private_hash.encode(),
        method.upper().encode(),
        hashlib.sha256,
    ).hexdigest()
    return {"apikey": FOUROVER_API_KEY, "signature": signature}


def _has_credentials() -> bool:
    return bool(FOUROVER_API_KEY) and bool(FOUROVER_PRIVATE_KEY)


def _nearest_runsize(qty: int) -> str:
    """Pick the smallest runsize UUID that fits the quantity."""
    for threshold in sorted(RUNSIZE_UUIDS.keys()):
        if qty <= threshold:
            return RUNSIZE_UUIDS[threshold]
    # Fall back to largest
    return RUNSIZE_UUIDS[max(RUNSIZE_UUIDS.keys())]


# ── Schemas ─────────────────────────────────────────────────────────

class QuoteRequest(BaseModel):
    quantity: int
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    turnaround_days: int = 7


class QuoteResponse(BaseModel):
    base_price: float
    markup_amount: float
    total_price: float
    per_card_price: float
    quantity: int
    is_mock: bool = False


class ShippingAddress(BaseModel):
    name: str
    company: Optional[str] = ""
    address1: str
    address2: Optional[str] = ""
    city: str
    state: str
    zip: str
    country: str = "US"


class OrderRequest(BaseModel):
    quantity: int
    paper_stock: str = "14PT C2S"
    finish: str = "No coating"
    color_spec: str = "4/4"
    turnaround_days: int = 7
    shipping_address: ShippingAddress
    design_name: str = ""
    event_id: Optional[int] = None


class OrderResponse(BaseModel):
    job_id: str
    status: str
    total_price: float
    is_mock: bool = False


class AddressValidationRequest(BaseModel):
    address1: str
    address2: Optional[str] = ""
    city: str
    state: str
    zip: str
    country: str = "US"


# ── Mock responses ──────────────────────────────────────────────────

# NextDayFlyers fold-over business card pricing (3.5x4" folded).
# Prices are total cost per quantity tier for 14PT C2S, 4/4, no coating,
# standard turnaround. The user's order is rounded UP to the nearest
# available tier (minimum order 50).
NDF_PRICE_TIERS = [
    (50,   59.95),
    (100,  79.95),
    (250,  119.95),
    (500,  159.95),
    (1000, 219.95),
    (2500, 349.95),
    (5000, 549.95),
]


def _nearest_tier(qty: int) -> tuple[int, float]:
    """Return (tier_quantity, base_price) for the smallest tier >= qty."""
    for tier_qty, price in NDF_PRICE_TIERS:
        if qty <= tier_qty:
            return tier_qty, price
    # Above largest tier — use largest
    return NDF_PRICE_TIERS[-1]


def _mock_quote(req: QuoteRequest) -> QuoteResponse:
    """Return pricing aligned with NextDayFlyers fold-over card rates.

    Quantities are rounded up to the nearest order tier (min 50).
    """
    tier_qty, base = _nearest_tier(req.quantity)

    # Paper stock multiplier
    stock_mult = {
        "14PT C2S": 1.0,
        "14PT Uncoated": 1.0,
        "16PT C2S": 1.15,
        "18PT C1S": 1.25,
        "100LB Cover Linen": 1.30,
    }
    base *= stock_mult.get(req.paper_stock, 1.0)

    # Finish surcharge
    finish_mult = {
        "No coating": 1.0,
        "UV Front": 1.12,
        "Matte": 1.10,
        "Aqueous": 1.08,
        "Satin Aqueous": 1.10,
    }
    base *= finish_mult.get(req.finish, 1.0)

    # Color spec
    color_mult = {"4/0": 0.75, "4/1": 0.85, "4/4": 1.0}
    base *= color_mult.get(req.color_spec, 1.0)

    # Rush surcharge
    if req.turnaround_days == 4:
        base *= 1.30

    base = round(base, 2)
    markup_amt = round(base * MARKUP, 2)
    total = round(base + markup_amt, 2)
    per_card = round(total / tier_qty, 2)

    return QuoteResponse(
        base_price=base,
        markup_amount=markup_amt,
        total_price=total,
        per_card_price=per_card,
        quantity=tier_qty,
        is_mock=True,
    )


# ── Endpoints ───────────────────────────────────────────────────────

@router.post("/quote", response_model=QuoteResponse)
async def get_print_quote(req: QuoteRequest):
    """Get a price quote for fold-over name cards."""
    if req.quantity < 1:
        raise HTTPException(400, "Quantity must be at least 1")

    if not _has_credentials():
        return _mock_quote(req)

    runsize_uuid = _nearest_runsize(req.quantity)
    turnaround_uuid = TURNAROUND_UUIDS.get(req.turnaround_days, TURNAROUND_UUIDS[7])
    colorspec_uuid = COLORSPEC_UUIDS.get(req.color_spec, COLORSPEC_UUIDS["4/4"])

    params = {
        "product_uuid": PRODUCT_UUID,
        "runsize_uuid": runsize_uuid,
        "turnaroundtime_uuid": turnaround_uuid,
        "colorspec_uuid": colorspec_uuid,
        **_sign("GET"),
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(f"{_base_url()}/printproducts/productquote", params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        # Fall back to mock on any 4over error
        result = _mock_quote(req)
        result.is_mock = True
        return result

    base_price = float(data.get("price", data.get("total", 0)))
    markup_amt = round(base_price * MARKUP, 2)
    total = round(base_price + markup_amt, 2)
    per_card = round(total / req.quantity, 2) if req.quantity else 0

    return QuoteResponse(
        base_price=base_price,
        markup_amount=markup_amt,
        total_price=total,
        per_card_price=per_card,
        quantity=req.quantity,
        is_mock=False,
    )


@router.post("/order", response_model=OrderResponse)
async def place_print_order(req: OrderRequest):
    """Submit a print order for fold-over name cards."""
    if not _has_credentials():
        return OrderResponse(
            job_id="MOCK-ORDER-12345",
            status="submitted",
            total_price=_mock_quote(
                QuoteRequest(
                    quantity=req.quantity,
                    paper_stock=req.paper_stock,
                    finish=req.finish,
                    color_spec=req.color_spec,
                    turnaround_days=req.turnaround_days,
                )
            ).total_price,
            is_mock=True,
        )

    order_payload = {
        "product_uuid": PRODUCT_UUID,
        "runsize_uuid": _nearest_runsize(req.quantity),
        "turnaroundtime_uuid": TURNAROUND_UUIDS.get(req.turnaround_days, TURNAROUND_UUIDS[7]),
        "colorspec_uuid": COLORSPEC_UUIDS.get(req.color_spec, COLORSPEC_UUIDS["4/4"]),
        "shipping": {
            "name": req.shipping_address.name,
            "company": req.shipping_address.company or "",
            "address1": req.shipping_address.address1,
            "address2": req.shipping_address.address2 or "",
            "city": req.shipping_address.city,
            "state": req.shipping_address.state,
            "zip": req.shipping_address.zip,
            "country": req.shipping_address.country,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_base_url()}/orders",
                params=_sign("POST"),
                json=order_payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(502, f"4over order submission failed: {exc}")

    job_id = str(data.get("job_id", data.get("id", "")))

    # Compute final price with markup
    base_price = float(data.get("price", data.get("total", 0)))
    total = round(base_price * (1 + MARKUP), 2)

    return OrderResponse(
        job_id=job_id,
        status="submitted",
        total_price=total,
        is_mock=False,
    )


@router.post("/validate-address")
async def validate_address(req: AddressValidationRequest):
    """Validate a shipping address via 4over."""
    if not _has_credentials():
        return {"valid": True, "message": "Address validation skipped (no API keys configured)", "is_mock": True}

    payload = {
        "address1": req.address1,
        "address2": req.address2 or "",
        "city": req.city,
        "state": req.state,
        "zip": req.zip,
        "country": req.country,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{_base_url()}/addressvalidation",
                params=_sign("POST"),
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        raise HTTPException(502, f"Address validation failed: {exc}")


@router.get("/order/{job_id}/status")
async def get_order_status(job_id: str):
    """Check the status of a submitted print order."""
    if not _has_credentials():
        return {"job_id": job_id, "status": "processing", "is_mock": True}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_base_url()}/orders/{job_id}/status",
                params=_sign("GET"),
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        raise HTTPException(502, f"Failed to fetch order status: {exc}")
