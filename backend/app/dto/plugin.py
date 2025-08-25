from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# This schema is used for returning data from the repository.
# It ensures that JSON fields are correctly converted to Python types.
class PluginServiceRuntimeDTO(BaseModel):
    """
    A Pydantic model to represent a PluginServiceRuntime object,
    with required_env_vars as a list of strings.
    """
    id: str
    plugin_id: str
    plugin_slug: str
    name: str
    source_url: Optional[str] = None
    type: Optional[str] = None
    install_command: Optional[str] = None
    start_command: Optional[str] = None
    healthcheck_url: Optional[str] = None
    required_env_vars: List[str] = []
    status: Optional[str] = None
    user_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
