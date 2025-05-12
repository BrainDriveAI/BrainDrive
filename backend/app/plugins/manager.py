from fastapi import APIRouter, HTTPException, Depends
from pathlib import Path
import json
import logging
from typing import Dict, List, Optional, Any
import asyncio
from dataclasses import dataclass
from datetime import datetime
import structlog
import importlib.util
import sys
import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.plugin import Plugin, Module
from app.plugins.repository import PluginRepository

logger = structlog.get_logger()

class PluginFileHandler(FileSystemEventHandler):
    def __init__(self, plugin_manager):
        self.plugin_manager = plugin_manager
        
    def on_modified(self, event):
        if event.is_directory:
            return
        
        # TEMPORARILY DISABLED: Plugin file watching is disabled
        if event.src_path.endswith("plugin.json"):
            plugin_dir = Path(event.src_path).parent
            plugin_id = plugin_dir.name
            logger.info(f"Plugin configuration changed: {plugin_id} (reload disabled)")
            # asyncio.create_task(self.plugin_manager.reload_plugin(plugin_id))  # Commented out to prevent reloading

class PluginManager:
    def __init__(self, plugins_dir: str):
        """Initialize the plugin manager.
        
        Args:
            plugins_dir: Path to the plugins directory
        """
        self.plugins_dir = Path(plugins_dir)
        self.router = APIRouter()
        self.plugin_backends = {}  # Store backend modules
        self._initialized = False
        
        # TEMPORARILY DISABLED: File watcher is disabled to reduce log spam
        # Set up file watcher
        # self.observer = Observer()
        # self.observer.schedule(PluginFileHandler(self), str(self.plugins_dir), recursive=True)
        # self.observer.start()
        logger.info("File watcher is temporarily disabled")
    
    async def get_user_plugins_dir(self, user_id: str) -> Path:
        """Get the plugins directory for a specific user."""
        user_dir = self.plugins_dir / user_id
        if not user_dir.exists():
            user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir
        
    async def initialize(self):
        """Initialize the plugin manager asynchronously.
        This method should be called before using any other methods.
        """
        if not self._initialized:
            # await self._discover_plugins()
            self._initialized = True

    async def _load_plugin_config(self, plugin_dir: Path) -> Dict[str, Any]:
        """Load plugin configuration from plugin.json"""
        # TEMPORARILY DISABLED: Plugin configuration loading is disabled
        logger.info(f"Plugin configuration loading is temporarily disabled for {plugin_dir}")
        
        # Return a minimal config to avoid errors
        return {
            "name": "Disabled Plugin",
            "version": "1.0.0",
            "description": "Plugin loading is temporarily disabled",
            "modules": []
        }
        
        # Original implementation commented out:
        """
        config_path = plugin_dir / "plugin.json"
        if not config_path.exists():
            raise ValueError(f"No plugin.json found in {plugin_dir}")
        
        try:
            with open(config_path) as f:
                config = json.load(f)
                
            # Validate required fields
            required_fields = ["name", "version", "description"]
            for field in required_fields:
                if field not in config:
                    raise ValueError(f"Missing required field '{field}' in {config_path}")
                    
            # Validate modules if present
            if "modules" in config and isinstance(config["modules"], list):
                for i, module in enumerate(config["modules"]):
                    if not isinstance(module, dict):
                        raise ValueError(f"Module at index {i} in {config_path} is not an object")
                    if "name" not in module:
                        raise ValueError(f"Module at index {i} in {config_path} has no name")
                        
                    # Ensure id field exists (add if missing)
                    if "id" not in module:
                        module["id"] = module["name"]
                
            return config
        except Exception as e:
            logger.error(f"Error loading plugin config: {str(e)}")
            raise
        """

    async def _discover_plugins(self, user_id: str = None):
        """Scan plugin directories and register new plugins in the database.
        
        Args:
            user_id: If provided, only scan plugins for this user
        """
        # TEMPORARILY DISABLED: Plugin discovery is disabled to prevent loading JSON files
        logger.info("Plugin discovery is temporarily disabled")
        
        # Just set up routes without loading any plugins
        try:
            async for db in get_db():
                repo = PluginRepository(db)
                await self.setup_routes(repo)
                break  # Only need one session for initialization
        except Exception as e:
            logger.error(f"Error setting up routes: {str(e)}")
            
        # Original implementation commented out:
        """
        try:
            # Get a database session
            async for db in get_db():
                repo = PluginRepository(db)
                
                # Determine which directories to scan
                if user_id:
                    # Only scan the user's directory
                    user_dir = await self.get_user_plugins_dir(user_id)
                    user_dirs = [user_dir]
                else:
                    # Scan all user directories
                    user_dirs = [d for d in self.plugins_dir.iterdir() if d.is_dir() and not d.name.startswith('.')]
                
                # Process each user directory
                for user_dir in user_dirs:
                    current_user_id = user_dir.name
                    
                    # Process each plugin directory for this user
                    for plugin_dir in user_dir.iterdir():
                        if not plugin_dir.is_dir() or plugin_dir.name.startswith('.') or plugin_dir.name == 'static':
                            continue
                            
                        try:
                            # Load plugin configuration
                            config = await self._load_plugin_config(plugin_dir)
                            
                            # Use directory name as plugin_slug
                            plugin_slug = plugin_dir.name
                            
                            # Generate a unique plugin_id
                            plugin_id = f"{current_user_id}_{plugin_slug}"
                            
                            # Set values in the config
                            config["id"] = plugin_id
                            config["plugin_slug"] = plugin_slug
                            config["user_id"] = current_user_id
                            
                            # Check if plugin exists in database
                            existing_plugin = await repo.get_plugin(plugin_id)
                            
                            if existing_plugin:
                                # Update existing plugin
                                await repo.update_plugin(plugin_id, config)
                                logger.info(f"Updated plugin in database: {plugin_id}")
                            else:
                                # Insert new plugin
                                await repo.insert_plugin(config)
                                logger.info(f"Inserted plugin into database: {plugin_id}")
                            
                            # Load backend module if exists
                            await self._load_backend_module(plugin_id, plugin_dir, config)
                            
                        except Exception as e:
                            logger.error(f"Failed to process plugin {plugin_dir.name} for user {current_user_id}: {str(e)}")
                
                # Setup routes
                await self.setup_routes(repo)
                break  # Only need one session for initialization
        except Exception as e:
            logger.error(f"Error discovering plugins: {str(e)}")
        """

    async def _load_backend_module(self, plugin_id: str, plugin_dir: Path, config: Dict[str, Any]):
        """Load backend module for a plugin if it exists"""
        # TEMPORARILY DISABLED: Backend module loading is disabled
        logger.info(f"Backend module loading is temporarily disabled for plugin {plugin_id}")
        return
        
        # Original implementation commented out:
        """
        backend_module_path = plugin_dir / "backend" / "main.py"
        if not backend_module_path.exists():
            return
            
        try:
            # Determine the class name from the plugin.json
            # If entry.backend.class exists, use that
            # Otherwise, try to infer from the plugin ID
            class_name = None
            if "entry" in config and "backend" in config["entry"] and "class" in config["entry"]["backend"]:
                class_name = config["entry"]["backend"]["class"]
            else:
                # Try to infer class name from the plugin ID
                class_name = f"{plugin_dir.name.title().replace('-', '')}Plugin"
            
            # Load the module
            spec = importlib.util.spec_from_file_location(
                f"plugins.{plugin_dir.name}.backend.main",
                str(backend_module_path)
            )
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            
            # Try to find the plugin class
            plugin_class = None
            if hasattr(module, class_name):
                plugin_class = getattr(module, class_name)
            else:
                # If class_name not found, look for any class that ends with "Plugin"
                for attr_name in dir(module):
                    if attr_name.endswith("Plugin"):
                        plugin_class = getattr(module, attr_name)
                        break
            
            if plugin_class:
                # Initialize plugin class
                plugin_instance = plugin_class(config=config)
                self.plugin_backends[plugin_id] = plugin_instance
                
                # Add plugin routes if they exist
                if hasattr(plugin_instance, "router"):
                    self.router.include_router(
                        plugin_instance.router,
                        prefix=f"/api/plugins/{plugin_id}",
                        tags=[plugin_id]
                    )
                    logger.info(f"Added routes for plugin: {plugin_id}")
            else:
                logger.warning(f"No plugin class found in {backend_module_path}")
        except Exception as e:
            logger.error(f"Error loading backend module for {plugin_id}: {str(e)}")
        """

    async def setup_routes(self, repo: PluginRepository):
        """Set up API routes for plugin management"""
        
        @self.router.get("")
        async def get_plugins(db: AsyncSession = Depends(get_db)):
            """Get all plugins"""
            repo = PluginRepository(db)
            plugins = await repo.get_all_plugins()
            
            # Convert list to dictionary with plugin_id as key
            return {plugin["id"]: plugin for plugin in plugins}
            
        @self.router.get("/{plugin_id}")
        async def get_plugin(plugin_id: str, db: AsyncSession = Depends(get_db)):
            """Get a specific plugin by ID"""
            repo = PluginRepository(db)
            plugin = await repo.get_plugin_with_modules(plugin_id)
            
            if not plugin:
                raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                
            return plugin
            
        @self.router.get("/{plugin_id}/modules")
        async def get_plugin_modules(plugin_id: str, db: AsyncSession = Depends(get_db)):
            """Get all modules for a specific plugin"""
            repo = PluginRepository(db)
            modules = await repo.get_plugin_modules(plugin_id)
            
            if not modules and not await repo.get_plugin(plugin_id):
                raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                
            return modules
            
        @self.router.get("/{plugin_id}/modules/{module_id}")
        async def get_plugin_module(
            plugin_id: str, 
            module_id: str, 
            db: AsyncSession = Depends(get_db)
        ):
            """Get a specific module from a plugin"""
            from sqlalchemy import text
            
            # Use raw SQL query to bypass ORM issues
            module_query = text("""
            SELECT * FROM module 
            WHERE plugin_id = :plugin_id AND id = :module_id
            """)
            module_result = await db.execute(module_query, {"plugin_id": plugin_id, "module_id": module_id})
            module_row = module_result.fetchone()
            
            if not module_row:
                # Check if plugin exists
                plugin_query = text("""
                SELECT * FROM plugin 
                WHERE id = :plugin_id
                """)
                plugin_result = await db.execute(plugin_query, {"plugin_id": plugin_id})
                plugin_row = plugin_result.fetchone()
                
                if not plugin_row:
                    raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                else:
                    raise HTTPException(
                        status_code=404, 
                        detail=f"Module {module_id} not found in plugin {plugin_id}"
                    )
            
            # Convert to dictionary
            module = {
                "id": module_row.id,
                "pluginId": module_row.plugin_id,
                "name": module_row.name,
                "displayName": module_row.display_name,
                "description": module_row.description,
                "icon": module_row.icon,
                "category": module_row.category,
                "enabled": bool(module_row.enabled),
                "priority": module_row.priority
            }
            
            # Parse JSON fields
            for field, attr in [
                ("props", module_row.props),
                ("configFields", module_row.config_fields),
                ("messages", module_row.messages),
                ("requiredServices", module_row.required_services),
                ("layout", module_row.layout)
            ]:
                if attr:
                    try:
                        module[field] = json.loads(attr)
                    except json.JSONDecodeError:
                        module[field] = {}
            
            # Parse tags
            if module_row.tags:
                try:
                    module["tags"] = json.loads(module_row.tags)
                except json.JSONDecodeError:
                    module["tags"] = []
            else:
                module["tags"] = []
            
            # Parse dependencies
            if module_row.dependencies:
                try:
                    module["dependencies"] = json.loads(module_row.dependencies)
                except json.JSONDecodeError:
                    module["dependencies"] = []
            else:
                module["dependencies"] = []
            
            if not module:
                # Check if plugin exists
                plugin = await repo.get_plugin(plugin_id)
                if not plugin:
                    raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                else:
                    raise HTTPException(
                        status_code=404, 
                        detail=f"Module {module_id} not found in plugin {plugin_id}"
                    )
                    
            return module
            
        @self.router.patch("/{plugin_id}/modules/{module_id}")
        async def update_plugin_module_status(
            plugin_id: str, 
            module_id: str, 
            status: bool = True,
            db: AsyncSession = Depends(get_db)
        ):
            """Enable or disable a specific module"""
            repo = PluginRepository(db)
            success = await repo.update_module_status(plugin_id, module_id, status)
            
            if not success:
                # Check if plugin exists
                plugin = await repo.get_plugin(plugin_id)
                if not plugin:
                    raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                else:
                    raise HTTPException(
                        status_code=404, 
                        detail=f"Module {module_id} not found in plugin {plugin_id}"
                    )
                    
            return {
                "status": "success", 
                "message": f"Module {module_id} {'enabled' if status else 'disabled'}"
            }
            
        @self.router.patch("/{plugin_id}")
        async def update_plugin_status(
            plugin_id: str, 
            status: bool = True,
            db: AsyncSession = Depends(get_db)
        ):
            """Enable or disable a plugin"""
            repo = PluginRepository(db)
            success = await repo.update_plugin_status(plugin_id, status)
            
            if not success:
                raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
                    
            return {
                "status": "success", 
                "message": f"Plugin {plugin_id} {'enabled' if status else 'disabled'}"
            }

    async def get_all_plugins(self, user_id: str) -> Dict[str, Any]:
        """Get information about all plugins for a specific user."""
        # Ensure user_id is provided
        if not user_id:
            logger.error("No user ID provided to get_all_plugins")
            return {}
        
        logger.info(f"Getting all plugins for user: {user_id}")
        
        async for db in get_db():
            repo = PluginRepository(db)
            plugins = await repo.get_all_plugins(user_id=user_id)
            
            # Log the number of plugins found
            logger.info(f"Found {len(plugins)} plugins for user {user_id}")
            
            # Convert list to dictionary with plugin_id as key
            return {plugin["id"]: plugin for plugin in plugins}
        
    async def get_all_plugins_for_designer(self, user_id: str) -> Dict[str, Any]:
        """Get information about all plugins including layout configuration for the designer."""
        # Ensure user_id is provided
        if not user_id:
            logger.error("No user ID provided to get_all_plugins_for_designer")
            return {}
        
        logger.info(f"Getting all plugins for designer for user: {user_id}")
        
        async for db in get_db():
            repo = PluginRepository(db)
            plugins = await repo.get_all_plugins_with_modules(user_id=user_id)
            
            # Log the number of plugins found
            logger.info(f"Found {len(plugins)} plugins for user {user_id}")
            
            # Convert list to dictionary with plugin_id as key
            return {plugin["id"]: plugin for plugin in plugins}
        
    async def get_plugin_info(self, plugin_id: str, user_id: str) -> Dict[str, Any]:
        """Get detailed information about a specific plugin."""
        # Ensure user_id is provided
        if not user_id:
            logger.error("No user ID provided to get_plugin_info")
            raise HTTPException(status_code=400, detail="User ID is required")
        
        logger.info(f"Getting plugin info for plugin {plugin_id} and user {user_id}")
        
        async for db in get_db():
            repo = PluginRepository(db)
            plugin = await repo.get_plugin_with_modules(plugin_id, user_id=user_id)
            
            if not plugin:
                logger.error(f"Plugin {plugin_id} not found for user {user_id}")
                raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
            
            logger.info(f"Found plugin {plugin_id} for user {user_id}")
            return plugin
        
    async def reload_plugin(self, plugin_id: str, user_id: str = None):
        """Reload a specific plugin
        
        Args:
            plugin_id: The ID of the plugin to reload
            user_id: The user ID that owns the plugin. If not provided, it will be extracted from plugin_id
        """
        # TEMPORARILY DISABLED: Plugin reloading is disabled
        logger.info(f"Plugin reloading is temporarily disabled for plugin {plugin_id}")
        return
        
        # Original implementation commented out:
        """
        # If user_id is not provided, try to extract it from plugin_id
        if not user_id and '_' in plugin_id:
            user_id, plugin_slug = plugin_id.split('_', 1)
        else:
            # Try to get the plugin from the database to get its slug
            async for db in get_db():
                repo = PluginRepository(db)
                plugin_data = await repo.get_plugin(plugin_id)
                if plugin_data:
                    plugin_slug = plugin_data.get("plugin_slug", plugin_id)
                    user_id = plugin_data.get("userId")
                break
        
        if not user_id:
            logger.warning(f"Could not determine user_id for plugin {plugin_id}, cannot reload")
            return
            
        # Get the plugin directory
        user_dir = await self.get_user_plugins_dir(user_id)
        plugin_dir = user_dir / plugin_slug
        
        if not plugin_dir.exists() or not plugin_dir.is_dir():
            logger.warning(f"Plugin directory {plugin_dir} not found, cannot reload")
            return
            
        try:
            # Load plugin configuration
            config = await self._load_plugin_config(plugin_dir)
            
            # Set plugin ID and slug
            config["id"] = plugin_id
            config["plugin_slug"] = plugin_slug
            config["user_id"] = user_id
            
            # Update plugin in database
            async for db in get_db():
                repo = PluginRepository(db)
                
                # Check if plugin exists
                existing_plugin = await repo.get_plugin(plugin_id)
                
                if existing_plugin:
                    # Update existing plugin
                    await repo.update_plugin(plugin_id, config)
                    logger.info(f"Updated plugin in database: {plugin_id}")
                else:
                    # Insert new plugin
                    await repo.insert_plugin(config)
                    logger.info(f"Inserted plugin into database: {plugin_id}")
                
                # Reload backend module if exists
                await self._load_backend_module(plugin_id, plugin_dir, config)
                break  # Only need one session
                
            logger.info(f"Reloaded plugin: {plugin_id}")
        except Exception as e:
            logger.error(f"Failed to reload plugin {plugin_id}: {str(e)}")
        """
        
    async def refresh_plugin_cache(self):
        """Refresh the plugin cache by reloading all plugin configurations"""
        try:
            # Get current plugins
            async for db in get_db():
                repo = PluginRepository(db)
                current_plugins = await repo.get_all_plugins()
                current_plugin_ids = [p["id"] for p in current_plugins]
                
                # Rediscover plugins
                # await self._discover_plugins()
                
                # Get updated plugins
                updated_plugins = await repo.get_all_plugins()
                updated_plugin_ids = [p["id"] for p in updated_plugins]
                
                # Calculate changes
                new_plugins = set(updated_plugin_ids) - set(current_plugin_ids)
                removed_plugins = set(current_plugin_ids) - set(updated_plugin_ids)
                
                if new_plugins:
                    logger.info(f"New plugins found: {', '.join(new_plugins)}")
                if removed_plugins:
                    logger.info(f"Plugins removed: {', '.join(removed_plugins)}")
                    
                return {
                    "total": len(updated_plugins),
                    "new": list(new_plugins),
                    "removed": list(removed_plugins)
                }
        except Exception as e:
            logger.error(f"Error refreshing plugin cache: {str(e)}")
            return {
                "error": str(e),
                "total": 0,
                "new": [],
                "removed": []
            }
