from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class EventCreate(BaseModel):
    name: str
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    venue_type: Optional[str] = None
    event_category: Optional[str] = None
    description: Optional[str] = None
    # Hero image data URL — frontend resizes/compresses to a JPEG data URL
    # before submit. Without this field declared, Pydantic silently dropped
    # the image on POST while PATCH (which uses EventUpdate) saved it, so
    # uploads during Create Event never made it to the next screen.
    image_data: Optional[str] = None
    # Optional Salon membership at create time. Null = standalone event.
    salon_id: Optional[int] = None


class EventUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    venue_type: Optional[str] = None
    event_category: Optional[str] = None
    description: Optional[str] = None
    image_data: Optional[str] = None
    # Pass null to detach from a salon; an int to attach/move.
    salon_id: Optional[int] = None


class EventResponse(BaseModel):
    id: int
    name: str
    start_date: Optional[datetime]
    end_date: Optional[datetime]
    location: Optional[str]
    venue: Optional[str]
    venue_type: Optional[str] = None
    event_category: Optional[str] = None
    description: Optional[str]
    created_at: datetime
    attendee_count: int = 0
    public_token: Optional[str] = None
    image_data: Optional[str] = None
    salon_id: Optional[int] = None
    # Display label for the workspace this event belongs to. Frontend
    # uses it to render a workspace tag on cards when the caller has
    # access to events from more than one workspace (invited member
    # case). Empty string when the event has no workspace stamp yet.
    workspace_name: Optional[str] = None

    model_config = {"from_attributes": True}
