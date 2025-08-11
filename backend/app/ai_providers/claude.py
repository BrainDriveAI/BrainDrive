"""
Claude provider implementation.
"""
from typing import Dict, List, Any, AsyncGenerator
import anthropic
from .base import AIProvider


class ClaudeProvider(AIProvider):
    """Claude provider implementation."""
    
    @property
    def provider_name(self) -> str:
        return "claude"
    
    async def initialize(self, config: Dict[str, Any]) -> bool:
        """Initialize the provider with configuration."""
        self.api_key = config.get("api_key", "")
        self.server_name = config.get("server_name", "Claude API")
        
        # Initialize the Anthropic client
        self.client = anthropic.AsyncAnthropic(api_key=self.api_key)
        
        # Initialize dynamic model mapping
        self.model_mapping = {}
        await self._build_model_mapping()
        return True
    
    async def _build_model_mapping(self):
        """Build dynamic mapping from display names to model IDs."""
        try:
            models_response = await self.client.models.list()
            for model in models_response.data:
                display_name = model.display_name or model.id
                self.model_mapping[display_name] = model.id
        except Exception as e:
            print(f"Error building model mapping: {e}")
            # Fallback to basic mapping if API call fails
            self.model_mapping = {
                "Claude Sonnet 4": "claude-sonnet-4-20250514",
                "Claude Opus 4": "claude-opus-4-20250514",
                "Claude Sonnet 3.7": "claude-3-7-sonnet-20250219",
                "Claude Sonnet 3.5 (New)": "claude-3-5-sonnet-20241022",
                "Claude Haiku 3.5": "claude-3-5-haiku-20241022",
                "Claude Sonnet 3.5 (Old)": "claude-3-5-sonnet-20240620",
                "Claude Haiku 3": "claude-3-haiku-20240307",
                "Claude Opus 3": "claude-3-opus-20240229"
            }
    
    def _get_model_id(self, model_name: str) -> str:
        """Convert display name to model ID if needed."""
        # If it's already a model ID (contains hyphens and version), return as is
        if "-" in model_name and any(char.isdigit() for char in model_name):
            return model_name
        
        # Otherwise, try to map from display name to model ID
        return self.model_mapping.get(model_name, model_name)
    
    async def get_models(self) -> List[Dict[str, Any]]:
        """Get available models from Claude."""
        try:
            # Use Anthropic's models.list() endpoint to get available models dynamically
            models_response = await self.client.models.list()
            
            # Convert the response to our standard format
            models = []
            for model in models_response.data:
                models.append({
                    "id": model.id,
                    "name": model.display_name or model.id,
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "created_at": model.created_at.isoformat() if model.created_at else None,
                        "description": f"Claude model: {model.id}"
                    }
                })
            
            return models
        except Exception as e:
            # If the API call fails, return a basic set of known models as fallback
            print(f"Error fetching models from Anthropic API: {e}")
            return [
                {
                    "id": "claude-3-5-sonnet-20241022",
                    "name": "Claude 3.5 Sonnet 2024-10-22",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Most capable model for complex tasks"
                    }
                },
                {
                    "id": "claude-3-5-sonnet",
                    "name": "Claude 3.5 Sonnet",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Most capable model for complex tasks"
                    }
                },
                {
                    "id": "claude-3-5-haiku",
                    "name": "Claude 3.5 Haiku",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Fast and efficient for simple tasks"
                    }
                },
                {
                    "id": "claude-3-opus-20240229",
                    "name": "Claude 3 Opus",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Most powerful model for advanced reasoning"
                    }
                },
                {
                    "id": "claude-3-sonnet-20240229",
                    "name": "Claude 3 Sonnet",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Balanced model for general use"
                    }
                },
                {
                    "id": "claude-3-haiku-20240307",
                    "name": "Claude 3 Haiku",
                    "provider": "claude",
                    "metadata": {
                        "owned_by": "anthropic",
                        "context_length": 200000,
                        "description": "Fastest model for simple tasks"
                    }
                }
            ]
    
    async def generate_text(self, prompt: str, model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate text from a prompt (batch/full response mode).
        
        Args:
            prompt: The input prompt text
            model: The model to use for generation
            params: Additional parameters for the generation
            
        Returns:
            A dictionary containing the generated text and metadata
        """
        # Create a copy of params to avoid modifying the original
        payload_params = params.copy()
        
        # Ensure stream is not set for batch mode
        if "stream" in payload_params:
            del payload_params["stream"]
        
        # Extract parameters that should not be passed to the API
        max_tokens = payload_params.pop("max_tokens", None)
        temperature = payload_params.pop("temperature", None)
        top_p = payload_params.pop("top_p", None)
        
        # Get the correct model ID using dynamic mapping
        model_id = self._get_model_id(model)
        
        # Build the API parameters
        api_params = {
            "model": model_id,
            **payload_params
        }
        
        # Add optional parameters if provided
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens
        if temperature is not None:
            api_params["temperature"] = temperature
        if top_p is not None:
            api_params["top_p"] = top_p
        
        try:
            # Call the Claude API
            response = await self.client.messages.create(
                model=model_id,
                max_tokens=max_tokens or 4096,
                temperature=temperature or 1.0,
                top_p=top_p or 1.0,
                messages=[{"role": "user", "content": prompt}]
            )
            
            return {
                "text": response.content[0].text,
                "provider": "claude",
                "model": model,
                "finish_reason": response.stop_reason,
                "metadata": {
                    "id": response.id,
                    "usage": {
                        "prompt_tokens": response.usage.input_tokens,
                        "completion_tokens": response.usage.output_tokens,
                        "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                    }
                }
            }
        except Exception as e:
            return {
                "error": True,
                "message": f"Claude API error: {str(e)}",
                "provider": "claude",
                "model": model
            }
    
    async def generate_stream(self, prompt: str, model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate streaming text from a prompt (streaming mode).
        
        Args:
            prompt: The input prompt text
            model: The model to use for generation
            params: Additional parameters for the generation
            
        Yields:
            Dictionaries containing chunks of generated text and metadata
        """
        # Create a copy of params to avoid modifying the original
        payload_params = params.copy()
        
        # Ensure stream is set to True for streaming mode
        payload_params["stream"] = True
        
        # Extract parameters that should not be passed to the API
        max_tokens = payload_params.pop("max_tokens", None)
        temperature = payload_params.pop("temperature", None)
        top_p = payload_params.pop("top_p", None)
        
        # Get the correct model ID using dynamic mapping
        model_id = self._get_model_id(model)
        
        # Build the API parameters
        api_params = {
            "model": model_id,
            **payload_params
        }
        
        # Add optional parameters if provided
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens
        if temperature is not None:
            api_params["temperature"] = temperature
        if top_p is not None:
            api_params["top_p"] = top_p
        
        try:
            # Call the Claude API with streaming
            stream = await self.client.messages.create(
                model=model_id,
                max_tokens=max_tokens or 4096,
                temperature=temperature or 1.0,
                top_p=top_p or 1.0,
                messages=[{"role": "user", "content": prompt}],
                stream=True
            )
            
            async for chunk in stream:
                try:
                    if chunk.type == "content_block_delta":
                        yield {
                            "text": chunk.delta.text,
                            "provider": "claude",
                            "model": model,
                            "finish_reason": None,
                            "done": False,
                            "metadata": {
                                "id": None  # message_id not available in streaming chunks
                            }
                        }
                    elif chunk.type == "message_stop":
                        # Use safe attribute access for stop_reason
                        stop_reason = getattr(chunk, 'stop_reason', 'stop')
                        yield {
                            "text": "",
                            "provider": "claude",
                            "model": model,
                            "finish_reason": stop_reason,
                            "done": True,
                            "metadata": {
                                "id": None  # message_id not available in streaming chunks
                            }
                        }
                    elif chunk.type == "message_start":
                        # Handle message start - no text to yield
                        pass
                    elif chunk.type == "content_block_start":
                        # Handle content block start - no text to yield
                        pass
                    elif chunk.type == "content_block_stop":
                        # Handle content block stop - no text to yield
                        pass
                    elif chunk.type == "message_delta":
                        # Handle message delta - no text to yield
                        pass
                    else:
                        # Handle other chunk types if needed
                        print(f"Unhandled chunk type: {chunk.type}")
                except Exception as chunk_error:
                    print(f"Error processing chunk: {chunk_error}")
                    yield {
                        "error": True,
                        "message": f"Error processing chunk: {str(chunk_error)}",
                        "provider": "claude",
                        "model": model,
                        "done": True
                    }
        except Exception as e:
            yield {
                "error": True,
                "message": f"Claude API error: {str(e)}",
                "provider": "claude",
                "model": model,
                "done": True
            }
    
    async def chat_completion(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a chat completion (batch/full response mode).
        
        Args:
            messages: List of chat messages with role and content
            model: The model to use for generation
            params: Additional parameters for the generation
            
        Returns:
            A dictionary containing the generated chat completion and metadata
        """
        # Create a copy of params to avoid modifying the original
        payload_params = params.copy()
        
        # Ensure stream is not set for batch mode
        if "stream" in payload_params:
            del payload_params["stream"]
        
        # Extract parameters that should not be passed to the API
        max_tokens = payload_params.pop("max_tokens", None)
        temperature = payload_params.pop("temperature", None)
        top_p = payload_params.pop("top_p", None)
        
        # Get the correct model ID using dynamic mapping
        model_id = self._get_model_id(model)
        
        # Build the API parameters
        api_params = {
            "model": model_id,
            **payload_params
        }
        
        # Add optional parameters if provided
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens
        if temperature is not None:
            api_params["temperature"] = temperature
        if top_p is not None:
            api_params["top_p"] = top_p
        
        try:
            # Convert messages to Claude format
            claude_messages = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                
                # Skip empty messages
                if not content.strip():
                    continue
                
                # Claude uses "assistant" instead of "assistant"
                if role == "assistant":
                    role = "assistant"
                elif role == "user":
                    role = "user"
                elif role == "system":
                    # Claude doesn't support system messages in the same way
                    # We'll skip system messages for now
                    continue
                
                claude_messages.append({"role": role, "content": content})
            
            # Call the Claude API
            response = await self.client.messages.create(
                model=model_id,
                max_tokens=max_tokens or 4096,
                temperature=temperature or 1.0,
                top_p=top_p or 1.0,
                messages=claude_messages
            )
            
            result = {
                "text": response.content[0].text,
                "provider": "claude",
                "model": model,
                "finish_reason": response.stop_reason,
                "metadata": {
                    "id": response.id,
                    "usage": {
                        "prompt_tokens": response.usage.input_tokens,
                        "completion_tokens": response.usage.output_tokens,
                        "total_tokens": response.usage.input_tokens + response.usage.output_tokens
                    }
                }
            }
            
            # Add chat-specific fields to match OpenAI format
            result["choices"] = [
                {
                    "message": {
                        "role": "assistant",
                        "content": response.content[0].text
                    },
                    "finish_reason": response.stop_reason
                }
            ]
            
            return result
        except Exception as e:
            return {
                "error": True,
                "message": f"Claude API error: {str(e)}",
                "provider": "claude",
                "model": model
            }
    
    async def chat_completion_stream(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Generate a streaming chat completion (streaming mode).
        
        Args:
            messages: List of chat messages with role and content
            model: The model to use for generation
            params: Additional parameters for the generation
            
        Yields:
            Dictionaries containing chunks of the chat completion and metadata
        """
        # Create a copy of params to avoid modifying the original
        payload_params = params.copy()
        
        # Ensure stream is set to True for streaming mode
        payload_params["stream"] = True
        
        # Extract parameters that should not be passed to the API
        max_tokens = payload_params.pop("max_tokens", None)
        temperature = payload_params.pop("temperature", None)
        top_p = payload_params.pop("top_p", None)
        
        # Get the correct model ID using dynamic mapping
        model_id = self._get_model_id(model)
        
        # Build the API parameters
        api_params = {
            "model": model_id,
            **payload_params
        }
        
        # Add optional parameters if provided
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens
        if temperature is not None:
            api_params["temperature"] = temperature
        if top_p is not None:
            api_params["top_p"] = top_p
        
        try:
            # Convert messages to Claude format
            claude_messages = []
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                
                # Skip empty messages
                if not content.strip():
                    continue
                
                # Claude uses "assistant" instead of "assistant"
                if role == "assistant":
                    role = "assistant"
                elif role == "user":
                    role = "user"
                elif role == "system":
                    # Claude doesn't support system messages in the same way
                    # We'll skip system messages for now
                    continue
                
                claude_messages.append({"role": role, "content": content})
            
            # Call the Claude API with streaming
            stream = await self.client.messages.create(
                model=model_id,
                max_tokens=max_tokens or 4096,
                temperature=temperature or 1.0,
                top_p=top_p or 1.0,
                messages=claude_messages,
                stream=True
            )
            
            async for chunk in stream:
                try:
                    if chunk.type == "content_block_delta":
                        chunk_data = {
                            "text": chunk.delta.text,
                            "provider": "claude",
                            "model": model,
                            "finish_reason": None,
                            "done": False,
                            "metadata": {
                                "id": None  # message_id not available in streaming chunks
                            }
                        }
                        
                        # Add chat-specific fields to match OpenAI format
                        chunk_data["choices"] = [
                            {
                                "delta": {
                                    "role": "assistant",
                                    "content": chunk.delta.text
                                },
                                "finish_reason": None
                            }
                        ]
                        
                        yield chunk_data
                    elif chunk.type == "message_stop":
                        # Use safe attribute access for stop_reason
                        stop_reason = getattr(chunk, 'stop_reason', 'stop')
                        chunk_data = {
                            "text": "",
                            "provider": "claude",
                            "model": model,
                            "finish_reason": stop_reason,
                            "done": True,
                            "metadata": {
                                "id": None  # message_id not available in streaming chunks
                            }
                        }
                        
                        # Add chat-specific fields to match OpenAI format
                        chunk_data["choices"] = [
                            {
                                "delta": {
                                    "role": "assistant",
                                    "content": ""
                                },
                                "finish_reason": stop_reason
                            }
                        ]
                        
                        yield chunk_data
                    elif chunk.type == "message_start":
                        # Handle message start - no text to yield
                        pass
                    elif chunk.type == "content_block_start":
                        # Handle content block start - no text to yield
                        pass
                    elif chunk.type == "content_block_stop":
                        # Handle content block stop - no text to yield
                        pass
                    elif chunk.type == "message_delta":
                        # Handle message delta - no text to yield
                        pass
                    else:
                        # Handle other chunk types if needed
                        print(f"Unhandled chunk type: {chunk.type}")
                except Exception as chunk_error:
                    print(f"Error processing chunk: {chunk_error}")
                    yield {
                        "error": True,
                        "message": f"Error processing chunk: {str(chunk_error)}",
                        "provider": "claude",
                        "model": model,
                        "done": True
                    }
        except Exception as e:
            yield {
                "error": True,
                "message": f"Claude API error: {str(e)}",
                "provider": "claude",
                "model": model,
                "done": True
            }
    
    async def validate_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate connection to the Claude API.
        
        Args:
            config: Configuration containing API key
            
        Returns:
            Dictionary with validation results
        """
        try:
            # Initialize a temporary client for validation
            temp_client = anthropic.AsyncAnthropic(api_key=config.get("api_key", ""))
            
            # Try to get models (this will validate the API key)
            models = await self.get_models()
            
            return {
                "valid": True,
                "provider": "claude",
                "models_available": len(models),
                "message": "Claude API connection validated successfully"
            }
        except Exception as e:
            return {
                "valid": False,
                "provider": "claude",
                "error": str(e),
                "message": f"Failed to validate Claude API connection: {str(e)}"
            } 
                
