from typing import Optional
from pydantic import BaseModel
from datetime import datetime
from uuid import UUID

class ComponentBase(BaseModel):
    name: str
    component_id: str
    description: Optional[str] = None
    icon: Optional[str] = None
    is_system: Optional[bool] = False
    user_id: str

class ComponentCreate(ComponentBase):
    pass

class ComponentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None

class ComponentResponse(ComponentBase):
    id: UUID
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    user_id: str

    class Config:
        from_attributes = True
