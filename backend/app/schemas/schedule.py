from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class MealOptions(BaseModel):
    """Course → list of available options. Empty arrays are allowed (no options
    for that course). When all arrays are empty the whole object is effectively
    unused."""
    entrees: List[str] = []
    mains: List[str] = []
    desserts: List[str] = []
    drinks: List[str] = []


class ScheduleItemCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    venue_name: Optional[str] = None
    venue_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    requires_seating: bool = False
    assigned_to: Optional[str] = None
    assign_notes: Optional[str] = None
    meal_options: Optional[MealOptions] = None
    sort_order: int = 0


class ScheduleItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    venue_name: Optional[str] = None
    venue_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    requires_seating: Optional[bool] = None
    assigned_to: Optional[str] = None
    assign_notes: Optional[str] = None
    meal_options: Optional[MealOptions] = None
    sort_order: Optional[int] = None


class ScheduleItemResponse(BaseModel):
    id: int
    event_id: int
    title: str
    description: Optional[str]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    venue_name: Optional[str]
    venue_type: Optional[str]
    location: Optional[str]
    notes: Optional[str]
    requires_seating: bool
    assigned_to: Optional[str]
    assign_notes: Optional[str]
    meal_options: Optional[MealOptions] = None
    sort_order: int
    created_at: datetime

    model_config = {"from_attributes": True}
