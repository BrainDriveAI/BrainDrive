"""
Schemas for AI providers.
"""
from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field


class ProviderConfig(BaseModel):
    """Configuration for an AI provider."""
    provider: str = Field(..., description="Provider type (e.g., 'ollama', 'openai')")
    instance_id: str = Field(..., description="Instance ID")
    config: Dict[str, Any] = Field(..., description="Provider configuration")


class TextGenerationRequest(BaseModel):
    """Request for text generation."""
    provider: str = Field(..., description="Provider type (e.g., 'ollama', 'openai')")
    settings_id: str = Field(..., description="Settings ID (e.g., 'ollama_servers_settings')")
    server_id: str = Field(..., description="Specific server ID to use")
    model: str = Field(..., description="Model to use")
    prompt: str = Field(..., description="Prompt text")
    user_id: Optional[str] = Field(None, description="User ID for access control")
    params: Dict[str, Any] = Field(default_factory=dict, description="Additional parameters")
    stream: bool = Field(False, description="Whether to stream the response")


class ChatMessage(BaseModel):
    """Chat message."""
    role: str = Field(..., description="Message role (system, user, assistant)")
    content: str = Field(..., description="Message content")


class ChatCompletionRequest(BaseModel):
    """Request for chat completion."""
    provider: str = Field(..., description="Provider type (e.g., 'ollama', 'openai')")
    settings_id: str = Field(..., description="Settings ID (e.g., 'ollama_servers_settings')")
    server_id: str = Field(..., description="Specific server ID to use")
    model: str = Field(..., description="Model to use")
    messages: List[ChatMessage] = Field(..., description="Chat messages")
    user_id: Optional[str] = Field(None, description="User ID for access control")
    params: Dict[str, Any] = Field(default_factory=dict, description="Additional parameters")
    stream: bool = Field(False, description="Whether to stream the response")
    conversation_id: Optional[str] = Field(None, description="ID of an existing conversation to continue")
    page_context: Optional[str] = Field(None, description="Context where the conversation is taking place (e.g., 'home', 'editor', 'chatbot_lab')")
    conversation_type: Optional[str] = Field("chat", description="Type/category of the conversation (e.g., 'chat', 'email_reply', 'therapy')")


class ValidationRequest(BaseModel):
    """Request for provider validation."""
    provider: str = Field(..., description="Provider type (e.g., 'ollama', 'openai')")
    config: Dict[str, Any] = Field(..., description="Provider configuration")


class ProviderSettingRequest(BaseModel):
    """Request for creating or updating a provider setting."""
    provider: str = Field(..., description="Provider type (e.g., 'ollama', 'openai')")
    instance_id: str = Field(..., description="Instance ID")
    name: str = Field(..., description="Display name")
    config: Dict[str, Any] = Field(..., description="Provider configuration")
