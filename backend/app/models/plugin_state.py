from sqlalchemy import Column, String, Text, Boolean, ForeignKey, TIMESTAMP, Integer, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID
import uuid

from app.models.base import Base
from app.models.mixins import TimestampMixin

class PluginState(Base, TimestampMixin):
    """SQLAlchemy model for plugin state persistence across devices."""
    
    __tablename__ = "plugin_states"
    
    # Primary key
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    
    # Foreign keys
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plugin_id = Column(String(255), nullable=False, index=True)
    
    # State identification
    page_id = Column(String(255), nullable=True, index=True)  # Optional: state can be page-specific
    state_key = Column(String(255), nullable=True, index=True)  # Optional: for namespaced state
    
    # State data
    state_data = Column(Text, nullable=False)  # JSON serialized state
    state_schema_version = Column(String(50), nullable=True)  # For migration support
    
    # Metadata
    state_strategy = Column(String(50), default="persistent")  # none, session, persistent, custom
    compression_type = Column(String(20), nullable=True)  # gzip, lz4, etc.
    state_size = Column(Integer, default=0)  # Size in bytes for monitoring
    
    # Lifecycle management
    last_accessed = Column(TIMESTAMP, default=func.now(), onupdate=func.now())
    access_count = Column(Integer, default=0)
    ttl_expires_at = Column(TIMESTAMP, nullable=True)  # Time-to-live expiration
    is_active = Column(Boolean, default=True)
    
    # Sync and versioning
    version = Column(Integer, default=1)  # For conflict resolution
    device_id = Column(String(255), nullable=True)  # Device that last updated
    sync_status = Column(String(50), default="synced")  # synced, pending, conflict
    
    # Relationships
    user = relationship("User", back_populates="plugin_states")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_plugin_state_user_plugin', 'user_id', 'plugin_id'),
        Index('idx_plugin_state_user_plugin_page', 'user_id', 'plugin_id', 'page_id'),
        Index('idx_plugin_state_last_accessed', 'last_accessed'),
        Index('idx_plugin_state_ttl', 'ttl_expires_at'),
        Index('idx_plugin_state_sync', 'sync_status'),
    )

class PluginStateHistory(Base, TimestampMixin):
    """SQLAlchemy model for plugin state change history and backup."""
    
    __tablename__ = "plugin_state_history"
    
    # Primary key
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    
    # Foreign key to plugin state
    plugin_state_id = Column(String(36), ForeignKey("plugin_states.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Historical data
    state_data = Column(Text, nullable=False)  # JSON serialized historical state
    version = Column(Integer, nullable=False)
    change_type = Column(String(50), nullable=False)  # create, update, delete, restore
    
    # Metadata
    device_id = Column(String(255), nullable=True)
    user_agent = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    
    # Relationships
    plugin_state = relationship("PluginState")
    
    # Indexes
    __table_args__ = (
        Index('idx_plugin_state_history_state_id', 'plugin_state_id'),
        Index('idx_plugin_state_history_version', 'plugin_state_id', 'version'),
    )

class PluginStateConfig(Base, TimestampMixin):
    """SQLAlchemy model for plugin state configuration."""
    
    __tablename__ = "plugin_state_configs"
    
    # Primary key
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    
    # Configuration identification
    plugin_id = Column(String(255), nullable=False, unique=True, index=True)
    
    # Configuration data
    config_data = Column(Text, nullable=False)  # JSON serialized configuration
    config_version = Column(String(50), default="1.0.0")
    
    # Metadata
    is_active = Column(Boolean, default=True)
    created_by = Column(String(36), nullable=True)  # Admin who created config
    
    # Indexes
    __table_args__ = (
        Index('idx_plugin_state_config_plugin', 'plugin_id'),
    )