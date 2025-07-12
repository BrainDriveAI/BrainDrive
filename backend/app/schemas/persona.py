from typing import Optional, Dict, Any, List
from pydantic import BaseModel, constr, Field
from datetime import datetime


class PersonaBase(BaseModel):
    """Base schema for persona data that's common across requests"""
    
    name: constr(min_length=1, max_length=100)  # type: ignore
    description: Optional[str] = None
    system_prompt: constr(min_length=1)  # type: ignore
    model_settings: Optional[Dict[str, Any]] = None
    avatar: Optional[str] = None
    tags: Optional[List[str]] = None
    sample_greeting: Optional[str] = None
    is_active: bool = True


class PersonaCreate(PersonaBase):
    """Schema for persona creation requests"""
    
    class Config:
        json_schema_extra = {
            "example": {
                "name": "Cyberpunk Hacker",
                "description": "A sarcastic but helpful cyberpunk hacker mentor",
                "system_prompt": "You are a helpful but sarcastic cyberpunk hacker mentor. You have extensive knowledge of computer systems, networks, and security. You speak with attitude but always provide accurate technical information.",
                "model_settings": {
                    "temperature": 0.8,
                    "top_p": 0.9,
                    "frequency_penalty": 0.1,
                    "presence_penalty": 0.1,
                    "context_window": 4000,
                    "stop_sequences": ["Human:", "Assistant:"]
                },
                "avatar": "hacker-icon",
                "tags": ["technical", "sarcastic", "cyberpunk", "mentor"],
                "sample_greeting": "Well, well, well... another newbie looking for help. What's broken now?",
                "is_active": True
            }
        }


class PersonaUpdate(BaseModel):
    """Schema for persona update requests"""
    
    name: Optional[constr(min_length=1, max_length=100)] = None  # type: ignore
    description: Optional[str] = None
    system_prompt: Optional[constr(min_length=1)] = None  # type: ignore
    model_settings: Optional[Dict[str, Any]] = None
    avatar: Optional[str] = None
    tags: Optional[List[str]] = None
    sample_greeting: Optional[str] = None
    is_active: Optional[bool] = None


class PersonaInDB(PersonaBase):
    """Schema for persona data as stored in the database"""
    
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PersonaResponse(BaseModel):
    """Schema for persona data in responses"""
    
    id: str
    name: str
    description: Optional[str] = None
    system_prompt: str
    model_settings: Optional[Dict[str, Any]] = None
    avatar: Optional[str] = None
    tags: Optional[List[str]] = None
    sample_greeting: Optional[str] = None
    is_active: bool
    user_id: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
                "name": "Cyberpunk Hacker",
                "description": "A sarcastic but helpful cyberpunk hacker mentor",
                "system_prompt": "You are a helpful but sarcastic cyberpunk hacker mentor...",
                "model_settings": {
                    "temperature": 0.8,
                    "top_p": 0.9,
                    "frequency_penalty": 0.1,
                    "presence_penalty": 0.1,
                    "context_window": 4000,
                    "stop_sequences": ["Human:", "Assistant:"]
                },
                "avatar": "hacker-icon",
                "tags": ["technical", "sarcastic", "cyberpunk", "mentor"],
                "sample_greeting": "Well, well, well... another newbie looking for help. What's broken now?",
                "is_active": True,
                "user_id": "user123456789",
                "created_at": "2025-01-10T08:00:00Z",
                "updated_at": "2025-01-10T08:00:00Z"
            }
        }


class PersonaListResponse(BaseModel):
    """Schema for paginated persona list responses"""
    
    personas: List[PersonaResponse]
    total_items: int
    page: int
    page_size: int
    total_pages: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "personas": [],
                "total_items": 15,
                "page": 1,
                "page_size": 20,
                "total_pages": 1
            }
        }


class ModelSettings(BaseModel):
    """Schema for model settings validation"""
    
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0, description="Controls randomness (0.0-2.0)")
    top_p: Optional[float] = Field(None, ge=0.0, le=1.0, description="Controls nucleus sampling (0.0-1.0)")
    frequency_penalty: Optional[float] = Field(None, ge=-2.0, le=2.0, description="Reduces repetition (-2.0-2.0)")
    presence_penalty: Optional[float] = Field(None, ge=-2.0, le=2.0, description="Reduces repetition (-2.0-2.0)")
    context_window: Optional[int] = Field(None, gt=0, description="Context window size (positive integer)")
    stop_sequences: Optional[List[str]] = Field(None, description="Stop sequences for generation")
    
    class Config:
        json_schema_extra = {
            "example": {
                "temperature": 0.8,
                "top_p": 0.9,
                "frequency_penalty": 0.1,
                "presence_penalty": 0.1,
                "context_window": 4000,
                "stop_sequences": ["Human:", "Assistant:"]
            }
        }
