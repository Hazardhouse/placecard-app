from datetime import datetime
from typing import Dict, Optional

from pydantic import BaseModel


class AttendeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    dietary_requirements: Optional[str] = None
    responses: Optional[Dict[str, str]] = None
    notes: Optional[str] = None
    rsvp_status: str = "pending"


class AttendeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    dietary_requirements: Optional[str] = None
    responses: Optional[Dict[str, str]] = None
    notes: Optional[str] = None
    rsvp_status: Optional[str] = None


class AttendeeResponse(BaseModel):
    id: int
    event_id: int
    name: str
    email: Optional[str]
    phone: Optional[str]
    country: Optional[str]
    dietary_requirements: Optional[str]
    responses: Optional[Dict[str, str]]
    notes: Optional[str]
    rsvp_status: str
    google_form_response_id: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}
