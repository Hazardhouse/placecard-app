"""
Google Places API proxy — keeps the API key server-side.
Provides location autocomplete and nearby venue search.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Query

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
