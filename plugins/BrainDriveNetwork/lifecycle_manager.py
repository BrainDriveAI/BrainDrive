#!/usr/bin/env python3
"""
BrainDrive Network Plugin Lifecycle Manager

This script handles install/update/delete operations for the BrainDrive Network plugin
without using the UserInitializerBase system. It works directly with the database
and file system to manage user-specific plugin installations.
"""

import json
import logging
import datetime
import os
import shutil
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import structlog

logger = structlog.get_logger()

class BrainDriveNetworkLifecycleManager:
    """Lifecycle manager for BrainDrive Network plugin"""

    def __init__(self, plugins_base_dir: str = None):
        """Initialize the lifecycle manager"""
        if plugins_base_dir:
            self.plugins_base_dir = Path(plugins_base_dir)
        else:
            self.plugins_base_dir = Path(__file__).parent.parent

        self.PLUGIN_DATA = {
            "name": "BrainDrive Network",
            "description": "Network status monitoring and connectivity checking for BrainDrive services",
            "version": "1.0.0",
            "type": "frontend",
            "icon": "NetworkCheck",
            "category": "monitoring",
            "official": True,
            "author": "BrainDrive Team",
            "compatibility": "1.0.0",
            "scope": "braindrive_network",
            "bundle_method": "webpack",
            "bundle_location": "dist/remoteEntry.js",
            "is_local": True,
            "long_description": "Monitor network connectivity and status of BrainDrive services",
            "plugin_slug": "BrainDriveNetwork",
            # Update tracking fields (matching plugin model)
            "source_type": "github",
            "source_url": "https://github.com/DJJones66/NetworkEyes",
            "update_check_url": "https://api.github.com/repos/DJJones66/NetworkEyes/releases/latest",
            "last_update_check": None,  # Will be set when first checked
            "update_available": False,  # Will be updated by update checker
            "latest_version": None,     # Will be populated by update checker
            "installation_type": "local",
            "permissions": ["network.read", "storage.read", "storage.write"]
        }

        self.MODULE_DATA = [
            {
                "name": "ComponentNetworkStatus",
                "display_name": "Network Status Monitor",
                "description": "Real-time network connectivity monitoring dashboard",
                "icon": "NetworkCheck",
                "category": "monitoring",
                "priority": 1,
                "props": {},
                "config_fields": {
                    "refresh_interval": {
                        "type": "number",
                        "description": "Auto-refresh interval in seconds",
                        "default": 30
                    }
                },
                "messages": {},
                "required_services": {
                    "api": {"methods": ["get"], "version": "1.0.0"},
                    "network": {"methods": ["check", "monitor"], "version": "1.0.0"}
                },
                "dependencies": [],
                "layout": {
                    "minWidth": 3,
                    "minHeight": 2,
                    "defaultWidth": 4,
                    "defaultHeight": 3
                },
                "tags": ["monitoring", "network", "status", "connectivity"]
            }
        ]

    async def install_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Install BrainDrive Network plugin for specific user"""
        try:
            logger.info(f"Installing BrainDrive Network plugin for user {user_id}")

            existing_check = await self._check_existing_plugin(user_id, db)
            if existing_check['exists']:
                return {
                    'success': False,
                    'error': f"Plugin already installed for user {user_id}",
                    'plugin_id': existing_check['plugin_id']
                }

            user_plugin_dir = await self._create_user_plugin_directory(user_id)
            if not user_plugin_dir:
                return {'success': False, 'error': 'Failed to create user plugin directory'}

            copy_result = await self._copy_plugin_files(user_id, user_plugin_dir)
            if not copy_result['success']:
                await self._cleanup_user_directory(user_plugin_dir)
                return copy_result

            db_result = await self._create_database_records(user_id, db)
            if not db_result['success']:
                await self._cleanup_user_directory(user_plugin_dir)
                return db_result

            validation = await self._validate_installation(user_id, user_plugin_dir)
            if not validation['valid']:
                await db.rollback()
                await self._cleanup_user_directory(user_plugin_dir)
                return {'success': False, 'error': validation['error']}

            await db.commit()
            logger.info(f"BrainDrive Network plugin installed successfully for user {user_id}")

            return {
                'success': True,
                'plugin_id': db_result['plugin_id'],
                'plugin_slug': self.PLUGIN_DATA['plugin_slug'],
                'modules_created': db_result['modules_created'],
                'plugin_directory': str(user_plugin_dir)
            }

        except Exception as e:
            logger.error(f"Plugin installation failed for user {user_id}: {e}")
            await db.rollback()
            return {'success': False, 'error': str(e)}

    async def delete_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Delete BrainDrive Network plugin for user"""
        try:
            print(f"[DEBUG] Starting delete_plugin for user {user_id}")
            logger.info(f"Deleting BrainDrive Network plugin for user {user_id}")

            print(f"[DEBUG] About to check existing plugin...")
            existing_check = await self._check_existing_plugin(user_id, db)
            print(f"[DEBUG] Existing check result: {existing_check}")

            if not existing_check['exists']:
                print(f"[DEBUG] Plugin not found - returning error")
                return {'success': False, 'error': 'Plugin not found for user'}

            plugin_id = existing_check['plugin_id']
            print(f"[DEBUG] Found plugin ID: {plugin_id}")

            delete_result = await self._delete_database_records(user_id, plugin_id, db)
            if not delete_result['success']:
                return delete_result

            user_plugin_dir = self.plugins_base_dir / user_id / self.PLUGIN_DATA['plugin_slug']
            await self._cleanup_user_directory(user_plugin_dir)

            await db.commit()
            logger.info(f"BrainDrive Network plugin deleted successfully for user {user_id}")

            return {
                'success': True,
                'plugin_id': plugin_id,
                'deleted_modules': delete_result['deleted_modules']
            }

        except Exception as e:
            print(f"[DEBUG] Exception in delete_plugin: {e}")
            logger.error(f"Plugin deletion failed for user {user_id}: {e}")
            await db.rollback()
            return {'success': False, 'error': str(e)}

    async def get_plugin_status(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Get current status of BrainDrive Network plugin installation"""
        try:
            existing_check = await self._check_existing_plugin(user_id, db)
            if not existing_check['exists']:
                return {'exists': False, 'status': 'not_installed'}

            plugin_id = existing_check['plugin_id']
            user_plugin_dir = self.plugins_base_dir / user_id / self.PLUGIN_DATA['plugin_slug']
            files_exist = user_plugin_dir.exists()
            modules_status = await self._check_modules_status(user_id, plugin_id, db)

            if files_exist and modules_status['all_loaded']:
                status = 'healthy'
            elif not files_exist:
                status = 'files_missing'
            elif not modules_status['all_loaded']:
                status = 'modules_corrupted'
            else:
                status = 'unknown'

            return {
                'exists': True,
                'status': status,
                'plugin_id': plugin_id,
                'plugin_info': existing_check['plugin_info'],
                'files_exist': files_exist,
                'modules_status': modules_status,
                'plugin_directory': str(user_plugin_dir)
            }

        except Exception as e:
            logger.error(f"Error checking plugin status for user {user_id}: {e}")
            return {'exists': False, 'status': 'error', 'error': str(e)}

    async def _check_existing_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Check if plugin already exists for user"""
        try:
            plugin_slug = self.PLUGIN_DATA['plugin_slug']
            print(f"[DEBUG] Checking for existing plugin: user_id={user_id}, plugin_slug={plugin_slug}")
            logger.info(f"Checking for existing plugin: user_id={user_id}, plugin_slug={plugin_slug}")

            plugin_query = text("""
            SELECT id, name, version, enabled, created_at, updated_at
            FROM plugin
            WHERE user_id = :user_id AND plugin_slug = :plugin_slug
            """)

            print(f"[DEBUG] Executing query with user_id={user_id}, plugin_slug={plugin_slug}")
            result = await db.execute(plugin_query, {
                'user_id': user_id,
                'plugin_slug': plugin_slug
            })

            plugin_row = result.fetchone()
            print(f"[DEBUG] Query result: {plugin_row}")

            if plugin_row:
                print(f"[DEBUG] Plugin found: {plugin_row.id}")
                logger.info(f"Plugin found: {plugin_row.id}")
                return {
                    'exists': True,
                    'plugin_id': plugin_row.id,
                    'plugin_info': {
                        'id': plugin_row.id,
                        'name': plugin_row.name,
                        'version': plugin_row.version,
                        'enabled': plugin_row.enabled,
                        'created_at': plugin_row.created_at,
                        'updated_at': plugin_row.updated_at
                    }
                }
            else:
                print(f"[DEBUG] Plugin not found in database")
                logger.error(f"Plugin not found in database for user_id={user_id}, plugin_slug={plugin_slug}")

                # Debug: Check what plugins exist for this user
                print(f"[DEBUG] Checking all plugins for user...")
                debug_query = text("SELECT id, plugin_slug FROM plugin WHERE user_id = :user_id")
                debug_result = await db.execute(debug_query, {'user_id': user_id})
                debug_rows = debug_result.fetchall()
                print(f"[DEBUG] All plugins for user {user_id}: {[(row.id, row.plugin_slug) for row in debug_rows]}")
                logger.info(f"All plugins for user {user_id}: {[(row.id, row.plugin_slug) for row in debug_rows]}")

                return {'exists': False}

        except Exception as e:
            print(f"[DEBUG] Exception in _check_existing_plugin: {e}")
            logger.error(f"Error checking existing plugin: {e}")
            return {'exists': False, 'error': str(e)}

    async def _create_user_plugin_directory(self, user_id: str) -> Optional[Path]:
        """Create user-specific plugin directory"""
        try:
            user_dir = self.plugins_base_dir / user_id
            plugin_dir = user_dir / self.PLUGIN_DATA['plugin_slug']

            plugin_dir.mkdir(parents=True, exist_ok=True)
            (plugin_dir / "dist").mkdir(exist_ok=True)
            (plugin_dir / "assets").mkdir(exist_ok=True)

            logger.info(f"Created plugin directory: {plugin_dir}")
            return plugin_dir

        except Exception as e:
            logger.error(f"Error creating user plugin directory: {e}")
            return None

    async def _copy_plugin_files(self, user_id: str, target_dir: Path, update: bool = False) -> Dict[str, Any]:
        """Copy plugin files from source to user directory"""
        try:
            source_dir = Path(__file__).parent

            files_to_copy = ["package.json", "README.md"]
            dirs_to_copy = ["dist", "src", "public"]
            copied_files = []

            for file_path in files_to_copy:
                source_file = source_dir / file_path
                target_file = target_dir / file_path

                if source_file.exists():
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source_file, target_file)
                    copied_files.append(str(file_path))

            for dir_path in dirs_to_copy:
                source_dir_path = source_dir / dir_path
                target_dir_path = target_dir / dir_path

                if source_dir_path.exists():
                    if target_dir_path.exists() and update:
                        shutil.rmtree(target_dir_path)
                    shutil.copytree(source_dir_path, target_dir_path, dirs_exist_ok=True)
                    copied_files.append(f"{dir_path}/")

            metadata_file = target_dir / "plugin_metadata.json"
            with open(metadata_file, 'w') as f:
                json.dump({
                    'plugin_data': self.PLUGIN_DATA,
                    'module_data': self.MODULE_DATA,
                    'installed_for_user': user_id,
                    'installed_at': datetime.datetime.now().isoformat()
                }, f, indent=2)
            copied_files.append("plugin_metadata.json")

            logger.info(f"Copied {len(copied_files)} files/directories to {target_dir}")
            return {'success': True, 'copied_files': copied_files}

        except Exception as e:
            logger.error(f"Error copying plugin files: {e}")
            return {'success': False, 'error': str(e)}

    async def _create_database_records(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Create plugin and module records in database"""
        try:
            current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            plugin_slug = self.PLUGIN_DATA['plugin_slug']
            plugin_id = f"{user_id}_{plugin_slug}"

            plugin_stmt = text("""
            INSERT INTO plugin
            (id, name, description, version, type, enabled, icon, category, status,
            official, author, last_updated, compatibility, downloads, scope,
            bundle_method, bundle_location, is_local, long_description,
            config_fields, messages, dependencies, created_at, updated_at, user_id,
            plugin_slug, source_type, source_url, update_check_url, last_update_check,
            update_available, latest_version, installation_type, permissions)
            VALUES
            (:id, :name, :description, :version, :type, :enabled, :icon, :category,
            :status, :official, :author, :last_updated, :compatibility, :downloads,
            :scope, :bundle_method, :bundle_location, :is_local, :long_description,
            :config_fields, :messages, :dependencies, :created_at, :updated_at, :user_id,
            :plugin_slug, :source_type, :source_url, :update_check_url, :last_update_check,
            :update_available, :latest_version, :installation_type, :permissions)
            """)

            await db.execute(plugin_stmt, {
                'id': plugin_id,
                'name': self.PLUGIN_DATA['name'],
                'description': self.PLUGIN_DATA['description'],
                'version': self.PLUGIN_DATA['version'],
                'type': self.PLUGIN_DATA['type'],
                'enabled': True,
                'icon': self.PLUGIN_DATA['icon'],
                'category': self.PLUGIN_DATA['category'],
                'status': 'activated',
                'official': self.PLUGIN_DATA['official'],
                'author': self.PLUGIN_DATA['author'],
                'last_updated': current_time,
                'compatibility': self.PLUGIN_DATA['compatibility'],
                'downloads': 0,
                'scope': self.PLUGIN_DATA['scope'],
                'bundle_method': self.PLUGIN_DATA['bundle_method'],
                'bundle_location': self.PLUGIN_DATA['bundle_location'],
                'is_local': self.PLUGIN_DATA['is_local'],
                'long_description': self.PLUGIN_DATA['long_description'],
                'config_fields': json.dumps({}),
                'messages': None,
                'dependencies': None,
                'created_at': current_time,
                'updated_at': current_time,
                'user_id': user_id,
                'plugin_slug': plugin_slug,
                'source_type': self.PLUGIN_DATA['source_type'],
                'source_url': self.PLUGIN_DATA['source_url'],
                'update_check_url': self.PLUGIN_DATA['update_check_url'],
                'last_update_check': self.PLUGIN_DATA['last_update_check'],
                'update_available': self.PLUGIN_DATA['update_available'],
                'latest_version': self.PLUGIN_DATA['latest_version'],
                'installation_type': self.PLUGIN_DATA['installation_type'],
                'permissions': json.dumps(self.PLUGIN_DATA['permissions'])
            })

            modules_created = []
            for module_data in self.MODULE_DATA:
                module_id = f"{user_id}_{plugin_slug}_{module_data['name']}"

                module_stmt = text("""
                INSERT INTO module
                (id, plugin_id, name, display_name, description, icon, category,
                enabled, priority, props, config_fields, messages, required_services,
                dependencies, layout, tags, created_at, updated_at, user_id)
                VALUES
                (:id, :plugin_id, :name, :display_name, :description, :icon, :category,
                :enabled, :priority, :props, :config_fields, :messages, :required_services,
                :dependencies, :layout, :tags, :created_at, :updated_at, :user_id)
                """)

                await db.execute(module_stmt, {
                    'id': module_id,
                    'plugin_id': plugin_id,
                    'name': module_data['name'],
                    'display_name': module_data['display_name'],
                    'description': module_data['description'],
                    'icon': module_data['icon'],
                    'category': module_data['category'],
                    'enabled': True,
                    'priority': module_data['priority'],
                    'props': json.dumps(module_data['props']),
                    'config_fields': json.dumps(module_data['config_fields']),
                    'messages': json.dumps(module_data['messages']),
                    'required_services': json.dumps(module_data['required_services']),
                    'dependencies': json.dumps(module_data['dependencies']),
                    'layout': json.dumps(module_data['layout']),
                    'tags': json.dumps(module_data['tags']),
                    'created_at': current_time,
                    'updated_at': current_time,
                    'user_id': user_id
                })

                modules_created.append(module_id)

            logger.info(f"Created database records for plugin {plugin_id} with {len(modules_created)} modules")
            return {'success': True, 'plugin_id': plugin_id, 'modules_created': modules_created}

        except Exception as e:
            logger.error(f"Error creating database records: {e}")
            return {'success': False, 'error': str(e)}

    async def _delete_database_records(self, user_id: str, plugin_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Delete plugin and module records from database"""
        try:
            module_delete_stmt = text("""
            DELETE FROM module
            WHERE plugin_id = :plugin_id AND user_id = :user_id
            """)

            module_result = await db.execute(module_delete_stmt, {
                'plugin_id': plugin_id,
                'user_id': user_id
            })

            deleted_modules = module_result.rowcount

            plugin_delete_stmt = text("""
            DELETE FROM plugin
            WHERE id = :plugin_id AND user_id = :user_id
            """)

            plugin_result = await db.execute(plugin_delete_stmt, {
                'plugin_id': plugin_id,
                'user_id': user_id
            })

            if plugin_result.rowcount == 0:
                return {'success': False, 'error': 'Plugin not found or not owned by user'}

            logger.info(f"Deleted database records for plugin {plugin_id} ({deleted_modules} modules)")
            return {'success': True, 'deleted_modules': deleted_modules}

        except Exception as e:
            logger.error(f"Error deleting database records: {e}")
            return {'success': False, 'error': str(e)}

    async def _validate_installation(self, user_id: str, plugin_dir: Path) -> Dict[str, Any]:
        """Validate plugin installation"""
        try:
            required_files = ["package.json", "plugin_metadata.json"]
            missing_files = []

            for file_path in required_files:
                if not (plugin_dir / file_path).exists():
                    missing_files.append(file_path)

            if missing_files:
                return {
                    'valid': False,
                    'error': f"Missing required files: {', '.join(missing_files)}"
                }

            metadata_file = plugin_dir / "plugin_metadata.json"
            try:
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)

                if metadata.get('installed_for_user') != user_id:
                    return {
                        'valid': False,
                        'error': 'Metadata file has incorrect user ID'
                    }

            except (json.JSONDecodeError, KeyError) as e:
                return {
                    'valid': False,
                    'error': f'Invalid metadata file: {e}'
                }

            return {'valid': True}

        except Exception as e:
            logger.error(f"Error validating installation: {e}")
            return {'valid': False, 'error': str(e)}

    async def _check_modules_status(self, user_id: str, plugin_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Check status of plugin modules"""
        try:
            module_query = text("""
            SELECT id, name, enabled
            FROM module
            WHERE plugin_id = :plugin_id AND user_id = :user_id
            """)

            result = await db.execute(module_query, {
                'plugin_id': plugin_id,
                'user_id': user_id
            })

            modules = result.fetchall()
            expected_modules = len(self.MODULE_DATA)
            actual_modules = len(modules)
            enabled_modules = sum(1 for m in modules if m.enabled)

            return {
                'expected_count': expected_modules,
                'actual_count': actual_modules,
                'enabled_count': enabled_modules,
                'all_loaded': actual_modules == expected_modules,
                'all_enabled': enabled_modules == actual_modules,
                'modules': [{'id': m.id, 'name': m.name, 'enabled': m.enabled} for m in modules]
            }

        except Exception as e:
            logger.error(f"Error checking modules status: {e}")
            return {'expected_count': 0, 'actual_count': 0, 'enabled_count': 0, 'all_loaded': False}

    async def _cleanup_user_directory(self, plugin_dir: Path):
        """Remove plugin directory and contents"""
        try:
            if plugin_dir.exists():
                shutil.rmtree(plugin_dir)
                logger.info(f"Cleaned up plugin directory: {plugin_dir}")

        except Exception as e:
            logger.error(f"Error cleaning up plugin directory: {e}")


if __name__ == "__main__":
    import sys

    async def main():
        if len(sys.argv) < 3:
            print("Usage: python lifecycle_manager.py <operation> <user_id>")
            print("Operations: install, delete, status")
            sys.exit(1)

        operation = sys.argv[1]
        user_id = sys.argv[2]

        manager = BrainDriveNetworkLifecycleManager()

        print(f"BrainDrive Network Plugin Lifecycle Manager")
        print(f"Operation: {operation}")
        print(f"User ID: {user_id}")
        print(f"Plugin: {manager.PLUGIN_DATA['name']} v{manager.PLUGIN_DATA['version']}")
        print("\nNote: This script requires database connection for actual operations.")

    asyncio.run(main())