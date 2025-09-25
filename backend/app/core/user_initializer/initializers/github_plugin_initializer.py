"""
GitHub Plugin Initializer

This initializer installs plugins from GitHub repositories during user registration.
Uses the same installation function as the frontend for perfect consistency.
"""

import logging
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer

logger = logging.getLogger(__name__)

class GitHubPluginInitializer(UserInitializerBase):
    """
    Initializer that installs plugins from GitHub repositories.
    
    Uses the same install_plugin_from_url() function as the frontend
    to ensure identical installation behavior and error handling.
    """
    
    name = "github_plugin_initializer"
    description = "Installs default plugins from GitHub repositories"
    priority = 400  # Run after core system setup but before pages
    dependencies = ["settings_initializer", "components_initializer", "navigation_initializer"]  # Run after core setup
    
    # Default plugins to install for new users
    DEFAULT_PLUGINS = [
        {
            "repo_url": "https://github.com/BrainDriveAI/BrainDrive-Settings-Plugin",
            "version": "latest",
            "name": "BrainDrive Settings"
        },
        {
            "repo_url": "https://github.com/BrainDriveAI/BrainDrive-Chat-Plugin", 
            "version": "latest",
            "name": "BrainDrive Chat"
        }
    ]
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """
        Install default GitHub plugins for the new user.
        
        Args:
            user_id: The ID of the newly registered user
            db: Database session
            **kwargs: Additional arguments (unused)
            
        Returns:
            bool: True if all plugins installed successfully, False otherwise
        """
        logger.info(f"Starting GitHub plugin installation for user {user_id}")
        
        # Import the same function used by the frontend
        try:
            from app.plugins.remote_installer import install_plugin_from_url
        except ImportError as e:
            logger.error(f"Failed to import install_plugin_from_url: {e}")
            return False
        
        successful_installs = []
        failed_installs = []
        
        for plugin_config in self.DEFAULT_PLUGINS:
            repo_url = plugin_config["repo_url"]
            version = plugin_config["version"]
            name = plugin_config["name"]
            
            logger.info(f"Installing {name} from {repo_url} (version: {version}) for user {user_id}")
            
            try:
                # Use the exact same function as the frontend
                result = await install_plugin_from_url(
                    repo_url=repo_url,
                    user_id=user_id,
                    version=version
                )
                
                if result.get("success", False):
                    successful_installs.append({
                        "name": name,
                        "repo_url": repo_url,
                        "plugin_id": result.get("plugin_id"),
                        "plugin_slug": result.get("plugin_slug")
                    })
                    logger.info(f"Successfully installed {name} for user {user_id}")
                else:
                    error_msg = result.get("error", "Unknown error")
                    failed_installs.append({
                        "name": name,
                        "repo_url": repo_url,
                        "error": error_msg
                    })
                    logger.error(f"Failed to install {name} for user {user_id}: {error_msg}")
                    
            except Exception as e:
                failed_installs.append({
                    "name": name,
                    "repo_url": repo_url,
                    "error": str(e)
                })
                logger.error(f"Exception installing {name} for user {user_id}: {str(e)}")
        
        # Log summary
        logger.info(f"GitHub plugin installation complete for user {user_id}: "
                   f"{len(successful_installs)} successful, {len(failed_installs)} failed")
        
        if successful_installs:
            logger.info(f"Successfully installed: {[p['name'] for p in successful_installs]}")
        
        if failed_installs:
            logger.warning(f"Failed to install: {[p['name'] for p in failed_installs]}")
        
        # Return True only if all plugins installed successfully
        return len(failed_installs) == 0
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """
        Clean up any plugins that were installed if initialization fails.
        
        Args:
            user_id: The ID of the user
            db: Database session
            **kwargs: Additional arguments
            
        Returns:
            bool: True if cleanup was successful
        """
        logger.info(f"Cleaning up GitHub plugins for user {user_id}")
        
        try:
            # For now, we'll implement basic cleanup logging
            # More sophisticated cleanup could be added later if needed
            logger.info(f"GitHub plugin cleanup initiated for user {user_id}")
            
            # Note: The existing plugin system should handle cleanup through
            # the normal plugin uninstall mechanisms if needed
            
            return True
            
        except Exception as e:
            logger.error(f"Error during GitHub plugin cleanup for user {user_id}: {str(e)}")
            return False

# Register the initializer
register_initializer(GitHubPluginInitializer)