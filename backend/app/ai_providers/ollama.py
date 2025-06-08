"""
Ollama AI provider implementation (clean and streaming-ready).
"""
import httpx
import json
import asyncio
from typing import Dict, List, Any, AsyncGenerator
from .base import AIProvider
import re
from app.utils.link_injector import load_keyword_map, inject_links


class OllamaProvider(AIProvider):
    _keyword_map = None

    @classmethod
    def get_keyword_map(cls):
        if cls._keyword_map is None:
            cls._keyword_map = load_keyword_map()
        return cls._keyword_map

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
        
        prompt = self._format_chat_messages(messages, model)
        print(f"Formatted prompt (full):\n{prompt}")
        
        result = await self._call_ollama_api(prompt, model, params, is_streaming=False)
        if "error" not in result:
            text = result.get("text", "")
            text = self.clean_think_tags(text)
            # Inject links into the response
            user_prompt = ""
            for msg in messages:
                if msg.get("role") == "user":
                    user_prompt = msg.get("content", "")
            keyword_map = self.get_keyword_map()
            text = inject_links(text, user_prompt, keyword_map, use_markdown=False)
            result["text"] = text
            result["choices"] = [{
                "message": {
                    "role": "assistant",
                    "content": text
                },
                "finish_reason": result.get("finish_reason")
            }]
        return result

    async def chat_completion_stream(self, messages: List[Dict[str, Any]], model: str, params: Dict[str, Any]) -> AsyncGenerator[Dict[str, Any], None]:
        print(f"Ollama chat_completion_stream received {len(messages)} messages")
        print(f"DETAILED MESSAGE INSPECTION (STREAMING):")
        for i, msg in enumerate(messages):
            print(f"  Message {i+1}: role={msg.get('role', 'unknown')}, content={msg.get('content', '')}")
        
        prompt = self._format_chat_messages(messages, model)
        print(f"Formatted prompt (full):\n{prompt}")
        
        first_content_found = False
        full_response = ""
        user_prompt = ""
        last_chunk = None
        for msg in messages:
            if msg.get("role") == "user":
                user_prompt = msg.get("content", "")
        async for chunk in self._stream_ollama_api(prompt, model, params):
            if "error" not in chunk:
                text = chunk.get("text", "")
                text = self.clean_think_tags_streaming(text)
                if not first_content_found:
                    if text.strip() == "":
                        continue  # skip empty/newline-only chunks at the start
                    text = text.lstrip('\n\r\t ')
                    first_content_found = True
                full_response += text
                chunk["text"] = text
                chunk["choices"] = [{
                    "delta": {
                        "role": "assistant",
                        "content": text
                    },
                    "finish_reason": chunk.get("finish_reason")
                }]
                last_chunk = chunk
                # If this is the final chunk, append links to the content
                if chunk.get("done"):
                    keyword_map = self.get_keyword_map()
                    links_text = inject_links("", user_prompt, keyword_map, use_markdown=False)
                    if links_text and links_text.strip():
                        # Append links to the last chunk's content
                        chunk["text"] += links_text
                        chunk["choices"][0]["delta"]["content"] += links_text
                    yield chunk
                else:
                    yield chunk
            else:
                # If error, yield as is
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
                                raw_response = data.get("response", "")
                                print(f"[OLLAMA STREAM RAW RESPONSE CHUNK]: '{raw_response}'")
                                yield {
                                    "text": raw_response,
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

    def _format_chat_messages(self, messages: List[Dict[str, Any]], model: str) -> str:
        try:
            if "concierge" in model.lower():
                return self._format_concierge_messages(messages)
            return self._format_default_messages(messages)
        except Exception as e:
            print(f"Chat formatting error: {e}")
            return "Hello, can you help me?"

    def _format_default_messages(self, messages: List[Dict[str, Any]]) -> str:
        print(f"Formatting {len(messages)} messages (default)")
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

    def _format_concierge_messages(self, messages: List[Dict[str, Any]]) -> str:
        print(f"Formatting {len(messages)} messages (concierge)")
        formatted = []
        for i, msg in enumerate(messages):
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                prefix = "System: "
            elif role == "assistant":
                prefix = "Assistant: "
            else:
                prefix = "User: "
            formatted_msg = f"{prefix}{content}"
            print(f"  Formatting message {i+1}: role={role}, prefix={prefix}")
            print(f"  Formatted message: {formatted_msg}")
            formatted.append(formatted_msg)
        result = "\n".join(formatted)
        print(f"Final formatted result length: {len(result)} characters (concierge)")
        print(f"FINAL FORMATTED PROMPT (concierge):\n{result}")
        return result

    def clean_think_tags(self, text: str) -> str:
        """Remove <think> and </think> tags, but keep the content inside. Collapse multiple newlines and spaces."""
        if not isinstance(text, str):
            return text
        # Remove <think> and </think> tags, but keep the content inside
        text = re.sub(r'</?think>', '', text)
        # Collapse multiple newlines into a single newline
        text = re.sub(r'\n{2,}', '\n', text)
        # Collapse multiple spaces into a single space
        text = re.sub(r' {2,}', ' ', text)
        # Strip leading/trailing whitespace
        return text.strip()

    def clean_think_tags_streaming(self, text: str) -> str:
        """Remove <think> and </think> tags, but keep the content and all spaces/newlines (for streaming)."""
        if not isinstance(text, str):
            return text
        return re.sub(r'</?think>', '', text)
