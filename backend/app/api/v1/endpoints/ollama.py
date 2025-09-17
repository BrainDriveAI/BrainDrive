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
from dataclasses import dataclass, field
from collections import deque
import time
import uuid

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

# -----------------------------
# In-memory background job model
# -----------------------------

TERMINAL_STATES = {"completed", "error", "canceled"}


@dataclass
class InstallTask:
    task_id: str
    name: str
    server_base: str
    api_key: Optional[str] = None
    state: str = "queued"  # queued | running | downloading | verifying | extracting | completed | error | canceled
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    created_at: float = field(default_factory=lambda: time.time())
    updated_at: float = field(default_factory=lambda: time.time())
    dedupe_key: str = ""
    ring_buffer: deque = field(default_factory=lambda: deque(maxlen=200))
    subscribers: set = field(default_factory=set)  # Set[asyncio.Queue]
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


# Global registries (single-process)
TASKS: Dict[str, InstallTask] = {}
MODEL_TO_TASK: Dict[str, str] = {}
SEMAPHORE = asyncio.Semaphore(1)  # Limit concurrent downloads
TASK_TTL_SECONDS = 60 * 10  # keep finished tasks for 10 minutes


def normalize_server_base(url: str) -> str:
    url = unquote(url).strip()
    url = url.rstrip("/")
    # Remove common suffixes to get the base host
    if url.endswith("/api/pull"):
        url = url[: -len("/api/pull")]
    if url.endswith("/api"):
        url = url[: -len("/api")]
    return url


def make_dedupe_key(server_base: str, name: str) -> str:
    return f"{server_base}|{name}"


async def emit_event(task: InstallTask, payload: Dict[str, Any]) -> None:
    payload = {
        "task_id": task.task_id,
        "name": task.name,
        "state": task.state,
        "progress": task.progress,
        "message": task.message,
        **payload,
    }
    line = json.dumps(payload)
    # Append to ring buffer
    task.ring_buffer.append(line)
    # Fan-out to subscribers
    stale: List[asyncio.Queue] = []
    for q in list(task.subscribers):
        try:
            q.put_nowait(line)
        except Exception:
            stale.append(q)
    for q in stale:
        task.subscribers.discard(q)


def is_terminal(task: InstallTask) -> bool:
    return task.state in TERMINAL_STATES


def cleanup_tasks() -> None:
    now = time.time()
    to_delete = []
    for tid, t in TASKS.items():
        if is_terminal(t) and now - t.updated_at > TASK_TTL_SECONDS:
            to_delete.append(tid)
    for tid in to_delete:
        task = TASKS.pop(tid, None)
        if task:
            MODEL_TO_TASK.pop(task.dedupe_key, None)


