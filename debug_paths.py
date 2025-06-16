#!/usr/bin/env python3
"""
Debug script to test path construction for plugin file serving
"""
from pathlib import Path

# Simulate the router's path construction
PLUGINS_DIR = Path(__file__).parent / "backend" / "app" / "routers" / ".." / ".." / ".." / "plugins"
PLUGINS_DIR = PLUGINS_DIR.resolve()

print(f"PLUGINS_DIR: {PLUGINS_DIR}")

# Test the path construction I implemented
plugin_slug = "BrainDriveNetwork"
plugin_version = "1.0.10"
path = "dist/remoteEntry.js"

# My current implementation
shared_plugin_dir = PLUGINS_DIR.parent / "backend" / "backend" / "plugins" / "shared" / plugin_slug / f"v{plugin_version}"
full_path = shared_plugin_dir / path

print(f"Constructed path: {full_path}")
print(f"Path exists: {full_path.exists()}")

# Let's also check the actual file location
actual_path = Path("./backend/backend/plugins/shared/BrainDriveNetwork/v1.0.10/dist/remoteEntry.js")
print(f"Actual path: {actual_path.resolve()}")
print(f"Actual path exists: {actual_path.exists()}")

# Let's see what the correct construction should be
correct_path = Path(__file__).parent / "backend" / "backend" / "plugins" / "shared" / plugin_slug / f"v{plugin_version}" / path
print(f"Correct path: {correct_path.resolve()}")
print(f"Correct path exists: {correct_path.exists()}")