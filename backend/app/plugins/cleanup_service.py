"""
Plugin Cleanup Service

Background service for automatic cleanup of unused plugin resources,
lifecycle managers, and temporary files.
"""

import asyncio
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import List
import structlog

logger = structlog.get_logger()


class PluginCleanupService:
    """Background service for plugin resource cleanup"""

    def __init__(self, lifecycle_service):
        self.lifecycle_service = lifecycle_service
        self.cleanup_interval = 300  # 5 minutes
        self.manager_timeout = 1800  # 30 minutes
        self.version_retention_days = 30
        self.temp_file_retention_hours = 24
        self._running = False
        self._cleanup_task = None

    async def start(self):
        """Start the cleanup service"""
        if self._running:
            logger.warning("Cleanup service is already running")
            return

        self._running = True
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Plugin cleanup service started")

    async def stop(self):
        """Stop the cleanup service"""
        if not self._running:
            return

        self._running = False

        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        logger.info("Plugin cleanup service stopped")

    async def _cleanup_loop(self):
        """Main cleanup loop"""
        try:
            while self._running:
                try:
                    await self._cleanup_cycle()
                    await asyncio.sleep(self.cleanup_interval)
                except Exception as e:
                    logger.error(f"Cleanup cycle failed: {e}")
                    await asyncio.sleep(60)  # Wait 1 minute before retry
        except asyncio.CancelledError:
            logger.info("Cleanup loop cancelled")
        except Exception as e:
            logger.error(f"Cleanup loop error: {e}")

    async def _cleanup_cycle(self):
        """Perform one cleanup cycle"""
        logger.debug("Starting plugin cleanup cycle")

        try:
            # Clean up unused lifecycle managers
            cleaned_managers = await self._cleanup_unused_managers()

            # Clean up unused plugin versions
            cleaned_versions = await self._cleanup_unused_versions()

            # Clean up temporary files
            cleaned_temp_files = await self._cleanup_temp_files()

            # Clean up empty directories
            cleaned_directories = await self._cleanup_empty_directories()

            if any([cleaned_managers, cleaned_versions, cleaned_temp_files, cleaned_directories]):
                logger.info(
                    f"Cleanup completed: {cleaned_managers} managers, "
                    f"{cleaned_versions} versions, {cleaned_temp_files} temp files, "
                    f"{cleaned_directories} directories"
                )

        except Exception as e:
            logger.error(f"Error in cleanup cycle: {e}")

    async def _cleanup_unused_managers(self) -> int:
        """Clean up lifecycle managers that haven't been used recently"""
        try:
            registry = self.lifecycle_service.registry
            cleaned_count = 0

            cutoff_time = datetime.now() - timedelta(seconds=self.manager_timeout)

            # Get list of managers to clean up
            managers_to_cleanup = []

            async with registry._lock:
                for manager_key, manager in list(registry._managers.items()):
                    last_used = registry._last_used.get(manager_key, datetime.now())
                    usage_count = registry._usage_count.get(manager_key, 0)

                    # Check if manager can be unloaded
                    can_unload = (
                        usage_count == 0 and
                        last_used < cutoff_time and
                        (not hasattr(manager, 'can_be_unloaded') or manager.can_be_unloaded())
                    )

                    if can_unload:
                        managers_to_cleanup.append(manager_key)

            # Clean up managers outside the lock
            for manager_key in managers_to_cleanup:
                try:
                    await registry._unload_manager(manager_key)
                    cleaned_count += 1
                    logger.debug(f"Cleaned up unused lifecycle manager: {manager_key}")
                except Exception as e:
                    logger.error(f"Error cleaning up manager {manager_key}: {e}")

            return cleaned_count

        except Exception as e:
            logger.error(f"Error cleaning up unused managers: {e}")
            return 0

    async def _cleanup_unused_versions(self) -> int:
        """Clean up plugin versions that are no longer used"""
        try:
            removed_versions = await self.lifecycle_service.version_manager.cleanup_unused_versions()
            return len(removed_versions)

        except Exception as e:
            logger.error(f"Error cleaning up unused versions: {e}")
            return 0

    async def _cleanup_temp_files(self) -> int:
        """Clean up temporary files older than retention period"""
        try:
            temp_dir = self.lifecycle_service.storage_manager.cache_dir / "temp"
            cleaned_count = 0

            if not temp_dir.exists():
                return 0

            cutoff_time = datetime.now() - timedelta(hours=self.temp_file_retention_hours)

            for temp_item in temp_dir.iterdir():
                try:
                    # Check file/directory modification time
                    item_mtime = datetime.fromtimestamp(temp_item.stat().st_mtime)

                    if item_mtime < cutoff_time:
                        if temp_item.is_file():
                            temp_item.unlink()
                            cleaned_count += 1
                            logger.debug(f"Removed old temp file: {temp_item.name}")
                        elif temp_item.is_dir():
                            shutil.rmtree(temp_item)
                            cleaned_count += 1
                            logger.debug(f"Removed old temp directory: {temp_item.name}")

                except Exception as e:
                    logger.error(f"Error cleaning up temp item {temp_item}: {e}")

            return cleaned_count

        except Exception as e:
            logger.error(f"Error cleaning up temp files: {e}")
            return 0

    async def _cleanup_empty_directories(self) -> int:
        """Clean up empty directories in the plugin storage"""
        try:
            cleaned_count = 0

            # Clean up empty plugin directories in shared storage
            for plugin_dir in self.lifecycle_service.storage_manager.shared_dir.iterdir():
                if plugin_dir.is_dir():
                    try:
                        # Check if plugin directory is empty or only contains empty version directories
                        version_dirs = [d for d in plugin_dir.iterdir() if d.is_dir()]

                        # Remove empty version directories
                        for version_dir in version_dirs:
                            if version_dir.is_dir() and not any(version_dir.iterdir()):
                                version_dir.rmdir()
                                cleaned_count += 1
                                logger.debug(f"Removed empty version directory: {version_dir}")

                        # Remove plugin directory if it's now empty
                        if plugin_dir.is_dir() and not any(plugin_dir.iterdir()):
                            plugin_dir.rmdir()
                            cleaned_count += 1
                            logger.debug(f"Removed empty plugin directory: {plugin_dir}")

                    except Exception as e:
                        logger.error(f"Error cleaning up directory {plugin_dir}: {e}")

            # Clean up empty user directories
            for user_dir in self.lifecycle_service.storage_manager.users_dir.iterdir():
                if user_dir.is_dir():
                    try:
                        # Check if user directory only contains empty installed_plugins.json
                        installed_plugins_file = user_dir / "installed_plugins.json"

                        if installed_plugins_file.exists():
                            try:
                                with open(installed_plugins_file, 'r') as f:
                                    import json
                                    plugins_data = json.load(f)

                                # If no plugins installed, remove the file
                                if not plugins_data:
                                    installed_plugins_file.unlink()
                                    logger.debug(f"Removed empty plugins file for user: {user_dir.name}")

                            except (json.JSONDecodeError, Exception) as e:
                                logger.error(f"Error processing plugins file for {user_dir}: {e}")

                        # Remove user directory if it's empty
                        if user_dir.is_dir() and not any(user_dir.iterdir()):
                            user_dir.rmdir()
                            cleaned_count += 1
                            logger.debug(f"Removed empty user directory: {user_dir}")

                    except Exception as e:
                        logger.error(f"Error cleaning up user directory {user_dir}: {e}")

            return cleaned_count

        except Exception as e:
            logger.error(f"Error cleaning up empty directories: {e}")
            return 0

    async def force_cleanup(self) -> dict:
        """Force immediate cleanup and return results"""
        try:
            logger.info("Starting forced cleanup cycle")

            results = {
                'managers_cleaned': await self._cleanup_unused_managers(),
                'versions_cleaned': await self._cleanup_unused_versions(),
                'temp_files_cleaned': await self._cleanup_temp_files(),
                'directories_cleaned': await self._cleanup_empty_directories(),
                'timestamp': datetime.now().isoformat()
            }

            logger.info(f"Forced cleanup completed: {results}")
            return results

        except Exception as e:
            logger.error(f"Error in forced cleanup: {e}")
            return {'error': str(e), 'timestamp': datetime.now().isoformat()}

    def get_cleanup_stats(self) -> dict:
        """Get cleanup service statistics"""
        return {
            'running': self._running,
            'cleanup_interval_seconds': self.cleanup_interval,
            'manager_timeout_seconds': self.manager_timeout,
            'version_retention_days': self.version_retention_days,
            'temp_file_retention_hours': self.temp_file_retention_hours,
            'last_cleanup': datetime.now().isoformat() if self._running else None
        }

    async def update_settings(self, settings: dict):
        """Update cleanup service settings"""
        try:
            if 'cleanup_interval' in settings:
                self.cleanup_interval = max(60, int(settings['cleanup_interval']))  # Minimum 1 minute

            if 'manager_timeout' in settings:
                self.manager_timeout = max(300, int(settings['manager_timeout']))  # Minimum 5 minutes

            if 'version_retention_days' in settings:
                self.version_retention_days = max(1, int(settings['version_retention_days']))  # Minimum 1 day

            if 'temp_file_retention_hours' in settings:
                self.temp_file_retention_hours = max(1, int(settings['temp_file_retention_hours']))  # Minimum 1 hour

            logger.info(f"Updated cleanup service settings: {settings}")

        except Exception as e:
            logger.error(f"Error updating cleanup settings: {e}")
            raise