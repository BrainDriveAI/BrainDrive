"""
BrainDrive Network Plugin Initializer

This initializer creates the BrainDrive Network plugin and its modules for a user.
Follows the BrainDrive initializer pattern for consistent plugin management.
"""

import logging
import json
import datetime
import os
import shutil
from pathlib import Path
from typing import Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

# Import BrainDrive initializer base (this will be available in the BrainDrive environment)
try:
    from app.core.user_initializer.base import UserInitializerBase
    from app.core.user_initializer.utils import prepare_record_for_new_user
except ImportError:
    # Fallback for development/testing
    class UserInitializerBase:
        pass
    def prepare_record_for_new_user(data, user_id, preserve_fields=None, user_id_field="user_id"):
        result = data.copy()
        result[user_id_field] = user_id
        return result

logger = logging.getLogger(__name__)

class BrainDriveNetworkInitializer(UserInitializerBase):
    """Initializer for BrainDrive Network plugin and its modules."""

    name = "braindrive_network_initializer"
    description = "Initializes BrainDrive Network plugin and its modules for a user"
    priority = 500  # Medium priority
    dependencies = []  # No dependencies

    # Plugin metadata (replaces manifest.json)
    PLUGIN_DATA = {
        "id": "braindrive_network",
        "name": "BrainDrive Network",
        "description": "Network status monitoring and connectivity checking for BrainDrive services",
        "version": "1.0.0",
        "type": "frontend",
        "enabled": True,
        "icon": "NetworkCheck",
        "category": "monitoring",
        "status": "activated",
        "official": True,  # This is an official BrainDrive plugin
        "author": "BrainDrive Team",
        "last_updated": datetime.datetime.now().strftime("%Y-%m-%d"),
        "compatibility": "1.0.0",
        "downloads": 0,
        "scope": "braindrive_network",
        "bundle_method": "webpack",
        "bundle_location": "dist/remoteEntry.js",
        "is_local": True,
        "long_description": "Monitor network connectivity and status of BrainDrive services including Ollama servers, API endpoints, and other critical network resources. Provides real-time status updates and connectivity diagnostics.",
        "config_fields": json.dumps({
            "monitoring_targets": {
                "type": "array",
                "description": "List of network targets to monitor",
                "default": [
                    {"name": "Ollama", "url": "https://www.ollama.com", "enabled": True},
                    {"name": "Local Ollama", "url": "http://localhost:11434", "enabled": True}
                ]
            },
            "check_interval": {
                "type": "number",
                "description": "Interval between network checks in milliseconds",
                "default": 30000
            },
            "timeout": {
                "type": "number",
                "description": "Request timeout in milliseconds",
                "default": 3000
            }
        }),
        "messages": None,
        "dependencies": None,
        "plugin_slug": "braindrive_network",
        "source_type": "local",
        "source_url": "local://plugins/BrainDriveNetwork",
        "permissions": json.dumps(["network.read", "storage.read", "storage.write"])
    }

    # Module definitions
    MODULE_DATA = [
        {
            "id": "network_status_monitor",
            "plugin_id": "braindrive_network",
            "name": "ComponentNetworkStatus",
            "display_name": "Network Status Monitor",
            "description": "Real-time network connectivity monitoring dashboard",
            "icon": "NetworkCheck",
            "category": "monitoring",
            "enabled": True,
            "priority": 1,
            "props": json.dumps({}),
            "config_fields": json.dumps({
                "refresh_interval": {
                    "type": "number",
                    "description": "Auto-refresh interval in seconds",
                    "default": 30
                },
                "show_details": {
                    "type": "boolean",
                    "description": "Show detailed connection information",
                    "default": True
                }
            }),
            "messages": json.dumps({}),
            "required_services": json.dumps({
                "api": {
                    "methods": ["get"],
                    "version": "1.0.0"
                },
                "network": {
                    "methods": ["check", "monitor"],
                    "version": "1.0.0"
                }
            }),
            "dependencies": json.dumps([]),
            "layout": json.dumps({
                "minWidth": 3,
                "minHeight": 2,
                "defaultWidth": 4,
                "defaultHeight": 3
            }),
            "tags": json.dumps(["monitoring", "network", "status", "connectivity"])
        }
    ]

    # Optional: Default pages that use the plugin modules
    DEFAULT_PAGES = [
        {
            "name": "Network Monitoring Dashboard",
            "route": f"network-dashboard-{int(datetime.datetime.now().timestamp())}",
            "is_published": 1,
            "description": "Monitor network connectivity and service status",
            "icon": "NetworkCheck",
            "parent_type": "page",
            "is_parent_page": 0
        }
    ]

    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Initialize BrainDrive Network plugin and its modules for a user."""
        try:
            logger.info(f"Initializing BrainDrive Network plugin for user {user_id}")

            # Create the plugin for the user
            plugin_data = self.PLUGIN_DATA.copy()

            # Prepare the plugin data for the new user
            prepared_plugin = prepare_record_for_new_user(
                plugin_data,
                user_id,
                preserve_fields=["name", "description", "version", "type", "icon",
                                "category", "status", "official", "author",
                                "last_updated", "compatibility", "scope",
                                "bundle_method", "bundle_location", "is_local",
                                "long_description", "plugin_slug", "source_type",
                                "source_url", "permissions", "config_fields"],
                user_id_field="user_id"
            )

            # Update the ID to use the new format: user_id_plugin_slug
            plugin_slug = prepared_plugin.get("plugin_slug", "braindrive_network")
            prepared_plugin["id"] = f"{user_id}_{plugin_slug}"

            # Create the plugin using direct SQL
            current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            # Create SQL statement for plugin
            plugin_stmt = text("""
            INSERT INTO plugin
            (id, name, description, version, type, enabled, icon, category, status,
            official, author, last_updated, compatibility, downloads, scope,
            bundle_method, bundle_location, is_local, long_description,
            config_fields, messages, dependencies, created_at, updated_at, user_id,
            plugin_slug, source_type, source_url, permissions)
            VALUES
            (:id, :name, :description, :version, :type, :enabled, :icon, :category,
            :status, :official, :author, :last_updated, :compatibility, :downloads,
            :scope, :bundle_method, :bundle_location, :is_local, :long_description,
            :config_fields, :messages, :dependencies, :created_at, :updated_at, :user_id,
            :plugin_slug, :source_type, :source_url, :permissions)
            """)

            # Execute statement with parameters
            await db.execute(plugin_stmt, {
                "id": prepared_plugin["id"],
                "name": prepared_plugin["name"],
                "description": prepared_plugin["description"],
                "version": prepared_plugin["version"],
                "type": prepared_plugin["type"],
                "enabled": prepared_plugin.get("enabled", True),
                "icon": prepared_plugin.get("icon"),
                "category": prepared_plugin.get("category"),
                "status": prepared_plugin.get("status", "activated"),
                "official": prepared_plugin.get("official", False),
                "author": prepared_plugin.get("author"),
                "last_updated": prepared_plugin.get("last_updated"),
                "compatibility": prepared_plugin.get("compatibility", "1.0.0"),
                "downloads": prepared_plugin.get("downloads", 0),
                "scope": prepared_plugin.get("scope"),
                "bundle_method": prepared_plugin.get("bundle_method"),
                "bundle_location": prepared_plugin.get("bundle_location"),
                "is_local": prepared_plugin.get("is_local", True),
                "long_description": prepared_plugin.get("long_description"),
                "config_fields": prepared_plugin.get("config_fields"),
                "messages": prepared_plugin.get("messages"),
                "dependencies": prepared_plugin.get("dependencies"),
                "created_at": current_time,
                "updated_at": current_time,
                "user_id": user_id,
                "plugin_slug": prepared_plugin.get("plugin_slug"),
                "source_type": prepared_plugin.get("source_type", "local"),
                "source_url": prepared_plugin.get("source_url"),
                "permissions": prepared_plugin.get("permissions")
            })

            logger.info(f"Created plugin {prepared_plugin['name']} for user {user_id}")

            # Initialize all modules for this plugin
            prepared_modules = []
            for module_data in self.MODULE_DATA:
                # Prepare the module data for the new user
                prepared_module = prepare_record_for_new_user(
                    module_data,
                    user_id,
                    preserve_fields=["name", "display_name", "description", "icon",
                                    "category", "enabled", "priority", "props",
                                    "config_fields", "messages", "required_services",
                                    "dependencies", "layout", "tags"],
                    user_id_field="user_id"
                )

                # Create the module using direct SQL
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

                # Execute statement with parameters
                await db.execute(module_stmt, {
                    "id": prepared_module["id"],
                    "plugin_id": prepared_plugin["id"],  # Use the new plugin ID
                    "name": prepared_module["name"],
                    "display_name": prepared_module.get("display_name"),
                    "description": prepared_module.get("description"),
                    "icon": prepared_module.get("icon"),
                    "category": prepared_module.get("category"),
                    "enabled": prepared_module.get("enabled", True),
                    "priority": prepared_module.get("priority", 0),
                    "props": prepared_module.get("props"),
                    "config_fields": prepared_module.get("config_fields"),
                    "messages": prepared_module.get("messages"),
                    "required_services": prepared_module.get("required_services"),
                    "dependencies": prepared_module.get("dependencies"),
                    "layout": prepared_module.get("layout"),
                    "tags": prepared_module.get("tags"),
                    "created_at": current_time,
                    "updated_at": current_time,
                    "user_id": user_id
                })

                prepared_modules.append(prepared_module)
                logger.info(f"Created module {prepared_module['name']} for user {user_id}")

            # Handle file copying and directory structure
            await self._setup_plugin_files(user_id, prepared_plugin)

            # Optional: Create default pages that use the plugin modules
            if self.DEFAULT_PAGES:
                await self._create_default_pages(user_id, db, prepared_plugin["id"], prepared_modules)

            await db.commit()
            logger.info(f"BrainDrive Network plugin initialized successfully for user {user_id}")
            return True

        except Exception as e:
            logger.error(f"Error initializing BrainDrive Network plugin for user {user_id}: {e}")
            await db.rollback()
            return False

    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Clean up the plugin and its modules if initialization fails."""
        try:
            logger.info(f"Cleaning up BrainDrive Network plugin for user {user_id}")

            # Delete all modules for this plugin for this user
            module_stmt = text("""
            DELETE FROM module
            WHERE user_id = :user_id AND plugin_id IN (
                SELECT id FROM plugin WHERE user_id = :user_id AND plugin_slug = :plugin_slug
            )
            """)

            await db.execute(module_stmt, {"user_id": user_id, "plugin_slug": "braindrive_network"})

            # Delete plugin
            plugin_stmt = text("""
            DELETE FROM plugin
            WHERE user_id = :user_id AND plugin_slug = :plugin_slug
            """)

            await db.execute(plugin_stmt, {"user_id": user_id, "plugin_slug": "braindrive_network"})

            # Clean up directory structure
            await self._cleanup_plugin_files(user_id)

            # Clean up any pages created by this plugin
            await self._cleanup_plugin_pages(user_id, db)

            await db.commit()
            logger.info(f"BrainDrive Network plugin cleaned up successfully for user {user_id}")
            return True

        except Exception as e:
            logger.error(f"Error cleaning up BrainDrive Network plugin for user {user_id}: {e}")
            await db.rollback()
            return False

    async def _create_default_pages(self, user_id: str, db: AsyncSession, plugin_id: str, modules: list):
        """Create default pages that use the plugin modules"""
        try:
            # Build module lookup for easy access
            module_lookup = {module["name"]: module["id"] for module in modules}

            for page_data in self.DEFAULT_PAGES:
                # Generate unique module IDs for the content JSON
                timestamp_base = int(datetime.datetime.now().timestamp() * 1000)

                # Create page content with plugin modules
                page_content = {
                    "layouts": {
                        "desktop": [],
                        "tablet": [],
                        "mobile": []
                    },
                    "modules": {}
                }

                # Add network status module to the page layout
                y_position = 0
                for i, (module_name, module_id) in enumerate(module_lookup.items()):
                    unique_module_id = f"braindrive_network_{module_id}_{timestamp_base + (i * 1000)}"

                    # Desktop layout
                    page_content["layouts"]["desktop"].append({
                        "moduleUniqueId": unique_module_id,
                        "i": unique_module_id,
                        "x": 0,
                        "y": y_position,
                        "w": 6,
                        "h": 3,
                        "minW": 3,
                        "minH": 2
                    })

                    # Tablet layout
                    page_content["layouts"]["tablet"].append({
                        "moduleUniqueId": unique_module_id,
                        "i": unique_module_id,
                        "x": 0,
                        "y": y_position,
                        "w": 4,
                        "h": 3,
                        "minW": 3,
                        "minH": 2
                    })

                    # Mobile layout
                    page_content["layouts"]["mobile"].append({
                        "moduleUniqueId": unique_module_id,
                        "i": unique_module_id,
                        "x": 0,
                        "y": y_position,
                        "w": 4,
                        "h": 3,
                        "minW": 3,
                        "minH": 2
                    })

                    # Module configuration
                    page_content["modules"][unique_module_id.replace("-", "")] = {
                        "pluginId": "braindrive_network",
                        "moduleId": module_id,
                        "moduleName": module_name,
                        "config": {
                            "moduleId": module_id,
                            "displayName": "Network Status Monitor",
                            "refresh_interval": 30,
                            "show_details": True
                        }
                    }

                    y_position += 3

                # Set the content for this page
                page_data["content"] = page_content

                # Prepare the page data for the new user
                prepared_page = prepare_record_for_new_user(
                    page_data,
                    user_id,
                    preserve_fields=["route"],
                    user_id_field="creator_id"
                )

                # Create the page using direct SQL
                current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                page_stmt = text("""
                INSERT INTO pages
                (id, name, route, content, creator_id, created_at, updated_at, is_published, publish_date)
                VALUES
                (:id, :name, :route, :content, :creator_id, :created_at, :updated_at, :is_published, :publish_date)
                """)

                await db.execute(page_stmt, {
                    "id": prepared_page.get("id", self._generate_uuid()),
                    "name": prepared_page["name"],
                    "route": prepared_page.get("route"),
                    "content": json.dumps(page_content),
                    "creator_id": user_id,
                    "created_at": current_time,
                    "updated_at": current_time,
                    "is_published": 1,
                    "publish_date": current_time
                })

                logger.info(f"Created page {prepared_page['name']} for user {user_id}")

        except Exception as e:
            logger.error(f"Error creating default pages for user {user_id}: {e}")
            raise

    async def _cleanup_plugin_pages(self, user_id: str, db: AsyncSession):
        """Cleanup pages created by this plugin"""
        try:
            # Delete pages that were created by this plugin
            for page_data in self.DEFAULT_PAGES:
                page_stmt = text("""
                DELETE FROM pages
                WHERE creator_id = :user_id AND name = :page_name
                """)

                await db.execute(page_stmt, {
                    "user_id": user_id,
                    "page_name": page_data["name"]
                })

                logger.info(f"Deleted page {page_data['name']} for user {user_id}")

        except Exception as e:
            logger.error(f"Error cleaning up pages for user {user_id}: {e}")

    async def _setup_plugin_files(self, user_id: str, plugin_data: dict):
        """Setup plugin files and directory structure"""
        try:
            # Define paths (following existing pattern)
            plugins_dir = Path(__file__).parent.parent.parent / "plugins"
            user_dir = plugins_dir / user_id
            plugin_dir = user_dir / plugin_data["id"]

            # Create user directory if it doesn't exist
            if not user_dir.exists():
                user_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created user directory: {user_dir}")

            # Create plugin directory if it doesn't exist
            if not plugin_dir.exists():
                plugin_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created plugin directory: {plugin_dir}")

            # Create frontend/dist directory structure
            frontend_dist_dir = plugin_dir / "frontend" / "dist"
            frontend_dist_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created frontend/dist directory: {frontend_dist_dir}")

            # Copy plugin files from the source BrainDriveNetwork plugin
            source_plugin_dir = Path(__file__).parent

            # Copy built files if they exist
            source_dist = source_plugin_dir / "dist"
            if source_dist.exists():
                import shutil
                shutil.copytree(source_dist, frontend_dist_dir, dirs_exist_ok=True)
                logger.info(f"Copied dist files from {source_dist} to {frontend_dist_dir}")
            else:
                # Create a placeholder remoteEntry.js if dist doesn't exist
                remote_entry_path = frontend_dist_dir / "remoteEntry.js"
                if not remote_entry_path.exists():
                    with open(remote_entry_path, 'w') as f:
                        f.write('// BrainDrive Network Plugin Remote Entry\n')
                        f.write('window.braindrive_network = { get: function() { return Promise.resolve(() => ({ default: {} })); } };\n')
                    logger.info(f"Created placeholder remoteEntry.js file at {remote_entry_path}")

            # Create data directory for network monitoring data
            data_dir = plugin_dir / "data"
            data_dir.mkdir(parents=True, exist_ok=True)

            # Create network configuration file
            config_file = data_dir / "network_config.json"
            if not config_file.exists():
                default_config = {
                    "monitoring_targets": [
                        {"name": "Ollama", "url": "https://www.ollama.com", "enabled": True},
                        {"name": "Local Ollama", "url": "http://localhost:11434", "enabled": True}
                    ],
                    "check_interval": 30000,
                    "timeout": 3000,
                    "retry_attempts": 3
                }
                with open(config_file, 'w') as f:
                    json.dump(default_config, f, indent=2)
                logger.info(f"Created network configuration file at {config_file}")

        except Exception as e:
            logger.error(f"Error setting up plugin files: {e}")
            raise

    async def _cleanup_plugin_files(self, user_id: str):
        """Cleanup plugin files and directories"""
        try:
            plugins_dir = Path(__file__).parent.parent.parent / "plugins"
            plugin_id = f"{user_id}_braindrive_network"
            plugin_dir = plugins_dir / user_id / plugin_id

            if plugin_dir.exists():
                import shutil
                shutil.rmtree(plugin_dir)
                logger.info(f"Removed plugin directory: {plugin_dir}")

            # Check if user directory is empty and remove it if it is
            user_dir = plugins_dir / user_id
            if user_dir.exists() and not any(user_dir.iterdir()):
                user_dir.rmdir()
                logger.info(f"Removed empty user directory: {user_dir}")

        except Exception as e:
            logger.error(f"Error cleaning up plugin files: {e}")

    def _generate_uuid(self):
        """Generate a UUID for database records"""
        import uuid
        return str(uuid.uuid4())