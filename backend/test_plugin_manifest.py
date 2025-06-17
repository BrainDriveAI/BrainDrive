#!/usr/bin/env python3
"""
Test script to verify that the NetworkEyes plugin appears in the manifest endpoint
"""
import asyncio
import sys
import os

from app.plugins.repository import PluginRepository
from app.core.database import get_db

async def test_plugin_manifest():
    """Test if NetworkEyes plugin appears in the manifest"""
    user_id = "1e6e40ac044f451d82ad7e21fce67499"

    print(f"Testing plugin manifest for user: {user_id}")

    async for db in get_db():
        repo = PluginRepository(db)

        # Get all plugins with modules
        plugins = await repo.get_all_plugins_with_modules(user_id=user_id)

        print(f"\nFound {len(plugins)} plugins:")

        for plugin in plugins:
            print(f"\nPlugin: {plugin['name']} (ID: {plugin['id']})")
            print(f"  Plugin Slug: {plugin.get('plugin_slug')}")
            print(f"  Version: {plugin.get('version')}")
            print(f"  Bundle Location: {plugin.get('bundlelocation')}")
            print(f"  Modules: {len(plugin.get('modules', []))}")

            for module in plugin.get('modules', []):
                print(f"    - {module['name']} ({module['displayName']})")

        # Specifically look for NetworkEyes
        network_eyes = None
        for plugin in plugins:
            if plugin.get('plugin_slug') == 'BrainDriveNetwork':
                network_eyes = plugin
                break

        if network_eyes:
            print(f"\n✅ Found NetworkEyes plugin!")
            print(f"   ID: {network_eyes['id']}")
            print(f"   Name: {network_eyes['name']}")
            print(f"   Bundle Location: {network_eyes.get('bundlelocation')}")
            print(f"   Modules: {len(network_eyes.get('modules', []))}")

            if network_eyes.get('modules'):
                for module in network_eyes['modules']:
                    print(f"     Module: {module['name']}")
                    print(f"       Display Name: {module['displayName']}")
                    print(f"       Category: {module['category']}")
                    print(f"       Tags: {module.get('tags', [])}")
        else:
            print(f"\n❌ NetworkEyes plugin not found in manifest!")
            print("Available plugin slugs:")
            for plugin in plugins:
                print(f"  - {plugin.get('plugin_slug')} ({plugin['name']})")

if __name__ == "__main__":
    asyncio.run(test_plugin_manifest())