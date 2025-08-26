import ast
import re

def debug_list_parsing():
    """
    Test parsing of your specific service structure with improved extraction
    """
    
    # Your actual structure
    test_content = '''
self.required_services_runtime = [
    {
        "name": "cwyd_service",
        "source_url": "https://github.com/BrainDriveAI/chat-with-your-documents",
        "type": "docker-compose",
        "install_command": "",
        "start_command": "docker compose up --build -d",
        "healthcheck_url": "http://localhost:8000/health",
        "required_env_vars": [
            "LLM_PROVIDER",
            "EMBEDDING_PROVIDER",
            "ENABLE_CONTEXTUAL_RETRIEVAL",
            "OLLAMA_CONTEXTUAL_LLM_BASE_URL",
            "OLLAMA_CONTEXTUAL_LLM_MODEL",
            "OLLAMA_LLM_BASE_URL",
            "OLLAMA_LLM_MODEL",
            "OLLAMA_EMBEDDING_BASE_URL",
            "OLLAMA_EMBEDDING_MODEL",
            "DOCUMENT_PROCESSOR_API_URL",
            "DOCUMENT_PROCESSOR_TIMEOUT",
            "DOCUMENT_PROCESSOR_MAX_RETRIES",
        ]
    }
]
    '''
    
    print("=== DEBUGGING LIST PARSING WITH IMPROVED EXTRACTION ===\n")
    
    # Test different extraction patterns
    patterns = [
        ("Pattern 1: Nested bracket matching", r'self\.required_services_runtime\s*=\s*(\[(?:[^\[\]]*|\[[^\[\]]*\])*\])'),
        ("Pattern 2: Multiline with end anchor", r'(?:self\.)?required_services_runtime\s*=\s*(\[[\s\S]*?^\s*\])'),
        ("Pattern 3: Bracket counting", "BRACKET_COUNTING"),
    ]
    
    for pattern_name, pattern in patterns:
        print(f"--- Testing {pattern_name} ---")
        
        if pattern == "BRACKET_COUNTING":
            services_match = extract_with_bracket_counting(test_content)
        else:
            services_match = re.search(pattern, test_content, re.MULTILINE | re.DOTALL)
        
        if services_match:
            services_str = services_match.group(1)
            print(f"✅ EXTRACTED: {len(services_str)} chars")
            print(f"First 100: {repr(services_str[:100])}")
            print(f"Last 100: {repr(services_str[-100:])}")
            
            # Test cleaning and parsing
            try:
                cleaned = clean_for_ast_parsing(services_str)
                print(f"Cleaned length: {len(cleaned)}")
                
                result = ast.literal_eval(cleaned)
                print(f"✅ PARSING SUCCESS: {len(result)} services")
                
                if result and isinstance(result[0], dict):
                    service = result[0]
                    print(f"  Service: {service.get('name')}")
                    print(f"  Type: {service.get('type')}")
                    print(f"  Env vars: {len(service.get('required_env_vars', []))}")
                break
            except Exception as e:
                print(f"❌ PARSING FAILED: {e}")
        else:
            print("❌ NO MATCH")
        print()


def extract_with_bracket_counting(content: str):
    """
    Extract required_services_runtime using bracket counting to ensure complete capture
    """
    import re
    
    # Find the start of required_services_runtime
    start_pattern = r'(?:self\.)?required_services_runtime\s*=\s*\['
    start_match = re.search(start_pattern, content)
    
    if not start_match:
        return None
    
    # Get position right after the opening bracket
    start_pos = start_match.end() - 1  # Include the opening bracket
    
    # Count brackets to find the matching closing bracket
    bracket_count = 0
    pos = start_pos
    in_string = False
    escape_next = False
    quote_char = None
    
    while pos < len(content):
        char = content[pos]
        
        if escape_next:
            escape_next = False
        elif char == '\\':
            escape_next = True
        elif not in_string and char in ['"', "'"]:
            in_string = True
            quote_char = char
        elif in_string and char == quote_char and not escape_next:
            in_string = False
            quote_char = None
        elif not in_string:
            if char == '[':
                bracket_count += 1
            elif char == ']':
                bracket_count -= 1
                if bracket_count == 0:
                    # Found the matching closing bracket
                    extracted = content[start_pos:pos + 1]
                    
                    # Create a mock match object
                    class MockMatch:
                        def __init__(self, text):
                            self._text = text
                        def group(self, n):
                            return self._text
                    
                    return MockMatch(extracted)
        pos += 1
    
    return None


def clean_for_ast_parsing(services_str: str) -> str:
    """
    Clean up common issues that prevent ast.literal_eval from working
    Enhanced to handle more edge cases
    """
    import re
    
    print(f"  Cleaning string of length {len(services_str)}")
    
    # Remove comments (but be careful not to remove quotes inside strings)
    cleaned = re.sub(r'#[^\r\n]*', '', services_str)
    
    # Remove trailing commas before closing brackets/braces
    # This handles the main issue from your debug output
    cleaned = re.sub(r',(\s*[\]\}])', r'\1', cleaned)
    
    # Normalize quotes (ensure all are double quotes, but preserve content)
    # Only replace single quotes that are around keys/values, not inside strings
    cleaned = re.sub(r"'([^'\"]*)'(\s*:)", r'"\1"\2', cleaned)  # Keys
    cleaned = re.sub(r":\s*'([^'\"]*)'", r': "\1"', cleaned)   # String values
    
    # Validate that we still have a complete structure
    if cleaned.count('[') != cleaned.count(']') or cleaned.count('{') != cleaned.count('}'):
        print(f"  ⚠️  Structure validation failed, using original")
        return services_str
    
    print(f"  Cleaned to length {len(cleaned)}")
    return cleaned


# if __name__ == "__main__":
#     debug_list_parsing()
