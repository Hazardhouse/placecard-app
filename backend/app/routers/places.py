"""
Google Places API proxy — keeps the API key server-side.
Provides location autocomplete, nearby venue search, and static map images.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.config import settings

router = APIRouter(prefix="/api/places", tags=["places"])


@router.get("/autocomplete")
async def autocomplete(
    q: str = Query(..., min_length=2),
    types: Optional[str] = Query(None),
):
    """
    Proxy for Google Places Autocomplete.
    types: e.g. "geocode", "establishment", "address"
    """
    if not settings.google_places_api_key:
        return {"predictions": []}

    params = {
        "input": q,
        "key": settings.google_places_api_key,
    }
    if types:
        params["types"] = types

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://maps.googleapis.com/maps/api/place/autocomplete/json",
            params=params,
            timeout=10,
        )

    data = resp.json()
    predictions = [
        {
            "place_id": p["place_id"],
            "description": p["description"],
            "main_text": p.get("structured_formatting", {}).get("main_text", ""),
            "secondary_text": p.get("structured_formatting", {}).get("secondary_text", ""),
        }
        for p in data.get("predictions", [])
    ]
    return {"predictions": predictions}


@router.get("/nearby")
async def nearby_venues(
    location: str = Query(..., min_length=2),
    type: Optional[str] = Query("restaurant|bar|cafe|hotel", description="Place types"),
):
    """
    Search for venues near a location.
    First geocodes the location, then searches nearby.
    """
    if not settings.google_places_api_key:
        return {"results": []}

    async with httpx.AsyncClient() as client:
        # Step 1: Geocode the location to get lat/lng
        geo_resp = await client.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": location, "key": settings.google_places_api_key},
            timeout=10,
        )
        geo_data = geo_resp.json()
        if not geo_data.get("results"):
            return {"results": []}

        lat_lng = geo_data["results"][0]["geometry"]["location"]
        lat, lng = lat_lng["lat"], lat_lng["lng"]

        # Step 2: Search nearby places
        nearby_resp = await client.get(
            "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
            params={
                "location": f"{lat},{lng}",
                "radius": 2000,
                "type": type,
                "key": settings.google_places_api_key,
            },
            timeout=10,
        )
        nearby_data = nearby_resp.json()

    results = [
        {
            "place_id": r["place_id"],
            "name": r["name"],
            "address": r.get("vicinity", ""),
            "types": r.get("types", []),
            "rating": r.get("rating"),
        }
        for r in nearby_data.get("results", [])[:15]
    ]
    return {"results": results}


@router.get("/static-map")
async def static_map(
    q: str = Query(..., min_length=2, description="Address / venue to render"),
    width: int = Query(600, ge=100, le=1280),
    height: int = Query(300, ge=100, le=720),
    zoom: int = Query(15, ge=1, le=21),
):
    """Proxy a Google Static Maps PNG for the given query.

    Keeps the API key server-side. Browser caches the response for 24h
    via Cache-Control so a typical page view only hits Google once per
    venue per day. Returns 503 when the key isn't configured so the
    frontend can hide the map card gracefully.
    """
    if not settings.google_places_api_key:
        raise HTTPException(status_code=503, detail="Maps not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://maps.googleapis.com/maps/api/staticmap",
            params={
                "center": q,
                "zoom": str(zoom),
                "size": f"{width}x{height}",
                "scale": "2",  # retina-friendly
                "maptype": "roadmap",
                "markers": f"color:0x1b4fff|{q}",
                "key": settings.google_places_api_key,
            },
            timeout=15,
        )

    # Google returns 200 + an image even when the address can't be
    # geocoded (renders a generic world map). Pass through whatever it
    # gave us — falling back to a hard error here would over-aggressively
    # hide maps for venues with quirky spellings.
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Map service unavailable")

    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/png"),
        headers={"Cache-Control": "public, max-age=86400"},
    )
