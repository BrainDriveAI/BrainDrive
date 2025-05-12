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
    dependencies = ["navigation_initializer", "brain_drive_basic_ai_chat_initializer"]  # Depends on navigation routes and AI Chat plugin
    
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
        Get the module IDs for a user's BrainDrive Basic AI Chat plugin.
        
        Args:
            user_id: The user ID
            db: Database session
            
        Returns:
            Dict[str, str]: A dictionary mapping module names to their IDs
        """
        try:
            # Get the plugin ID for the user's BrainDrive Basic AI Chat plugin
            plugin_stmt = text("""
            SELECT id FROM plugin
            WHERE user_id = :user_id AND plugin_slug = 'BrainDriveBasicAIChat'
            """)
            
            plugin_result = await db.execute(plugin_stmt, {"user_id": user_id})
            plugin_id = plugin_result.scalar_one_or_none()
            
            if not plugin_id:
                logger.error(f"BrainDriveBasicAIChat plugin not found for user {user_id}")
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
            
            # Get the module IDs for the user's BrainDrive Basic AI Chat plugin
            module_info = await self.get_module_ids(user_id, db)
            
            if not module_info:
                logger.error(f"Failed to get module IDs for user {user_id}")
                return False
                
            plugin_id = module_info.get("plugin_id")
            module_ids = module_info.get("module_ids", {})
            
            if not plugin_id:
                logger.error(f"BrainDriveBasicAIChat plugin not found for user {user_id}")
                return False
                
            # Create pages for the user using default pages
            for page_data in self.DEFAULT_PAGES:
                # If this is the AI Chat page, generate dynamic content
                if page_data["name"] == "AI Chat":
                    # Generate unique module IDs for the content JSON
                    timestamp_base = int(datetime.datetime.now().timestamp() * 1000)  # Use milliseconds for timestamp
                    model_selection_module_id = f"BrainDriveBasicAIChat_{module_ids.get('ComponentModelSelection', '')}_{timestamp_base}"
                    chat_history_module_id = f"BrainDriveBasicAIChat_{module_ids.get('AIChatHistory', '')}_{timestamp_base + 2000}"  # Add 2 seconds
                    ai_prompt_chat_module_id = f"BrainDriveBasicAIChat_{module_ids.get('AIPromptChat', '')}_{timestamp_base + 5000}"  # Add 5 seconds
                    
                    # Generate the content JSON with the actual module IDs
                    page_data["content"] = {
                        "layouts": {
                            "desktop": [
                                {"moduleUniqueId": model_selection_module_id, "i": model_selection_module_id, "x": 0, "y": 0, "w": 6, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": chat_history_module_id, "i": chat_history_module_id, "x": 6, "y": 0, "w": 6, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": ai_prompt_chat_module_id, "i": ai_prompt_chat_module_id, "x": 0, "y": 1, "w": 12, "h": 5, "minW": 4, "minH": 4}
                            ],
                            "tablet": [
                                {"moduleUniqueId": model_selection_module_id, "i": model_selection_module_id, "x": 0, "y": 0, "w": 6, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": chat_history_module_id, "i": chat_history_module_id, "x": 0, "y": 1, "w": 6, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": ai_prompt_chat_module_id, "i": ai_prompt_chat_module_id, "x": 0, "y": 2, "w": 6, "h": 6, "minW": 4, "minH": 4}
                            ],
                            "mobile": [
                                {"moduleUniqueId": model_selection_module_id, "i": model_selection_module_id, "x": 0, "y": 0, "w": 4, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": chat_history_module_id, "i": chat_history_module_id, "x": 0, "y": 1, "w": 4, "h": 1, "minW": 3, "minH": 1},
                                {"moduleUniqueId": ai_prompt_chat_module_id, "i": ai_prompt_chat_module_id, "x": 0, "y": 2, "w": 4, "h": 6, "minW": 4, "minH": 4}
                            ]
                        },
                        "modules": {
                            model_selection_module_id.replace("-", ""): {
                                "pluginId": "BrainDriveBasicAIChat",
                                "moduleId": module_ids.get('ComponentModelSelection', ''),
                                "moduleName": "ComponentModelSelection",
                                "config": {
                                    "moduleId": module_ids.get('ComponentModelSelection', ''),
                                    "label": "Select Model",
                                    "labelPosition": "top",
                                    "providerSettings": ["ollama_servers_settings"],
                                    "targetComponent": "",
                                    "displayName": "Model Selection v2"
                                }
                            },
                            chat_history_module_id.replace("-", ""): {
                                "pluginId": "BrainDriveBasicAIChat",
                                "moduleId": module_ids.get('AIChatHistory', ''),
                                "moduleName": "AIChatHistory",
                                "config": {
                                    "moduleId": module_ids.get('AIChatHistory', ''),
                                    "displayName": "AI Chat History"
                                }
                            },
                            ai_prompt_chat_module_id.replace("-", ""): {
                                "pluginId": "BrainDriveBasicAIChat",
                                "moduleId": module_ids.get('AIPromptChat', ''),
                                "moduleName": "AIPromptChat",
                                "config": {
                                    "initialGreeting": "Hello! How can I assist you today?",
                                    "promptQuestion": "Type your message here...",
                                    "moduleId": module_ids.get('AIPromptChat', ''),
                                    "displayName": "AI Prompt Chat V2"
                                }
                            }
                        }
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