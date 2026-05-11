from typing import Optional

from pydantic import BaseModel


class TableCreate(BaseModel):
    name: str
    shape: str = "round"
    width: float = 120.0
    height: float = 120.0
    capacity: int = 8
    x_position: float = 0.0
    y_position: float = 0.0
    rotation: float = 0.0


class TableUpdate(BaseModel):
    name: Optional[str] = None
    shape: Optional[str] = None
    width: Optional[float] = None
    height: Optional[float] = None
    capacity: Optional[int] = None
    x_position: Optional[float] = None
    y_position: Optional[float] = None
    rotation: Optional[float] = None


class TableResponse(BaseModel):
    id: int
    event_id: int
    name: str
    shape: str
    width: float
    height: float
    capacity: int
    x_position: float
    y_position: float
    rotation: float

    model_config = {"from_attributes": True}
