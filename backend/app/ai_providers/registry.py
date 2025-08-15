"""
Registry for AI providers.
"""
from typing import Dict, Type, List, Any
from .base import AIProvider
from .ollama import OllamaProvider
from .openai import OpenAIProvider
from .openrouter import OpenRouterProvider
from .claude import ClaudeProvider
from .groq import GroqProvider


from .openrouter import OpenRouterProvider

class AIProviderRegistry:
    """Registry for AI providers."""
    
    def __init__(self):
        self._providers: Dict[str, Type[AIProvider]] = {}
        self._instances: Dict[str, Dict[str, AIProvider]] = {}
        
        # Register built-in providers
        self.register_provider("ollama", OllamaProvider)
        self.register_provider("openai", OpenAIProvider)
        self.register_provider("claude", ClaudeProvider)
        self.register_provider("groq", GroqProvider)

        self.register_provider("openrouter", OpenRouterProvider)
    
    def register_provider(self, name: str, provider_class: Type[AIProvider]) -> None:
        """Register a new provider class."""
        self._providers[name] = provider_class
        self._instances[name] = {}
    
    async def get_provider(self, name: str, instance_id: str, config: Dict[str, Any]) -> AIProvider:
        """Get or create a provider instance."""
        if name not in self._providers:
            raise ValueError(f"Provider '{name}' not registered")
        
        # Create a unique instance key
        instance_key = f"{instance_id}"
        
        # Check if instance exists
        if instance_key in self._instances[name]:
            return self._instances[name][instance_key]
        
        # Create new instance
        provider = self._providers[name]()
        await provider.initialize(config)
        self._instances[name][instance_key] = provider
        
        return provider
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider types."""
        return list(self._providers.keys())

# Create a global instance of the registry
provider_registry = AIProviderRegistry()
