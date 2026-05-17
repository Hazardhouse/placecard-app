from typing import List, Optional

from pydantic import BaseModel


class SalonResponse(BaseModel):
    """Salon row shape used by listings + the salon detail page."""
    id: int
    host_user_id: str
    slug: str
    name: str
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    visibility: str  # 'public' | 'unlisted' | 'private'
    join_mode: str  # 'closed' | 'request_to_join' | 'open'
    created_at: str
    # Convenience counts for cards / list views — saves the client a
    # separate request.
    event_count: int = 0


class SalonCreateRequest(BaseModel):
    name: str
    slug: Optional[str] = None  # auto-generated from name when omitted
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    visibility: Optional[str] = "public"
    join_mode: Optional[str] = "request_to_join"


class SalonUpdateRequest(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    visibility: Optional[str] = None
    join_mode: Optional[str] = None


class SalonEventSummary(BaseModel):
    """Event row shape for /@handle/salon-slug — same fields as the
    profile's hosted-events list, just scoped to one salon.
    """
    id: int
    name: str
    public_token: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    image_data: Optional[str] = None


class SalonDetailResponse(SalonResponse):
    """Public salon detail — adds the host's display name + handle so
    the salon page can show "Hosted by @dani" without a second lookup,
    plus the list of events in this salon.
    """
    host_handle: str
    host_display_name: str
    host_photo_url: Optional[str] = None
    events: List[SalonEventSummary] = []
