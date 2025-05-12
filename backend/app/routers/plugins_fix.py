from fastapi import APIRouter, HTTPException, Body, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from ..plugins import PluginManager
from ..plugins.repository import PluginRepository
from ..core.database import get_db
from ..models.plugin import Plugin, Module
from pathlib import Path
from typing import Dict, Any, List, Optional
import structlog
import json

logger = structlog.get_logger()

# Initialize plugin manager with the correct plugins directory
PLUGINS_DIR = Path(__file__).parent.parent.parent / "plugins"
plugin_manager = PluginManager(str(PLUGINS_DIR))

# Create a router for plugin management endpoints WITHOUT a prefix
router = APIRouter(tags=["plugins"])

# Initialize plugin manager on startup
@router.on_event("startup")
async def startup_event():
    """Initialize plugin manager on startup."""
    await plugin_manager.initialize()

@router.get("/plugins/manifest")
async def get_plugin_manifest():
    """Get the manifest of all available plugins."""
    # Ensure plugin manager is initialized
    if not plugin_manager._initialized:
        await plugin_manager.initialize()
    return await plugin_manager.get_all_plugins()

@router.get("/plugins/manifest/designer")
async def get_plugin_manifest_for_designer():
    """Get the manifest of all available plugins with layout information for the page designer."""
    # Ensure plugin manager is initialized
    if not plugin_manager._initialized:
        await plugin_manager.initialize()
    return await plugin_manager.get_all_plugins_for_designer()

