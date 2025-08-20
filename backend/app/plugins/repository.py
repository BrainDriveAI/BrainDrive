import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Union
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from app.models.plugin import Plugin, Module, PluginServiceRuntime
from app.dto.plugin import PluginServiceRuntimeDTO

logger = structlog.get_logger()

class PluginRepository:
    """
    Repository for plugin data operations using SQLAlchemy.
    Handles CRUD operations for plugins and modules.
    """
    
    def __init__(self, db: AsyncSession):
        """
        Initialize the repository.
        
        Args:
            db: SQLAlchemy async session
        """
        self.db = db
        
    async def get_all_plugins(self, user_id: str = None) -> List[Dict[str, Any]]:
        """Get all enabled plugins with basic info."""
        try:
            # Log the user ID filter
            logger.info(f"Getting all plugins for user: {user_id}")
            
            query = select(Plugin).where(Plugin.enabled == True)
            
            # Filter by user_id if provided
            if user_id:
                logger.info(f"Applying user ID filter: {user_id}")
                query = query.where(Plugin.user_id == user_id)
            else:
                logger.warning("No user ID provided, returning all plugins")
                
            result = await self.db.execute(query)
            plugins = result.scalars().all()
            
            # Log the number of plugins found
            logger.info(f"Found {len(plugins)} plugins")
            
            # Log the plugin IDs
            plugin_ids = [plugin.id for plugin in plugins]
            logger.info(f"Plugin IDs: {plugin_ids}")
            
            return [plugin.to_dict() for plugin in plugins]
        except Exception as e:
            logger.error("Error getting all plugins", error=str(e))
            raise
            
    async def get_all_plugins_with_modules(self, user_id: str = None) -> List[Dict[str, Any]]:
        """Get all plugins with their modules."""
        try:
            # Log the user ID filter
            logger.info(f"Getting all plugins with modules for user: {user_id}")
            
            # Get all plugins
            query = select(Plugin).where(Plugin.enabled == True)
            
            # Filter by user_id if provided
            if user_id:
                logger.info(f"Applying user ID filter: {user_id}")
                query = query.where(Plugin.user_id == user_id)
            else:
                logger.warning("No user ID provided, returning all plugins")
            
            result = await self.db.execute(query)
            plugins = result.scalars().all()
            
            # Log the number of plugins found
            logger.info(f"Found {len(plugins)} plugins")
            
            # Log the plugin IDs
            plugin_ids = [plugin.id for plugin in plugins]
            logger.info(f"Plugin IDs: {plugin_ids}")
            
            # Convert to dictionaries and fetch modules separately
            plugin_dicts = []
            for plugin in plugins:
                plugin_dict = plugin.to_dict()

                # Get modules for this plugin
                modules_query = select(Module).where(Module.plugin_id == plugin.id)
                
                # Filter modules by user_id if provided
                if user_id:
                    modules_query = modules_query.where(Module.user_id == user_id)
                    
                modules_result = await self.db.execute(modules_query)
                modules = modules_result.scalars().all()
                
                # Add modules to plugin dictionary
                plugin_dict["modules"] = [module.to_dict() for module in modules]
                plugin_dicts.append(plugin_dict)
                
            return plugin_dicts
        except Exception as e:
            logger.error("Error getting plugins with modules", error=str(e))
            raise

    async def get_all_service_runtimes(self) -> List[PluginServiceRuntimeDTO]:
        """
        Get all plugin service runtimes for startup and return them as DTOs.
        """
        try:
            query = select(PluginServiceRuntime).where(
                PluginServiceRuntime.status.in_(["pending", "stopped", "running"])
            )
            
            result = await self.db.execute(query)
            services = result.scalars().all()
            
            # Convert SQLAlchemy models to Pydantic DTOs for a typed return
            return [PluginServiceRuntimeDTO(**service.to_dict()) for service in services]
            
        except Exception as e:
            logger.error("Error getting service runtimes", error=str(e))
            raise
            
    async def get_plugin(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific plugin by ID."""
        try:
            result = await self.db.execute(
                select(Plugin).where(Plugin.id == plugin_id)
            )
            plugin = result.scalars().first()
            
            if not plugin:
                return None
                
            return plugin.to_dict()
        except Exception as e:
            logger.error("Error getting plugin", plugin_id=plugin_id, error=str(e))
            raise
            
    async def get_plugin_with_modules(self, plugin_id: str, user_id: str = None) -> Optional[Dict[str, Any]]:
        """Get a specific plugin with its modules."""
        try:
            # Get the plugin
            query = select(Plugin).where(Plugin.id == plugin_id)
            
            # Filter by user_id if provided
            if user_id:
                query = query.where(Plugin.user_id == user_id)
                
            result = await self.db.execute(query)
            plugin = result.scalars().first()
            
            if not plugin:
                return None
            
            # Get plugin as dictionary
            plugin_dict = plugin.to_dict()
            
            # Get modules for this plugin
            modules_query = select(Module).where(Module.plugin_id == plugin_id)
            
            # Filter modules by user_id if provided
            if user_id:
                modules_query = modules_query.where(Module.user_id == user_id)
                
            modules_result = await self.db.execute(modules_query)
            modules = modules_result.scalars().all()
            
            # Add modules to plugin dictionary
            plugin_dict["modules"] = [module.to_dict() for module in modules]
            
            return plugin_dict
        except Exception as e:
            logger.error("Error getting plugin with modules",
                        plugin_id=plugin_id,
                        error=str(e))
            raise
            
    async def get_plugin_modules(self, plugin_id: str, user_id: str = None) -> List[Dict[str, Any]]:
        """Get all modules for a specific plugin."""
        try:
            query = select(Module).where(Module.plugin_id == plugin_id)
            
            # Filter by user_id if provided
            if user_id:
                query = query.where(Module.user_id == user_id)
                
            result = await self.db.execute(query)
            modules = result.scalars().all()
            
            return [module.to_dict() for module in modules]
        except Exception as e:
            logger.error("Error getting plugin modules",
                        plugin_id=plugin_id,
                        error=str(e))
            raise
            
    async def get_plugin_by_slug(self, plugin_slug: str, user_id: str = None) -> Optional[Dict[str, Any]]:
        """Get a specific plugin by slug and user_id."""
        try:
            query = select(Plugin).where(Plugin.plugin_slug == plugin_slug)
            
            # Filter by user_id if provided
            if user_id:
                query = query.where(Plugin.user_id == user_id)
                
            result = await self.db.execute(query)
            plugin = result.scalars().first()
            
            if not plugin:
                return None
                
            return plugin.to_dict()
        except Exception as e:
            logger.error("Error getting plugin by slug",
                        plugin_slug=plugin_slug,
                        user_id=user_id,
                        error=str(e))
            raise
            
    async def get_module(self, plugin_id: str, module_id: str, user_id: str = None) -> Optional[Dict[str, Any]]:
        """Get a specific module from a plugin."""
        try:
            query = select(Module).where(
                Module.plugin_id == plugin_id,
                Module.id == module_id
            )
            
            # Filter by user_id if provided
            if user_id:
                query = query.where(Module.user_id == user_id)
                
            result = await self.db.execute(query)
            module = result.scalars().first()
            
            if not module:
                return None
                
            return module.to_dict()
        except Exception as e:
            logger.error("Error getting module",
                        plugin_id=plugin_id,
                        module_id=module_id,
                        error=str(e))
            raise
            
    async def insert_plugin(self, plugin_data: Dict[str, Any]) -> str:
        """Insert a new plugin."""
        try:
            # Extract modules from plugin data
            modules_data = plugin_data.pop("modules", [])
            
            # Get user_id from plugin data
            user_id = plugin_data.get("user_id")
            
            # Create plugin model
            plugin = Plugin.from_dict(plugin_data)
            
            # Add to session
            self.db.add(plugin)
            await self.db.flush()  # Flush to get the ID
            
            # Insert modules
            for module_data in modules_data:
                # Ensure module has the same user_id as the plugin
                if user_id and "user_id" not in module_data:
                    module_data["user_id"] = user_id
                
                module = Module.from_dict(module_data, plugin.id)
                self.db.add(module)
            
            # Commit changes
            await self.db.commit()
            
            return plugin.id
        except Exception as e:
            await self.db.rollback()
            logger.error("Error inserting plugin",
                        plugin_id=plugin_data.get("id"),
                        error=str(e))
            raise
            
    async def update_plugin(self, plugin_id: str, plugin_data: Dict[str, Any]) -> bool:
        """Update an existing plugin."""
        try:
            # Check if plugin exists
            result = await self.db.execute(
                select(Plugin).where(Plugin.id == plugin_id)
            )
            existing_plugin = result.scalars().first()
            
            if not existing_plugin:
                logger.warning("Plugin not found for update", plugin_id=plugin_id)
                return False
            
            # Extract modules from plugin data
            modules_data = plugin_data.pop("modules", None)
            
            # Get user_id from plugin data or existing plugin
            user_id = plugin_data.get("user_id") or existing_plugin.user_id
            
            # Update plugin fields
            for key, value in plugin_data.items():
                # Convert camelCase to snake_case for database fields
                if key == "lastUpdated":
                    setattr(existing_plugin, "last_updated", value)
                elif key == "bundlemethod":
                    setattr(existing_plugin, "bundle_method", value)
                elif key == "bundlelocation":
                    setattr(existing_plugin, "bundle_location", value)
                elif key == "islocal":
                    setattr(existing_plugin, "is_local", value)
                elif key == "longDescription":
                    setattr(existing_plugin, "long_description", value)
                elif key == "configFields":
                    setattr(existing_plugin, "config_fields", json.dumps(value) if value else None)
                elif key == "messages":
                    setattr(existing_plugin, "messages", json.dumps(value) if value else None)
                elif key == "dependencies":
                    setattr(existing_plugin, "dependencies", json.dumps(value) if value else None)
                else:
                    # Convert camelCase to snake_case
                    db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                    setattr(existing_plugin, db_key, value)
            
            # Update modules if provided
            if modules_data is not None:
                # Delete existing modules
                await self.db.execute(
                    delete(Module).where(Module.plugin_id == plugin_id)
                )
                
                # Insert new modules
                for module_data in modules_data:
                    # Ensure module has the same user_id as the plugin
                    if user_id and "user_id" not in module_data:
                        module_data["user_id"] = user_id
                    
                    module = Module.from_dict(module_data, plugin_id)
                    self.db.add(module)
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error updating plugin",
                        plugin_id=plugin_id,
                        error=str(e))
            raise
            
    async def update_module(self, plugin_id: str, module_id: str, module_data: Dict[str, Any]) -> bool:
        """Update an existing module."""
        try:
            # Check if module exists
            result = await self.db.execute(
                select(Module).where(
                    Module.plugin_id == plugin_id,
                    Module.id == module_id
                )
            )
            existing_module = result.scalars().first()
            
            if not existing_module:
                logger.warning("Module not found for update", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            # Update module fields
            for key, value in module_data.items():
                if key in ["id", "plugin_id"]:
                    continue  # Skip primary key fields
                
                # Handle special fields
                if key == "displayName":
                    setattr(existing_module, "display_name", value)
                elif key == "configFields":
                    setattr(existing_module, "config_fields", json.dumps(value) if value else None)
                elif key == "requiredServices":
                    setattr(existing_module, "required_services", json.dumps(value) if value else None)
                elif key in ["props", "messages", "dependencies", "layout", "tags"]:
                    # Convert camelCase to snake_case
                    db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                    setattr(existing_module, db_key, json.dumps(value) if value else None)
                else:
                    # Convert camelCase to snake_case
                    db_key = ''.join(['_' + c.lower() if c.isupper() else c for c in key]).lstrip('_')
                    setattr(existing_module, db_key, value)
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error updating module", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    async def delete_plugin(self, plugin_id: str) -> bool:
        """Delete a plugin and all its modules."""
        try:
            # Check if plugin exists
            result = await self.db.execute(
                select(Plugin).where(Plugin.id == plugin_id)
            )
            existing_plugin = result.scalars().first()
            
            if not existing_plugin:
                logger.warning("Plugin not found for deletion", plugin_id=plugin_id)
                return False
            
            # Delete plugin (modules will be deleted via cascade)
            await self.db.execute(
                delete(Plugin).where(Plugin.id == plugin_id)
            )
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error deleting plugin", 
                        plugin_id=plugin_id, 
                        error=str(e))
            raise
            
    async def delete_module(self, plugin_id: str, module_id: str) -> bool:
        """Delete a specific module from a plugin."""
        try:
            # Check if module exists
            result = await self.db.execute(
                select(Module).where(
                    Module.plugin_id == plugin_id,
                    Module.id == module_id
                )
            )
            existing_module = result.scalars().first()
            
            if not existing_module:
                logger.warning("Module not found for deletion", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            # Delete module
            await self.db.execute(
                delete(Module).where(
                    Module.plugin_id == plugin_id,
                    Module.id == module_id
                )
            )
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error deleting module", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
            
    async def update_plugin_status(self, plugin_id: str, enabled: bool) -> bool:
        """Update a plugin's enabled status."""
        try:
            result = await self.db.execute(
                update(Plugin)
                .where(Plugin.id == plugin_id)
                .values(enabled=enabled)
                .returning(Plugin.id)
            )
            updated_id = result.scalar_one_or_none()
            
            if not updated_id:
                logger.warning("Plugin not found for status update", plugin_id=plugin_id)
                return False
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error updating plugin status", 
                        plugin_id=plugin_id, 
                        error=str(e))
            raise
            
    async def update_module_status(self, plugin_id: str, module_id: str, enabled: bool) -> bool:
        """Update a module's enabled status."""
        try:
            result = await self.db.execute(
                update(Module)
                .where(
                    Module.plugin_id == plugin_id,
                    Module.id == module_id
                )
                .values(enabled=enabled)
                .returning(Module.id)
            )
            updated_id = result.scalar_one_or_none()
            
            if not updated_id:
                logger.warning("Module not found for status update", 
                              plugin_id=plugin_id, 
                              module_id=module_id)
                return False
            
            # Commit changes
            await self.db.commit()
            
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error("Error updating module status", 
                        plugin_id=plugin_id, 
                        module_id=module_id, 
                        error=str(e))
            raise
