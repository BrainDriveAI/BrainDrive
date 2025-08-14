"""
Pages initializer plugin.

This plugin initializes pages for a new user.
"""

import logging
import uuid
import datetime
import json
from app.core.user_initializer.utils import generate_uuid
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer
from app.core.user_initializer.utils import prepare_record_for_new_user
from app.models.page import Page

logger = logging.getLogger(__name__)

class PagesInitializer(UserInitializerBase):
    """Initializer for user pages."""
    
    name = "pages_initializer"
    description = "Initializes default pages for a new user"
    priority = 600  # Run after navigation routes
    dependencies = ["navigation_initializer", "github_plugin_initializer"]  # Depends on navigation routes and GitHub plugin installer
    
    # Default pages templates
    DEFAULT_PAGES = [
        {
            "name": "AI Chat",
            # Generate a unique route based on the name with current timestamp
            "route": f"ai-chat-{int(datetime.datetime.now().timestamp())}",
            "is_published": 1,
            # publish_date will be set at insertion time
            "description": "",
            "icon": "",
            "parent_type": "page",
            "is_parent_page": 0
        }
    ]
    
    async def get_module_ids(self, user_id: str, db: AsyncSession) -> Dict[str, str]:
        """
        Get the module IDs for a user's BrainDrive Chat plugin (GitHub-installed).
        
        Args:
            user_id: The user ID
            db: Database session
            
        Returns:
            Dict[str, str]: A dictionary mapping module names to their IDs
        """
        try:
            # Get the plugin ID for the user's BrainDrive Chat plugin (GitHub-installed)
            plugin_stmt = text("""
            SELECT id FROM plugin
            WHERE user_id = :user_id AND plugin_slug = 'BrainDriveChat'
            """)
            
            plugin_result = await db.execute(plugin_stmt, {"user_id": user_id})
            plugin_id = plugin_result.scalar_one_or_none()
            
            if not plugin_id:
                logger.error(f"BrainDriveChat plugin not found for user {user_id}")
                return {}
            
            # Get the module IDs for the plugin
            module_stmt = text("""
            SELECT id, name FROM module
            WHERE user_id = :user_id AND plugin_id = :plugin_id
            """)
            
            module_result = await db.execute(module_stmt, {
                "user_id": user_id,
                "plugin_id": plugin_id
            })
            
            module_ids = {}
            for row in module_result:
                module_ids[row.name] = row.id
            
            return {
                "plugin_id": plugin_id,
                "module_ids": module_ids
            }
        except Exception as e:
            logger.error(f"Error getting module IDs for user {user_id}: {e}")
            return {}
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize pages for a new user."""
        try:
            logger.info(f"Initializing pages for user {user_id}")
            
            # Get the module IDs for the user's BrainDrive Chat plugin (GitHub-installed)
            module_info = await self.get_module_ids(user_id, db)
            
            if not module_info:
                logger.error(f"Failed to get module IDs for user {user_id}")
                return False
                
            plugin_id = module_info.get("plugin_id")
            module_ids = module_info.get("module_ids", {})
            
            if not plugin_id:
                logger.error(f"BrainDriveChat plugin not found for user {user_id}")
                return False
                
            # Create pages for the user using default pages
            for page_data in self.DEFAULT_PAGES:
                # If this is the AI Chat page, generate dynamic content
                if page_data["name"] == "AI Chat":
                    # Generate unique module ID for the BrainDriveChat interface
                    timestamp_base = int(datetime.datetime.now().timestamp() * 1000)  # Use milliseconds for timestamp
                    
                    # Get the BrainDriveChat module ID (should be the only module in the plugin)
                    brain_drive_chat_module_id = None
                    for module_name, module_id in module_ids.items():
                        if 'BrainDriveChat' in module_name:
                            brain_drive_chat_module_id = module_id
                            break
                    
                    if not brain_drive_chat_module_id:
                        logger.error(f"BrainDriveChat module not found for user {user_id}")
                        return False
                    
                    # Generate unique identifier for the layout
                    chat_interface_id = f"BrainDriveChat_{brain_drive_chat_module_id}_{timestamp_base}"
                    
                    # Generate the content JSON with the actual module IDs (new BrainDriveChat structure)
                    page_data["content"] = {
                        "layouts": {
                            "desktop": [
                                {
                                    "i": chat_interface_id,
                                    "x": 0,
                                    "y": 0,
                                    "w": 12,
                                    "h": 10,
                                    "pluginId": "BrainDriveChat",
                                    "args": {
                                        "moduleId": brain_drive_chat_module_id,
                                        "displayName": "AI Chat Interface"
                                    }
                                }
                            ],
                            "tablet": [
                                {
                                    "i": chat_interface_id,
                                    "x": 1,
                                    "y": 0,
                                    "w": 4,
                                    "h": 3,
                                    "pluginId": "BrainDriveChat",
                                    "args": {
                                        "moduleId": brain_drive_chat_module_id,
                                        "displayName": "AI Chat Interface"
                                    }
                                }
                            ],
                            "mobile": [
                                {
                                    "i": chat_interface_id,
                                    "x": 1,
                                    "y": 0,
                                    "w": 4,
                                    "h": 3,
                                    "pluginId": "BrainDriveChat",
                                    "args": {
                                        "moduleId": brain_drive_chat_module_id,
                                        "displayName": "AI Chat Interface"
                                    }
                                }
                            ]
                        },
                        "modules": {}
                    }
                # Prepare the page data for the new user
                # This will:
                # 1. Generate a new ID
                # 2. Set the creator_id to the new user's ID
                # 3. Update created_at and updated_at timestamps
                prepared_data = prepare_record_for_new_user(
                    page_data,
                    user_id,
                    preserve_fields=["route"],  # Keep the original route path
                    user_id_field="creator_id"  # Explicitly specify the creator_id field
                )
                
                # Use direct SQL to avoid ORM relationship issues
                try:
                    # Get current timestamp
                    current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    
                    # Create SQL statement
                    stmt = text("""
                    INSERT INTO pages
                    (id, name, route, content, creator_id, created_at, updated_at, is_published, publish_date)
                    VALUES
                    (:id, :name, :route, :content, :creator_id, :created_at, :updated_at, :is_published, :publish_date)
                    """)
                    
                    # Use content directly if it's already provided, otherwise construct it
                    if "content" in prepared_data and isinstance(prepared_data["content"], dict):
                        content = prepared_data["content"]
                    else:
                        # Convert layout and components to content JSON
                        content = {
                            "layout": prepared_data.get("layout", {}),
                            "components": prepared_data.get("components", [])
                        }
                    
                    # Execute statement with parameters
                    await db.execute(stmt, {
                        "id": prepared_data.get("id", generate_uuid()),
                        "name": prepared_data["name"],
                        "route": prepared_data.get("route"),
                        "content": json.dumps(content),
                        "creator_id": user_id,
                        "created_at": current_time,
                        "updated_at": current_time,
                        "is_published": 1,  # Always publish the page
                        "publish_date": current_time  # Set publish date to current time
                    })
                    
                    logger.info(f"Created page {prepared_data['name']} for user {user_id}")
                except Exception as e:
                    logger.error(f"Error creating page {prepared_data.get('name')}: {e}")
                    raise
            
            await db.commit()
            logger.info(f"Pages initialized successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing pages for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up pages if initialization fails."""
        try:
            # Delete all pages created for this user using direct SQL
            stmt = text("DELETE FROM pages WHERE creator_id = :user_id")
            await db.execute(stmt, {"user_id": user_id})
            
            await db.commit()
            logger.info(f"Pages cleanup successful for user {user_id}")
            return True
        except Exception as e:
            logger.error(f"Error during pages cleanup for user {user_id}: {e}")
            await db.rollback()
            return False

# Register the initializer
register_initializer(PagesInitializer)