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
    
    # Default navigation routes templates with hierarchical structure
    DEFAULT_ROUTES = [
        # Parent route: Your BrainDrive
        {
            "id": "your-braindrive-parent",
            "name": "Your BrainDrive",
            "route": "dashboard",
            "icon": "AccountTree",
            "description": "Core BrainDrive functionality and settings",
            "order": 0,
            "is_visible": True,
            "is_system_route": True,
            "parent_id": None,
            "default_component_id": "dashboard",  # Has a default component like Your Pages
            "display_order": 0,
            "is_collapsible": True,
            "is_expanded": True,
            "can_change_default": False
        },



        # Child routes under "Your BrainDrive"
        {
            "name": "Settings",
            "route": "settings",
            "icon": "Settings",
            "description": "BrainDrive settings",
            "order": 30,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "settings",
            "parent_id": "your-braindrive-parent",
            "display_order": 1,
            "is_collapsible": False,
            "is_expanded": True,
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
            "parent_id": "your-braindrive-parent",
            "display_order": 2,
            "is_collapsible": False,
            "is_expanded": True,
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
            "parent_id": "your-braindrive-parent",
            "display_order": 3,
            "is_collapsible": False,
            "is_expanded": True,
            "can_change_default": False
        },
        {
            "name": "Page Builder",
            "route": "plugin-studio",
            "icon": "AccountTree",
            "description": "Page Builder for creating and managing pages",
            "order": 20,
            "is_visible": True,
            "is_system_route": True,
            "default_component_id": "plugin-studio",
            "parent_id": "your-braindrive-parent",
            "display_order": 4,
            "is_collapsible": False,
            "is_expanded": True,
            "can_change_default": False
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize navigation routes for a new user."""
        try:
            logger.info(f"Initializing navigation routes for user {user_id}")
            
            # Two-pass approach: First create parent routes, then child routes
            parent_route_ids = {}
            
            # First pass: Create parent routes (routes with parent_id = None)
            for route_data in self.DEFAULT_ROUTES:
                if route_data.get("parent_id") is None:
                    # This is a parent route
                    prepared_data = prepare_record_for_new_user(
                        route_data,
                        user_id,
                        preserve_fields=["route"],
                        user_id_field="creator_id"
                    )
                    
                    route_id = generate_uuid()
                    
                    # Store the parent route ID for later reference
                    original_id = route_data.get("id")
                    if original_id:
                        parent_route_ids[original_id] = route_id
                    
                    # Create the parent route
                    await self._create_route(db, prepared_data, route_id, None)
                    logger.info(f"Created parent route {prepared_data['name']} (ID: {route_id}) for user {user_id}")
            
            # Second pass: Create child routes with resolved parent IDs
            for route_data in self.DEFAULT_ROUTES:
                if route_data.get("parent_id") is not None:
                    # This is a child route
                    prepared_data = prepare_record_for_new_user(
                        route_data,
                        user_id,
                        preserve_fields=["route"],
                        user_id_field="creator_id"
                    )
                    
                    route_id = generate_uuid()
                    
                    # Resolve parent ID
                    original_parent_id = route_data.get("parent_id")
                    resolved_parent_id = parent_route_ids.get(original_parent_id)
                    
                    if not resolved_parent_id:
                        logger.error(f"Could not resolve parent ID {original_parent_id} for route {prepared_data['name']}")
                        continue
                    
                    # Create the child route
                    await self._create_route(db, prepared_data, route_id, resolved_parent_id)
                    logger.info(f"Created child route {prepared_data['name']} (ID: {route_id}) with parent {resolved_parent_id} for user {user_id}")
            
            await db.commit()
            logger.info(f"Navigation routes initialized successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing navigation routes for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def _create_route(self, db: AsyncSession, prepared_data: Dict[str, Any], route_id: str, parent_id: str = None):
        """Helper method to create a single navigation route."""
        from sqlalchemy import text
        
        # Get current timestamp
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        # Create SQL statement
        stmt = text("""
        INSERT INTO navigation_routes
        (id, name, route, icon, description, "order", is_visible, is_system_route,
         default_component_id, creator_id, created_at, updated_at, can_change_default,
         parent_id, display_order, is_collapsible, is_expanded)
        VALUES
        (:id, :name, :route, :icon, :description, :order, :is_visible, :is_system_route,
         :default_component_id, :creator_id, :created_at, :updated_at, :can_change_default,
         :parent_id, :display_order, :is_collapsible, :is_expanded)
        """)
        
        # Execute statement with parameters
        await db.execute(stmt, {
            "id": route_id,
            "name": prepared_data["name"],
            "route": prepared_data["route"],
            "icon": prepared_data.get("icon", ""),
            "description": prepared_data.get("description", ""),
            "order": prepared_data.get("order", 0),
            "is_visible": prepared_data.get("is_visible", True),
            "is_system_route": prepared_data.get("is_system_route", False),
            "default_component_id": prepared_data.get("default_component_id"),
            "creator_id": prepared_data.get("creator_id"),
            "created_at": current_time,
            "updated_at": current_time,
            "can_change_default": prepared_data.get("can_change_default", False),
            "parent_id": parent_id,
            "display_order": prepared_data.get("display_order", 0),
            "is_collapsible": prepared_data.get("is_collapsible", True),
            "is_expanded": prepared_data.get("is_expanded", True)
        })
    
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