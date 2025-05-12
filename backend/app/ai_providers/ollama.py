"""
Ollama AI provider implementation (clean and streaming-ready).
"""
import httpx
import json
import asyncio
from typing import Dict, List, Any, AsyncGenerator
from .base import AIProvider


class OllamaProvider(AIProvider):
    @property
    def provider_name(self) -> str:
        return "ollama"

    async def initialize(self, config: Dict[str, Any]) -> bool:
        self.server_url = config.get("server_url", "http://localhost:11434")
        self.api_key = config.get("api_key", "")
        self.server_name = config.get("server_name", "Default Ollama Server")
        return True

    async def get_models(self) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.server_url}/api/tags")
            models = response.json().get("models", [])
            return [
                {
                    "id": model["name"],
                    "name": model["name"],
                    "provider": "ollama",
                    "metadata": model
                }
                for model in models
            ]

    async def generate_text(self, prompt: str, model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        return await self._call_ollama_api(prompt, model, params, is_streaming=False)

    async def generate_stream(self, prompt: str, model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        async for chunk in self._stream_ollama_api(prompt, model, params):
            yield chunk

    async def chat_completion(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> Dict[str, Any]:
        print(f"Ollama chat_completion received {len(messages)} messages")
        print(f"DETAILED MESSAGE INSPECTION:")
        for i, msg in enumerate(messages):
            print(f"  Message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')}")
        
        prompt = self._format_chat_messages(messages)
        print(f"Formatted prompt (full):\n{prompt}")
        
        result = await self._call_ollama_api(prompt, model, params, is_streaming=False)
        if "error" not in result:
            result["choices"] = [{
                "message": {
                    "role": "assistant",
                    "content": result.get("text", "")
                },
                "finish_reason": result.get("finish_reason")
            }]
        return result

    async def chat_completion_stream(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        print(f"Ollama chat_completion_stream received {len(messages)} messages")
        print(f"DETAILED MESSAGE INSPECTION (STREAMING):")
        for i, msg in enumerate(messages):
            print(f"  Message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')}")
        
        prompt = self._format_chat_messages(messages)
        print(f"Formatted prompt (full):\n{prompt}")
        
        async for chunk in self._stream_ollama_api(prompt, model, params):
            if "error" not in chunk:
                chunk["choices"] = [{
                    "delta": {
                        "role": "assistant",
                        "content": chunk.get("text", "")
                    },
                    "finish_reason": chunk.get("finish_reason")
                }]
            yield chunk

    async def _call_ollama_api(self, prompt: str, model: str, params: Dict[str, Any], is_streaming: bool = False) -> Dict[str, Any]:
        payload_params = params.copy() if params else {}
        payload_params["stream"] = False
        payload = {"model": model, "prompt": prompt, **payload_params}
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(f"{self.server_url}/api/generate", json=payload, headers=headers)
                response.raise_for_status()
                result = response.json()
                return {
                    "text": result.get("response", ""),
                    "provider": "ollama",
                    "model": model,
                    "metadata": result,
                    "finish_reason": result.get("done") and "stop" or None
                }
        except Exception as e:
            return self._format_error(e, model)

    async def _stream_ollama_api(self, prompt: str, model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        payload_params = params.copy() if params else {}
        payload_params["stream"] = True
        payload = {"model": model, "prompt": prompt, **payload_params}
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['Authorization'] = f'Bearer {self.api_key}'

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", f"{self.server_url}/api/generate", json=payload, headers=headers) as response:
                    response.raise_for_status()
                    async for chunk in response.aiter_lines():
                        if chunk:
                            try:
                                data = json.loads(chunk)
                                yield {
                                    "text": data.get("response", ""),
                                    "provider": "ollama",
                                    "model": model,
                                    "metadata": data,
                                    "finish_reason": data.get("done") and "stop" or None,
                                    "done": data.get("done", False)
                                }
                                await asyncio.sleep(0.01)
                            except json.JSONDecodeError:
                                continue
        except Exception as e:
            yield self._format_error(e, model, done=True)

    def _format_error(self, error, model, done=False):
        error_response = {
            "error": True,
            "provider": "ollama",
            "model": model,
            "message": str(error)
        }
        if done:
            error_response["done"] = True
        return error_response

    async def validate_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        server_url = config.get("server_url", "http://localhost:11434")
        api_key = config.get("api_key", "")
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{server_url}/api/version", headers=headers)
                response.raise_for_status()
                return {
                    "status": "success",
                    "version": response.json().get("version", "unknown"),
                    "provider": "ollama"
                }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "provider": "ollama"
            }

    def _format_chat_messages(self, messages: List[Dict[str, Any]]) -> str:
        try:
            print(f"Formatting {len(messages)} messages")
            formatted = []
            for i, msg in enumerate(messages):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                tag = "system" if role == "system" else ("assistant" if role == "assistant" else "user")
                formatted_msg = f"<{tag}>\n{content}\n</{tag}>"
                print(f"  Formatting message {i+1}: role={role}, tag={tag}")
                print(f"  Formatted message: {formatted_msg}")
                formatted.append(formatted_msg)
            result = "\n".join(formatted)
            print(f"Final formatted result length: {len(result)} characters")
            print(f"FINAL FORMATTED PROMPT:\n{result}")
            return result
        except Exception as e:
            print(f"Chat formatting error: {e}")
            return "Hello, can you help me?"
