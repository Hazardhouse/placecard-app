from typing import List, Optional

from pydantic import BaseModel


class ProfileResponse(BaseModel):
    """Shape returned by GET /api/profiles/me and /handle/{h}."""
    user_id: str
    handle: str
    display_name: str
    photo_url: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    visibility: str  # 'public' | 'unlisted' | 'private'
    created_at: str


class HostedEventSummary(BaseModel):
    """Slim event row for the public profile's hosted-events list."""
    id: int
    name: str
    public_token: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    image_data: Optional[str] = None
    # Phase I-A has no event-level visibility yet; everything the
    # host has created is treated as listed. is_private is here so
    # the frontend renders the greyed-out variant once the column
    # ships in Phase I-B.
    is_private: bool = False


class PublicProfileResponse(ProfileResponse):
    """Public profile + the visible events the user has hosted.
    For private profiles, the route returns 404 instead.
    """
    hosted_events: List[HostedEventSummary] = []


class ProfileUpdateRequest(BaseModel):
    """All fields optional — only provided ones are persisted. Handle
    edits go through the same validation as new-handle requests.
    """
    display_name: Optional[str] = None
    handle: Optional[str] = None
    bio: Optional[str] = None
    city: Optional[str] = None
    visibility: Optional[str] = None  # 'public' | 'unlisted' | 'private'


class ProfilePhotoUploadRequest(BaseModel):
    image_b64: str
    mime_type: str  # e.g. 'image/jpeg', 'image/png', 'image/webp'


class ProfilePhotoUploadResponse(BaseModel):
    photo_url: str


class HandleAvailabilityResponse(BaseModel):
    available: bool
    reason: Optional[str] = None
