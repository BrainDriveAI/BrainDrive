from fastapi import APIRouter, HTTPException, Depends, Body, Response
from fastapi.responses import StreamingResponse
import httpx
import json
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator
from pydantic import BaseModel, AnyHttpUrl
from urllib.parse import unquote
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.settings import SettingDefinition, SettingScope

router = APIRouter()

class OllamaResponse(BaseModel):
    status: str
    version: Optional[str] = None

class ModelInstallRequest(BaseModel):
    name: str
    server_url: str
    api_key: Optional[str] = None
    stream: Optional[bool] = True

class ModelDeleteRequest(BaseModel):
    name: str
    server_url: str
    api_key: Optional[str] = None

async def ensure_ollama_settings_definition(db: AsyncSession):
    """Ensure the Ollama settings definition exists"""
    definition = await SettingDefinition.get_by_id(db, 'ollama_settings')
    if not definition:
        definition = SettingDefinition(
            id='ollama_settings',
            name='Ollama Server Settings',
            description='Configuration for the Ollama server connection',
            category='servers',
            type='object',
            allowed_scopes=[SettingScope.USER],
            validation={
                'required': ['serverAddress', 'serverName'],
                'properties': {
                    'serverAddress': {'type': 'string', 'format': 'uri'},
                    'serverName': {'type': 'string', 'minLength': 1},
                    'apiKey': {'type': 'string'}
                }
            }
        )
        await definition.save(db)
    return definition

@router.get("/test", response_model=OllamaResponse)
async def test_ollama_connection(
    server_url: str,
    api_key: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Test connection to an Ollama server by checking its version endpoint
    """
    # Ensure settings definition exists
    # await ensure_ollama_settings_definition(db)

    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/version
        if not server_url.endswith('/api/version'):
            server_url = server_url.rstrip('/') + '/api/version'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        # Set a reasonable timeout and disable redirects
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            try:
                response = await client.get(server_url, headers=headers)
                if response.status_code == 200:
                    return OllamaResponse(
                        status="success",
                        version=response.json().get("version", "unknown")
                    )
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Server returned status code {response.status_code}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

async def stream_response(response: httpx.Response) -> AsyncGenerator[bytes, None]:
    """
    Stream the response from Ollama API
    
    Ollama's streaming format is a series of newline-delimited JSON objects.
    Each JSON object contains a 'response' field with a chunk of text.
    For model installation, it contains progress information.
    """
    try:
        # Check if response is successful
        if response.status_code != 200:
            error_json = json.dumps({"error": f"Server returned status {response.status_code}"})
            yield error_json.encode() + b'\n'
            return

        # Try to read the response content
        try:
            async for line in response.aiter_lines():
                if line.strip():
                    try:
                        # Parse the JSON and yield it back as a properly formatted JSON line
                        data = json.loads(line)
                        # Add a newline to ensure proper streaming format
                        yield json.dumps(data).encode() + b'\n'
                    except json.JSONDecodeError:
                        # If it's not valid JSON, just pass it through
                        yield line.encode() + b'\n'
        except Exception as stream_error:
            # If streaming fails, try to get the response content directly
            try:
                content = response.text
                if content.strip():
                    # Try to parse as JSON first
                    try:
                        data = json.loads(content)
                        yield json.dumps(data).encode() + b'\n'
                    except json.JSONDecodeError:
                        # If not JSON, send as plain text
                        yield content.encode() + b'\n'
                else:
                    # Empty response but successful status - send success message
                    success_json = json.dumps({"status": "success", "message": "Operation completed successfully"})
                    yield success_json.encode() + b'\n'
            except Exception as content_error:
                print(f"Error reading response content: {content_error}")
                # Send a generic success message if we can't read the content
                success_json = json.dumps({"status": "success", "message": "Operation completed"})
                yield success_json.encode() + b'\n'
                
    except Exception as e:
        print(f"Error in stream_response: {e}")
        error_json = json.dumps({"error": str(e)})
        yield error_json.encode() + b'\n'

@router.post("/passthrough")
async def ollama_passthrough(
    request_data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Generic passthrough for Ollama API requests (non-streaming)
    """
    try:
        # Extract required parameters
        server_url = request_data.get("server_url")
        endpoint = request_data.get("endpoint")
        method = request_data.get("method", "GET").upper()
        api_key = request_data.get("api_key")
        payload = request_data.get("payload", {})
        
        # Validate required parameters
        if not server_url or not endpoint:
            raise HTTPException(
                status_code=400,
                detail="server_url and endpoint are required"
            )
            
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )
            
        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Set a longer timeout for large models and disable redirects
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            try:
                if method == "GET":
                    response = await client.get(full_url, headers=headers, params=payload)
                elif method == "POST":
                    response = await client.post(full_url, headers=headers, json=payload)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported method: {method}"
                    )
                
                # Return the response data
                return {
                    "status_code": response.status_code,
                    "data": response.json() if response.headers.get("content-type") == "application/json" else response.text
                }
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

