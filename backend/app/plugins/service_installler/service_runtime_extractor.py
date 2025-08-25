"""
Service Runtime Extractor

Extracts required_services_runtime configuration from plugin lifecycle_manager.py files.
Handles complex nested structures with robust parsing and fallback methods.
"""

import re
import ast
import structlog
from typing import List, Dict, Any, Optional

logger = structlog.get_logger()


def extract_required_services_runtime(content: str, plugin_name: str = None) -> List[Dict[str, Any]]:
    """
    Extract required_services_runtime configuration from plugin source code.
    
    Args:
        content: Source code content to parse
        plugin_name: Optional plugin name for logging
        
    Returns:
        List of service runtime configurations
    """
    plugin_ref = f" for {plugin_name}" if plugin_name else ""
    logger.info(f"Extracting required_services_runtime{plugin_ref}")
    
    # Try multiple extraction patterns
    services_match = None
    
    patterns = [
        ("self.required_services_runtime with nested brackets", 
         r'self\.required_services_runtime\s*=\s*(\[(?:[^\[\]]*|\[[^\[\]]*\])*\])'),
        ("required_services_runtime with nested brackets", 
         r'(?<!self\.)required_services_runtime\s*=\s*(\[(?:[^\[\]]*|\[[^\[\]]*\])*\])'),
        ("multiline with end anchor", 
         r'(?:self\.)?required_services_runtime\s*=\s*(\[[\s\S]*?^\s*\])'),
    ]
    
    for pattern_name, pattern in patterns:
        services_match = re.search(pattern, content, re.MULTILINE | re.DOTALL)
        if services_match:
            logger.debug(f"Found match with pattern: {pattern_name}")
            break
    
    # Fallback to bracket counting if regex patterns fail
    if not services_match:
        logger.debug("Trying manual bracket counting extraction...")
        services_match = extract_with_bracket_counting(content)
    
    if not services_match:
        logger.info(f"No required_services_runtime found{plugin_ref}")
        return []
    
    # Extract and parse the services
    services_str = services_match.group(1)
    logger.debug(f"Extracted {len(services_str)} characters")
    
    try:
        # Clean and parse with ast.literal_eval
        cleaned_str = clean_for_ast_parsing(services_str)
        services_list = ast.literal_eval(cleaned_str)
        
        if isinstance(services_list, list):
            valid_services = validate_and_normalize_services(services_list, plugin_name)
            logger.info(f"Successfully extracted {len(valid_services)} services{plugin_ref}")
            return valid_services
            
    except (ValueError, SyntaxError) as parse_err:
        logger.warning(f"AST parsing failed{plugin_ref}: {parse_err}")
        
        # Fallback to manual extraction
        try:
            logger.info(f"Attempting manual extraction{plugin_ref}...")
            manual_services = extract_services_manually(content)
            if manual_services:
                logger.info(f"Manually extracted {len(manual_services)} services{plugin_ref}")
                return manual_services
        except Exception as manual_err:
            logger.error(f"Manual extraction failed{plugin_ref}: {manual_err}")
    
    return []