@router.get("/plugins/{plugin_id}/info")
async def get_plugin_info(plugin_id: str):
    """Get information about a specific plugin."""
    try:
        # Ensure plugin manager is initialized
        if not plugin_manager._initialized:
            await plugin_manager.initialize()
        return await plugin_manager.get_plugin_info(plugin_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting plugin info", plugin_id=plugin_id, error=str(e))
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/plugins/{plugin_id}/{path:path}")
async def serve_plugin_static(plugin_id: str, path: str):
    """Serve static files from plugin directory."""
    plugin_path = PLUGINS_DIR / plugin_id / path
    if not plugin_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(plugin_path)

@router.post("/plugins/{plugin_id}/register")
async def register_plugin(
    plugin_id: str, 
    plugin_info: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """Register a new plugin."""
    try:
        # Ensure plugin manager is initialized
        if not plugin_manager._initialized:
            await plugin_manager.initialize()
            
        # Set plugin ID from path parameter
        plugin_info["id"] = plugin_id
        
        # Insert plugin into database
        repo = PluginRepository(db)
        await repo.insert_plugin(plugin_info)
        
        # Reload plugin in manager
        await plugin_manager.reload_plugin(plugin_id)
        
        return {"status": "success", "message": f"Plugin {plugin_id} registered successfully"}
    except Exception as e:
        logger.error("Error registering plugin", plugin_id=plugin_id, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/plugins/{plugin_id}")
async def unregister_plugin(
    plugin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Unregister a plugin."""
    try:
        # Ensure plugin manager is initialized
        if not plugin_manager._initialized:
            await plugin_manager.initialize()
            
        # Delete plugin from database
        repo = PluginRepository(db)
        success = await repo.delete_plugin(plugin_id)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        return {"status": "success", "message": f"Plugin {plugin_id} unregistered successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error unregistering plugin", plugin_id=plugin_id, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/plugins/refresh-cache")
async def refresh_plugin_cache():
    """Refresh the plugin cache by reloading all plugin configurations."""
    try:
        # Ensure plugin manager is initialized
        if not plugin_manager._initialized:
            await plugin_manager.initialize()
            
        result = await plugin_manager.refresh_plugin_cache()
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to refresh plugin cache: {str(e)}"
        )

# Plugin Manager API Endpoints

@router.get("/plugins/manager")
async def get_plugins_for_manager(
    search: Optional[str] = None,
    category: Optional[str] = None,
    tags: Optional[str] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all modules with optional filtering for the plugin manager.
    
    Args:
        search: Optional search term to filter modules by name, display name, or description
        category: Optional category to filter modules by
        tags: Optional comma-separated list of tags to filter modules by
        page: Page number for pagination (1-based)
        pageSize: Number of items per page
    """
    try:
        # Parse tags if provided
        tag_list = tags.split(',') if tags else []
        
        # Build query for modules
        query = select(Module)
        
        # Apply filters
        if search:
            search_lower = f"%{search.lower()}%"
            query = query.filter(
                (func.lower(Module.name).like(search_lower)) |
                (func.lower(Module.display_name).like(search_lower)) |
                (func.lower(Module.description).like(search_lower))
            )
        
        if category:
            query = query.filter(Module.category == category)
        
        # Execute query to get all matching modules
        result = await db.execute(query)
        all_modules = result.scalars().all()
        
        # Filter by tags if needed (this needs to be done in Python since tags are stored as JSON)
        if tag_list:
            filtered_modules = []
            for module in all_modules:
                if module.tags:
                    module_tags = json.loads(module.tags) if isinstance(module.tags, str) else module.tags
                    if any(tag in module_tags for tag in tag_list):
                        filtered_modules.append(module)
            all_modules = filtered_modules
        
        # Calculate total count
        total_items = len(all_modules)
        
        # Apply pagination
        start_idx = (page - 1) * pageSize
        end_idx = start_idx + pageSize
        paginated_modules = all_modules[start_idx:end_idx]
        
        # Convert to dictionaries
        module_dicts = []
        for module in paginated_modules:
            module_dict = module.to_dict()
            
            # Parse tags from JSON string
            if module_dict.get('tags') and isinstance(module_dict['tags'], str):
                try:
                    module_dict['tags'] = json.loads(module_dict['tags'])
                except json.JSONDecodeError:
                    module_dict['tags'] = []
            
            module_dicts.append(module_dict)
        
        return {
            "modules": module_dicts,
            "totalItems": total_items
        }
    except Exception as e:
        logger.error("Error getting modules for manager", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/plugins/categories")
async def get_categories(db: AsyncSession = Depends(get_db)):
    """Get all available module categories."""
    try:
        # Query distinct categories from modules
        result = await db.execute(
            select(Module.category).distinct()
        )
        categories = [row[0] for row in result.all() if row[0]]
        
        return {"categories": categories}
    except Exception as e:
        logger.error("Error getting categories", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/plugins/tags")
async def get_tags(db: AsyncSession = Depends(get_db)):
    """Get all available module tags."""
    try:
        # Query all modules to extract tags
        result = await db.execute(select(Module.tags))
        all_tags = []
        
        # Extract tags from each module
        for row in result.all():
            if row[0]:
                try:
                    tags = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    if isinstance(tags, list):
                        all_tags.extend(tags)
                except json.JSONDecodeError:
                    pass
        
        # Get unique tags
        unique_tags = list(set(all_tags))
        
        return {"tags": unique_tags}
    except Exception as e:
        logger.error("Error getting tags", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/plugins/{plugin_id}/modules")
async def get_plugin_modules(
    plugin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get all modules for a specific plugin."""
    try:
        repo = PluginRepository(db)
        modules = await repo.get_plugin_modules(plugin_id)
        
        # Parse tags from JSON string for each module
        for module in modules:
            if module.get('tags') and isinstance(module['tags'], str):
                try:
                    module['tags'] = json.loads(module['tags'])
                except json.JSONDecodeError:
                    module['tags'] = []
        
        return {"modules": modules}
    except Exception as e:
        logger.error("Error getting plugin modules", plugin_id=plugin_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/plugins/{plugin_id}/modules/{module_id}")
async def get_module_detail(
    plugin_id: str,
    module_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get details for a specific module."""
    try:
        logger.info("Fetching module detail", plugin_id=plugin_id, module_id=module_id)
        
        # Use raw SQL query to bypass ORM issues
        # Get module data
        module_query = """
        SELECT * FROM module 
        WHERE plugin_id = :plugin_id AND id = :module_id
        """
        module_result = await db.execute(module_query, {"plugin_id": plugin_id, "module_id": module_id})
        module_row = module_result.fetchone()
        
        if not module_row:
            logger.error("Module not found", plugin_id=plugin_id, module_id=module_id)
            raise HTTPException(status_code=404, detail=f"Module {module_id} not found in plugin {plugin_id}")
        
        logger.info("Module found", plugin_id=plugin_id, module_id=module_id)
        
        # Get plugin data
        plugin_query = """
        SELECT * FROM plugin 
        WHERE id = :plugin_id
        """
        plugin_result = await db.execute(plugin_query, {"plugin_id": plugin_id})
        plugin_row = plugin_result.fetchone()
        
        if not plugin_row:
            logger.error("Plugin not found", plugin_id=plugin_id)
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        # Convert rows to dictionaries
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
        
        # Convert plugin row to dictionary
        plugin = {
            "id": plugin_row.id,
            "name": plugin_row.name,
            "description": plugin_row.description,
            "version": plugin_row.version,
            "type": plugin_row.type,
            "enabled": bool(plugin_row.enabled),
            "icon": plugin_row.icon,
            "category": plugin_row.category,
            "status": plugin_row.status,
            "official": bool(plugin_row.official),
            "author": plugin_row.author,
            "lastUpdated": plugin_row.last_updated,
            "compatibility": plugin_row.compatibility,
            "downloads": plugin_row.downloads,
            "scope": plugin_row.scope,
            "bundleMethod": plugin_row.bundle_method,
            "bundleLocation": plugin_row.bundle_location,
            "isLocal": bool(plugin_row.is_local)
        }
        
        # Parse JSON fields for plugin
        for field, attr in [
            ("configFields", plugin_row.config_fields),
            ("messages", plugin_row.messages),
            ("dependencies", plugin_row.dependencies)
        ]:
            if attr:
                try:
                    plugin[field] = json.loads(attr)
                except json.JSONDecodeError:
                    plugin[field] = {} if field != "dependencies" else []
            else:
                plugin[field] = {} if field != "dependencies" else []
        
        logger.info("Returning module and plugin details", plugin_id=plugin_id, module_id=module_id)
        return {
            "module": module,
            "plugin": plugin
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error getting module detail", 
                    plugin_id=plugin_id, 
                    module_id=module_id, 
                    error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

# Add a direct endpoint for the frontend to use
@router.get("/plugins/direct/{plugin_id}/modules/{module_id}")
async def get_module_detail_direct(
    plugin_id: str,
    module_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Direct endpoint for module details that matches the frontend path."""
    logger.info("Direct endpoint called", plugin_id=plugin_id, module_id=module_id)
    try:
        result = await get_module_detail(plugin_id, module_id, db)
        logger.info("Direct endpoint successful", plugin_id=plugin_id, module_id=module_id)
        return result
    except Exception as e:
        logger.error("Direct endpoint error", plugin_id=plugin_id, module_id=module_id, error=str(e))
        raise

# Add a simple test endpoint
@router.get("/plugins/test")
async def test_endpoint():
    """Simple test endpoint to verify the router is working."""
    logger.info("Test endpoint called")
    return {"message": "Plugin router is working!"}

# Add a simple module data endpoint
@router.get("/plugins/simple/{plugin_id}/modules/{module_id}")
async def get_simple_module_detail(
    plugin_id: str,
    module_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Simple endpoint that directly returns module data from the database."""
    logger.info("Simple module endpoint called", plugin_id=plugin_id, module_id=module_id)
    try:
        # Use raw SQL query to bypass ORM issues
        module_query = """
        SELECT * FROM module 
        WHERE plugin_id = :plugin_id AND id = :module_id
        """
        module_result = await db.execute(module_query, {"plugin_id": plugin_id, "module_id": module_id})
        module_row = module_result.fetchone()
        
        if not module_row:
            logger.error("Module not found", plugin_id=plugin_id, module_id=module_id)
            raise HTTPException(status_code=404, detail=f"Module {module_id} not found in plugin {plugin_id}")
        
        # Get plugin data
        plugin_query = """
        SELECT * FROM plugin 
        WHERE id = :plugin_id
        """
        plugin_result = await db.execute(plugin_query, {"plugin_id": plugin_id})
        plugin_row = plugin_result.fetchone()
        
        if not plugin_row:
            logger.error("Plugin not found", plugin_id=plugin_id)
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        # Return simplified data
        return {
            "module": {
                "id": module_row.id,
                "pluginId": module_row.plugin_id,
                "name": module_row.name,
                "displayName": module_row.display_name,
                "description": module_row.description,
            },
            "plugin": {
                "id": plugin_row.id,
                "name": plugin_row.name,
                "description": plugin_row.description,
                "version": plugin_row.version,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Simple module endpoint error", plugin_id=plugin_id, module_id=module_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/plugins/{plugin_id}")
async def update_plugin_status(
    plugin_id: str,
    data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """Enable or disable a plugin."""
    try:
        if "enabled" not in data:
            raise HTTPException(status_code=400, detail="Missing 'enabled' field in request body")
        
        enabled = bool(data["enabled"])
        
        repo = PluginRepository(db)
        success = await repo.update_plugin_status(plugin_id, enabled)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Plugin {plugin_id} not found")
        
        return {"status": "success", "message": f"Plugin {plugin_id} {'enabled' if enabled else 'disabled'} successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error updating plugin status", plugin_id=plugin_id, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/plugins/{plugin_id}/modules/{module_id}")
async def update_module_status(
    plugin_id: str,
    module_id: str,
    data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """Enable or disable a module."""
    try:
        if "enabled" not in data:
            raise HTTPException(status_code=400, detail="Missing 'enabled' field in request body")
        
        enabled = bool(data["enabled"])
        
        repo = PluginRepository(db)
        success = await repo.update_module_status(plugin_id, module_id, enabled)
        
        if not success:
            raise HTTPException(status_code=404, detail=f"Module {module_id} not found in plugin {plugin_id}")
        
        return {"status": "success", "message": f"Module {module_id} {'enabled' if enabled else 'disabled'} successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error updating module status", 
                    plugin_id=plugin_id, 
                    module_id=module_id, 
                    error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
