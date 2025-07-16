from sqlalchemy import Column, String, Integer, Boolean, ForeignKey, Text, JSON, UniqueConstraint, TIMESTAMP
import sqlalchemy
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.base import Base

class Plugin(Base):
    """SQLAlchemy model for plugins."""
    
    id = Column(String(32), primary_key=True, index=True)
    # The plugin_slug stores the original plugin identifier used for file paths
    plugin_slug = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String, nullable=False)
    version = Column(String, nullable=False)
    type = Column(String, default="frontend")
    enabled = Column(Boolean, default=True)
    icon = Column(String)
    category = Column(String)
    status = Column(String, default="activated")
    official = Column(Boolean, default=True)
    author = Column(String, default="BrainDrive Team")
    last_updated = Column(String)
    compatibility = Column(String, default="1.0.0")
    downloads = Column(Integer, default=0)
    scope = Column(String)
    bundle_method = Column(String)
    bundle_location = Column(String)
    is_local = Column(Boolean, default=False)
    long_description = Column(Text)
    
    # Update tracking fields
    source_type = Column(String(50), nullable=True)  # github, gitlab, npm, custom, local
    source_url = Column(Text, nullable=True)  # Original repository/source URL
    update_check_url = Column(Text, nullable=True)  # Specific API endpoint for checking updates
    last_update_check = Column(TIMESTAMP, nullable=True)  # When we last checked for updates
    update_available = Column(Boolean, default=False)  # Cached flag indicating if update is available
    latest_version = Column(String(50), nullable=True)  # Latest available version (cached)
    installation_type = Column(String(20), default='local')  # Installation type: local or remote
    permissions = Column(Text, nullable=True)  # JSON array of required permissions

    # JSON fields
    config_fields = Column(Text)  # Stored as JSON string
    messages = Column(Text)       # Stored as JSON string
    dependencies = Column(Text)   # Stored as JSON string
    
    # Timestamps
    created_at = Column(String, default=func.now())
    updated_at = Column(String, default=func.now(), onupdate=func.now())
    
    # User relationship
    user_id = Column(String(32), ForeignKey("users.id", name="fk_plugin_user_id"), nullable=False)
    user = relationship("User", back_populates="plugins")
    
    # Add a unique constraint for user_id + plugin_slug
    __table_args__ = (
        sqlalchemy.UniqueConstraint('user_id', 'plugin_slug', name='unique_plugin_per_user'),
    )
    
    # Relationships
    modules = relationship("Module", back_populates="plugin", cascade="all, delete-orphan")
    
    def to_dict(self):
        """Convert model to dictionary."""
        import json
        
        result = {
            "id": self.id,
            "plugin_slug": self.plugin_slug,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "type": self.type,
            "enabled": self.enabled,
            "icon": self.icon,
            "category": self.category,
            "status": self.status,
            "official": self.official,
            "author": self.author,
            "lastUpdated": self.last_updated,
            "compatibility": self.compatibility,
            "downloads": self.downloads,
            "scope": self.scope,
            "bundlemethod": self.bundle_method,
            "bundlelocation": self.bundle_location,
            "islocal": self.is_local,
            "longDescription": self.long_description,
            "userId": self.user_id,
            # Update tracking fields
            "sourceType": self.source_type,
            "sourceUrl": self.source_url,
            "updateCheckUrl": self.update_check_url,
            "lastUpdateCheck": self.last_update_check.isoformat() if self.last_update_check else None,
            "updateAvailable": self.update_available,
            "latestVersion": self.latest_version,
            "installationType": self.installation_type,
        }
        
        # Deserialize JSON fields
        if self.config_fields:
            result["configFields"] = json.loads(self.config_fields)
        else:
            result["configFields"] = {}
            
        if self.messages:
            result["messages"] = json.loads(self.messages)
        else:
            result["messages"] = {}
            
        if self.dependencies:
            result["dependencies"] = json.loads(self.dependencies)
        else:
            result["dependencies"] = []
            
        if self.permissions:
            result["permissions"] = json.loads(self.permissions)
        else:
            result["permissions"] = []

        return result
    
    @classmethod
    def from_dict(cls, data):
        """Create model from dictionary."""
        import json
        
        # Convert camelCase to snake_case for database fields
        field_mapping = {
            "lastUpdated": "last_updated",
            "bundlemethod": "bundle_method",
            "bundlelocation": "bundle_location",
            "islocal": "is_local",
            "longDescription": "long_description",
            "configFields": "config_fields",
            "userId": "user_id",
            "pluginSlug": "plugin_slug",
            "sourceType": "source_type",
            "sourceUrl": "source_url",
            "updateCheckUrl": "update_check_url",
            "lastUpdateCheck": "last_update_check",
            "updateAvailable": "update_available",
            "latestVersion": "latest_version",
            "installationType": "installation_type",
        }
        
        # Create a new dictionary with snake_case keys
        db_data = {}
        for key, value in data.items():
            if key in field_mapping:
                db_key = field_mapping[key]
            else:
                # Convert camelCase to snake_case
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
            
            # Handle special fields
            if db_key in ["config_fields", "messages", "dependencies", "permissions"] and value is not None:
                db_data[db_key] = json.dumps(value)
            else:
                db_data[db_key] = value
        
        # Remove modules from data as they are handled separately
        if "modules" in db_data:
            db_data.pop("modules")
            
        return cls(**db_data)


