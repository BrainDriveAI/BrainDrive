#!/usr/bin/env python3
"""
BrainDrive Network Plugin API Endpoints

This module provides FastAPI endpoints for managing the BrainDrive Network plugin
lifecycle operations. It integrates with the lifecycle_manager.py to provide
REST API access to plugin installation, deletion, and status checking.
"""

from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Dict, Any
import structlog

# Import the lifecycle manager
from .lifecycle_manager import BrainDriveNetworkLifecycleManager

# These would be imported from the main BrainDrive backend
# from app.core.database import get_db
# from app.core.security import get_current_user
# from app.models.user import User

logger = structlog.get_logger()

# Create router for plugin endpoints
router = APIRouter(prefix="/api/plugins/braindrive-network", tags=["BrainDrive Network Plugin"])

# Initialize lifecycle manager
lifecycle_manager = BrainDriveNetworkLifecycleManager()

# Mock dependencies for demonstration (replace with actual BrainDrive imports)
async def get_db():
    """Mock database dependency - replace with actual implementation"""
    pass

async def get_current_user():
    """Mock user dependency - replace with actual implementation"""
    class MockUser:
        def __init__(self):
            self.id = "demo_user"
    return MockUser()

@router.post("/install")
async def install_plugin(
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Install BrainDrive Network plugin for the current user

    This endpoint installs the plugin only for the requesting user,
    ensuring proper plugin scoping and isolation.
    """
    try:
        logger.info(f"Plugin installation requested by user {current_user.id}")

        result = await lifecycle_manager.install_plugin(current_user.id, db)

        if result['success']:
            return {
                "status": "success",
                "message": "BrainDrive Network plugin installed successfully",
                "data": {
                    "plugin_id": result['plugin_id'],
                    "plugin_slug": result['plugin_slug'],
                    "modules_created": result['modules_created'],
                    "plugin_directory": result['plugin_directory']
                }
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result['error']
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during plugin installation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during plugin installation"
        )

@router.delete("/uninstall")
async def uninstall_plugin(
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Uninstall BrainDrive Network plugin for the current user

    This endpoint removes the plugin only for the requesting user,
    leaving other users' installations intact.
    """
    try:
        logger.info(f"Plugin uninstallation requested by user {current_user.id}")

        result = await lifecycle_manager.delete_plugin(current_user.id, db)

        if result['success']:
            return {
                "status": "success",
                "message": "BrainDrive Network plugin uninstalled successfully",
                "data": {
                    "plugin_id": result['plugin_id'],
                    "deleted_modules": result['deleted_modules']
                }
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=result['error']
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error during plugin uninstallation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during plugin uninstallation"
        )

@router.get("/status")
async def get_plugin_status(
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get installation status of BrainDrive Network plugin for the current user

    Returns detailed information about the plugin installation status,
    including file system and database consistency checks.
    """
    try:
        logger.info(f"Plugin status requested by user {current_user.id}")

        status_info = await lifecycle_manager.get_plugin_status(current_user.id, db)

        return {
            "status": "success",
            "data": status_info
        }

    except Exception as e:
        logger.error(f"Error getting plugin status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while checking plugin status"
        )

@router.get("/info")
async def get_plugin_info():
    """
    Get general information about the BrainDrive Network plugin

    Returns plugin metadata without requiring authentication.
    Useful for plugin discovery and information display.
    """
    try:
        return {
            "status": "success",
            "data": {
                "plugin_info": lifecycle_manager.PLUGIN_DATA,
                "module_info": lifecycle_manager.MODULE_DATA,
                "installation_type": "user-scoped",
                "description": "This plugin is installed per-user and does not affect other users"
            }
        }

    except Exception as e:
        logger.error(f"Error getting plugin info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error while getting plugin information"
        )

@router.post("/repair")
async def repair_plugin_installation(
    current_user = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Repair a corrupted plugin installation

    This endpoint attempts to fix common installation issues by:
    1. Checking file system integrity
    2. Validating database records
    3. Recreating missing files or database entries
    """
    try:
        logger.info(f"Plugin repair requested by user {current_user.id}")

        # First check current status
        status_info = await lifecycle_manager.get_plugin_status(current_user.id, db)

        if not status_info['exists']:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Plugin is not installed for this user"
            )

        if status_info['status'] == 'healthy':
            return {
                "status": "success",
                "message": "Plugin installation is already healthy",
                "data": status_info
            }

        # Attempt repair based on status
        repair_actions = []

        if not status_info['files_exist']:
            # Recreate files
            user_plugin_dir = lifecycle_manager.plugins_base_dir / current_user.id / lifecycle_manager.PLUGIN_DATA['plugin_slug']
            await lifecycle_manager._create_user_plugin_directory(current_user.id)
            copy_result = await lifecycle_manager._copy_plugin_files(current_user.id, user_plugin_dir)
            if copy_result['success']:
                repair_actions.append("Recreated missing plugin files")
            else:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to recreate plugin files: {copy_result['error']}"
                )

        if not status_info['modules_status']['all_loaded']:
            # This would require more complex repair logic
            repair_actions.append("Module repair not yet implemented")

        # Validate repair
        new_status = await lifecycle_manager.get_plugin_status(current_user.id, db)

        return {
            "status": "success",
            "message": "Plugin repair completed",
            "data": {
                "repair_actions": repair_actions,
                "old_status": status_info['status'],
                "new_status": new_status['status'],
                "status_info": new_status
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during plugin repair: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during plugin repair"
        )

# Integration function for main BrainDrive app
def register_plugin_routes(main_app_router: APIRouter):
    """
    Register the BrainDrive Network plugin routes with the main application

    This function should be called from the main BrainDrive backend
    to integrate the plugin's API endpoints.

    Args:
        main_app_router: The main FastAPI router instance
    """
    main_app_router.include_router(router)
    logger.info("BrainDrive Network plugin routes registered")

# Example usage documentation
USAGE_EXAMPLES = {
    "install": {
        "method": "POST",
        "url": "/api/plugins/braindrive-network/install",
        "description": "Install plugin for authenticated user",
        "requires_auth": True
    },
    "uninstall": {
        "method": "DELETE",
        "url": "/api/plugins/braindrive-network/uninstall",
        "description": "Uninstall plugin for authenticated user",
        "requires_auth": True
    },
    "status": {
        "method": "GET",
        "url": "/api/plugins/braindrive-network/status",
        "description": "Get plugin installation status",
        "requires_auth": True
    },
    "info": {
        "method": "GET",
        "url": "/api/plugins/braindrive-network/info",
        "description": "Get plugin information",
        "requires_auth": False
    },
    "repair": {
        "method": "POST",
        "url": "/api/plugins/braindrive-network/repair",
        "description": "Repair corrupted plugin installation",
        "requires_auth": True
    }
}

if __name__ == "__main__":
    print("BrainDrive Network Plugin API Endpoints")
    print("=" * 50)
    print("\nAvailable endpoints:")
    for name, info in USAGE_EXAMPLES.items():
        auth_req = "Yes" if info["requires_auth"] else "No"
        print(f"\n{name.upper()}:")
        print(f"  Method: {info['method']}")
        print(f"  URL: {info['url']}")
        print(f"  Description: {info['description']}")
        print(f"  Requires Auth: {auth_req}")

    print("\nNote: These endpoints must be integrated with the main BrainDrive backend")
    print("to function properly with authentication and database connections.")