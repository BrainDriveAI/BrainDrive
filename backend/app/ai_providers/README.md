# AI Providers Guide

This document provides information on using and testing the AI providers, particularly the Ollama provider.

## API Endpoints

The API has been consolidated to use fewer endpoints with parameters controlling the behavior:

- `/api/v1/ai/providers/generate` - For text generation (with `stream=true|false` parameter)
- `/api/v1/ai/providers/chat` - For chat completion (with `stream=true|false` parameter)

## Response Format

### Non-streaming Responses

For non-streaming requests (`stream=false`), the response is a JSON object with the following structure:

**Text Generation:**
```json
{
  "text": "The generated text response",
  "provider": "ollama",
  "model": "llama2",
  "metadata": { ... },
  "finish_reason": "stop"
}
```

**Chat Completion:**
```json
{
  "text": "The generated text response",
  "provider": "ollama",
  "model": "llama2",
  "metadata": { ... },
  "finish_reason": "stop",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "The generated text response"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### Streaming Responses

For streaming requests (`stream=true`), the response is a stream of server-sent events (SSE), with each event containing a JSON object with a similar structure to the non-streaming response, but with partial content.

## Request Parameters

### Common Parameters

- `provider`: The AI provider to use (e.g., "ollama")
- `model`: The model to use for generation (e.g., "llama2")
- `stream`: Whether to stream the response (true/false)
- `params`: Additional parameters for the generation:
  - `temperature`: Controls randomness (0.0 to 1.0)
  - `max_tokens`: Maximum number of tokens to generate
  - `top_p`: Controls diversity via nucleus sampling
  - `top_k`: Controls diversity via top-k sampling
  - `stop`: Sequences where the API will stop generating further tokens

### Text Generation Parameters

- `prompt`: The input prompt text

### Chat Completion Parameters

- `messages`: List of chat messages with role and content:
  ```json
  [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello, who are you?"}
  ]
  ```

## Implementation Details

### NDJSON Handling

The Ollama provider has been updated to handle NDJSON (Newline Delimited JSON) responses from the Ollama API. This is important because:

1. Ollama may return NDJSON responses even for non-streaming requests
2. Each line in the response is a separate JSON object
3. For non-streaming requests, we combine all chunks into a single response

### Streaming Control

The Ollama provider explicitly sets `stream=false` for non-streaming requests to ensure consistent behavior. This helps prevent issues where Ollama might return streaming responses even when not requested.

## Test Routes

For easier testing and debugging, test routes are available that bypass authentication and complex setup. These routes are enabled by default in development and can be disabled in production by setting the `ENABLE_TEST_ROUTES` environment variable to `"False"`.

The test routes provide a direct way to test the AI providers without needing to set up authentication or configure settings in the database.

### Testing Ollama Provider

#### Text Generation

**Non-streaming example:**

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/test/ollama/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain quantum computing in simple terms",
    "model": "llama2",
    "stream": false,
    "temperature": 0.7,
    "max_tokens": 100,
    "server_url": "http://localhost:11434"
  }'
```

**Streaming example:**

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/test/ollama/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Write a short poem about programming",
    "model": "llama2",
    "stream": true,
    "temperature": 0.7,
    "max_tokens": 100,
    "server_url": "http://localhost:11434"
  }'
```

#### Chat Completion

**Non-streaming example:**

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/test/ollama/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, who are you?"}
    ],
    "model": "llama2",
    "stream": false,
    "temperature": 0.7,
    "max_tokens": 100,
    "server_url": "http://localhost:11434"
  }'
```

**Streaming example:**

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/test/ollama/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Tell me a short story"}
    ],
    "model": "llama2",
    "stream": true,
    "temperature": 0.7,
    "max_tokens": 100,
    "server_url": "http://localhost:11434"
  }'
```

## Regular API Endpoints

For regular API usage (with authentication and settings), use the main endpoints:

### Text Generation

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "provider": "ollama",
    "settings_id": "ollama_servers_settings",
    "server_id": "your_server_id",
    "model": "llama2",
    "prompt": "Explain quantum computing in simple terms",
    "params": {
      "temperature": 0.7,
      "max_tokens": 100
    },
    "stream": false
  }'
```

### Chat Completion

```bash
curl -X POST "http://localhost:8000/api/v1/ai/providers/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "provider": "ollama",
    "settings_id": "ollama_servers_settings",
    "server_id": "your_server_id",
    "model": "llama2",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, who are you?"}
    ],
    "params": {
      "temperature": 0.7,
      "max_tokens": 100
    },
    "stream": false
  }'
```

## Troubleshooting

### Common Issues

1. **JSON Parsing Errors**: If you see errors about parsing JSON, it may be because Ollama is returning NDJSON. The provider should handle this automatically, but you can check the logs for details.

2. **Connection Errors**: Make sure the Ollama server is running and accessible at the specified URL.

3. **Model Not Found**: Ensure the model is available on your Ollama server. You can check available models with:
   ```bash
   curl http://localhost:11434/api/tags
   ```

4. **Streaming Issues**: If streaming isn't working as expected, check that your client can handle server-sent events (SSE) properly.

## Controlling Test Routes

To disable test routes in production, set the environment variable:

```bash
export ENABLE_TEST_ROUTES=False
```

Or in your .env file:

```
ENABLE_TEST_ROUTES=False
```

## Further Development

When implementing new AI providers, follow these guidelines:

1. Implement the `AIProvider` interface in a new class
2. Register the provider in the provider registry
3. Ensure proper error handling and response formatting
4. Add test routes for the new provider
