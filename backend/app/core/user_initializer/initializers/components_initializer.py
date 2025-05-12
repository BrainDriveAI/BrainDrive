"""
Components initializer plugin.

This plugin initializes components for a new user.
"""

import logging
import uuid
import datetime
from app.core.user_initializer.utils import generate_uuid
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer
from app.core.user_initializer.utils import prepare_record_for_new_user
from app.models.component import Component

logger = logging.getLogger(__name__)

class ComponentsInitializer(UserInitializerBase):
    """Initializer for user components."""
    
    name = "components_initializer"
    description = "Initializes default components for a new user"
    priority = 800  # Run after settings
    dependencies = ["settings_initializer"]  # Depends on settings
    
    # Default component templates
    DEFAULT_COMPONENTS = [
        {
            "name": "Dashboard",
            "component_id": "dashboard",
            "description": "Main dashboard component",
            "icon": "Dashboard",
            "is_system": True
        },
        {
            "name": "Plugin Studio",
            "component_id": "plugin-studio",
            "description": "Plugin development environment",
            "icon": "Extension",
            "is_system": True
        },
        {
            "name": "Settings",
            "component_id": "settings",
            "description": "System settings",
            "icon": "Settings",
            "is_system": True
        },
        {
            "name": "Plugin Manager",
            "component_id": "plugin-manager",
            "description": "Manage plugins and modules",
            "icon": "Extension",
            "is_system": True
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize components for a new user."""
        try:
            logger.info(f"Initializing components for user {user_id}")
            
            # Create components for the user using the hardcoded default components
            for component_data in self.DEFAULT_COMPONENTS:
                # Prepare the component data for the new user
                # This will:
                # 1. Generate a new ID
                # 2. Set the creator_id to the new user's ID
                # 3. Update created_at and updated_at timestamps
                prepared_data = prepare_record_for_new_user(
                    component_data,
                    user_id,
                    preserve_fields=["component_id"],  # Keep the original component_id
                    user_id_field="user_id"  # Explicitly specify the user_id field
                )
                
                # Use direct SQL to avoid ORM relationship issues
                try:
                    # Get current timestamp
                    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Create SQL statement
                    from sqlalchemy import text
                    stmt = text("""
                    INSERT INTO components
                    (id, name, component_id, description, icon, is_system, user_id, created_at, updated_at)
                    VALUES
                    (:id, :name, :component_id, :description, :icon, :is_system, :user_id, :created_at, :updated_at)
                    """)
                    
                    # Execute statement with parameters
                    await db.execute(stmt, {
                        "id": prepared_data.get("id", generate_uuid()),
                        "name": prepared_data["name"],
                        "component_id": prepared_data["component_id"],
                        "description": prepared_data.get("description", ""),
                        "icon": prepared_data.get("icon", ""),
                        "is_system": prepared_data.get("is_system", False),
                        "user_id": user_id,  # Changed from creator_id to user_id to match the model
                        "created_at": current_time,
                        "updated_at": current_time
                    })
                    
                    logger.info(f"Created component {prepared_data['name']} for user {user_id}")
                except Exception as e:
                    logger.error(f"Error creating component {prepared_data.get('name')}: {e}")
                    raise
            
            await db.commit()
            logger.info(f"Components initialized successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing components for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up components if initialization fails."""
        try:
            # Delete all components created for this user using direct SQL
            from sqlalchemy import text
            stmt = text("DELETE FROM components WHERE user_id = :user_id")
            await db.execute(stmt, {"user_id": user_id})
            
            await db.commit()
            logger.info(f"Components cleanup successful for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error during components cleanup for user {user_id}: {e}")
            await db.rollback()
            return False

# Register the initializer
register_initializer(ComponentsInitializer)