@router.post("/stream")
async def ollama_stream(
    request_data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Streaming endpoint for Ollama API requests
    """
    try:
        # Extract required parameters
        server_url = request_data.get("server_url")
        endpoint = request_data.get("endpoint")
        method = request_data.get("method", "POST").upper()  # Default to POST for streaming
        api_key = request_data.get("api_key")
        payload = request_data.get("payload", {})
        
        # Ensure streaming is enabled in the payload
        if isinstance(payload, dict):
            payload["stream"] = True
        
        # Validate required parameters
        if not server_url or not endpoint:
            raise HTTPException(
                status_code=400,
                detail="server_url and endpoint are required"
            )
            
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )
            
        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Set a longer timeout for large models and disable redirects
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            try:
                if method == "GET":
                    response = await client.get(full_url, headers=headers, params=payload, stream=True)
                elif method == "POST":
                    response = await client.post(full_url, headers=headers, json=payload, stream=True)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported method: {method}"
                    )
                
                # Return a streaming response
                return StreamingResponse(
                    stream_response(response),
                    media_type="application/json",
                    status_code=response.status_code
                )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

@router.get("/models", response_model=List[Dict[str, Any]])
async def get_ollama_models(
    server_url: str,
    api_key: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a list of available models from an Ollama server
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/tags
        if not server_url.endswith('/api/tags'):
            server_url = server_url.rstrip('/') + '/api/tags'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        # Set a reasonable timeout and disable redirects
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            try:
                response = await client.get(server_url, headers=headers)
                if response.status_code == 200:
                    # Extract the models from the response
                    models = response.json().get("models", [])
                    return models
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Server returned status code {response.status_code}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

async def check_model_exists(client: httpx.AsyncClient, server_url: str, model_name: str, headers: dict) -> bool:
    """
    Check if a model already exists on the Ollama server
    """
    try:
        # Construct the models endpoint URL
        models_url = f"{server_url.rstrip('/').replace('/api/pull', '')}/api/tags"
        
        response = await client.get(models_url, headers=headers)
        if response.status_code == 200:
            models_data = response.json()
            models = models_data.get("models", [])
            
            # Check if the model name exists in the list
            for model in models:
                if model.get("name") == model_name:
                    return True
        return False
    except Exception as e:
        print(f"Error checking if model exists: {e}")
        # If we can't check, assume it doesn't exist to allow installation
        return False

@router.post("/install")
async def install_ollama_model(
    request: ModelInstallRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Install a model from the Ollama library
    """
    try:
        # Clean and validate the URL
        server_url = unquote(request.server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/pull
        if not server_url.endswith('/api/pull'):
            server_url = server_url.rstrip('/') + '/api/pull'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if request.api_key:
            headers['Authorization'] = f'Bearer {request.api_key}'

        # Set a much longer timeout for model downloads and disable redirects
        async with httpx.AsyncClient(timeout=1800.0, follow_redirects=False) as client:  # 30 minutes
            try:
                # Check if model already exists before attempting to install
                print(f"Checking if model {request.name} already exists...")
                model_exists = await check_model_exists(client, server_url, request.name, headers)
                
                if model_exists:
                    print(f"Model {request.name} already exists, skipping installation")
                    return {
                        "status": "success",
                        "message": f"Model '{request.name}' already exists on the server",
                        "data": {"model_name": request.name, "already_exists": True}
                    }

                # Prepare payload - use streaming for progress updates
                payload = {
                    "name": request.name,
                    "stream": True  # Enable streaming for progress updates
                }

                print(f"Installing model: {request.name} from {server_url}")
                print(f"Using streaming mode for progress updates")
                print(f"Payload being sent: {payload}")

                # Use streaming mode for progress updates
                print("Using streaming mode for install")
                response = await client.post(server_url, headers=headers, json=payload)
                print(f"Response status: {response.status_code}")
                print(f"Response headers: {dict(response.headers)}")
                
                if response.status_code == 200:
                    # Return a streaming response for progress updates
                    return StreamingResponse(
                        stream_response(response),
                        media_type="application/json",
                        status_code=response.status_code
                    )
                else:
                    # Get the error details from the response
                    error_detail = "Unknown error"
                    try:
                        if response.headers.get("content-type") == "application/json":
                            error_data = response.json()
                            error_detail = error_data.get("error", str(error_data))
                        else:
                            error_detail = response.text
                    except:
                        error_detail = response.text
                    
                    print(f"Ollama server error: {error_detail}")
                    # If the error is a known model not found error, return 400
                    if 'file does not exist' in error_detail.lower() or 'not found' in error_detail.lower():
                        raise HTTPException(
                            status_code=400,
                            detail=f"Error pulling model: file does not exist. Please check the model name in the Ollama library."
                        )
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Ollama server error: {error_detail}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Unexpected error in install_ollama_model: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

@router.delete("/delete")
async def delete_ollama_model(
    request: ModelDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a model from the Ollama server
    """
    try:
        # Clean and validate the URL
        server_url = unquote(request.server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/delete
        if not server_url.endswith('/api/delete'):
            server_url = server_url.rstrip('/') + '/api/delete'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if request.api_key:
            headers['Authorization'] = f'Bearer {request.api_key}'

        # Prepare payload
        payload = {
            "name": request.name
        }

        # Set a reasonable timeout and disable redirects
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            try:
                # Use client.request for DELETE with JSON body
                response = await client.request("DELETE", server_url, headers=headers, json=payload)
                if response.status_code == 200:
                    return {
                        "status": "success",
                        "data": response.json() if response.headers.get("content-type") == "application/json" else response.text
                    }
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Server returned status code {response.status_code}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )