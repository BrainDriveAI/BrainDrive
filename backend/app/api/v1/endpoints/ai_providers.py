"""
API endpoints for AI providers.
"""
import os
import json
import time
import asyncio
import logging
import traceback
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Depends, Body, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.settings import SettingDefinition, SettingScope, SettingInstance
from app.models.user import User
from app.ai_providers.registry import provider_registry
from app.ai_providers.ollama import OllamaProvider
from app.schemas.ai_providers import (
    TextGenerationRequest,
    ChatCompletionRequest,
    ValidationRequest,
)

# Flag to enable/disable test routes (set to False in production)
TEST_ROUTES_ENABLED = os.getenv("ENABLE_TEST_ROUTES", "True").lower() == "true"

router = APIRouter()


# Helper function to get provider instance from request
async def get_provider_instance_from_request(request, db):
    """Helper function to get provider instance from request."""
    # Use current user if not specified
    user_id = request.user_id or "current"
    
    # Normalize user_id by removing hyphens if present
    if user_id != "current":
        user_id = user_id.replace("-", "")
    
    logger = logging.getLogger(__name__)
    logger.info(f"Getting provider instance for: settings_id={request.settings_id}, user_id={user_id}")
    logger.info(f"Original user_id from request: {request.user_id}")
    
    try:
        # Get settings for the specified user
        logger.info(f"Fetching settings with definition_id={request.settings_id}, user_id={user_id}")
        settings = await SettingInstance.get_all_parameterized(
            db,
            definition_id=request.settings_id,
            scope=SettingScope.USER.value,
            user_id=user_id
        )
        
        logger.info(f"Found {len(settings)} settings for user_id={user_id}")
        
        if not settings or len(settings) == 0:
            logger.error(f"No settings found for definition_id={request.settings_id}, user_id={user_id}")
            # For testing purposes, use a default configuration if settings are not found
            if request.settings_id == "ollama_settings" and request.provider == "ollama":
                logger.warning(f"Using default Ollama configuration for testing. settings_id={request.settings_id}, user_id={user_id}")
                server = {
                    "id": request.server_id,
                    "serverName": "Test Ollama Server",
                    "serverAddress": "http://localhost:11434",
                    "apiKey": ""
                }
                config = {
                    "server_url": server["serverAddress"],
                    "api_key": server["apiKey"],
                    "server_name": server["serverName"]
                }
                
                # Get provider instance
                logger.info(f"Getting provider instance for: {request.provider}, {request.server_id}")
                provider_instance = await provider_registry.get_provider(
                    request.provider,
                    request.server_id,
                    config
                )
                
                logger.info(f"Got provider instance: {provider_instance.provider_name}")
                
                return provider_instance
            else:
                # For other providers, raise an error
                raise HTTPException(
                    status_code=404,
                    detail=f"Provider settings not found for settings_id={request.settings_id}, user_id={user_id}. "
                           f"Please ensure the settings are properly configured."
                )
        
        # Use the first setting found
        setting = settings[0]
        logger.info(f"Using setting with ID: {setting['id'] if isinstance(setting, dict) else setting.id}")
        
        # Extract configuration from settings value
        # Parse the JSON string if value is a string
        setting_value = setting['value'] if isinstance(setting, dict) else setting.value
        
        if isinstance(setting_value, str):
            try:
                # First parse
                logger.info("Parsing settings value as JSON string")
                value_dict = json.loads(setting_value)
                logger.debug(f"Parsed JSON string into: {value_dict}")
                
                # Check if the result is still a string (double-encoded JSON)
                if isinstance(value_dict, str):
                    logger.info("Value is double-encoded JSON, parsing again")
                    value_dict = json.loads(value_dict)
                    logger.debug(f"Parsed double-encoded JSON into: {value_dict}")
                
                # Now value_dict should be a dictionary
                if not isinstance(value_dict, dict):
                    logger.error(f"Error: value_dict is not a dictionary: {type(value_dict)}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Error parsing settings value: expected dict, got {type(value_dict)}. "
                               f"Please check the format of your settings."
                    )
            except json.JSONDecodeError as e:
                logger.error(f"Error parsing JSON string: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Error parsing settings value: {str(e)}. "
                           f"Please ensure the settings value is valid JSON."
                )
        else:
            logger.info("Settings value is already a dictionary")
            value_dict = setting_value
        
        # Handle different provider configurations
        if request.provider == "openai":
            # OpenAI uses simple api_key structure
            logger.info("Processing OpenAI provider configuration")
            api_key = value_dict.get("api_key", "")
            if not api_key:
                logger.error("OpenAI API key is missing")
                raise HTTPException(
                    status_code=400,
                    detail="OpenAI API key is required. Please configure your OpenAI API key in settings."
                )
            
            # For OpenAI, we create a virtual server configuration
            config = {
                "api_key": api_key,
                "server_url": "https://api.openai.com/v1",  # Default OpenAI API URL
                "server_name": "OpenAI API"
            }
            logger.info(f"Created OpenAI config with API key")
        else:
            # Other providers (like Ollama) use servers array
            logger.info("Processing server-based provider configuration")
            servers = value_dict.get("servers", [])
            logger.info(f"Found {len(servers)} servers in settings")
            
            # Find the specific server by ID
            logger.info(f"Looking for server with ID: {request.server_id}")
            server = next((s for s in servers if s.get("id") == request.server_id), None)
            if not server and servers:
                # If the requested server ID is not found but there are servers available,
                # use the first server as a fallback
                logger.warning(f"Server with ID {request.server_id} not found, using first available server as fallback")
                server = servers[0]
                logger.info(f"Using fallback server: {server.get('serverName')} ({server.get('id')})")
            
            if not server:
                logger.error(f"No server found with ID: {request.server_id} and no fallback available")
                raise HTTPException(
                    status_code=404,
                    detail=f"Server not found with ID: {request.server_id}. "
                           f"Please check your server configuration or use a different server ID."
                )
            
            logger.info(f"Found server: {server.get('serverName')}")
            
            # Create provider configuration from server details
            server_url = server.get("serverAddress")
            if not server_url:
                logger.error(f"Server URL is missing for server: {server.get('id')}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Server URL is missing for server: {server.get('id')}. "
                           f"Please update your server configuration with a valid URL."
                )
                
            config = {
                "server_url": server_url,
                "api_key": server.get("apiKey", ""),
                "server_name": server.get("serverName", "Unknown Server")
            }
        
        logger.info(f"Created config with server_url: {config.get('server_url', 'N/A')}")
        
        # Get provider instance
        logger.info(f"Getting provider instance for: {request.provider}, {request.server_id}")
        provider_instance = await provider_registry.get_provider(
            request.provider,
            request.server_id,
            config
        )
        
        logger.info(f"Got provider instance: {provider_instance.provider_name}")
        
        return provider_instance
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Error in get_provider_instance_from_request: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Error getting provider instance: {str(e)}. "
                   f"Please check your configuration and try again."
        )


@router.get("/providers")
async def get_providers():
    """Get list of available AI providers."""
    return {
        "providers": provider_registry.get_available_providers()
    }


@router.post("/validate")
async def validate_provider(request: ValidationRequest):
    """Validate connection to a provider."""
    try:
        provider_name = request.provider
        if provider_name not in provider_registry.get_available_providers():
            raise HTTPException(status_code=404, detail=f"Provider '{provider_name}' not found")
        
        # Create a temporary provider instance for validation
        provider_class = provider_registry._providers.get(provider_name)
        provider = provider_class()
        result = await provider.validate_connection(request.config)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/models")
async def get_models(
    provider: str = Query(..., description="Provider name"),
    settings_id: str = Query(..., description="Settings ID"),
    server_id: str = Query(..., description="Server ID"),
    user_id: Optional[str] = Query("current", description="User ID"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user)
):
    """Get available models from a provider."""
    try:
        # Resolve user_id from authentication if "current" is specified
        if user_id == "current":
            if not current_user:
                raise HTTPException(status_code=401, detail="Authentication required")
            user_id = str(current_user.id)
        
        # Normalize user_id by removing hyphens if present
        user_id = user_id.replace("-", "")
            
        print(f"Getting models for: provider={provider}, settings_id={settings_id}, server_id={server_id}, user_id={user_id}")
        
        # Get settings for the specified user
        settings = await SettingInstance.get_all_parameterized(
            db, 
            definition_id=settings_id,
            scope=SettingScope.USER.value, 
            user_id=user_id
        )
        
        print(f"Found {len(settings)} settings for user_id={user_id}")
        
        if not settings or len(settings) == 0:
            raise HTTPException(status_code=404, detail=f"Provider settings not found for user_id={user_id}")
        
        # Use the first setting found
        setting = settings[0]
        
        # Extract configuration from settings value
        # Parse the JSON string if value is a string
        setting_value = setting['value'] if isinstance(setting, dict) else setting.value
        
        if isinstance(setting_value, str):
            try:
                # First parse
                value_dict = json.loads(setting_value)
                print(f"Parsed JSON string into: {value_dict}")
                
                # Check if the result is still a string (double-encoded JSON)
                if isinstance(value_dict, str):
                    print("Value is double-encoded JSON, parsing again")
                    value_dict = json.loads(value_dict)
                    print(f"Parsed double-encoded JSON into: {value_dict}")
                
                # Now value_dict should be a dictionary
                if not isinstance(value_dict, dict):
                    print(f"Error: value_dict is not a dictionary: {type(value_dict)}")
                    raise HTTPException(status_code=500, detail=f"Error parsing settings value: expected dict, got {type(value_dict)}")
            except json.JSONDecodeError as e:
                print(f"Error parsing JSON string: {e}")
                raise HTTPException(status_code=500, detail=f"Error parsing settings value: {str(e)}")
        else:
            value_dict = setting_value
        
        # Handle different provider configurations
        if provider == "openai":
            # OpenAI uses simple api_key structure
            api_key = value_dict.get("api_key", "")
            if not api_key:
                raise HTTPException(status_code=400, detail="OpenAI API key is required")
            
            config = {
                "api_key": api_key,
                "server_url": "https://api.openai.com/v1",  # Default OpenAI API URL
                "server_name": "OpenAI API"
            }
            print(f"Created OpenAI config with API key")
        else:
            # Other providers (like Ollama) use servers array
            servers = value_dict.get("servers", [])
            print(f"Found {len(servers)} servers in settings")
            
            # Find the specific server by ID
            server = next((s for s in servers if s.get("id") == server_id), None)
            if not server and servers:
                # If the requested server ID is not found but there are servers available,
                # use the first server as a fallback
                print(f"Server with ID {server_id} not found, using first available server as fallback")
                server = servers[0]
                print(f"Using fallback server: {server.get('serverName')} ({server.get('id')})")
            
            if not server:
                raise HTTPException(status_code=404, detail=f"Server not found with ID: {server_id}")
            
            print(f"Found server: {server.get('serverName')}")
            
            # Create provider configuration from server details
            config = {
                "server_url": server.get("serverAddress"),
                "api_key": server.get("apiKey", ""),
                "server_name": server.get("serverName")
            }
        
        print(f"Created config with server_url: {config['server_url']}")
        
        # Get provider instance
        provider_instance = await provider_registry.get_provider(
            provider, 
            server_id,
            config
        )
        
        print(f"Got provider instance: {provider_instance.provider_name}")
        
        # Get models
        models = await provider_instance.get_models()
        print(f"Got {len(models)} models")
        
        return {
            "models": models
        }
    except Exception as e:
        print(f"Error in get_models: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate")
