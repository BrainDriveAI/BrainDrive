from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field
from uuid import UUID


class TagBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: Optional[str] = Field(None, pattern=r'^#[0-9A-Fa-f]{6}$')  # Hex color validation


class TagCreate(TagBase):
    user_id: str


class TagUpdate(TagBase):
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    color: Optional[str] = None


class TagInDB(TagBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Tag(TagInDB):
    pass


class ConversationTagCreate(BaseModel):
    tag_id: str


class ConversationWithTags(BaseModel):
    id: str
    title: Optional[str] = None
    page_context: Optional[str] = None
    created_at: datetime
    model: Optional[str] = None
    server: Optional[str] = None
    tags: List[Tag] = []

    class Config:
        from_attributes = True