class Module(Base):
    """SQLAlchemy model for plugin modules."""
    
    id = Column(String(32), primary_key=True, index=True)
    plugin_id = Column(String(32), ForeignKey("plugin.id", ondelete="CASCADE"), primary_key=True)
    name = Column(String, nullable=False)
    display_name = Column(String)
    description = Column(String)
    icon = Column(String)
    category = Column(String)
    enabled = Column(Boolean, default=True)
    priority = Column(Integer, default=0)
    
    # JSON fields
    props = Column(Text)              # Stored as JSON string
    config_fields = Column(Text)      # Stored as JSON string
    messages = Column(Text)           # Stored as JSON string
    required_services = Column(Text)  # Stored as JSON string
    dependencies = Column(Text)       # Stored as JSON string
    layout = Column(Text)             # Stored as JSON string
    tags = Column(Text)               # Stored as JSON string
    
    # Timestamps
    created_at = Column(String, default=func.now())
    updated_at = Column(String, default=func.now(), onupdate=func.now())
    
    # User relationship
    user_id = Column(String(32), ForeignKey("users.id", name="fk_module_user_id"), nullable=False)
    user = relationship("User", back_populates="modules")
    
    # Relationships
    plugin = relationship("Plugin", back_populates="modules")
    
    def to_dict(self):
        """Convert model to dictionary."""
        import json
        
        result = {
            "id": self.id,
            "pluginId": self.plugin_id,
            "name": self.name,
            "displayName": self.display_name,
            "description": self.description,
            "icon": self.icon,
            "category": self.category,
            "enabled": self.enabled,
            "priority": self.priority,
            "userId": self.user_id,
        }
        
        # Deserialize JSON fields
        for field, attr in [
            ("props", self.props),
            ("configFields", self.config_fields),
            ("requiredServices", self.required_services),
            ("layout", self.layout)
        ]:
            if attr:
                result[field] = json.loads(attr)
            else:
                result[field] = {}
                
        for field, attr in [
            ("dependencies", self.dependencies),
            ("tags", self.tags)
        ]:
            if attr:
                result[field] = json.loads(attr)
            else:
                result[field] = []
                
        if self.messages:
            result["messages"] = json.loads(self.messages)
        else:
            result["messages"] = {"sends": [], "receives": []}
            
        return result
    
    @classmethod
    def from_dict(cls, data, plugin_id):
        """Create model from dictionary."""
        import json
        
        # Convert camelCase to snake_case for database fields
        field_mapping = {
            "displayName": "display_name",
            "configFields": "config_fields",
            "requiredServices": "required_services",
            "userId": "user_id",
        }
        
        # Create a new dictionary with snake_case keys
        db_data = {"plugin_id": plugin_id}
        for key, value in data.items():
            if key in field_mapping:
                db_key = field_mapping[key]
            else:
                # Convert camelCase to snake_case
                db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
            
            # Handle JSON fields
            if db_key in ["props", "config_fields", "messages", "required_services",
                         "dependencies", "layout", "tags"] and value is not None:
                db_data[db_key] = json.dumps(value)
            else:
                db_data[db_key] = value
        
        # If user_id is not provided, try to extract it from the plugin_id
        if "user_id" not in db_data and "_" in plugin_id:
            # Plugin ID format is expected to be "{user_id}_{plugin_slug}"
            user_id, _ = plugin_id.split("_", 1)
            db_data["user_id"] = user_id
            
        return cls(**db_data)
