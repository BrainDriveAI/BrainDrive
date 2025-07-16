#!/usr/bin/env python3
"""
BrainDrive Network Plugin Installation Script
This script handles plugin-specific installation tasks for the BrainDrive Network plugin.
"""

import json
import os
import sys
from pathlib import Path

class BrainDriveNetworkInstaller:
    def __init__(self, user_id: str, plugin_dir: str, db_session=None):
        self.user_id = user_id
        self.plugin_dir = Path(plugin_dir)
        self.db = db_session
        self.manifest = self.load_manifest()

    def load_manifest(self):
        """Load plugin manifest from package.json"""
        package_path = self.plugin_dir / "package.json"
        if not package_path.exists():
            raise FileNotFoundError("package.json not found")

        with open(package_path, 'r') as f:
            package_data = json.load(f)

        # Extract BrainDrive configuration from package.json
        braindrive_config = package_data.get('braindrive', {})

        # Create manifest-like structure from package.json
        manifest = {
            'name': package_data.get('name', 'BrainDrive Network'),
            'version': package_data.get('version', '1.0.0'),
            'description': package_data.get('description', 'Network status monitoring for BrainDrive'),
            'permissions': braindrive_config.get('permissions', ['network.read']),
            'type': braindrive_config.get('pluginType', 'frontend'),
            'category': braindrive_config.get('category', 'monitoring')
        }

        return manifest

    def install(self):
        """Main installation method"""
        print(f"Installing {self.manifest['name']} for user {self.user_id}")

        try:
            self.create_database_entries()
            self.setup_permissions()
            self.initialize_plugin_data()
            self.setup_network_monitoring()
            self.post_install_cleanup()

            print("Installation completed successfully!")
            return True

        except Exception as e:
            print(f"Installation failed: {e}")
            self.cleanup_on_failure()
            return False

    def create_database_entries(self):
        """Create necessary database entries"""
        # This will be called by the BrainDrive plugin installer
        # Plugin-specific database setup can be added here
        print("Creating database entries for BrainDrive Network plugin...")
        pass

    def setup_permissions(self):
        """Setup plugin permissions"""
        permissions = self.manifest.get('permissions', [])
        print(f"Setting up permissions: {permissions}")

        # Network monitoring requires network access permissions
        required_permissions = ['network.read', 'storage.read', 'storage.write']
        for permission in required_permissions:
            if permission not in permissions:
                permissions.append(permission)

        print(f"Final permissions: {permissions}")

    def initialize_plugin_data(self):
        """Initialize plugin-specific data"""
        print("Initializing BrainDrive Network plugin data...")

        # Create any necessary data files or configurations
        data_dir = self.plugin_dir / "data"
        data_dir.mkdir(exist_ok=True)

        # Initialize default network monitoring configuration
        config_file = data_dir / "network_config.json"
        if not config_file.exists():
            default_config = {
                "initialized": True,
                "version": self.manifest["version"],
                "user_id": self.user_id,
                "monitoring_targets": [
                    {
                        "name": "Ollama",
                        "url": "https://www.ollama.com",
                        "enabled": True,
                        "timeout": 3000
                    },
                    {
                        "name": "Local Ollama",
                        "url": "http://localhost:11434",
                        "enabled": True,
                        "timeout": 3000
                    }
                ],
                "check_interval": 30000,  # 30 seconds
                "retry_attempts": 3,
                "notification_enabled": True
            }
            with open(config_file, 'w') as f:
                json.dump(default_config, f, indent=2)
            print(f"Created network configuration file: {config_file}")

    def setup_network_monitoring(self):
        """Setup network monitoring specific configurations"""
        print("Setting up network monitoring configurations...")

        # Create monitoring logs directory
        logs_dir = self.plugin_dir / "data" / "logs"
        logs_dir.mkdir(exist_ok=True)

        # Create initial log file
        log_file = logs_dir / "network_status.log"
        if not log_file.exists():
            with open(log_file, 'w') as f:
                f.write(f"# BrainDrive Network Status Log - User: {self.user_id}\n")
                f.write(f"# Initialized: {self._get_current_timestamp()}\n")
            print(f"Created network status log: {log_file}")

        # Create cache directory for network status
        cache_dir = self.plugin_dir / "data" / "cache"
        cache_dir.mkdir(exist_ok=True)
        print(f"Created cache directory: {cache_dir}")

    def post_install_cleanup(self):
        """Cleanup after installation"""
        print("Performing post-installation cleanup...")

        # Remove any temporary files
        temp_dir = self.plugin_dir / "temp"
        if temp_dir.exists():
            import shutil
            shutil.rmtree(temp_dir)
            print("Removed temporary files")

        # Ensure proper permissions on data directory
        data_dir = self.plugin_dir / "data"
        if data_dir.exists():
            # Set appropriate permissions (readable/writable by user)
            os.chmod(data_dir, 0o755)
            print("Set proper permissions on data directory")

    def cleanup_on_failure(self):
        """Cleanup on installation failure"""
        print("Cleaning up after installation failure...")

        # Remove any partially created files
        data_dir = self.plugin_dir / "data"
        if data_dir.exists():
            import shutil
            shutil.rmtree(data_dir)
            print("Removed partially created data directory")

    def _get_current_timestamp(self):
        """Get current timestamp in ISO format"""
        from datetime import datetime
        return datetime.now().isoformat()

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: install.py <user_id> <plugin_dir>")
        print("Example: install.py user123 /path/to/plugin/directory")
        sys.exit(1)

    user_id = sys.argv[1]
    plugin_dir = sys.argv[2]

    print(f"Starting BrainDrive Network plugin installation...")
    print(f"User ID: {user_id}")
    print(f"Plugin Directory: {plugin_dir}")

    installer = BrainDriveNetworkInstaller(user_id, plugin_dir)
    success = installer.install()

    if success:
        print("🎉 BrainDrive Network plugin installed successfully!")
    else:
        print("❌ BrainDrive Network plugin installation failed!")

    sys.exit(0 if success else 1)