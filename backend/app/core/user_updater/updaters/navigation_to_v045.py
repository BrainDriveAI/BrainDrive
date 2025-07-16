import logging
from datetime import datetime
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

logger = logging.getLogger(__name__)


class NavigationToV045(UserUpdaterBase):
    """Add personas navigation route for existing users."""

    name = "navigation_to_v045"
    description = "Add personas navigation route for existing users"
    from_version = "0.4.1"
    to_version = "0.4.5"
    priority = 1100

    # Personas route configuration (matches navigation_initializer.py)
    PERSONAS_ROUTE = {
        "name": "Personas",
        "route": "personas",
        "icon": "Person",
        "description": "Manage AI conversation personas",
        "order": 25,
        "is_visible": True,
        "is_system_route": True,
        "default_component_id": "personas",
        "can_change_default": False
    }

    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Apply the update for the given user."""
        try:
            logger.info("Adding personas navigation route for user %s (v0.4.1 -> v0.4.5)", user_id)
            
            # Check if personas route already exists for this user
            check_stmt = text(
                "SELECT id FROM navigation_routes WHERE route = :route AND creator_id = :user_id"
            )
            result = await db.execute(check_stmt, {"route": "personas", "user_id": user_id})
            existing_route = result.scalar_one_or_none()
            
            if existing_route:
                logger.info("Personas navigation route already exists for user %s, skipping", user_id)
                return True
            
            # Generate UUID for the new route (32 chars, no hyphens to match existing pattern)
            route_id = str(uuid4()).replace('-', '')
            current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # Insert personas navigation route
            insert_stmt = text("""
                INSERT INTO navigation_routes
                (id, name, route, icon, description, "order", is_visible, is_system_route,
                 default_component_id, creator_id, created_at, updated_at, can_change_default)
                VALUES
                (:id, :name, :route, :icon, :description, :order, :is_visible, :is_system_route,
                 :default_component_id, :creator_id, :created_at, :updated_at, :can_change_default)
            """)
            
            await db.execute(insert_stmt, {
                "id": route_id,
                "name": self.PERSONAS_ROUTE["name"],
                "route": self.PERSONAS_ROUTE["route"],
                "icon": self.PERSONAS_ROUTE["icon"],
                "description": self.PERSONAS_ROUTE["description"],
                "order": self.PERSONAS_ROUTE["order"],
                "is_visible": self.PERSONAS_ROUTE["is_visible"],
                "is_system_route": self.PERSONAS_ROUTE["is_system_route"],
                "default_component_id": self.PERSONAS_ROUTE["default_component_id"],
                "creator_id": user_id,
                "created_at": current_time,
                "updated_at": current_time,
                "can_change_default": self.PERSONAS_ROUTE["can_change_default"]
            })
            
            logger.info("Successfully added personas navigation route for user %s", user_id)
            return True
            
        except Exception as e:
            logger.error("Error applying NavigationToV045 updater for user %s: %s", user_id, e)
            return False

    async def rollback(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Rollback the update by removing the personas navigation route."""
        try:
            logger.info("Rolling back personas navigation route for user %s", user_id)
            
            # Remove personas navigation route for this user
            delete_stmt = text(
                "DELETE FROM navigation_routes WHERE route = :route AND creator_id = :user_id"
            )
            await db.execute(delete_stmt, {"route": "personas", "user_id": user_id})
            
            logger.info("Successfully rolled back personas navigation route for user %s", user_id)
            return True
            
        except Exception as e:
            logger.error("Error rolling back NavigationToV045 updater for user %s: %s", user_id, e)
            return False


# Register the updater
register_updater(NavigationToV045)