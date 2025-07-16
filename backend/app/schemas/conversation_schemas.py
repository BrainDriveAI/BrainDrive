from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from uuid import UUID
from app.schemas.tag_schemas import Tag
from app.schemas.persona import PersonaResponse

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
    page_id: Optional[str] = Field(None, description="ID of the page this conversation belongs to")
    model: Optional[str] = Field(None, description="LLM model used for the conversation")
    server: Optional[str] = Field(None, description="Server used for the conversation")
    conversation_type: Optional[str] = Field("chat", description="Type/category of the conversation (e.g., 'chat', 'email_reply', 'therapy')")
    persona_id: Optional[str] = Field(None, description="ID of the persona used in this conversation")


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


class ConversationWithPersona(Conversation):
    """Schema for conversation data with full persona details"""
    persona: Optional[PersonaResponse] = Field(None, description="Persona used in this conversation")
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
                "title": "AI Assistant Chat",
                "page_context": "chat",
                "page_id": "page123456789",
                "model": "gpt-4",
                "server": "openai",
                "conversation_type": "chat",
                "persona_id": "persona123456789",
                "user_id": "user123456789",
                "created_at": "2025-01-11T08:00:00Z",
                "updated_at": "2025-01-11T08:30:00Z",
                "tags": [],
                "persona": {
                    "id": "persona123456789",
                    "name": "Helpful Assistant",
                    "description": "A friendly and helpful AI assistant",
                    "system_prompt": "You are a helpful AI assistant...",
                    "model_settings": {
                        "temperature": 0.7,
                        "top_p": 0.9
                    },
                    "avatar": "assistant-icon",
                    "tags": ["helpful", "friendly"],
                    "sample_greeting": "Hello! How can I help you today?",
                    "is_active": True,
                    "user_id": "user123456789",
                    "created_at": "2025-01-10T08:00:00Z",
                    "updated_at": "2025-01-10T08:00:00Z"
                }
            }
        }