def extract_with_bracket_counting(content: str):
    """
    Extract required_services_runtime using bracket counting for complete capture.
    
    Args:
        content: Source code content
        
    Returns:
        Mock match object or None
    """
    start_pattern = r'(?:self\.)?required_services_runtime\s*=\s*\['
    start_match = re.search(start_pattern, content)
    
    if not start_match:
        return None
    
    start_pos = start_match.end() - 1  # Include opening bracket
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
                    extracted = content[start_pos:pos + 1]
                    
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
    Clean up common issues that prevent ast.literal_eval from working.
    
    Args:
        services_str: Raw extracted services string
        
    Returns:
        Cleaned string ready for parsing
    """
    logger.debug(f"Cleaning string of length {len(services_str)}")
    
    # Remove comments
    cleaned = re.sub(r'#[^\r\n]*', '', services_str)
    
    # Remove trailing commas before closing brackets/braces
    cleaned = re.sub(r',(\s*[\]\}])', r'\1', cleaned)
    
    # Normalize quotes
    cleaned = re.sub(r"'([^'\"]*)'(\s*:)", r'"\1"\2', cleaned)  # Keys
    cleaned = re.sub(r":\s*'([^'\"]*)'", r': "\1"', cleaned)   # String values
    
    # Validate structure integrity
    if cleaned.count('[') != cleaned.count(']') or cleaned.count('{') != cleaned.count('}'):
        logger.warning("Structure validation failed during cleaning, using original")
        return services_str
    
    logger.debug(f"Cleaned to length {len(cleaned)}")
    return cleaned


def validate_and_normalize_services(services_list: List[Dict], plugin_name: str = None) -> List[Dict[str, Any]]:
    """
    Validate and normalize service configurations.
    
    Args:
        services_list: List of service dictionaries
        plugin_name: Optional plugin name for logging
        
    Returns:
        List of validated and normalized service configurations
    """
    plugin_ref = f" for {plugin_name}" if plugin_name else ""
    valid_services = []
    
    for i, service in enumerate(services_list):
        if not isinstance(service, dict):
            logger.warning(f"Service {i} is not a dictionary{plugin_ref}")
            continue
        
        if validate_service_structure(service):
            # Normalize with defaults
            normalized_service = normalize_service(service)
            valid_services.append(normalized_service)
            
            logger.info(f"Valid service: {normalized_service['name']} "
                       f"(type: {normalized_service['type']}){plugin_ref}")
            
            if normalized_service.get('required_env_vars'):
                logger.info(f"Service {normalized_service['name']} requires "
                           f"{len(normalized_service['required_env_vars'])} environment variables")
        else:
            logger.warning(f"Service {i} failed validation{plugin_ref}: {service}")
    
    return valid_services


def validate_service_structure(service: Dict[str, Any]) -> bool:
    """
    Validate that a service has all required fields.
    
    Args:
        service: Service configuration dictionary
        
    Returns:
        True if valid, False otherwise
    """
    required_fields = ["name", "source_url", "type", "healthcheck_url"]
    return all(
        field in service and 
        isinstance(service[field], str) and 
        service[field].strip() 
        for field in required_fields
    )


def normalize_service(service: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize service configuration with defaults.
    
    Args:
        service: Raw service configuration
        
    Returns:
        Normalized service configuration
    """
    normalized = service.copy()
    
    # Set defaults for optional fields
    normalized.setdefault("install_command", "")
    normalized.setdefault("start_command", "")
    normalized.setdefault("required_env_vars", [])
    
    # Ensure required_env_vars is a list
    if not isinstance(normalized["required_env_vars"], list):
        normalized["required_env_vars"] = []
    
    # Clean up string fields
    for field in ["name", "source_url", "type", "install_command", "start_command", "healthcheck_url"]:
        if field in normalized:
            normalized[field] = str(normalized[field]).strip()
    
    return normalized


def extract_services_manually(content: str) -> List[Dict[str, Any]]:
    """
    Manual extraction using regex when ast.literal_eval fails.
    
    Args:
        content: Full source code content
        
    Returns:
        List of manually extracted service configurations
    """
    services = []
    
    # Find the services runtime section
    start_pattern = r'(?:self\.)?required_services_runtime\s*=\s*\['
    start_match = re.search(start_pattern, content)
    
    if not start_match:
        return services
    
    # Extract content using bracket counting (reuse existing logic)
    bracket_match = extract_with_bracket_counting(content)
    if not bracket_match:
        return services
    
    services_content = bracket_match.group(1)
    
    # Find individual service dictionaries with improved regex
    service_pattern = r'\{(?:[^{}]|(?:\{[^{}]*\})|(?:\[[^\]]*\]))*\}'
    service_matches = re.findall(service_pattern, services_content, re.DOTALL)
    
    for service_str in service_matches:
        try:
            service = extract_single_service_manually(service_str)
            if service and validate_service_structure(service):
                normalized_service = normalize_service(service)
                services.append(normalized_service)
                logger.info(f"Manually extracted service: {normalized_service['name']} "
                           f"with {len(normalized_service['required_env_vars'])} env vars")
            
        except Exception as e:
            logger.warning(f"Failed to parse service manually: {e}")
            continue
    
    return services