async def run_install_worker(task: InstallTask) -> None:
    pull_url = f"{task.server_base}/api/pull"
    headers = {"Content-Type": "application/json"}
    if task.api_key:
        headers["Authorization"] = f"Bearer {task.api_key}"

    async with task.lock:
        task.state = "queued"
        task.message = "Queued"
        task.updated_at = time.time()
    await emit_event(task, {})

    async with SEMAPHORE:
        # Start streaming download (always attempt; Ollama will be fast if it already exists)
        async with httpx.AsyncClient(timeout=1800.0, follow_redirects=False) as client:
            try:
                # Indicate connection is starting
                async with task.lock:
                    task.state = "running"
                    task.message = "Connecting to Ollama"
                    task.updated_at = time.time()
                await emit_event(task, {})

                async with client.stream(
                    "POST", pull_url, headers=headers, json={"name": task.name, "stream": True}
                ) as resp:
                    # Emit HTTP status event
                    await emit_event(task, {"http_status": resp.status_code})
                    if resp.status_code != 200:
                        # Extract error
                        text = await resp.aread()
                        err = text.decode(errors="ignore") if isinstance(text, (bytes, bytearray)) else str(text)
                        async with task.lock:
                            task.state = "error"
                            task.error = f"Ollama server error: {err or resp.status_code}"
                            task.message = "Failed"
                            task.updated_at = time.time()
                        await emit_event(task, {})
                        return

                    async with task.lock:
                        task.state = "downloading"
                        task.message = "Starting download"
                        task.updated_at = time.time()
                    await emit_event(task, {})

                    had_lines = False
                    succeeded = False
                    async for line in resp.aiter_lines():
                        had_lines = True
                        if line.strip():
                            pass
                        if task.cancel_event.is_set():
                            try:
                                await resp.aclose()
                            except Exception:
                                pass
                            async with task.lock:
                                task.state = "canceled"
                                task.message = "Canceled"
                                task.updated_at = time.time()
                            await emit_event(task, {})
                            return

                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            # Pass-through text
                            data = {"raw": line}

                        # Handle explicit error from Ollama
                        if isinstance(data, dict) and data.get("error"):
                            async with task.lock:
                                task.state = "error"
                                task.error = str(data.get("error"))
                                task.message = "Failed"
                                task.updated_at = time.time()
                            await emit_event(task, {"raw": data})
                            break

                        # Update progress heuristics
                        status = str(data.get("status") or data.get("message") or "").lower()
                        total = data.get("total")
                        completed = data.get("completed")
                        prog = task.progress
                        state_update = None
                        if isinstance(total, (int, float)) and isinstance(completed, (int, float)) and total:
                            # Use floor to avoid premature 100% before success is emitted
                            prog = int(max(0, min(100, (completed * 100.0) // total)))
                            state_update = "downloading"
                        else:
                            if "verifying" in status:
                                prog = max(prog, 90)
                                state_update = "verifying"
                            elif "writing" in status or "extract" in status:
                                prog = max(prog, 95)
                                state_update = "extracting"
                            elif "success" in status:
                                prog = 100
                                state_update = "completed"
                                succeeded = True

                        async with task.lock:
                            if state_update:
                                task.state = state_update
                            task.progress = prog
                            task.message = data.get("status") or data.get("message") or task.message
                            task.updated_at = time.time()

                        await emit_event(task, {"raw": data})

                        # Only break on explicit success or completed state
                        if task.state == "completed" or ("success" in status):
                            break

                    # Finalize
                    async with task.lock:
                        if task.state not in TERMINAL_STATES:
                            if succeeded:
                                task.state = "completed"
                                task.progress = 100
                                task.message = "Completed"
                            else:
                                # No success observed; treat as error to avoid false positives
                                if not had_lines:
                                    task.error = "No progress received from Ollama stream"
                                else:
                                    task.error = task.error or "Install did not complete successfully"
                                task.state = "error"
                                task.message = "Failed"
                            task.updated_at = time.time()
                    await emit_event(task, {})
            except httpx.TimeoutException:
                async with task.lock:
                    task.state = "error"
                    task.error = "Connection timed out"
                    task.message = "Failed"
                    task.updated_at = time.time()
                await emit_event(task, {})
            except httpx.ConnectError:
                async with task.lock:
                    task.state = "error"
                    task.error = "Could not connect to server"
                    task.message = "Failed"
                    task.updated_at = time.time()
                await emit_event(task, {})
            except httpx.RequestError as e:
                async with task.lock:
                    task.state = "error"
                    task.error = f"Error connecting to Ollama server: {str(e)}"
                    task.message = "Failed"
                    task.updated_at = time.time()
                await emit_event(task, {})
            finally:
                # Cleanup dedupe map when terminal
                if is_terminal(task):
                    MODEL_TO_TASK.pop(task.dedupe_key, None)
                cleanup_tasks()

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

async def check_model_exists(client: httpx.AsyncClient, server_base: str, model_name: str, headers: dict) -> bool:
    """
    Check if a model already exists on the Ollama server
    """
    try:
        # Construct the models endpoint URL
        base = server_base.rstrip('/')
        models_url = f"{base}/api/tags"
        
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
    """Enqueue a background install and return task_id immediately (Redis-free)."""
    try:
        server_base = normalize_server_base(request.server_url)
        if not server_base.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Invalid server URL. Must start with http:// or https://")

        dedupe_key = make_dedupe_key(server_base, request.name)
        # Return existing non-terminal task if present
        existing_task_id = MODEL_TO_TASK.get(dedupe_key)
        if existing_task_id:
            existing = TASKS.get(existing_task_id)
            if existing and existing.state not in TERMINAL_STATES:
                return {"task_id": existing.task_id, "deduped": True}

        # Create new task
        task_id = uuid.uuid4().hex
        task = InstallTask(
            task_id=task_id,
            name=request.name,
            server_base=server_base,
            api_key=request.api_key,
            dedupe_key=dedupe_key,
        )
        TASKS[task_id] = task
        MODEL_TO_TASK[dedupe_key] = task_id

        # Schedule worker
        asyncio.create_task(run_install_worker(task))

        return {"task_id": task_id, "deduped": False}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")


@router.get("/install/{task_id}")
async def get_install_status(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "task_id": task.task_id,
        "name": task.name,
        "server_base": task.server_base,
        "state": task.state,
        "progress": task.progress,
        "message": task.message,
        "error": task.error,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
    }


@router.get("/install/{task_id}/events")
async def stream_install_events(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    async def event_generator() -> AsyncGenerator[bytes, None]:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        # Subscribe
        task.subscribers.add(q)
        # subscriber connected (debug removed)
        # Replay ring buffer first
        for line in list(task.ring_buffer):
            yield f"data: {line}\n\n".encode()
        # If task already finished, end the stream
        if is_terminal(task):
            # immediate close on terminal (debug removed)
            return

        try:
            while True:
                try:
                    line = await q.get()
                except asyncio.CancelledError:
                    break
                yield f"data: {line}\n\n".encode()
                try:
                    obj = json.loads(line)
                    if obj.get("state") in TERMINAL_STATES or int(obj.get("progress", 0)) >= 100:
                        # closing on terminal (debug removed)
                        break
                except Exception:
                    # If parsing fails, keep streaming
                    pass
        finally:
            # Unsubscribe
            try:
                task.subscribers.discard(q)
                # subscriber disconnected (debug removed)
            except Exception:
                pass

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.delete("/install/{task_id}")
async def cancel_install(task_id: str):
    task = TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.cancel_event.set()
    return {"task_id": task.task_id, "state": "canceling"}

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
