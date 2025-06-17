"""
Plugin Lifecycle Service

Central orchestrator for all plugin lifecycle operations across all users.
Coordinates between registry, storage, and version management components.
"""

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from .storage_manager import PluginStorageManager
from .lifecycle_registry import PluginLifecycleRegistry
from .version_manager import PluginVersionManager

logger = structlog.get_logger()


class PluginLifecycleService:
    """Central service for plugin lifecycle management"""

    def __init__(self, plugins_base_dir: str = None):
        if plugins_base_dir:
            self.plugins_base_dir = Path(plugins_base_dir)
        else:
            # Default to backend/plugins directory
            self.plugins_base_dir = Path(__file__).parent.parent.parent / "plugins"

        # Initialize components
        self.storage_manager = PluginStorageManager(self.plugins_base_dir)
        self.registry = PluginLifecycleRegistry()
        self.version_manager = PluginVersionManager(self.storage_manager)

        # Operation locks to prevent concurrent operations on same plugin/user
        self.operation_locks: Dict[str, asyncio.Lock] = {}

        logger.info(f"Plugin Lifecycle Service initialized with base directory: {self.plugins_base_dir}")

    async def _get_operation_lock(self, user_id: str, plugin_slug: str) -> asyncio.Lock:
        """Get or create operation lock for user/plugin combination"""
        lock_key = f"{user_id}_{plugin_slug}"

        if lock_key not in self.operation_locks:
            self.operation_locks[lock_key] = asyncio.Lock()

        return self.operation_locks[lock_key]

    async def install_plugin(self, user_id: str, plugin_slug: str, version: str, source_url: str, db: AsyncSession) -> Dict[str, Any]:
        """Install plugin for specific user with full coordination"""
        operation_lock = await self._get_operation_lock(user_id, plugin_slug)

        async with operation_lock:
            try:
                logger.info(f"Installing plugin {plugin_slug} v{version} for user {user_id}")

                # Check if plugin is already installed for user
                existing_metadata = await self.storage_manager.get_user_plugin_metadata(user_id, plugin_slug)
                if existing_metadata:
                    return {
                        'success': False,
                        'error': f"Plugin {plugin_slug} is already installed for user",
                        'existing_version': existing_metadata.get('version')
                    }

                # Download and install plugin files to shared storage
                shared_path = await self._download_and_install_plugin(plugin_slug, version, source_url)
                if not shared_path:
                    return {'success': False, 'error': 'Failed to download and install plugin files'}

                # Get lifecycle manager for this plugin version
                manager = await self.registry.get_manager(plugin_slug, version, shared_path)

                # Validate plugin metadata
                plugin_metadata = await manager.get_plugin_metadata()
                if not plugin_metadata:
                    return {'success': False, 'error': 'Invalid plugin metadata'}

                # Check compatibility with user's existing plugins
                user_plugins = await self._get_user_plugins_list(user_id)
                if not await self.version_manager.check_compatibility(plugin_slug, version, user_plugins):
                    return {'success': False, 'error': 'Plugin is incompatible with existing plugins'}

                # Perform user-specific installation
                install_result = await manager.install_for_user(user_id, db, shared_path)
                if not install_result['success']:
                    await self.registry.release_manager(plugin_slug, version, user_id)
                    return install_result

                # Register plugin for user
                registration_metadata = {
                    'user_config': {},
                    'installation_metadata': {
                        'source_url': source_url,
                        'installation_type': 'production',
                        'installed_by': 'lifecycle_service'
                    }
                }

                registration_success = await self.storage_manager.register_user_plugin(
                    user_id, plugin_slug, version, shared_path, registration_metadata
                )

                if not registration_success:
                    # Rollback installation
                    await manager.uninstall_for_user(user_id, db)
                    await self.registry.release_manager(plugin_slug, version, user_id)
                    return {'success': False, 'error': 'Failed to register plugin for user'}

                # Register version in version manager
                await self.version_manager.register_version(plugin_slug, version, plugin_metadata)

                logger.info(f"Successfully installed plugin {plugin_slug} v{version} for user {user_id}")

                return {
                    'success': True,
                    'plugin_slug': plugin_slug,
                    'version': version,
                    'shared_path': str(shared_path),
                    'installation_details': install_result
                }

            except Exception as e:
                logger.error(f"Plugin installation failed for user {user_id}: {e}")
                return {'success': False, 'error': str(e)}

    async def update_plugin(self, user_id: str, plugin_slug: str, new_version: str, db: AsyncSession) -> Dict[str, Any]:
        """Update user's plugin to new version"""
        operation_lock = await self._get_operation_lock(user_id, plugin_slug)

        async with operation_lock:
            try:
                logger.info(f"Updating plugin {plugin_slug} to v{new_version} for user {user_id}")

                # Check if plugin is installed for user
                current_metadata = await self.storage_manager.get_user_plugin_metadata(user_id, plugin_slug)
                if not current_metadata:
                    return {'success': False, 'error': 'Plugin not installed for user'}

                current_version = current_metadata.get('version')
                if current_version == new_version:
                    return {'success': False, 'error': 'Plugin is already at the requested version'}

                # Get current manager
                current_shared_path = Path(current_metadata['shared_path'])
                current_manager = await self.registry.get_manager(plugin_slug, current_version, current_shared_path)

                # Check if new version exists in shared storage
                new_shared_path = self.storage_manager.shared_dir / plugin_slug / f"v{new_version}"
                if not new_shared_path.exists():
                    return {'success': False, 'error': f'Plugin version {new_version} not available'}

                # Get new version manager
                new_manager = await self.registry.get_manager(plugin_slug, new_version, new_shared_path)

                # Check compatibility
                user_plugins = await self._get_user_plugins_list(user_id, exclude_plugin=plugin_slug)
                if not await self.version_manager.check_compatibility(plugin_slug, new_version, user_plugins):
                    return {'success': False, 'error': 'New version is incompatible with existing plugins'}

                # Perform update migration
                update_result = await current_manager.update_for_user(user_id, db, new_manager)
                if not update_result['success']:
                    await self.registry.release_manager(plugin_slug, new_version, user_id)
                    return update_result

                # Update user plugin metadata
                updated_metadata = current_metadata.copy()
                updated_metadata.update({
                    'version': new_version,
                    'shared_path': str(new_shared_path.absolute()),
                    'updated_at': datetime.now().isoformat(),
                    'previous_version': current_version
                })

                # Unregister old version and register new version
                await self.storage_manager.unregister_user_plugin(user_id, plugin_slug)
                registration_success = await self.storage_manager.register_user_plugin(
                    user_id, plugin_slug, new_version, new_shared_path, {
                        'user_config': updated_metadata.get('user_config', {}),
                        'installation_metadata': updated_metadata.get('installation_metadata', {})
                    }
                )

                if not registration_success:
                    return {'success': False, 'error': 'Failed to update plugin registration'}

                # Release old manager
                await self.registry.release_manager(plugin_slug, current_version, user_id)

                logger.info(f"Successfully updated plugin {plugin_slug} from v{current_version} to v{new_version} for user {user_id}")

                return {
                    'success': True,
                    'plugin_slug': plugin_slug,
                    'previous_version': current_version,
                    'new_version': new_version,
                    'migration_data': update_result.get('migrated_data', {})
                }

            except Exception as e:
                logger.error(f"Plugin update failed for user {user_id}: {e}")
                return {'success': False, 'error': str(e)}

    async def delete_plugin(self, user_id: str, plugin_slug: str, db: AsyncSession) -> Dict[str, Any]:
        """Remove plugin for user while preserving shared resources"""
        operation_lock = await self._get_operation_lock(user_id, plugin_slug)

        async with operation_lock:
            try:
                logger.info(f"Deleting plugin {plugin_slug} for user {user_id}")

                # Check if plugin is installed for user
                plugin_metadata = await self.storage_manager.get_user_plugin_metadata(user_id, plugin_slug)
                if not plugin_metadata:
                    return {'success': False, 'error': 'Plugin not installed for user'}

                version = plugin_metadata.get('version')
                shared_path = Path(plugin_metadata['shared_path'])

                # Get lifecycle manager
                manager = await self.registry.get_manager(plugin_slug, version, shared_path)

                # Perform user-specific uninstallation
                uninstall_result = await manager.uninstall_for_user(user_id, db)
                if not uninstall_result['success']:
                    return uninstall_result

                # Unregister plugin for user
                unregistration_success = await self.storage_manager.unregister_user_plugin(user_id, plugin_slug)
                if not unregistration_success:
                    return {'success': False, 'error': 'Failed to unregister plugin for user'}

                # Release manager
                await self.registry.release_manager(plugin_slug, version, user_id)

                logger.info(f"Successfully deleted plugin {plugin_slug} for user {user_id}")

                return {
                    'success': True,
                    'plugin_slug': plugin_slug,
                    'version': version,
                    'uninstallation_details': uninstall_result
                }

            except Exception as e:
                logger.error(f"Plugin deletion failed for user {user_id}: {e}")
                return {'success': False, 'error': str(e)}

    async def get_plugin_status(self, user_id: str, plugin_slug: str, db: AsyncSession) -> Dict[str, Any]:
        """Get comprehensive plugin status for user"""
        try:
            # Check if plugin is installed for user
            plugin_metadata = await self.storage_manager.get_user_plugin_metadata(user_id, plugin_slug)
            if not plugin_metadata:
                return {'exists': False, 'status': 'not_installed'}

            version = plugin_metadata.get('version')
            shared_path = Path(plugin_metadata['shared_path'])

            # Get lifecycle manager
            manager = await self.registry.get_manager(plugin_slug, version, shared_path)

            # Get status from manager
            status = await manager.get_plugin_status(user_id, db)

            # Add additional metadata
            status.update({
                'user_metadata': plugin_metadata,
                'available_updates': await self._check_available_updates(plugin_slug, version)
            })

            return status

        except Exception as e:
            logger.error(f"Error getting plugin status for user {user_id}: {e}")
            return {'exists': False, 'status': 'error', 'error': str(e)}

    async def _download_and_install_plugin(self, plugin_slug: str, version: str, source_url: str) -> Optional[Path]:
        """Download and install plugin files to shared storage"""
        try:
            # Check if already installed in shared storage
            shared_path = self.storage_manager.shared_dir / plugin_slug / f"v{version}"
            if shared_path.exists():
                logger.info(f"Plugin {plugin_slug} v{version} already exists in shared storage")
                return shared_path

            # For local development, check if plugin exists in PluginBuild directory
            # This handles the case where plugins are built locally
            # Map plugin slugs to their directory names
            plugin_dir_mapping = {
                'BrainDriveNetworkReview': 'NetworkReview',
                'BrainDriveNetwork': 'NetworkEyes',
                'NetworkReview': 'NetworkReview',
                'NetworkEyes': 'NetworkEyes'
            }

            plugin_dir_name = plugin_dir_mapping.get(plugin_slug, plugin_slug)
            plugin_build_path = Path(__file__).parent.parent.parent.parent / "PluginBuild" / plugin_dir_name

            if plugin_build_path.exists():
                logger.info(f"Found local plugin source at {plugin_build_path}, copying to shared storage")
                # Use storage manager to install plugin files from local source
                shared_path = await self.storage_manager.install_plugin_files(plugin_slug, version, plugin_build_path)
                return shared_path

            # If source_url is a local path, use it directly
            if source_url.startswith('file://') or Path(source_url).exists():
                source_path = Path(source_url.replace('file://', ''))
                if source_path.exists():
                    logger.info(f"Installing plugin from local source: {source_path}")
                    shared_path = await self.storage_manager.install_plugin_files(plugin_slug, version, source_path)
                    return shared_path

            # For remote URLs, this would implement actual downloading logic
            # For now, create minimal structure for testing
            logger.warning(f"Plugin download from remote URL not implemented - creating minimal structure for {plugin_slug} v{version}")

            # Create directory structure
            shared_path.mkdir(parents=True, exist_ok=True)

            # Create minimal plugin structure for testing
            (shared_path / "package.json").write_text(f'{{"name": "{plugin_slug}", "version": "{version}"}}')

            return shared_path

        except Exception as e:
            logger.error(f"Error downloading and installing plugin {plugin_slug} v{version}: {e}")
            return None

    async def _get_user_plugins_list(self, user_id: str, exclude_plugin: str = None) -> List[Dict[str, Any]]:
        """Get list of user's installed plugins for compatibility checking"""
        try:
            user_plugins = await self.storage_manager.get_all_user_plugins(user_id)

            plugins_list = []
            for plugin_slug, plugin_data in user_plugins.items():
                if exclude_plugin and plugin_slug == exclude_plugin:
                    continue

                plugins_list.append({
                    'plugin_slug': plugin_slug,
                    'version': plugin_data.get('version'),
                    'shared_path': plugin_data.get('shared_path')
                })

            return plugins_list

        except Exception as e:
            logger.error(f"Error getting user plugins list: {e}")
            return []

    async def _check_available_updates(self, plugin_slug: str, current_version: str) -> List[str]:
        """Check for available updates for a plugin"""
        try:
            available_versions = self.version_manager.get_available_versions(plugin_slug)

            updates = []
            for version in available_versions:
                if self.version_manager._compare_versions(version, current_version) > 0:
                    updates.append(version)

            return sorted(updates, key=self.version_manager._version_sort_key)

        except Exception as e:
            logger.error(f"Error checking available updates: {e}")
            return []

    async def cleanup_unused_resources(self):
        """Clean up unused plugin resources"""
        try:
            logger.info("Starting cleanup of unused plugin resources")

            # Clean up unused plugin versions
            removed_versions = await self.version_manager.cleanup_unused_versions()

            # Clean up unused lifecycle managers
            cleaned_managers = await self.registry._cleanup_unused_managers()

            logger.info(f"Cleanup completed: {len(removed_versions)} versions, {cleaned_managers} managers")

            return {
                'removed_versions': removed_versions,
                'cleaned_managers': cleaned_managers
            }

        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
            return {'error': str(e)}

    async def get_system_stats(self) -> Dict[str, Any]:
        """Get system-wide plugin statistics"""
        try:
            registry_stats = self.registry.get_usage_stats()
            version_stats = self.version_manager.get_version_stats()

            # Count total users with plugins
            total_users = len([d for d in self.storage_manager.users_dir.iterdir() if d.is_dir()])

            return {
                'timestamp': datetime.now().isoformat(),
                'total_users_with_plugins': total_users,
                'lifecycle_managers': registry_stats,
                'plugin_versions': version_stats,
                'storage_base_dir': str(self.plugins_base_dir)
            }

        except Exception as e:
            logger.error(f"Error getting system stats: {e}")
            return {'error': str(e)}

    async def shutdown(self):
        """Shutdown the lifecycle service and clean up resources"""
        logger.info("Shutting down Plugin Lifecycle Service")

        try:
            # Shutdown registry
            await self.registry.shutdown()

            # Clear operation locks
            self.operation_locks.clear()

            logger.info("Plugin Lifecycle Service shutdown complete")

        except Exception as e:
            logger.error(f"Error during shutdown: {e}")