async def generate_text(request: TextGenerationRequest, db: AsyncSession = Depends(get_db)):
    """Generate text from a prompt.
    
    Uses the 'stream' parameter to determine whether to return a streaming or batch response.
    """
    try:
        # Get provider instance using the helper function
        provider_instance = await get_provider_instance_from_request(request, db)
        
        # Handle streaming
        if request.stream:
            async def stream_generator():
                async for chunk in provider_instance.generate_stream(
                    request.prompt, 
                    request.model, 
                    request.params
                ):
                    # Yield each chunk and flush immediately
                    yield f"data: {json.dumps(chunk)}\n\n"
                    # Add an explicit flush marker
                    yield ""
                yield "data: [DONE]\n\n"
            
            # Add headers to prevent buffering
            headers = {
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",  # Disable Nginx buffering
                "Connection": "keep-alive",
                "Content-Type": "text/event-stream"
            }
            
            return StreamingResponse(
                stream_generator(),
                media_type="text/event-stream",
                headers=headers
            )
        
        # Handle non-streaming
        result = await provider_instance.generate_text(
            request.prompt, 
            request.model, 
            request.params
        )
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat")
async def chat_completion(request: ChatCompletionRequest, db: AsyncSession = Depends(get_db)):
    """Generate a chat completion.
    
    Uses the 'stream' parameter to determine whether to return a streaming or batch response.
    Also stores the conversation history in the database and uses it for context.
    """
    logger = logging.getLogger(__name__)
    try:
        logger.info(f"Production chat endpoint called with: provider={request.provider}, settings_id={request.settings_id}, server_id={request.server_id}, model={request.model}")
        logger.debug(f"Messages: {request.messages}")
        logger.debug(f"Params: {request.params}")
        
        # Validate persona data if provided
        if request.persona_id or request.persona_system_prompt or request.persona_model_settings:
            logger.info(f"Persona data provided - persona_id: {request.persona_id}")
            
            # Basic validation: if persona_id is provided, persona_system_prompt should also be provided
            if request.persona_id and not request.persona_system_prompt:
                logger.error(f"Invalid persona data: persona_id provided but persona_system_prompt is missing")
                raise HTTPException(
                    status_code=400,
                    detail="Invalid persona data: persona_system_prompt is required when persona_id is provided"
                )
            
            # Validate persona model settings if provided
            if request.persona_model_settings:
                try:
                    # Import here to avoid circular imports
                    from app.schemas.persona import ModelSettings
                    ModelSettings(**request.persona_model_settings)
                    logger.debug(f"Persona model settings validated successfully")
                except Exception as validation_error:
                    logger.error(f"Invalid persona model settings: {validation_error}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid persona model settings: {str(validation_error)}"
                    )
        
        try:
            # Get provider instance using the helper function
            logger.info("Getting provider instance from request")
            provider_instance = await get_provider_instance_from_request(request, db)
            logger.info(f"Provider instance created successfully: {provider_instance.provider_name}")
            
            # Convert messages to the format expected by the provider
            current_messages = [message.model_dump() for message in request.messages]
            print(f"Current messages: {current_messages}")
            
            # Handle persona system prompt injection
            messages_with_persona = current_messages.copy()
            
            # If persona is provided, inject system prompt at the beginning
            if request.persona_system_prompt:
                logger.info(f"Applying persona system prompt for persona_id: {request.persona_id}")
                system_message = {
                    "role": "system",
                    "content": request.persona_system_prompt
                }
                # Insert system message at the beginning, but after any existing system messages
                system_messages = [msg for msg in messages_with_persona if msg.get("role") == "system"]
                non_system_messages = [msg for msg in messages_with_persona if msg.get("role") != "system"]
                
                # If there are existing system messages, replace the first one with persona system prompt
                # Otherwise, add persona system prompt as the first message
                if system_messages:
                    messages_with_persona = [system_message] + system_messages[1:] + non_system_messages
                else:
                    messages_with_persona = [system_message] + non_system_messages
                
                logger.debug(f"Messages after persona system prompt injection: {len(messages_with_persona)} messages")
            
            # Apply persona model settings to params
            enhanced_params = request.params.copy() if request.params else {}
            if request.persona_model_settings:
                logger.info(f"Applying persona model settings: {request.persona_model_settings}")
                # Merge persona settings with request params (persona takes precedence)
                enhanced_params.update(request.persona_model_settings)
                logger.debug(f"Enhanced params with persona settings: {enhanced_params}")
            
            # Initialize combined_messages with persona-enhanced messages
            combined_messages = messages_with_persona.copy()
            
            # Get or create a conversation
            from app.models.conversation import Conversation
            from app.models.message import Message
            import uuid
            
            # Extract user_id from the request
            user_id = request.user_id
            # The conversation_id is defined in the ChatCompletionRequest schema, so we can access it directly
            conversation_id = request.conversation_id
            print(f"Conversation ID from request: {conversation_id}")
            print(f"USER ID from request: {user_id} - THIS SHOULD BE THE CURRENT USER'S ID, NOT HARDCODED")
            
            # Debug: Print the entire request for inspection
            print(f"Request details:")
            print(f"  provider: {request.provider}")
            print(f"  settings_id: {request.settings_id}")
            print(f"  server_id: {request.server_id}")
            print(f"  model: {request.model}")
            print(f"  user_id: {user_id}")
            print(f"  conversation_id: {conversation_id}")
            print(f"  messages count: {len(request.messages)}")
            for i, msg in enumerate(request.messages):
                print(f"    Message {i+1}: role={msg.role}, content={msg.content[:50]}...")
            
            # If conversation_id is provided, get the existing conversation
            if conversation_id:
                print(f"Attempting to retrieve conversation with ID: {conversation_id}")
                conversation = await Conversation.get_by_id(db, conversation_id)
                if not conversation:
                    print(f"ERROR: Conversation with ID {conversation_id} not found in database")
                    raise HTTPException(status_code=404, detail="Conversation not found")
                
                print(f"Found conversation: {conversation.id}, user_id: {conversation.user_id}")
                
                # Ensure the user owns the conversation
                if str(conversation.user_id) != str(user_id):
                    print(f"ERROR: User {user_id} is not authorized to access conversation {conversation_id}")
                    print(f"Conversation owner: {conversation.user_id}, Request user: {user_id}, Original request user_id: {request.user_id}")
                    raise HTTPException(status_code=403, detail="Not authorized to access this conversation")
                
                # Update conversation with persona_id if provided and different from current
                if request.persona_id and conversation.persona_id != request.persona_id:
                    logger.info(f"Updating conversation {conversation_id} with persona_id: {request.persona_id}")
                    conversation.persona_id = request.persona_id
                    await db.commit()
                    await db.refresh(conversation)
                
                # Get previous messages for this conversation
                print(f"Retrieving previous messages for conversation {conversation_id}")
                previous_messages = await conversation.get_messages(db)
                print(f"Retrieved {len(previous_messages)} previous messages")
                
                # Convert previous messages to the format expected by the provider
                if previous_messages and len(previous_messages) > 0:
                    # Sort messages by created_at to ensure correct order
                    previous_messages.sort(key=lambda x: x.created_at)
                    print(f"Sorted {len(previous_messages)} messages by timestamp")
                    
                    # Print all previous messages for debugging
                    for i, msg in enumerate(previous_messages):
                        print(f"  Previous message {i+1}: sender={msg.sender}, created_at={msg.created_at}, content={msg.message[:50]}...")
                    
                    # Convert to the format expected by the provider
                    # We'll skip the last message if it's from the user, as it's likely duplicated in the current request
                    skip_last = previous_messages[-1].sender == "user" and len(current_messages) > 0
                    print(f"Skip last message: {skip_last} (last message sender: {previous_messages[-1].sender}, current messages: {len(current_messages)})")
                    
                    history_messages = []
                    for i, msg in enumerate(previous_messages):
                        # Skip the last message if it's from the user and we have current messages
                        if skip_last and i == len(previous_messages) - 1:
                            print(f"  Skipping last message (index {i})")
                            continue
                            
                        role = "assistant" if msg.sender == "llm" else "user"
                        history_messages.append({
                            "role": role,
                            "content": msg.message
                        })
                        print(f"  Added message to history: role={role}, content={msg.message[:50]}...")
                    
                    # Replace combined_messages with history followed by current
                    combined_messages = history_messages + current_messages
                    
                    print(f"Using {len(history_messages)} previous messages + {len(current_messages)} current messages = {len(combined_messages)} total messages")
                    print(f"Final combined messages:")
                    for i, msg in enumerate(combined_messages):
                        print(f"  Combined message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')[:50]}...")
                    
                    logger.info(f"Using {len(history_messages)} previous messages for context")
                    logger.debug(f"Combined messages: {combined_messages}")
            else:
                # Create a new conversation
                conversation = Conversation(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    title=f"Conversation with {request.model}",
                    page_context=request.page_context,  # This is already defined in the schema with a default of None
                    page_id=request.page_id,  # NEW FIELD - ID of the page this conversation belongs to
                    model=request.model,
                    server=provider_instance.server_name,
                    conversation_type=request.conversation_type or "chat",  # New field with default
                    persona_id=request.persona_id  # Store persona_id when creating conversation
                )
                db.add(conversation)
                await db.commit()
                await db.refresh(conversation)
                print(f"Created new conversation with ID: {conversation.id}")
                
                # If persona has a sample greeting, add it as the first assistant message
                if request.persona_sample_greeting:
                    logger.info(f"Adding persona sample greeting for persona_id: {request.persona_id}")
                    greeting_message = Message(
                        id=str(uuid.uuid4()),
                        conversation_id=conversation.id,
                        sender="llm",
                        message=request.persona_sample_greeting,
                        message_metadata={
                            "persona_id": request.persona_id,
                            "persona_greeting": True,
                            "model": request.model,
                            "temperature": 0.0  # Greeting is static, not generated
                        }
                    )
                    db.add(greeting_message)
                    await db.commit()
                    print(f"Added persona sample greeting: {request.persona_sample_greeting[:50]}...")
            
            # Store user messages in the database
            for msg in request.messages:
                if msg.role == "user":
                    db_message = Message(
                        id=str(uuid.uuid4()),
                        conversation_id=conversation.id,
                        sender="user",
                        message=msg.content,
                        message_metadata={"role": msg.role}
                    )
                    db.add(db_message)
                    print(f"Added user message to database: {msg.content[:50]}...")
            
            # Handle streaming
            if request.stream:
                async def stream_generator():
                    try:
                        print(f"Starting streaming with model: {request.model}")
                        full_response = ""
                        token_count = 0
                        start_time = time.time()
                        
                        print(f"Sending {len(combined_messages)} messages to chat_completion_stream")
                        for i, msg in enumerate(combined_messages):
                            print(f"  Message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')[:50]}...")
                        
                        async for chunk in provider_instance.chat_completion_stream(
                            combined_messages,
                            request.model,
                            enhanced_params
                        ):
                            # Extract content from the chunk
                            content = ""
                            if "choices" in chunk and len(chunk["choices"]) > 0:
                                if "delta" in chunk["choices"][0]:
                                    content = chunk["choices"][0]["delta"].get("content", "")
                                elif "text" in chunk["choices"][0]:
                                    content = chunk["choices"][0]["text"]
                            
                            # Accumulate the full response
                            full_response += content
                            token_count += 1
                            
                            # Yield each chunk and flush immediately
                            yield f"data: {json.dumps(chunk)}\n\n"
                            # Add an explicit flush marker
                            yield ""
                        
                        # Calculate tokens per second
                        elapsed_time = time.time() - start_time
                        tokens_per_second = token_count / elapsed_time if elapsed_time > 0 else 0
                        
                        # Store the LLM response in the database with persona metadata
                        message_metadata = {
                            "token_count": token_count,
                            "tokens_per_second": round(tokens_per_second, 1),
                            "model": request.model,
                            "temperature": enhanced_params.get("temperature", 0.7),
                            "streaming": True
                        }
                        
                        # Add persona metadata if persona was used
                        if request.persona_id:
                            message_metadata.update({
                                "persona_id": request.persona_id,
                                "persona_applied": bool(request.persona_system_prompt),
                                "persona_model_settings_applied": bool(request.persona_model_settings)
                            })
                        
                        db_message = Message(
                            id=str(uuid.uuid4()),
                            conversation_id=conversation.id,
                            sender="llm",
                            message=full_response,
                            message_metadata=message_metadata
                        )
                        db.add(db_message)
                        
                        # Update the conversation's updated_at timestamp
                        conversation.updated_at = db_message.created_at
                        
                        await db.commit()
                        
                        yield "data: [DONE]\n\n"
                    except Exception as stream_error:
                        print(f"Error in stream_generator: {stream_error}")
                        logger.error(f"Streaming error with persona_id {request.persona_id}: {stream_error}")
                        
                        # Enhanced error message for persona-related errors
                        error_message = f"Streaming error: {str(stream_error)}"
                        if request.persona_id:
                            error_message += f" (Persona ID: {request.persona_id})"
                        
                        error_json = json.dumps({
                            "error": True,
                            "message": error_message,
                            "persona_id": request.persona_id if request.persona_id else None
                        })
                        yield f"data: {error_json}\n\n"
                        yield "data: [DONE]\n\n"
                
                # Add headers to prevent buffering
                headers = {
                    "Cache-Control": "no-cache, no-transform",
                    "X-Accel-Buffering": "no",  # Disable Nginx buffering
                    "Connection": "keep-alive",
                    "Content-Type": "text/event-stream"
                }
                
                return StreamingResponse(
                    stream_generator(),
                    media_type="text/event-stream",
                    headers=headers
                )
            
            # Handle non-streaming
            print(f"Starting non-streaming chat completion with model: {request.model}")
            start_time = time.time()
            print(f"Sending {len(combined_messages)} messages to chat_completion")
            for i, msg in enumerate(combined_messages):
                print(f"  Message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')[:50]}...")
            
            result = await provider_instance.chat_completion(
                combined_messages,
                request.model,
                enhanced_params
            )
            elapsed_time = time.time() - start_time
            
            print(f"Chat completion result: {result}")
            
            # Extract the response content
            response_content = ""
            if "choices" in result and len(result["choices"]) > 0:
                if "message" in result["choices"][0]:
                    response_content = result["choices"][0]["message"].get("content", "")
                elif "text" in result["choices"][0]:
                    response_content = result["choices"][0]["text"]
            
            # Estimate token count (this is a rough estimate)
            token_count = len(response_content.split()) * 1.3  # Rough estimate: words * 1.3
            tokens_per_second = token_count / elapsed_time if elapsed_time > 0 else 0
            
            # Store the LLM response in the database with persona metadata
            message_metadata = {
                "token_count": int(token_count),
                "tokens_per_second": round(tokens_per_second, 1),
                "model": request.model,
                "temperature": enhanced_params.get("temperature", 0.7),
                "streaming": False
            }
            
            # Add persona metadata if persona was used
            if request.persona_id:
                message_metadata.update({
                    "persona_id": request.persona_id,
                    "persona_applied": bool(request.persona_system_prompt),
                    "persona_model_settings_applied": bool(request.persona_model_settings)
                })
            
            db_message = Message(
                id=str(uuid.uuid4()),
                conversation_id=conversation.id,
                sender="llm",
                message=response_content,
                message_metadata=message_metadata
            )
            db.add(db_message)
            
            # Update the conversation's updated_at timestamp
            conversation.updated_at = db_message.created_at
            
            await db.commit()
            
            # Add conversation_id to the result
            result["conversation_id"] = conversation.id
            
            return result
        except Exception as inner_e:
            logger.error(f"Inner exception in chat_completion: {inner_e}")
            import traceback
            logger.error(traceback.format_exc())
            
            # Provide a more detailed error message with persona context
            error_message = str(inner_e)
            if "provider_instance" in locals():
                error_message += f" Provider: {request.provider}, Server: {request.server_id}"
            if request.persona_id:
                error_message += f" Persona: {request.persona_id}"
            
            raise HTTPException(
                status_code=500,
                detail=f"Error in chat completion: {error_message}. Please check your configuration and try again."
            )
    except HTTPException:
        # Re-raise HTTP exceptions with their original status codes and details
        raise
    except Exception as e:
        logger.error(f"Exception in chat_completion: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error in chat completion: {str(e)}. Please try again later or contact support."
        )


