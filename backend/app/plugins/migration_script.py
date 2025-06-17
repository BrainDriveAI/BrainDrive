"""
Plugin System Migration Script

Migrates from the old per-user plugin storage system to the new
shared storage system with logical references.
"""

import asyncio
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
import structlog

from .storage_manager import PluginStorageManager
from .lifecycle_service import PluginLifecycleService
from ..core.database import get_db
from ..models.plugin import Plugin
from ..models.user import User

logger = structlog.get_logger()


class PluginMigrationScript:
    """Handles migration from old to new plugin system"""

    def __init__(self, old_plugins_dir: str, new_plugins_dir: str):
        self.old_plugins_dir = Path(old_plugins_dir)
        self.new_plugins_dir = Path(new_plugins_dir)
        self.storage_manager = PluginStorageManager(self.new_plugins_dir)
        self.lifecycle_service = PluginLifecycleService(str(new_plugins_dir))

        # Migration tracking
        self.migration_log = []
        self.errors = []

        logger.info(f"Migration script initialized: {old_plugins_dir} -> {new_plugins_dir}")

    async def run_migration(self, dry_run: bool = True) -> Dict[str, Any]:
        """Run the complete migration process"""
        try:
            logger.info(f"Starting plugin migration (dry_run={dry_run})")

            # Step 1: Analyze current system
            analysis = await self._analyze_current_system()

            if dry_run:
                logger.info("Dry run mode - no changes will be made")
                return {
                    'success': True,
                    'dry_run': True,
                    'analysis': analysis,
                    'migration_plan': await self._create_migration_plan(analysis)
                }

            # Step 2: Create backup
            backup_result = await self._create_backup()
            if not backup_result['success']:
                return backup_result

            # Step 3: Migrate plugins to shared storage
            migration_result = await self._migrate_plugins_to_shared_storage(analysis)
            if not migration_result['success']:
                return migration_result

            # Step 4: Update user metadata
            metadata_result = await self._create_user_metadata_files(analysis)
            if not metadata_result['success']:
                return metadata_result

            # Step 5: Validate migration
            validation_result = await self._validate_migration()

            logger.info("Plugin migration completed successfully")

            return {
                'success': True,
                'dry_run': False,
                'backup_location': backup_result.get('backup_location'),
                'migrated_plugins': migration_result.get('migrated_plugins', []),
                'created_metadata': metadata_result.get('created_files', []),
                'validation': validation_result,
                'migration_log': self.migration_log,
                'errors': self.errors
            }

        except Exception as e:
            logger.error(f"Migration failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'migration_log': self.migration_log,
                'errors': self.errors
            }

    async def _analyze_current_system(self) -> Dict[str, Any]:
        """Analyze the current plugin system"""
        try:
            analysis = {
                'users': [],
                'plugins': {},
                'total_files': 0,
                'total_size_mb': 0,
                'duplicates': []
            }

            if not self.old_plugins_dir.exists():
                logger.warning(f"Old plugins directory does not exist: {self.old_plugins_dir}")
                return analysis

            # Scan user directories
            for user_dir in self.old_plugins_dir.iterdir():
                if not user_dir.is_dir() or user_dir.name in ['shared', 'cache']:
                    continue

                user_id = user_dir.name.replace('user_', '') if user_dir.name.startswith('user_') else user_dir.name
                user_info = {
                    'user_id': user_id,
                    'plugins': [],
                    'total_files': 0,
                    'total_size_mb': 0
                }

                # Scan user's plugins
                for plugin_dir in user_dir.iterdir():
                    if not plugin_dir.is_dir():
                        continue

                    plugin_info = await self._analyze_plugin_directory(plugin_dir, user_id)
                    if plugin_info:
                        user_info['plugins'].append(plugin_info)
                        user_info['total_files'] += plugin_info['file_count']
                        user_info['total_size_mb'] += plugin_info['size_mb']

                        # Track plugin versions for duplicate detection
                        plugin_key = f"{plugin_info['name']}_{plugin_info['version']}"
                        if plugin_key not in analysis['plugins']:
                            analysis['plugins'][plugin_key] = []
                        analysis['plugins'][plugin_key].append({
                            'user_id': user_id,
                            'path': str(plugin_dir)
                        })

                if user_info['plugins']:
                    analysis['users'].append(user_info)
                    analysis['total_files'] += user_info['total_files']
                    analysis['total_size_mb'] += user_info['total_size_mb']

            # Identify duplicates
            for plugin_key, instances in analysis['plugins'].items():
                if len(instances) > 1:
                    analysis['duplicates'].append({
                        'plugin': plugin_key,
                        'instances': len(instances),
                        'users': [inst['user_id'] for inst in instances]
                    })

            logger.info(f"Analysis complete: {len(analysis['users'])} users, {len(analysis['plugins'])} unique plugins, {len(analysis['duplicates'])} duplicates")
            return analysis

        except Exception as e:
            logger.error(f"Error analyzing current system: {e}")
            return {}

    async def _analyze_plugin_directory(self, plugin_dir: Path, user_id: str) -> Dict[str, Any]:
        """Analyze a single plugin directory"""
        try:
            plugin_info = {
                'name': plugin_dir.name,
                'version': '1.0.0',  # Default version
                'path': str(plugin_dir),
                'file_count': 0,
                'size_mb': 0,
                'has_package_json': False,
                'has_lifecycle_manager': False
            }

            total_size = 0
            file_count = 0

            # Count files and calculate size
            for file_path in plugin_dir.rglob('*'):
                if file_path.is_file():
                    file_count += 1
                    total_size += file_path.stat().st_size

            plugin_info['file_count'] = file_count
            plugin_info['size_mb'] = round(total_size / (1024 * 1024), 2)

            # Check for important files
            package_json = plugin_dir / 'package.json'
            if package_json.exists():
                plugin_info['has_package_json'] = True
                try:
                    with open(package_json, 'r') as f:
                        package_data = json.load(f)
                        plugin_info['version'] = package_data.get('version', '1.0.0')
                        plugin_info['name'] = package_data.get('name', plugin_dir.name)
                except Exception as e:
                    logger.warning(f"Error reading package.json for {plugin_dir}: {e}")

            lifecycle_manager = plugin_dir / 'lifecycle_manager.py'
            if lifecycle_manager.exists():
                plugin_info['has_lifecycle_manager'] = True

            return plugin_info

        except Exception as e:
            logger.error(f"Error analyzing plugin directory {plugin_dir}: {e}")
            return None

    async def _create_migration_plan(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Create a detailed migration plan"""
        plan = {
            'shared_plugins_to_create': [],
            'user_metadata_files': [],
            'estimated_space_savings_mb': 0,
            'estimated_time_minutes': 0
        }

        # Calculate shared plugins needed
        unique_plugins = {}
        for plugin_key, instances in analysis['plugins'].items():
            if len(instances) > 0:
                # Use the first instance as the source
                source_instance = instances[0]
                unique_plugins[plugin_key] = source_instance

                # Calculate space savings (duplicates * size)
                if len(instances) > 1:
                    # Find plugin info from analysis
                    for user_info in analysis['users']:
                        for plugin_info in user_info['plugins']:
                            if f"{plugin_info['name']}_{plugin_info['version']}" == plugin_key:
                                savings = plugin_info['size_mb'] * (len(instances) - 1)
                                plan['estimated_space_savings_mb'] += savings
                                break

        plan['shared_plugins_to_create'] = list(unique_plugins.keys())

        # Calculate user metadata files needed
        for user_info in analysis['users']:
            plan['user_metadata_files'].append({
                'user_id': user_info['user_id'],
                'plugins_count': len(user_info['plugins'])
            })

        # Estimate time (rough calculation)
        total_plugins = len(analysis['plugins'])
        plan['estimated_time_minutes'] = max(5, total_plugins * 2)  # 2 minutes per unique plugin

        return plan

    async def _create_backup(self) -> Dict[str, Any]:
        """Create backup of current system"""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_dir = self.old_plugins_dir.parent / f"plugins_backup_{timestamp}"

            logger.info(f"Creating backup at: {backup_dir}")

            # Copy entire plugins directory
            shutil.copytree(self.old_plugins_dir, backup_dir)

            # Create backup info file
            backup_info = {
                'created_at': datetime.now().isoformat(),
                'source_directory': str(self.old_plugins_dir),
                'backup_directory': str(backup_dir),
                'migration_version': '2.0.0'
            }

            with open(backup_dir / 'backup_info.json', 'w') as f:
                json.dump(backup_info, f, indent=2)

            self.migration_log.append(f"Backup created: {backup_dir}")

            return {
                'success': True,
                'backup_location': str(backup_dir)
            }

        except Exception as e:
            error_msg = f"Failed to create backup: {e}"
            logger.error(error_msg)
            self.errors.append(error_msg)
            return {'success': False, 'error': error_msg}

    async def _migrate_plugins_to_shared_storage(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Migrate plugins to shared storage"""
        try:
            migrated_plugins = []

            # Process each unique plugin
            for plugin_key, instances in analysis['plugins'].items():
                if not instances:
                    continue

                # Use the first instance as the source
                source_instance = instances[0]
                source_path = Path(source_instance['path'])

                # Extract plugin name and version
                parts = plugin_key.split('_')
                if len(parts) >= 2:
                    plugin_name = '_'.join(parts[:-1])
                    version = parts[-1]
                else:
                    plugin_name = plugin_key
                    version = '1.0.0'

                # Create shared storage location
                shared_path = await self.storage_manager.install_plugin_files(
                    plugin_name, version, source_path
                )

                if shared_path:
                    migrated_plugins.append({
                        'plugin_name': plugin_name,
                        'version': version,
                        'shared_path': str(shared_path),
                        'source_path': str(source_path),
                        'instances': len(instances)
                    })

                    self.migration_log.append(f"Migrated {plugin_name} v{version} to shared storage")
                else:
                    error_msg = f"Failed to migrate {plugin_name} v{version}"
                    logger.error(error_msg)
                    self.errors.append(error_msg)

            return {
                'success': True,
                'migrated_plugins': migrated_plugins
            }

        except Exception as e:
            error_msg = f"Failed to migrate plugins to shared storage: {e}"
            logger.error(error_msg)
            self.errors.append(error_msg)
            return {'success': False, 'error': error_msg}

    async def _create_user_metadata_files(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Create user metadata files with logical references"""
        try:
            created_files = []

            for user_info in analysis['users']:
                user_id = user_info['user_id']
                user_plugins = {}

                for plugin_info in user_info['plugins']:
                    plugin_name = plugin_info['name']
                    version = plugin_info['version']

                    # Find shared path
                    shared_path = self.storage_manager.shared_dir / plugin_name / f"v{version}"

                    if shared_path.exists():
                        user_plugins[plugin_name] = {
                            'version': version,
                            'shared_path': str(shared_path.absolute()),
                            'installed_at': datetime.now().isoformat(),
                            'enabled': True,
                            'user_config': {},
                            'installation_metadata': {
                                'migrated_from': plugin_info['path'],
                                'migration_date': datetime.now().isoformat(),
                                'installation_type': 'migrated'
                            }
                        }

                # Create user metadata file
                if user_plugins:
                    success = await self.storage_manager.register_user_plugin(
                        user_id, list(user_plugins.keys())[0],
                        list(user_plugins.values())[0]['version'],
                        Path(list(user_plugins.values())[0]['shared_path']),
                        list(user_plugins.values())[0]
                    )

                    # Register additional plugins
                    for plugin_name, plugin_data in list(user_plugins.items())[1:]:
                        await self.storage_manager.register_user_plugin(
                            user_id, plugin_name, plugin_data['version'],
                            Path(plugin_data['shared_path']), plugin_data
                        )

                    if success:
                        created_files.append(f"user_{user_id}/installed_plugins.json")
                        self.migration_log.append(f"Created metadata for user {user_id} with {len(user_plugins)} plugins")

            return {
                'success': True,
                'created_files': created_files
            }

        except Exception as e:
            error_msg = f"Failed to create user metadata files: {e}"
            logger.error(error_msg)
            self.errors.append(error_msg)
            return {'success': False, 'error': error_msg}

    async def _validate_migration(self) -> Dict[str, Any]:
        """Validate the migration was successful"""
        try:
            validation = {
                'shared_plugins_exist': True,
                'user_metadata_valid': True,
                'file_access_working': True,
                'issues': []
            }

            # Check shared plugins exist
            if not self.storage_manager.shared_dir.exists():
                validation['shared_plugins_exist'] = False
                validation['issues'].append("Shared plugins directory does not exist")

            # Check user metadata files
            users_dir = self.storage_manager.users_dir
            if users_dir.exists():
                for user_dir in users_dir.iterdir():
                    if user_dir.is_dir():
                        metadata_file = user_dir / "installed_plugins.json"
                        if metadata_file.exists():
                            try:
                                with open(metadata_file, 'r') as f:
                                    json.load(f)
                            except Exception as e:
                                validation['user_metadata_valid'] = False
                                validation['issues'].append(f"Invalid metadata file: {metadata_file}")

            # Test file access
            try:
                test_user_id = "test_user"
                all_plugins = await self.storage_manager.get_all_user_plugins(test_user_id)
                # This should not fail even if user doesn't exist
            except Exception as e:
                validation['file_access_working'] = False
                validation['issues'].append(f"File access test failed: {e}")

            validation['overall_success'] = (
                validation['shared_plugins_exist'] and
                validation['user_metadata_valid'] and
                validation['file_access_working']
            )

            return validation

        except Exception as e:
            logger.error(f"Validation failed: {e}")
            return {
                'overall_success': False,
                'issues': [f"Validation error: {e}"]
            }

    async def rollback_migration(self, backup_location: str) -> Dict[str, Any]:
        """Rollback migration using backup"""
        try:
            backup_dir = Path(backup_location)

            if not backup_dir.exists():
                return {'success': False, 'error': 'Backup directory does not exist'}

            logger.info(f"Rolling back migration from backup: {backup_dir}")

            # Remove new plugins directory
            if self.new_plugins_dir.exists():
                shutil.rmtree(self.new_plugins_dir)

            # Restore from backup
            shutil.copytree(backup_dir, self.old_plugins_dir)

            logger.info("Migration rollback completed successfully")

            return {
                'success': True,
                'restored_from': str(backup_dir)
            }

        except Exception as e:
            error_msg = f"Rollback failed: {e}"
            logger.error(error_msg)
            return {'success': False, 'error': error_msg}


async def main():
    """Main function for running migration script"""
    import argparse

    parser = argparse.ArgumentParser(description='Migrate plugin system to new architecture')
    parser.add_argument('--old-dir', required=True, help='Old plugins directory')
    parser.add_argument('--new-dir', required=True, help='New plugins directory')
    parser.add_argument('--dry-run', action='store_true', help='Run in dry-run mode')
    parser.add_argument('--rollback', help='Rollback using backup directory')

    args = parser.parse_args()

    migration = PluginMigrationScript(args.old_dir, args.new_dir)

    if args.rollback:
        result = await migration.rollback_migration(args.rollback)
    else:
        result = await migration.run_migration(dry_run=args.dry_run)

    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    asyncio.run(main())