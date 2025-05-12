from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, UUID4, Field
from app.schemas.user import UserBase
from app.schemas.navigation import NavigationRouteResponse

class PageBase(BaseModel):
    name: str
    route: str
    route_segment: Optional[str] = None
    parent_route: Optional[str] = None
    parent_type: Optional[str] = "page"
    is_parent_page: Optional[bool] = False
    description: Optional[str] = None
    icon: Optional[str] = None
    navigation_route_id: Optional[UUID4] = None

class PageCreate(PageBase):
    content: Dict[str, Any]

class PageUpdate(BaseModel):
    name: Optional[str] = None
    route: Optional[str] = None
    route_segment: Optional[str] = None
    parent_route: Optional[str] = None
    parent_type: Optional[str] = None
    is_parent_page: Optional[bool] = None
    content: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    navigation_route_id: Optional[UUID4] = Field(default=None, description="Can be explicitly set to null")
    is_published: Optional[bool] = None

class PageBackup(BaseModel):
    create_backup: bool = True

class PagePublish(BaseModel):
    publish: bool

class PageResponse(PageBase):
    id: UUID4
    content: Dict[str, Any]
    creator_id: UUID4
    is_published: bool
    created_at: datetime
    updated_at: datetime
    publish_date: Optional[datetime] = None
    backup_date: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class PageDetailResponse(PageResponse):
    content_backup: Optional[Dict[str, Any]] = None
    creator: Optional[UserBase] = None
    navigation_route: Optional[NavigationRouteResponse] = None

class PageHierarchyUpdate(BaseModel):
    parent_route: Optional[str] = None
    parent_type: Optional[str] = None
    route_segment: Optional[str] = None
    is_parent_page: Optional[bool] = None

class PageListResponse(BaseModel):
    pages: List[PageResponse]
    total: int
