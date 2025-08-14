from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, UUID4, Field, validator
from uuid import UUID
from app.schemas.user import UserBase

class NavigationRouteBase(BaseModel):
    name: str
    route: str
    icon: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = 0
    is_visible: Optional[bool] = True
    is_system_route: Optional[bool] = False
    default_component_id: Optional[str] = None
    default_page_id: Optional[UUID] = Field(default=None, description="Can be null to clear the default page")
    can_change_default: Optional[bool] = False
    
    # Hierarchical fields
    parent_id: Optional[str] = None
    display_order: Optional[int] = 0
    is_collapsible: Optional[bool] = True
    is_expanded: Optional[bool] = True
    
    @validator('default_page_id', pre=True)
    def validate_default_page_id(cls, v):
        if v is None or v == "":
            return None
        return v

class NavigationRouteCreate(NavigationRouteBase):
    @validator('default_page_id', pre=True)
    def validate_default_page_id(cls, v):
        if v is None or v == "":
            return None
        return v
from pydantic import Field, validator

class NavigationRouteUpdate(BaseModel):
    name: Optional[str] = None
    route: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    order: Optional[int] = None
    is_visible: Optional[bool] = None
    default_component_id: Optional[str] = None
    default_page_id: Optional[UUID] = Field(default=None, description="Can be null to clear the default page")
    can_change_default: Optional[bool] = None
    parent_id: Optional[str] = None
    display_order: Optional[int] = None
    is_collapsible: Optional[bool] = None
    is_expanded: Optional[bool] = None
    # Note: is_system_route should not be updatable
    
    @validator('default_page_id', pre=True)
    def validate_default_page_id(cls, v):
        if v is None or v == "":
            return None
        return v
    
    class Config:
        # Allow conversion from string to UUID for default_page_id
        json_encoders = {
            UUID: lambda v: str(v)
        }
        # Allow null values for default_page_id
        extra = "allow"
        validate_assignment = True

class NavigationRouteResponse(NavigationRouteBase):
    id: str
    creator_id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True

class NavigationRouteDetailResponse(NavigationRouteResponse):
    creator: Optional[dict] = None
    pages: Optional[List[str]] = None

class NavigationRouteTree(NavigationRouteResponse):
    children: Optional[List['NavigationRouteTree']] = []
    depth_level: Optional[int] = 0

class NavigationRouteMove(BaseModel):
    parent_id: Optional[str] = None
    display_order: Optional[int] = None

class NavigationRouteBatchUpdate(BaseModel):
    id: str
    parent_id: Optional[str] = None
    display_order: Optional[int] = None
    is_expanded: Optional[bool] = None

class NavigationRouteListResponse(BaseModel):
    routes: List[NavigationRouteResponse]
    total: int

# Enable forward references for NavigationRouteTree
NavigationRouteTree.model_rebuild()
