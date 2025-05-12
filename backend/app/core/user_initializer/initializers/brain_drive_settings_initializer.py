"""
BrainDrive Settings initializer.

This initializer creates the BrainDrive Settings plugin and its modules for a new user.
"""

import logging
import json
import datetime
import os
import shutil
from pathlib import Path
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer
from app.core.user_initializer.utils import prepare_record_for_new_user

logger = logging.getLogger(__name__)

# Define the plugins directory path
PLUGINS_DIR = Path(__file__).parent.parent.parent.parent.parent / "plugins"

class BrainDriveSettingsInitializer(UserInitializerBase):
    """Initializer for BrainDrive Settings plugin and its modules."""
    
    name = "brain_drive_settings_initializer"
    description = "Initializes BrainDrive Settings plugin and its modules for a new user"
    priority = 500  # Medium priority
    dependencies = []  # No dependencies
    
    # Hardcoded plugin data from backend/plugins/BrainDriveSettings/plugin.json
    PLUGIN_DATA = {
        "id": "BrainDriveSettings",
        "name": "BrainDrive Settings",
        "description": "Basic BrainDrive Settings Plugin",
        "version": "1.0.0",
        "type": "frontend",
        "enabled": True,
        "icon": "Dashboard",
        "category": "Utilities",
        "status": "activated",
        "official": True,
        "author": "BrainDrive Team",
        "last_updated": "2025-03-06",
        "compatibility": "1.0.0",
        "downloads": 0,
        "scope": "BrainDriveSettings",
        "bundle_method": "webpack",
        "bundle_location": "frontend/dist/remoteEntry.js",
        "is_local": False,
        "long_description": None,
        "config_fields": None,
        "messages": None,
        "dependencies": None,
        "plugin_slug": "BrainDriveSettings"
    }
    
    # Hardcoded module data from backend/plugins/BrainDriveSettings/plugin.json
    MODULE_DATA = [
        {
            "id": "componentTheme",
            "plugin_id": "BrainDriveSettings",
            "name": "ComponentTheme",
            "display_name": "Theme Settings",
            "description": "Change application theme",
            "icon": "DarkMode",
            "category": "Settings",
            "enabled": True,
            "priority": 1,
            "props": "{}",
            "config_fields": "{}",
            "messages": "{\"sends\": [], \"receives\": []}",
            "required_services": "{\"theme\": {\"methods\": [\"getCurrentTheme\", \"setTheme\", \"toggleTheme\", \"addThemeChangeListener\", \"removeThemeChangeListener\"], \"version\": \"1.0.0\"}, \"settings\": {\"methods\": [\"getSetting\", \"setSetting\", \"registerSettingDefinition\", \"getSettingDefinitions\", \"subscribe\", \"subscribeToCategory\"], \"version\": \"1.0.0\"}}",
            "dependencies": "[]",
            "layout": "{\"minWidth\": 6, \"minHeight\": 1, \"defaultWidth\": 12, \"defaultHeight\": 1}",
            "tags": "[\"Settings\", \"Theme Settings\"]"
        },
        {
            "id": "componentOllamaServer",
            "plugin_id": "BrainDriveSettings",
            "name": "ComponentOllamaServer",
            "display_name": "Ollama Servers",
            "description": "Manage multiple Ollama server connections",
            "icon": "Storage",
            "category": "LLM Servers",
            "enabled": True,
            "priority": 1,
            "props": "{}",
            "config_fields": "{}",
            "messages": "{\"sends\": [], \"receives\": []}",
            "required_services": "{\"api\": {\"methods\": [\"get\", \"post\", \"delete\"], \"version\": \"1.0.0\"}, \"theme\": {\"methods\": [\"getCurrentTheme\", \"addThemeChangeListener\", \"removeThemeChangeListener\"], \"version\": \"1.0.0\"}}",
            "dependencies": "[]",
            "layout": "{\"minWidth\": 6, \"minHeight\": 4, \"defaultWidth\": 8, \"defaultHeight\": 5}",
            "tags": "[\"Settings\", \"Ollama Server Settings\", \"Multiple Servers\"]"
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize BrainDrive Settings plugin and its modules for a new user."""
        try:
            logger.info(f"Initializing BrainDrive Settings plugin for user {user_id}")
            
            # Create the plugin for the user
            plugin_data = self.PLUGIN_DATA.copy()
            
            # Prepare the plugin data for the new user
            prepared_plugin = prepare_record_for_new_user(
                plugin_data,
                user_id,
                preserve_fields=["name", "description", "version", "type", "icon",
                                "category", "status", "official", "author",
                                "last_updated", "compatibility", "scope",
                                "bundle_method", "bundle_location", "is_local",
                                "long_description", "plugin_slug"],
                user_id_field="user_id"
            )
            
            # Update the ID to use the new format: user_id_plugin_slug
            plugin_slug = prepared_plugin.get("plugin_slug", "BrainDriveSettings")
            prepared_plugin["id"] = f"{user_id}_{plugin_slug}"
            
            # Create the plugin using direct SQL
            current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # Create SQL statement for plugin
            plugin_stmt = text("""
            INSERT INTO plugin
            (id, name, description, version, type, enabled, icon, category, status,
            official, author, last_updated, compatibility, downloads, scope,
            bundle_method, bundle_location, is_local, long_description,
            config_fields, messages, dependencies, created_at, updated_at, user_id, plugin_slug)
            VALUES
            (:id, :name, :description, :version, :type, :enabled, :icon, :category,
            :status, :official, :author, :last_updated, :compatibility, :downloads,
            :scope, :bundle_method, :bundle_location, :is_local, :long_description,
            :config_fields, :messages, :dependencies, :created_at, :updated_at, :user_id, :plugin_slug)
            """)
            
            # Execute statement with parameters
            await db.execute(plugin_stmt, {
                "id": prepared_plugin["id"],
                "name": prepared_plugin["name"],
                "description": prepared_plugin["description"],
                "version": prepared_plugin["version"],
                "type": prepared_plugin["type"],
                "enabled": prepared_plugin.get("enabled", True),
                "icon": prepared_plugin.get("icon"),
                "category": prepared_plugin.get("category"),
                "status": prepared_plugin.get("status", "activated"),
                "official": prepared_plugin.get("official", True),
                "author": prepared_plugin.get("author", "BrainDrive Team"),
                "last_updated": prepared_plugin.get("last_updated"),
                "compatibility": prepared_plugin.get("compatibility", "1.0.0"),
                "downloads": prepared_plugin.get("downloads", 0),
                "scope": prepared_plugin.get("scope"),
                "bundle_method": prepared_plugin.get("bundle_method"),
                "bundle_location": prepared_plugin.get("bundle_location"),
                "is_local": prepared_plugin.get("is_local", False),
                "long_description": prepared_plugin.get("long_description"),
                "config_fields": prepared_plugin.get("config_fields"),
                "messages": prepared_plugin.get("messages"),
                "dependencies": prepared_plugin.get("dependencies"),
                "created_at": current_time,
                "updated_at": current_time,
                "user_id": user_id,
                "plugin_slug": prepared_plugin.get("plugin_slug")
            })
            
            logger.info(f"Created plugin {prepared_plugin['name']} for user {user_id}")
            
            # Now initialize all modules for this plugin
            for module_data in self.MODULE_DATA:
                # Convert JSON strings to actual JSON for required_services, messages, etc.
                module_data_processed = module_data.copy()
                
                # Prepare the module data for the new user
                prepared_module = prepare_record_for_new_user(
                    module_data_processed,
                    user_id,
                    preserve_fields=["name", "display_name", "description", "icon", 
                                    "category", "enabled", "priority", "props", 
                                    "config_fields", "messages", "required_services", 
                                    "dependencies", "layout", "tags"],
                    user_id_field="user_id"
                )
                
                # Create the module using direct SQL
                module_stmt = text("""
                INSERT INTO module
                (id, plugin_id, name, display_name, description, icon, category, 
                enabled, priority, props, config_fields, messages, required_services, 
                dependencies, layout, tags, created_at, updated_at, user_id)
                VALUES
                (:id, :plugin_id, :name, :display_name, :description, :icon, :category, 
                :enabled, :priority, :props, :config_fields, :messages, :required_services, 
                :dependencies, :layout, :tags, :created_at, :updated_at, :user_id)
                """)
                
                # Execute statement with parameters
                await db.execute(module_stmt, {
                    "id": prepared_module["id"],
                    "plugin_id": prepared_plugin["id"],  # Use the new plugin ID
                    "name": prepared_module["name"],
                    "display_name": prepared_module.get("display_name"),
                    "description": prepared_module.get("description"),
                    "icon": prepared_module.get("icon"),
                    "category": prepared_module.get("category"),
                    "enabled": prepared_module.get("enabled", True),
                    "priority": prepared_module.get("priority", 0),
                    "props": prepared_module.get("props"),
                    "config_fields": prepared_module.get("config_fields"),
                    "messages": prepared_module.get("messages"),
                    "required_services": prepared_module.get("required_services"),
                    "dependencies": prepared_module.get("dependencies"),
                    "layout": prepared_module.get("layout"),
                    "tags": prepared_module.get("tags"),
                    "created_at": current_time,
                    "updated_at": current_time,
                    "user_id": user_id
                })
                
                logger.info(f"Created module {prepared_module['name']} for user {user_id}")
            
            # Create directory structure and copy plugin files
            try:
                # Define paths
                original_plugin_dir = PLUGINS_DIR / "BrainDriveSettings"
                user_dir = PLUGINS_DIR / user_id
                plugin_dir = user_dir / prepared_plugin["id"]
                
                # Create user directory if it doesn't exist
                if not user_dir.exists():
                    user_dir.mkdir(parents=True, exist_ok=True)
                    logger.info(f"Created user directory: {user_dir}")
                
                # Create plugin directory if it doesn't exist
                if not plugin_dir.exists():
                    plugin_dir.mkdir(parents=True, exist_ok=True)
                    logger.info(f"Created plugin directory: {plugin_dir}")
                
                # Create frontend/dist directory structure
                frontend_dist_dir = plugin_dir / "frontend" / "dist"
                frontend_dist_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created frontend/dist directory: {frontend_dist_dir}")
                
                # Copy original plugin files to user plugin directory
                if original_plugin_dir.exists():
                    # Copy files from original plugin directory to user plugin directory
                    for item in original_plugin_dir.glob("**/*"):
                        if item.is_file():
                            # Get relative path from original plugin directory
                            rel_path = item.relative_to(original_plugin_dir)
                            # Create destination path
                            dest_path = plugin_dir / rel_path
                            # Create parent directories if they don't exist
                            dest_path.parent.mkdir(parents=True, exist_ok=True)
                            # Copy the file
                            shutil.copy2(item, dest_path)
                            logger.info(f"Copied {item} to {dest_path}")
                    
                    # Create a dummy remoteEntry.js file in the frontend/dist directory if it doesn't exist
                    remote_entry_path = frontend_dist_dir / "remoteEntry.js"
                    if not remote_entry_path.exists():
                        with open(remote_entry_path, 'w') as f:
                            f.write('// Placeholder for remote entry file\n')
                            f.write('window.BrainDriveSettings = { get: function() { return Promise.resolve(() => ({ default: {} })); } };\n')
                        logger.info(f"Created placeholder remoteEntry.js file at {remote_entry_path}")
                    
                    logger.info(f"Copied original plugin files to user plugin directory: {plugin_dir}")
                else:
                    logger.warning(f"Original plugin directory not found: {original_plugin_dir}")
            except Exception as e:
                logger.error(f"Error creating directory structure or copying files: {e}")
                # Continue with the initialization even if file copying fails
            
            await db.commit()
            logger.info(f"BrainDrive Settings plugin initialized successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error initializing BrainDrive Settings plugin for user {user_id}: {e}")
            await db.rollback()
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up the plugin and its modules if initialization fails."""
        try:
            logger.info(f"Cleaning up BrainDrive Settings plugin for user {user_id}")
            
            # Delete all modules for this plugin for this user
            module_stmt = text("""
            DELETE FROM module
            WHERE user_id = :user_id AND plugin_id IN (
                SELECT id FROM plugin WHERE user_id = :user_id AND name = 'BrainDrive Settings'
            )
            """)
            
            await db.execute(module_stmt, {"user_id": user_id})
            
            # Delete plugin
            plugin_stmt = text("""
            DELETE FROM plugin
            WHERE user_id = :user_id AND name = 'BrainDrive Settings'
            """)
            
            await db.execute(plugin_stmt, {"user_id": user_id})
            
            # Clean up directory structure
            try:
                plugin_id = f"{user_id}_BrainDriveSettings"
                plugin_dir = PLUGINS_DIR / user_id / plugin_id
                
                if plugin_dir.exists():
                    shutil.rmtree(plugin_dir)
                    logger.info(f"Removed plugin directory: {plugin_dir}")
                
                # Check if user directory is empty and remove it if it is
                user_dir = PLUGINS_DIR / user_id
                if user_dir.exists() and not any(user_dir.iterdir()):
                    user_dir.rmdir()
                    logger.info(f"Removed empty user directory: {user_dir}")
            except Exception as e:
                logger.error(f"Error cleaning up directory structure: {e}")
                # Continue with the cleanup even if directory removal fails
            
            await db.commit()
            logger.info(f"BrainDrive Settings plugin cleaned up successfully for user {user_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error cleaning up BrainDrive Settings plugin for user {user_id}: {e}")
            await db.rollback()
            return False

# Register the initializer
register_initializer(BrainDriveSettingsInitializer)