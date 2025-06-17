#!/usr/bin/env python3
"""Test script to verify plugin path resolution"""

from pathlib import Path
import sys
import os

# Add the backend directory to Python path
backend_dir = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_dir))

# Import the lifecycle API
from app.plugins.lifecycle_api import UniversalPluginLifecycleManager

def test_plugin_paths():
    print("Testing plugin path resolution...")

    # Create the manager
    manager = UniversalPluginLifecycleManager()

    print(f"Base plugins directory: {manager.plugins_base_dir}")
    print(f"Directory exists: {manager.plugins_base_dir.exists()}")

    if manager.plugins_base_dir.exists():
        print("\nContents of plugins directory:")
        for item in manager.plugins_base_dir.iterdir():
            if item.is_dir():
                print(f"  - {item.name}/")

    # Test shared directory
    shared_dir = manager.plugins_base_dir / "shared"
    print(f"\nShared directory: {shared_dir}")
    print(f"Shared directory exists: {shared_dir.exists()}")

    if shared_dir.exists():
        print("\nContents of shared directory:")
        for item in shared_dir.iterdir():
            if item.is_dir():
                print(f"  - {item.name}/")
                # Check for version directories
                for version_dir in item.iterdir():
                    if version_dir.is_dir() and version_dir.name.startswith('v'):
                        lifecycle_path = version_dir / "lifecycle_manager.py"
                        print(f"    - {version_dir.name}/ (lifecycle_manager.py: {lifecycle_path.exists()})")

    # Test specific plugin lookups
    test_plugins = ["BrainDriveChat", "BrainDriveNetwork", "BrainDriveNetworkReview"]

    print(f"\nTesting plugin directory lookup:")
    for plugin_slug in test_plugins:
        plugin_dir = manager._get_plugin_directory(plugin_slug)
        print(f"  - {plugin_slug}: {plugin_dir}")

if __name__ == "__main__":
    test_plugin_paths()