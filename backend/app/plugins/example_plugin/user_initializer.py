"""
Example plugin user initializer.

This is an example of how a plugin can extend the user initialization system.
"""

import logging
import uuid
import datetime
from app.core.user_initializer.utils import generate_uuid
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer
from app.core.user_initializer.utils import prepare_record_for_new_user

logger = logging.getLogger(__name__)

class ExamplePluginInitializer(UserInitializerBase):
    """Example initializer for a plugin."""
    
    name = "example_plugin_initializer"
    description = "Initializes data for the example plugin"
    priority = 500  # Lower priority than core initializers
    dependencies = ["pages_initializer"]  # Depends on pages
    
    # Default example plugin data
    DEFAULT_PLUGIN_DATA = [
        {
            "name": "Example Item 1",
            "data": '{"key": "value1"}'
        },
        {
            "name": "Example Item 2",
            "data": '{"key": "value2"}'
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize plugin data for a new user."""
        try:
            logger.info(f"Initializing example plugin data for user {user_id}")
            
            # This is where you would initialize your plugin's data
            # For example:
            # - Create plugin-specific database records
            # - Set up plugin-specific settings
            # - Initialize plugin-specific files or resources
            
            # Example of creating records using direct SQL:
            # from sqlalchemy import text
            #
            # # Process each default item
            # for item_data in self.DEFAULT_PLUGIN_DATA:
            #     # Prepare the data for the new user
            #     prepared_data = prepare_record_for_new_user(
            #         item_data,
            #         user_id,
            #         preserve_fields=["name", "data"],  # Fields to keep from the default data
            #         user_id_field="user_id"  # Explicitly specify the user_id field
            #     )
            #
            #     # Get current timestamp
            #     current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            #
            #     # Create SQL statement
            #     stmt = text("""
            #     INSERT INTO example_model
            #     (id, name, data, user_id, created_at, updated_at)
            #     VALUES
            #     (:id, :name, :data, :user_id, :created_at, :updated_at)
            #     """)
            #
            #     # Execute statement with parameters
            #     await db.execute(stmt, {
            #         "id": prepared_data.get("id", generate_uuid()),
            #         "name": prepared_data["name"],
            #         "data": prepared_data.get("data", "{}"),
            #         "user_id": user_id,
            #         "created_at": current_time,
            #         "updated_at": current_time
            #     })
            #
            #     logger.info(f"Created example record {prepared_data['name']} for user {user_id}")
            
            # For this example, we'll just log a message
            logger.info(f"Example plugin initialized for user {user_id}")
            
            # Commit changes
            await db.commit()
            return True
            
        except Exception as e:
            logger.error(f"Error initializing example plugin for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up plugin data if initialization fails."""
        try:
            logger.info(f"Cleaning up example plugin data for user {user_id}")
            
            # This is where you would clean up your plugin's data
            # For example:
            # - Delete plugin-specific database records
            # - Remove plugin-specific files or resources
            
            # Example of deleting records using direct SQL
            # from sqlalchemy import text
            # stmt = text("DELETE FROM example_model WHERE user_id = :user_id")
            # await db.execute(stmt, {"user_id": user_id})
            # logger.info(f"Deleted example records for user {user_id}")
            
            # For this example, we'll just log a message
            logger.info(f"Example plugin cleanup completed for user {user_id}")
            
            # Commit changes
            await db.commit()
            return True
            
        except Exception as e:
            logger.error(f"Error during example plugin cleanup for user {user_id}: {e}")
            await db.rollback()
            return False

# Register the initializer
register_initializer(ExamplePluginInitializer)