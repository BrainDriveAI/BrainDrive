from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from uuid import UUID
from app.schemas.tag_schemas import Tag

# Message schemas
class MessageBase(BaseModel):
    sender: str = Field(..., description="Sender of the message ('user' or 'llm')")
    message: str = Field(..., description="Content of the message")
    message_metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata for the message")


class MessageCreate(MessageBase):
    pass


class MessageInDB(MessageBase):
    id: str
    conversation_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Message(MessageInDB):
    pass


# Conversation schemas
class ConversationBase(BaseModel):
    title: Optional[str] = Field(None, description="Title of the conversation")
    page_context: Optional[str] = Field(None, description="Context where the conversation was created")
    model: Optional[str] = Field(None, description="LLM model used for the conversation")
    server: Optional[str] = Field(None, description="Server used for the conversation")
    conversation_type: Optional[str] = Field("chat", description="Type/category of the conversation (e.g., 'chat', 'email_reply', 'therapy')")


class ConversationCreate(ConversationBase):
    user_id: str = Field(..., description="ID of the user who owns the conversation")


class ConversationUpdate(ConversationBase):
    pass


class ConversationInDB(ConversationBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Conversation(ConversationInDB):
    tags: List[Tag] = Field(default_factory=list, description="Tags associated with the conversation")


class ConversationWithMessages(Conversation):
    messages: List[Message] = Field(default_factory=list, description="Messages in the conversation")