def extract_single_service_manually(service_str: str) -> Optional[Dict[str, Any]]:
    """
    Extract a single service configuration using regex.
    
    Args:
        service_str: String representation of service dictionary
        
    Returns:
        Service configuration dictionary or None
    """
    service = {}
    
    # Extract string fields
    string_fields = [
        ('name', r'"name":\s*"([^"]+)"'),
        ('source_url', r'"source_url":\s*"([^"]+)"'),
        ('type', r'"type":\s*"([^"]+)"'),
        ('install_command', r'"install_command":\s*"([^"]*)"'),
        ('start_command', r'"start_command":\s*"([^"]*)"'),
        ('healthcheck_url', r'"healthcheck_url":\s*"([^"]+)"')
    ]
    
    for field_name, pattern in string_fields:
        match = re.search(pattern, service_str)
        service[field_name] = match.group(1) if match else ""
    
    # Extract required_env_vars array
    env_vars = []
    env_vars_match = re.search(
        r'"required_env_vars":\s*\[(.*?)\]', 
        service_str, 
        re.DOTALL
    )
    
    if env_vars_match:
        env_vars_content = env_vars_match.group(1)
        env_vars = re.findall(r'"([^"]+)"', env_vars_content)
    
    service['required_env_vars'] = env_vars
    
    return service if service.get('name') else None


# Convenience function for direct usage
def extract_from_file(file_path: str, plugin_name: str = None) -> List[Dict[str, Any]]:
    """
    Extract services runtime from a file.
    
    Args:
        file_path: Path to lifecycle_manager.py file
        plugin_name: Optional plugin name for logging
        
    Returns:
        List of service configurations
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return extract_required_services_runtime(content, plugin_name)
    except Exception as e:
        logger.error(f"Failed to read file {file_path}: {e}")
        return []


# if __name__ == "__main__":
#     # Example usage
#     test_content = '''
#         self.required_services_runtime = [
#             {
#                 "name": "cwyd_service",
#                 "source_url": "https://github.com/BrainDriveAI/chat-with-your-documents",
#                 "type": "docker-compose",
#                 "install_command": "",
#                 "start_command": "docker compose up --build -d",
#                 "healthcheck_url": "http://localhost:8000/health",
#                 "required_env_vars": [
#                     "LLM_PROVIDER",
#                     "EMBEDDING_PROVIDER",
#                     "ENABLE_CONTEXTUAL_RETRIEVAL",
#                     "OLLAMA_CONTEXTUAL_LLM_BASE_URL",
#                     "OLLAMA_CONTEXTUAL_LLM_MODEL",
#                     "OLLAMA_LLM_BASE_URL",
#                     "OLLAMA_LLM_MODEL",
#                     "OLLAMA_EMBEDDING_BASE_URL",
#                     "OLLAMA_EMBEDDING_MODEL",
#                     "DOCUMENT_PROCESSOR_API_URL",
#                     "DOCUMENT_PROCESSOR_TIMEOUT",
#                     "DOCUMENT_PROCESSOR_MAX_RETRIES",
#                     "ONE_MORE",
#                 ]
#             }
#         ]
#     '''
    
#     services = extract_required_services_runtime(test_content, "TestPlugin")
#     print(f"Extracted {len(services)} services:")
#     for service in services:
#         print(f"  - {service['name']} ({service['type']})")
