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

    model_config = {"from_attributes": True}
