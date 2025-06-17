#!/usr/bin/env python3
"""Test script to verify plugin path resolution for source plugins"""

from pathlib import Path
import sys
import os

# Add the backend directory to Python path
backend_dir = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_dir))

# Import the lifecycle API
from app.plugins.lifecycle_api import UniversalPluginLifecycleManager

def test_source_plugin_paths():
    print("Testing source plugin path resolution...")

    # Create the manager
    manager = UniversalPluginLifecycleManager()

    # Test plugins that should be in source directory
    source_test_plugins = ["BrainDriveBasicAIChat", "BrainDriveSettings"]

    print(f"\nTesting source plugin directory lookup:")
    for plugin_slug in source_test_plugins:
        plugin_dir = manager._get_plugin_directory(plugin_slug)
        print(f"  - {plugin_slug}: {plugin_dir}")
        if plugin_dir:
            lifecycle_path = plugin_dir / "lifecycle_manager.py"
            print(f"    - Has lifecycle_manager.py: {lifecycle_path.exists()}")

if __name__ == "__main__":
    test_source_plugin_paths()