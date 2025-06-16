"""
Plugin Version Manager

Handles multiple plugin versions, dependencies, compatibility checking,
and cleanup of unused versions efficiently.
"""

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any
import structlog

logger = structlog.get_logger()


class PluginVersionManager:
    """Manages plugin versions, dependencies, and compatibility"""

    def __init__(self, storage_manager):
        self.storage_manager = storage_manager
        self.version_registry: Dict[str, List[str]] = {}
        self.dependency_graph: Dict[str, Dict[str, str]] = {}
        self.compatibility_matrix: Dict[str, Dict[str, bool]] = {}
        self._cache_file = self.storage_manager.cache_dir / "version_registry.json"
        self._load_cache()

    def _load_cache(self):
        """Load version registry from cache file"""
        try:
            if self._cache_file.exists():
                with open(self._cache_file, 'r') as f:
                    cache_data = json.load(f)
                    self.version_registry = cache_data.get('version_registry', {})
                    self.dependency_graph = cache_data.get('dependency_graph', {})
                    self.compatibility_matrix = cache_data.get('compatibility_matrix', {})
                logger.info("Loaded version registry from cache")
        except Exception as e:
            logger.error(f"Error loading version registry cache: {e}")
            self.version_registry = {}
            self.dependency_graph = {}
            self.compatibility_matrix = {}

    def _save_cache(self):
        """Save version registry to cache file"""
        try:
            cache_data = {
                'version_registry': self.version_registry,
                'dependency_graph': self.dependency_graph,
                'compatibility_matrix': self.compatibility_matrix,
                'last_updated': datetime.now().isoformat()
            }

            with open(self._cache_file, 'w') as f:
                json.dump(cache_data, f, indent=2)

        except Exception as e:
            logger.error(f"Error saving version registry cache: {e}")

    async def register_version(self, plugin_slug: str, version: str, metadata: Dict[str, Any]) -> bool:
        """Register new plugin version in the system"""
        try:
            # Add version to registry
            if plugin_slug not in self.version_registry:
                self.version_registry[plugin_slug] = []

            if version not in self.version_registry[plugin_slug]:
                self.version_registry[plugin_slug].append(version)
                # Sort versions to maintain order
                self.version_registry[plugin_slug].sort(key=self._version_sort_key)

            # Register dependencies if present
            dependencies = metadata.get('dependencies', {})
            if dependencies:
                self.dependency_graph[f"{plugin_slug}_{version}"] = dependencies

            # Update compatibility matrix
            await self._update_compatibility_matrix(plugin_slug, version, metadata)

            # Save cache
            self._save_cache()

            logger.info(f"Registered plugin version: {plugin_slug} v{version}")
            return True

        except Exception as e:
            logger.error(f"Error registering plugin version {plugin_slug} v{version}: {e}")
            return False

    async def unregister_version(self, plugin_slug: str, version: str) -> bool:
        """Unregister plugin version from the system"""
        try:
            # Remove from version registry
            if plugin_slug in self.version_registry:
                if version in self.version_registry[plugin_slug]:
                    self.version_registry[plugin_slug].remove(version)

                    # Remove plugin entry if no versions left
                    if not self.version_registry[plugin_slug]:
                        del self.version_registry[plugin_slug]

            # Remove from dependency graph
            dependency_key = f"{plugin_slug}_{version}"
            if dependency_key in self.dependency_graph:
                del self.dependency_graph[dependency_key]

            # Remove from compatibility matrix
            if plugin_slug in self.compatibility_matrix:
                if version in self.compatibility_matrix[plugin_slug]:
                    del self.compatibility_matrix[plugin_slug][version]

                    # Remove plugin entry if no versions left
                    if not self.compatibility_matrix[plugin_slug]:
                        del self.compatibility_matrix[plugin_slug]

            # Save cache
            self._save_cache()

            logger.info(f"Unregistered plugin version: {plugin_slug} v{version}")
            return True

        except Exception as e:
            logger.error(f"Error unregistering plugin version {plugin_slug} v{version}: {e}")
            return False

    def _version_sort_key(self, version: str) -> Tuple:
        """Create sort key for version strings"""
        try:
            # Remove 'v' prefix if present
            clean_version = version.replace('v', '')

            # Split version into parts and convert to integers
            parts = []
            for part in clean_version.split('.'):
                try:
                    parts.append(int(part))
                except ValueError:
                    # Handle non-numeric parts (e.g., 'alpha', 'beta')
                    parts.append(part)

            return tuple(parts)
        except Exception:
            # Fallback to string comparison
            return (version,)

    async def check_compatibility(self, plugin_slug: str, version: str, user_plugins: List[Dict]) -> bool:
        """Check if plugin version is compatible with user's existing plugins"""
        try:
            # Get plugin's dependencies
            dependency_key = f"{plugin_slug}_{version}"
            dependencies = self.dependency_graph.get(dependency_key, {})

            # Check if all dependencies are satisfied
            for dep_plugin, dep_version_req in dependencies.items():
                user_has_plugin = False

                for user_plugin in user_plugins:
                    if user_plugin.get('plugin_slug') == dep_plugin:
                        user_version = user_plugin.get('version')
                        if self._version_satisfies_requirement(user_version, dep_version_req):
                            user_has_plugin = True
                            break

                if not user_has_plugin:
                    logger.warning(f"Dependency not satisfied: {dep_plugin} {dep_version_req}")
                    return False

            # Check compatibility matrix
            if plugin_slug in self.compatibility_matrix:
                version_compat = self.compatibility_matrix[plugin_slug].get(version, {})

                for user_plugin in user_plugins:
                    user_plugin_slug = user_plugin.get('plugin_slug')
                    user_version = user_plugin.get('version')

                    if user_plugin_slug in version_compat:
                        if not version_compat[user_plugin_slug]:
                            logger.warning(f"Incompatible with existing plugin: {user_plugin_slug} v{user_version}")
                            return False

            return True

        except Exception as e:
            logger.error(f"Error checking compatibility for {plugin_slug} v{version}: {e}")
            return False

    def _version_satisfies_requirement(self, version: str, requirement: str) -> bool:
        """Check if version satisfies requirement (e.g., '>=1.0.0', '~1.2.0')"""
        try:
            # Simple implementation - can be enhanced with proper semver parsing
            if requirement.startswith('>='):
                req_version = requirement[2:].strip()
                return self._compare_versions(version, req_version) >= 0
            elif requirement.startswith('>'):
                req_version = requirement[1:].strip()
                return self._compare_versions(version, req_version) > 0
            elif requirement.startswith('<='):
                req_version = requirement[2:].strip()
                return self._compare_versions(version, req_version) <= 0
            elif requirement.startswith('<'):
                req_version = requirement[1:].strip()
                return self._compare_versions(version, req_version) < 0
            elif requirement.startswith('~'):
                # Compatible within same minor version
                req_version = requirement[1:].strip()
                return self._is_compatible_minor_version(version, req_version)
            elif requirement.startswith('^'):
                # Compatible within same major version
                req_version = requirement[1:].strip()
                return self._is_compatible_major_version(version, req_version)
            else:
                # Exact match
                return version == requirement

        except Exception as e:
            logger.error(f"Error checking version requirement {version} vs {requirement}: {e}")
            return False

    def _compare_versions(self, version1: str, version2: str) -> int:
        """Compare two version strings (-1, 0, 1)"""
        try:
            v1_parts = self._version_sort_key(version1)
            v2_parts = self._version_sort_key(version2)

            if v1_parts < v2_parts:
                return -1
            elif v1_parts > v2_parts:
                return 1
            else:
                return 0
        except Exception:
            # Fallback to string comparison
            if version1 < version2:
                return -1
            elif version1 > version2:
                return 1
            else:
                return 0

    def _is_compatible_minor_version(self, version: str, base_version: str) -> bool:
        """Check if version is compatible within same minor version"""
        try:
            v_parts = version.replace('v', '').split('.')
            b_parts = base_version.replace('v', '').split('.')

            if len(v_parts) >= 2 and len(b_parts) >= 2:
                return (v_parts[0] == b_parts[0] and
                        v_parts[1] == b_parts[1] and
                        self._compare_versions(version, base_version) >= 0)

            return version == base_version
        except Exception:
            return version == base_version

    def _is_compatible_major_version(self, version: str, base_version: str) -> bool:
        """Check if version is compatible within same major version"""
        try:
            v_parts = version.replace('v', '').split('.')
            b_parts = base_version.replace('v', '').split('.')

            if len(v_parts) >= 1 and len(b_parts) >= 1:
                return (v_parts[0] == b_parts[0] and
                        self._compare_versions(version, base_version) >= 0)

            return version == base_version
        except Exception:
            return version == base_version

    async def get_update_candidates(self, user_id: str) -> List[Dict[str, Any]]:
        """Get list of plugins that have available updates for user"""
        try:
            user_plugins = await self.storage_manager.get_all_user_plugins(user_id)
            update_candidates = []

            for plugin_slug, plugin_data in user_plugins.items():
                current_version = plugin_data.get('version')
                available_versions = self.version_registry.get(plugin_slug, [])

                # Find newer versions
                newer_versions = []
                for version in available_versions:
                    if self._compare_versions(version, current_version) > 0:
                        newer_versions.append(version)

                if newer_versions:
                    # Get the latest version
                    latest_version = max(newer_versions, key=self._version_sort_key)

                    update_candidates.append({
                        'plugin_slug': plugin_slug,
                        'current_version': current_version,
                        'latest_version': latest_version,
                        'available_versions': newer_versions
                    })

            return update_candidates

        except Exception as e:
            logger.error(f"Error getting update candidates for user {user_id}: {e}")
            return []

    async def _update_compatibility_matrix(self, plugin_slug: str, version: str, metadata: Dict[str, Any]):
        """Update compatibility matrix for plugin version"""
        try:
            # Initialize plugin entry if not exists
            if plugin_slug not in self.compatibility_matrix:
                self.compatibility_matrix[plugin_slug] = {}

            # Get compatibility info from metadata
            compatibility = metadata.get('compatibility', {})

            # Default to compatible with all if not specified
            if not compatibility:
                self.compatibility_matrix[plugin_slug][version] = {}
            else:
                self.compatibility_matrix[plugin_slug][version] = compatibility

        except Exception as e:
            logger.error(f"Error updating compatibility matrix: {e}")

    async def cleanup_unused_versions(self) -> List[str]:
        """Remove plugin versions that are no longer used by any user"""
        try:
            # Get all referenced plugin versions from users
            referenced_versions = set()

            for user_dir in self.storage_manager.users_dir.iterdir():
                if user_dir.is_dir():
                    user_plugins = await self.storage_manager.get_all_user_plugins(user_dir.name.replace('user_', ''))

                    for plugin_slug, plugin_data in user_plugins.items():
                        version = plugin_data.get('version')
                        if version:
                            referenced_versions.add(f"{plugin_slug}_{version}")

            # Find unused versions in shared storage
            removed_versions = []

            for plugin_dir in self.storage_manager.shared_dir.iterdir():
                if plugin_dir.is_dir():
                    plugin_slug = plugin_dir.name

                    for version_dir in plugin_dir.iterdir():
                        if version_dir.is_dir() and version_dir.name.startswith('v'):
                            version = version_dir.name[1:]  # Remove 'v' prefix
                            version_key = f"{plugin_slug}_{version}"

                            if version_key not in referenced_versions:
                                # Remove unused version
                                import shutil
                                shutil.rmtree(version_dir)
                                removed_versions.append(f"{plugin_slug} v{version}")

                                # Unregister from version manager
                                await self.unregister_version(plugin_slug, version)

                                logger.info(f"Removed unused plugin version: {plugin_slug} v{version}")

            return removed_versions

        except Exception as e:
            logger.error(f"Error cleaning up unused versions: {e}")
            return []

    def get_available_versions(self, plugin_slug: str) -> List[str]:
        """Get all available versions for a plugin"""
        return self.version_registry.get(plugin_slug, [])

    def get_latest_version(self, plugin_slug: str) -> Optional[str]:
        """Get the latest version for a plugin"""
        versions = self.get_available_versions(plugin_slug)
        if not versions:
            return None

        return max(versions, key=self._version_sort_key)

    def get_version_stats(self) -> Dict[str, Any]:
        """Get statistics about plugin versions"""
        total_plugins = len(self.version_registry)
        total_versions = sum(len(versions) for versions in self.version_registry.values())

        plugin_stats = {}
        for plugin_slug, versions in self.version_registry.items():
            plugin_stats[plugin_slug] = {
                'version_count': len(versions),
                'versions': versions,
                'latest_version': max(versions, key=self._version_sort_key) if versions else None
            }

        return {
            'total_plugins': total_plugins,
            'total_versions': total_versions,
            'plugins': plugin_stats,
            'dependency_count': len(self.dependency_graph),
            'compatibility_entries': sum(len(compat) for compat in self.compatibility_matrix.values())
        }