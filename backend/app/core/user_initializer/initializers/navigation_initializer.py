"""
Navigation routes initializer plugin.

This plugin initializes navigation routes for a new user.
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
from app.models.navigation import NavigationRoute

logger = logging.getLogger(__name__)

class NavigationInitializer(UserInitializerBase):
    """Initializer for user navigation routes."""
    
    name = "navigation_initializer"
    description = "Initializes default navigation routes for a new user"
    priority = 700  # Run after components
    dependencies = ["components_initializer"]  # Depends on components
    
    # Default navigation routes templates
    DEFAULT_ROUTES = [
        {
            "name": "Your BrainDrive",
            "route": "dashboard",
            "icon": "Dashboard",
            "description": "Your BrainDrive dashboard",
            "order": 10,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "dashboard",
            "can_change_default": True
        },
        {
            "name": "BrainDrive Studio",
            "route": "plugin-studio",
            "icon": "Extension",
            "description": "BrainDrive Studio for creating and managing plugins",
            "order": 20,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "plugin-studio",
            "can_change_default": False
        },
        {
            "name": "Personas",
            "route": "personas",
            "icon": "Person",
            "description": "Manage AI conversation personas",
            "order": 25,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "personas",
            "can_change_default": False
        },
        {
            "name": "Settings",
            "route": "settings",
            "icon": "Settings",
            "description": "BrainDrive settings",
            "order": 30,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "settings",
            "can_change_default": False
        },
        {
            "name": "Plugin Manager",
            "route": "plugin-manager",
            "icon": "Extension",
            "description": "Manage plugins and modules",
            "order": 40,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "plugin-manager",
            "can_change_default": False
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize navigation routes for a new user."""
        try:
            logger.info(f"Initializing navigation routes for user {user_id}")
            
            # Create navigation routes for the user using hardcoded default routes
            for route_data in self.DEFAULT_ROUTES:
                # Prepare the route data for the new user
                # This will:
                # 1. Generate a new ID
                # 2. Set the creator_id to the new user's ID
                # 3. Update created_at and updated_at timestamps
                prepared_data = prepare_record_for_new_user(
                    route_data,
                    user_id,
                    preserve_fields=["route"],  # Keep the original route path
                    user_id_field="creator_id"  # Explicitly specify the creator_id field
                )
                
                # Use direct SQL to avoid ORM relationship issues
                try:
                    # Get current timestamp
                    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Create SQL statement
                    from sqlalchemy import text
                    stmt = text("""
                    INSERT INTO navigation_routes
                    (id, name, route, icon, description, "order", is_visible, is_system_route,
                     default_component_id, creator_id, created_at, updated_at, can_change_default)
                    VALUES
                    (:id, :name, :route, :icon, :description, :order, :is_visible, :is_system_route,
                     :default_component_id, :creator_id, :created_at, :updated_at, :can_change_default)
                    """)
                    
                    # Execute statement with parameters
                    await db.execute(stmt, {
                        "id": prepared_data.get("id", generate_uuid()),
                        "name": prepared_data["name"],
                        "route": prepared_data["route"],
                        "icon": prepared_data.get("icon", ""),
                        "description": prepared_data.get("description", ""),
                        "order": prepared_data.get("order", 0),
                        "is_visible": prepared_data.get("is_visible", True),
                        "is_system_route": prepared_data.get("is_system_route", False),
                        "default_component_id": prepared_data.get("default_component_id"),
                        "creator_id": user_id,
                        "created_at": current_time,
                        "updated_at": current_time,
                        "can_change_default": prepared_data.get("can_change_default", False)
                    })
                    
                    logger.info(f"Created navigation route {prepared_data['name']} for user {user_id}")
                except Exception as e:
                    logger.error(f"Error creating navigation route {prepared_data.get('name')}: {e}")
                    raise
            
            await db.commit()
            logger.info(f"Navigation routes initialized successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing navigation routes for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up navigation routes if initialization fails."""
        try:
            # Delete all navigation routes created for this user using direct SQL
            from sqlalchemy import text
            stmt = text("DELETE FROM navigation_routes WHERE creator_id = :user_id")
            await db.execute(stmt, {"user_id": user_id})
            
            await db.commit()
            logger.info(f"Navigation routes cleanup successful for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error during navigation routes cleanup for user {user_id}: {e}")
            await db.rollback()
            return False

# Register the initializer
register_initializer(NavigationInitializer)