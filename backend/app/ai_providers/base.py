"""
Base class for AI providers.
"""
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional, AsyncGenerator


class AIProvider(ABC):
    """Base class for all AI providers."""
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the name of the provider."""
        pass
    
    @abstractmethod
    async def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the provider with configuration."""
        pass
    
    @abstractmethod
    async def get_models(self) -> List[Dict[str, Any]]:
        """Get available models from the provider."""
        pass
    
    @abstractmethod
    async def generate_text(self, prompt: str, model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Generate text from a prompt."""
        pass
    
    @abstractmethod
    async def generate_stream(self, prompt: str, model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """Generate streaming text from a prompt."""
        pass
    
    @abstractmethod
    async def chat_completion(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a chat completion."""
        pass
    
    @abstractmethod
    async def chat_completion_stream(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """Generate a streaming chat completion."""
        pass
    
    @abstractmethod
    async def validate_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate connection to the provider."""
        pass
