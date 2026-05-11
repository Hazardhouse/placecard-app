from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

from app.schemas.attendee import AttendeeResponse
from app.schemas.table import TableResponse


class SeatAssignmentCreate(BaseModel):
    attendee_id: int
    table_id: int
    seat_number: int


class SeatAssignmentResponse(BaseModel):
    id: int
    arrangement_id: int
    attendee_id: int
    table_id: int
    seat_number: int
    attendee: Optional[AttendeeResponse] = None
    table: Optional[TableResponse] = None

    model_config = {"from_attributes": True}


class SeatingArrangementCreate(BaseModel):
    name: str


class SeatingArrangementUpdate(BaseModel):
    name: Optional[str] = None


class SeatingArrangementResponse(BaseModel):
    id: int
    event_id: int
    name: str
    created_at: datetime
    seat_assignments: List[SeatAssignmentResponse] = []

    model_config = {"from_attributes": True}
