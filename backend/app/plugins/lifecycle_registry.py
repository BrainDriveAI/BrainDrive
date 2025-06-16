"""
Plugin Lifecycle Registry

Manages lifecycle manager instances efficiently with singleton pattern,
lazy loading, instance pooling, and automatic cleanup.
"""

import asyncio
import importlib.util
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Optional, Set
import structlog

logger = structlog.get_logger()


class PluginLifecycleRegistry:
    """Registry for managing lifecycle manager instances efficiently"""

    def __init__(self, cleanup_timeout: int = 1800):  # 30 minutes default
        self._managers: Dict[str, 'BaseLifecycleManager'] = {}
        self._usage_count: Dict[str, int] = {}
        self._last_used: Dict[str, datetime] = {}
        self._cleanup_timeout = cleanup_timeout
        self._cleanup_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    async def get_manager(self, plugin_slug: str, version: str, shared_plugin_path: Path) -> 'BaseLifecycleManager':
        """Get or create lifecycle manager instance"""
        manager_key = f"{plugin_slug}_{version}"

        async with self._lock:
            # Check if manager already exists
            if manager_key in self._managers:
                self._usage_count[manager_key] = self._usage_count.get(manager_key, 0) + 1
                self._last_used[manager_key] = datetime.now()
                logger.debug(f"Reusing existing lifecycle manager: {manager_key}")
                return self._managers[manager_key]

            # Create new manager instance
            manager = await self._load_manager(plugin_slug, version, shared_plugin_path)
            if manager:
                self._managers[manager_key] = manager
                self._usage_count[manager_key] = 1
                self._last_used[manager_key] = datetime.now()

                # Start cleanup task if not already running
                if not self._cleanup_task or self._cleanup_task.done():
                    self._cleanup_task = asyncio.create_task(self._cleanup_loop())

                logger.info(f"Created new lifecycle manager: {manager_key}")
                return manager
            else:
                raise RuntimeError(f"Failed to load lifecycle manager for {plugin_slug} v{version}")

    async def release_manager(self, plugin_slug: str, version: str, user_id: str):
        """Release manager reference and schedule cleanup if needed"""
        manager_key = f"{plugin_slug}_{version}"

        async with self._lock:
            if manager_key in self._managers:
                manager = self._managers[manager_key]

                # Remove user from active users
                if hasattr(manager, 'active_users'):
                    manager.active_users.discard(user_id)

                # Decrease usage count
                self._usage_count[manager_key] = max(0, self._usage_count.get(manager_key, 1) - 1)
                self._last_used[manager_key] = datetime.now()

                logger.debug(f"Released manager reference: {manager_key}, usage count: {self._usage_count[manager_key]}")

    async def _load_manager(self, plugin_slug: str, version: str, shared_plugin_path: Path) -> Optional['BaseLifecycleManager']:
        """Dynamically load and instantiate lifecycle manager"""
        try:
            # Look for lifecycle_manager.py in the plugin directory
            lifecycle_manager_path = shared_plugin_path / "lifecycle_manager.py"

            if not lifecycle_manager_path.exists():
                logger.warning(f"No lifecycle_manager.py found for {plugin_slug} v{version}")
                return None

            # Create module spec and load the module
            spec = importlib.util.spec_from_file_location(
                f"{plugin_slug}_{version}_lifecycle_manager",
                lifecycle_manager_path
            )

            if not spec or not spec.loader:
                logger.error(f"Failed to create module spec for {lifecycle_manager_path}")
                return None

            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)

            # Find the lifecycle manager class
            manager_class = None
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (isinstance(attr, type) and
                    hasattr(attr, '__bases__') and
                    any('LifecycleManager' in base.__name__ for base in attr.__bases__)):
                    manager_class = attr
                    break

            if not manager_class:
                logger.error(f"No lifecycle manager class found in {lifecycle_manager_path}")
                return None

            # Instantiate the manager
            manager = manager_class(plugin_slug, version, shared_plugin_path)
            logger.info(f"Successfully loaded lifecycle manager: {manager_class.__name__}")
            return manager

        except Exception as e:
            logger.error(f"Error loading lifecycle manager for {plugin_slug} v{version}: {e}")
            return None

    async def _cleanup_loop(self):
        """Background task to clean up unused managers"""
        try:
            while True:
                await asyncio.sleep(300)  # Check every 5 minutes
                await self._cleanup_unused_managers()
        except asyncio.CancelledError:
            logger.info("Cleanup loop cancelled")
        except Exception as e:
            logger.error(f"Error in cleanup loop: {e}")

    async def _cleanup_unused_managers(self) -> int:
        """Clean up lifecycle managers that haven't been used recently"""
        cleaned_count = 0
        cutoff_time = datetime.now() - timedelta(seconds=self._cleanup_timeout)

        async with self._lock:
            managers_to_remove = []

            for manager_key, manager in self._managers.items():
                last_used = self._last_used.get(manager_key, datetime.now())
                usage_count = self._usage_count.get(manager_key, 0)

                # Check if manager can be unloaded
                can_unload = (
                    usage_count == 0 and
                    last_used < cutoff_time and
                    (not hasattr(manager, 'can_be_unloaded') or manager.can_be_unloaded())
                )

                if can_unload:
                    managers_to_remove.append(manager_key)

            # Remove unused managers
            for manager_key in managers_to_remove:
                try:
                    manager = self._managers[manager_key]

                    # Call cleanup method if available
                    if hasattr(manager, 'cleanup'):
                        await manager.cleanup()

                    # Remove from registry
                    del self._managers[manager_key]
                    del self._usage_count[manager_key]
                    del self._last_used[manager_key]

                    cleaned_count += 1
                    logger.info(f"Cleaned up unused lifecycle manager: {manager_key}")

                except Exception as e:
                    logger.error(f"Error cleaning up manager {manager_key}: {e}")

        if cleaned_count > 0:
            logger.info(f"Cleaned up {cleaned_count} unused lifecycle managers")

        return cleaned_count

    async def _unload_manager(self, manager_key: str):
        """Forcefully unload a specific manager"""
        async with self._lock:
            if manager_key in self._managers:
                try:
                    manager = self._managers[manager_key]

                    # Call cleanup method if available
                    if hasattr(manager, 'cleanup'):
                        await manager.cleanup()

                    # Remove from registry
                    del self._managers[manager_key]
                    del self._usage_count[manager_key]
                    del self._last_used[manager_key]

                    logger.info(f"Forcefully unloaded lifecycle manager: {manager_key}")

                except Exception as e:
                    logger.error(f"Error unloading manager {manager_key}: {e}")

    def get_usage_stats(self) -> Dict[str, any]:
        """Get usage statistics for all managers"""
        stats = {
            'total_managers': len(self._managers),
            'managers': {}
        }

        for manager_key, manager in self._managers.items():
            manager_stats = {
                'usage_count': self._usage_count.get(manager_key, 0),
                'last_used': self._last_used.get(manager_key, datetime.now()).isoformat(),
            }

            # Add manager-specific stats if available
            if hasattr(manager, 'get_usage_stats'):
                manager_stats.update(manager.get_usage_stats())

            stats['managers'][manager_key] = manager_stats

        return stats

    async def shutdown(self):
        """Shutdown the registry and clean up all managers"""
        logger.info("Shutting down plugin lifecycle registry")

        # Cancel cleanup task
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # Clean up all managers
        async with self._lock:
            for manager_key, manager in list(self._managers.items()):
                try:
                    if hasattr(manager, 'cleanup'):
                        await manager.cleanup()
                except Exception as e:
                    logger.error(f"Error cleaning up manager {manager_key} during shutdown: {e}")

            self._managers.clear()
            self._usage_count.clear()
            self._last_used.clear()

        logger.info("Plugin lifecycle registry shutdown complete")


# Import base lifecycle manager for type hints
try:
    from .base_lifecycle_manager import BaseLifecycleManager
except ImportError:
    # Handle case where base manager hasn't been created yet
    BaseLifecycleManager = object