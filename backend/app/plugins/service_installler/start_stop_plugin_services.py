import structlog
from app.core.database import get_db
from app.plugins.repository import PluginRepository
from app.plugins.service_installler.plugin_service_manager import start_plugin_services, stop_plugin_services

logger = structlog.get_logger()

async def start_plugin_services_on_startup():
    """Start all plugin service runtimes on application startup."""
    try:
        logger.info("Starting plugin service runtimes...")
        
        async for db in get_db():
            repo = PluginRepository(db)
            service_runtimes = await repo.get_all_service_runtimes()

            if not service_runtimes:
                logger.info("No plugin services found in the database to start.")
                return
            
            logger.info(f"Found {len(service_runtimes)} service runtimes to start")
            
            for service_runtime in service_runtimes:
                logger.info(f"Service runtime")
                try:
                    plugin_slug = service_runtime.plugin_slug
                    logger.info(f"Starting service {service_runtime.name} for plugin {plugin_slug}")
                    
                    # Wrap in list if start_plugin_services expects a list
                    await start_plugin_services([service_runtime], plugin_slug)
                    
                except Exception as service_error:
                    logger.error(f"Failed to start service {service_runtime.name}: {service_error}")
                    continue
            
            break  # Only process the first db connection
            
    except Exception as e:
        logger.error(f"Error starting plugin services: {e}")

async def stop_all_plugin_services_on_shutdown():
    """
    Stops all plugin service runtimes on application shutdown.
    This function handles the logic of finding and stopping services.
    """
    try:
        logger.info("Stopping all plugin services...")
        
        async for db in get_db():
            repo = PluginRepository(db)
            service_runtimes = await repo.get_all_service_runtimes()

            if not service_runtimes:
                logger.info("No plugin services found in the database to stop.")
                return
            
            logger.info(f"Found {len(service_runtimes)} service runtimes to stop.")

            for service_runtime in service_runtimes:
                plugin_slug = service_runtime.plugin_slug
                if not plugin_slug:
                    logger.warning("Skipping service with no plugin_slug", name=service_runtime.get("name"))
                    continue
                
                await stop_plugin_services([service_runtime], plugin_slug)

    except Exception as e:
        logger.error("Error during shutdown of plugin services", error=str(e))
        # Don't reraise, allow the application to continue shutting down gracefully