# Test routes for direct testing (disabled in production)
if TEST_ROUTES_ENABLED:
    test_router = APIRouter(prefix="/test", tags=["ai_test"])
    
    @test_router.post("/ollama/generate")
    async def test_ollama_generate(
        prompt: str = Body(..., description="Text prompt"),
        model: str = Body("llama2", description="Model name"),
        stream: bool = Body(False, description="Whether to stream the response"),
        temperature: float = Body(0.7, description="Temperature for generation"),
        max_tokens: int = Body(2048, description="Maximum tokens to generate"),
        server_url: str = Body("http://localhost:11434", description="Ollama server URL")
    ):
        """Test route for Ollama text generation."""
        print(f"Test route called with: prompt={prompt}, model={model}, stream={stream}, server_url={server_url}")
        try:
            # Create provider instance directly
            provider = OllamaProvider()
            await provider.initialize({
                "server_url": server_url,
                "api_key": "",  # No API key for local testing
                "server_name": "Test Ollama Server"
            })
            
            # Set up parameters
            params = {
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            print(f"Initialized provider with server_url={server_url}, calling with params={params}")
            
            # Handle streaming vs. non-streaming
            if stream:
                async def stream_generator():
                    try:
                        async for chunk in provider.generate_stream(prompt, model, params):
                            print(f"Streaming chunk: {chunk}")
                            yield f"data: {json.dumps(chunk)}\n\n"
                            
                            # Add an explicit flush marker
                            yield ""
                        yield "data: [DONE]\n\n"
                    except Exception as stream_error:
                        print(f"Error in stream_generator: {stream_error}")
                        error_json = json.dumps({
                            "error": True,
                            "message": f"Streaming error: {str(stream_error)}"
                        })
                        yield f"data: {error_json}\n\n"
                        yield "data: [DONE]\n\n"
                
                # Add headers to prevent buffering
                headers = {
                    "Cache-Control": "no-cache, no-transform",
                    "X-Accel-Buffering": "no",  # Disable Nginx buffering
                    "Connection": "keep-alive",
                    "Content-Type": "text/event-stream"
                }
                
                return StreamingResponse(
                    stream_generator(),
                    media_type="text/event-stream",
                    headers=headers
                )
            else:
                print(f"Calling generate_text with prompt={prompt}, model={model}")
                result = await provider.generate_text(prompt, model, params)
                print(f"Result from generate_text: {result}")
                return result
        except Exception as e:
            print(f"Exception in test_ollama_generate: {e}")
            import traceback
            traceback.print_exc()
            return {
                "error": True,
                "message": f"Test route error: {str(e)}"
            }
    
    @test_router.post("/ollama/llmchat")
    async def test_ollama_chat(
        messages: List[Dict[str, Any]] = Body(..., description="Chat messages"),
        model: str = Body("llama2", description="Model name"),
        stream: bool = Body(False, description="Whether to stream the response"),
        temperature: float = Body(0.7, description="Temperature for generation"),
        max_tokens: int = Body(2048, description="Maximum tokens to generate"),
        server_url: str = Body("http://localhost:11434", description="Ollama server URL")
    ):
        from langchain_community.llms import Ollama
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_core.output_parsers import StrOutputParser

        try:
            # Fallback input from messages
            user_input = messages[0].get("content", "Hello") if messages else "Hello"

            # Build chain using LangChain
            prompt = ChatPromptTemplate.from_messages([
                ("system", "You are a helpful assistant."),
                ("human", "{input}")
            ])
            llm = Ollama(model=model, base_url=server_url)
            chain = prompt | llm | StrOutputParser()

            # Streaming generator
            async def stream_generator():
                for chunk in chain.stream({"input": user_input}):
                    print("[🔹] Streaming chunk:", chunk)
                    yield f"data: {chunk}\n\n"
                    await asyncio.sleep(0.01)

                yield "data: [DONE]\n\n"

            if stream:
                return StreamingResponse(
                    stream_generator(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache, no-transform",
                        "X-Accel-Buffering": "no",
                        "Connection": "keep-alive",
                        "Content-Type": "text/event-stream"
                    }
                )
            else:
                # For non-streaming response
                result = chain.invoke({"input": user_input})
                return {"answer": result}

        except Exception as e:
            print("❌ Exception in test_ollama_chat:", e)
            return {
                "error": True,
                "message": str(e)
            }


    @test_router.post("/ollama/chat")
    async def test_ollama_chat(
        messages: List[Dict[str, Any]] = Body(..., description="Chat messages"),
        model: str = Body("llama2", description="Model name"),
        stream: bool = Body(False, description="Whether to stream the response"),
        temperature: float = Body(0.7, description="Temperature for generation"),
        max_tokens: int = Body(2048, description="Maximum tokens to generate"),
        server_url: str = Body("http://localhost:11434", description="Ollama server URL")
    ):
        print(f"Test chat route called with: messages={messages}, model={model}, stream={stream}, server_url={server_url}")
        try:
            provider = OllamaProvider()
            await provider.initialize({
                "server_url": server_url,
                "api_key": "",
                "server_name": "Test Ollama Server"
            })

            params = {
                "temperature": temperature,
                "max_tokens": max_tokens
            }

            if stream:
                async def stream_generator():
                    try:
                        async for chunk in provider.chat_completion_stream(messages, model, params):
                            # content = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            # print(f"Streaming chunk: {content}")
                            # yield f"data: {content}\n\n"
                            yield f"data: {json.dumps(chunk)}\n\n"
                            await asyncio.sleep(0.01)
                        yield "data: [DONE]\n\n"

                    except Exception as stream_error:
                        print(f"Streaming error: {stream_error}")
                        yield "data: [DONE]\n\n"


                return StreamingResponse(
                    stream_generator(),
                    media_type="text/event-stream",
                    headers={
                        "Cache-Control": "no-cache, no-transform",
                        "X-Accel-Buffering": "no",
                        "Connection": "keep-alive",
                        "Content-Type": "text/event-stream"
                    }
                )
            else:
                result = await provider.chat_completion(messages, model, params)
                return result

        except Exception as e:
            print(f"Exception in chat handler: {e}")
            return {
                "error": True,
                "message": str(e)
            }

        
    @test_router.get("/test/stream")
    async def minimal_stream_test():
        async def event_stream():
            for i in range(5):
                yield f"data: chunk {i} at {time.time()}\n\n"
                print(f"Yielded chunk {i}")
                await asyncio.sleep(1)

            yield "data: [DONE]\n\n"

        headers = {
            "Cache-Control": "no-cache",
            "Content-Type": "text/event-stream",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Important if using nginx
        }

        return StreamingResponse(event_stream(), headers=headers)


    @test_router.get("/test/stream-ollama-direct")
    async def stream_ollama_direct_test():
        from app.ai_providers.ollama import OllamaProvider

        async def stream():
            provider = OllamaProvider()
            await provider.initialize({"server_url": "http://localhost:11434"})
            async for chunk in provider._stream_ollama_api("Give me 5 dragon Names", "hf.co/Triangle104/Dolphin3.0-R1-Mistral-24B-Q6_K-GGUF:latest", {"temperature": 0.7}):
                print("STREAM CHUNK:", chunk)
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive"
            }
        )
    
    # Include the test router in the main router
    router.include_router(test_router)
