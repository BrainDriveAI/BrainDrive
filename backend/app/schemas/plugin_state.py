from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

class StateStrategy(str, Enum):
    NONE = "none"
    SESSION = "session"
    PERSISTENT = "persistent"
    CUSTOM = "custom"

class SyncStatus(str, Enum):
    SYNCED = "synced"
    PENDING = "pending"
    CONFLICT = "conflict"

class ChangeType(str, Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    RESTORE = "restore"

# Base schemas
class PluginStateBase(BaseModel):
    plugin_id: str = Field(..., description="Plugin identifier")
    page_id: Optional[str] = Field(None, description="Optional page-specific state")
    state_key: Optional[str] = Field(None, description="Optional state namespace key")
    state_strategy: StateStrategy = Field(StateStrategy.PERSISTENT, description="State persistence strategy")
    ttl_expires_at: Optional[datetime] = Field(None, description="Time-to-live expiration")

class PluginStateCreate(PluginStateBase):
    state_data: Dict[Any, Any] = Field(..., description="State data to persist")
    device_id: Optional[str] = Field(None, description="Device identifier")
    state_schema_version: Optional[str] = Field(None, description="Schema version for migration")

class PluginStateUpdate(BaseModel):
    state_data: Optional[Dict[Any, Any]] = Field(None, description="Updated state data")
    state_strategy: Optional[StateStrategy] = Field(None, description="Updated persistence strategy")
    ttl_expires_at: Optional[datetime] = Field(None, description="Updated TTL expiration")
    device_id: Optional[str] = Field(None, description="Device identifier")
    state_schema_version: Optional[str] = Field(None, description="Updated schema version")

class PluginStateResponse(PluginStateBase):
    id: str = Field(..., description="State record ID")
    user_id: str = Field(..., description="User ID")
    state_data: Dict[Any, Any] = Field(..., description="State data")
    state_schema_version: Optional[str] = Field(None, description="Schema version")
    compression_type: Optional[str] = Field(None, description="Compression type used")
    state_size: int = Field(0, description="State size in bytes")
    last_accessed: datetime = Field(..., description="Last access timestamp")
    access_count: int = Field(0, description="Access count")
    is_active: bool = Field(True, description="Whether state is active")
    version: int = Field(1, description="Version for conflict resolution")
    device_id: Optional[str] = Field(None, description="Device that last updated")
    sync_status: SyncStatus = Field(SyncStatus.SYNCED, description="Sync status")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True

# Bulk operations
class PluginStateBulkCreate(BaseModel):
    states: List[PluginStateCreate] = Field(..., description="List of states to create")

class PluginStateBulkResponse(BaseModel):
    created: List[PluginStateResponse] = Field(..., description="Successfully created states")
    errors: List[Dict[str, Any]] = Field([], description="Errors during creation")

# State history schemas
class PluginStateHistoryResponse(BaseModel):
    id: str = Field(..., description="History record ID")
    plugin_state_id: str = Field(..., description="Plugin state ID")
    state_data: Dict[Any, Any] = Field(..., description="Historical state data")
    version: int = Field(..., description="State version")
    change_type: ChangeType = Field(..., description="Type of change")
    device_id: Optional[str] = Field(None, description="Device identifier")
    user_agent: Optional[str] = Field(None, description="User agent")
    ip_address: Optional[str] = Field(None, description="IP address")
    created_at: datetime = Field(..., description="Change timestamp")

    class Config:
        from_attributes = True

# State configuration schemas
class PluginStateConfigBase(BaseModel):
    plugin_id: str = Field(..., description="Plugin identifier")
    config_version: str = Field("1.0.0", description="Configuration version")

class PluginStateConfigCreate(PluginStateConfigBase):
    config_data: Dict[Any, Any] = Field(..., description="Configuration data")
    created_by: Optional[str] = Field(None, description="Admin who created config")

class PluginStateConfigUpdate(BaseModel):
    config_data: Optional[Dict[Any, Any]] = Field(None, description="Updated configuration data")
    config_version: Optional[str] = Field(None, description="Updated configuration version")
    is_active: Optional[bool] = Field(None, description="Whether config is active")

class PluginStateConfigResponse(PluginStateConfigBase):
    id: str = Field(..., description="Config record ID")
    config_data: Dict[Any, Any] = Field(..., description="Configuration data")
    is_active: bool = Field(True, description="Whether config is active")
    created_by: Optional[str] = Field(None, description="Admin who created config")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")

    class Config:
        from_attributes = True

# Query and filter schemas
class PluginStateQuery(BaseModel):
    plugin_id: Optional[str] = Field(None, description="Filter by plugin ID")
    page_id: Optional[str] = Field(None, description="Filter by page ID")
    state_key: Optional[str] = Field(None, description="Filter by state key")
    state_strategy: Optional[StateStrategy] = Field(None, description="Filter by strategy")
    sync_status: Optional[SyncStatus] = Field(None, description="Filter by sync status")
    is_active: Optional[bool] = Field(None, description="Filter by active status")
    device_id: Optional[str] = Field(None, description="Filter by device ID")
    limit: int = Field(100, ge=1, le=1000, description="Maximum number of results")
    offset: int = Field(0, ge=0, description="Number of results to skip")

class PluginStateStats(BaseModel):
    total_states: int = Field(..., description="Total number of states")
    active_states: int = Field(..., description="Number of active states")
    total_size: int = Field(..., description="Total size in bytes")
    plugins_with_state: int = Field(..., description="Number of plugins with state")
    average_state_size: float = Field(..., description="Average state size")
    last_activity: Optional[datetime] = Field(None, description="Last state activity")

# Sync and conflict resolution schemas
class PluginStateSyncRequest(BaseModel):
    device_id: str = Field(..., description="Device identifier")
    states: List[PluginStateCreate] = Field(..., description="States to sync")
    force_overwrite: bool = Field(False, description="Force overwrite conflicts")

class PluginStateSyncResponse(BaseModel):
    synced: List[PluginStateResponse] = Field(..., description="Successfully synced states")
    conflicts: List[Dict[str, Any]] = Field([], description="Conflicted states")
    errors: List[Dict[str, Any]] = Field([], description="Sync errors")

class PluginStateConflict(BaseModel):
    state_id: str = Field(..., description="Conflicted state ID")
    local_version: int = Field(..., description="Local version")
    remote_version: int = Field(..., description="Remote version")
    local_data: Dict[Any, Any] = Field(..., description="Local state data")
    remote_data: Dict[Any, Any] = Field(..., description="Remote state data")
    last_modified_local: datetime = Field(..., description="Local last modified")
    last_modified_remote: datetime = Field(..., description="Remote last modified")

class PluginStateConflictResolution(BaseModel):
    state_id: str = Field(..., description="State ID to resolve")
    resolution: str = Field(..., description="Resolution strategy: 'local', 'remote', 'merge'")
    merged_data: Optional[Dict[Any, Any]] = Field(None, description="Merged data if resolution is 'merge'")

# Migration schemas
class PluginStateMigrationRequest(BaseModel):
    from_version: str = Field(..., description="Source schema version")
    to_version: str = Field(..., description="Target schema version")
    plugin_ids: Optional[List[str]] = Field(None, description="Specific plugins to migrate")
    dry_run: bool = Field(True, description="Whether to perform a dry run")

class PluginStateMigrationResponse(BaseModel):
    migrated_count: int = Field(..., description="Number of states migrated")
    failed_count: int = Field(..., description="Number of failed migrations")
    errors: List[Dict[str, Any]] = Field([], description="Migration errors")
    dry_run: bool = Field(..., description="Whether this was a dry run")