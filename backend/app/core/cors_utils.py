import re
from typing import List
from urllib.parse import urlparse
import structlog

logger = structlog.get_logger("cors")

def build_dev_origin_regex(hosts: List[str] = None) -> str:
    """
    Build regex pattern for development origins.
    Supports IPv4, IPv6, and localhost with any port.
    
    Args:
        hosts: List of allowed hosts. Defaults to ["localhost", "127.0.0.1", "[::1]"]
    
    Returns:
        Regex pattern string for use with CORSMiddleware allow_origin_regex
    """
    if not hosts:
        hosts = ["localhost", "127.0.0.1", "[::1]"]
    
    # Escape special regex characters and handle IPv6
    escaped_hosts = []
    for host in hosts:
        if host.startswith("[") and host.endswith("]"):
            # IPv6 - already bracketed, escape the brackets
            escaped_hosts.append(re.escape(host))
        else:
            # IPv4 or hostname - escape dots and other special chars
            escaped_hosts.append(re.escape(host))
    
    # Create regex pattern: ^https?://(host1|host2|host3)(:\d+)?$
    host_pattern = "|".join(escaped_hosts)
    regex = rf"^https?://({host_pattern})(:\d+)?$"
    
    logger.info("Development CORS regex created", 
               pattern=regex, 
               hosts=hosts)
    
    return regex

def validate_production_origins(origins: List[str]) -> List[str]:
    """
    Validate production origins are properly formatted URLs.
    
    Args:
        origins: List of origin URLs to validate
    
    Returns:
        List of validated origins
    """
    validated = []
    for origin in origins:
        try:
            parsed = urlparse(origin)
            if not parsed.scheme or not parsed.netloc:
                logger.warning("Invalid origin format - missing scheme or netloc", 
                             origin=origin)
                continue
            if parsed.scheme not in ("http", "https"):
                logger.warning("Invalid origin scheme - must be http or https", 
                             origin=origin, 
                             scheme=parsed.scheme)
                continue
            # Additional production checks
            if parsed.scheme == "http" and not origin.startswith("http://localhost"):
                logger.warning("HTTP origins not recommended for production", 
                             origin=origin)
            validated.append(origin)
        except Exception as e:
            logger.error("Error parsing origin", 
                        origin=origin, 
                        error=str(e))
            continue
    
    logger.info("Production origins validated", 
               total=len(origins), 
               valid=len(validated),
               origins=validated)
    
    return validated

def log_cors_config(app_env: str, **kwargs):
    """
    Log CORS configuration for debugging purposes.
    
    Args:
        app_env: Application environment (dev, staging, prod)
        **kwargs: Additional configuration parameters to log
    """
    logger.info("CORS configuration applied",
               environment=app_env,
               **kwargs)

def get_cors_debug_info(request_origin: str = None, app_env: str = None) -> dict:
    """
    Get debugging information for CORS issues.
    
    Args:
        request_origin: The origin from the request
        app_env: Application environment
    
    Returns:
        Dictionary with debug information
    """
    debug_info = {
        "environment": app_env,
        "request_origin": request_origin,
        "timestamp": structlog.get_logger().info.__globals__.get("time", "unknown")
    }
    
    if request_origin:
        try:
            parsed = urlparse(request_origin)
            debug_info.update({
                "origin_scheme": parsed.scheme,
                "origin_hostname": parsed.hostname,
                "origin_port": parsed.port,
                "origin_netloc": parsed.netloc
            })
        except Exception as e:
            debug_info["origin_parse_error"] = str(e)
    
    return debug_info