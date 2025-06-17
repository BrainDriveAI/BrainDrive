#!/usr/bin/env python3
"""
Debug script to check plugin database state
Usage: python debug_plugin_database.py <user_id> [plugin_slug]
"""

import asyncio
import sys
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

# Add backend to path
backend_path = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_path))

from app.core.config import settings

async def check_plugin_database(user_id: str, plugin_slug: str = None):
    """Check the database state for plugins"""

    # Create database connection
    database_url = settings.DATABASE_URL
    # Convert sqlite:// to sqlite+aiosqlite:// for async support
    if database_url.startswith('sqlite://'):
        database_url = database_url.replace('sqlite://', 'sqlite+aiosqlite://')
    engine = create_async_engine(database_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as db:
        print(f"🔍 Checking database state for user: {user_id}")
        print("=" * 60)

        # Check all plugins for this user
        all_plugins_query = text("""
        SELECT id, plugin_slug, name, version, enabled, status, created_at, updated_at
        FROM plugin
        WHERE user_id = :user_id
        ORDER BY plugin_slug, created_at
        """)

        result = await db.execute(all_plugins_query, {'user_id': user_id})
        plugins = result.fetchall()

        if plugins:
            print(f"📦 Found {len(plugins)} plugin(s) for user:")
            for plugin in plugins:
                print(f"  • {plugin.plugin_slug} (v{plugin.version})")
                print(f"    ID: {plugin.id}")
                print(f"    Name: {plugin.name}")
                print(f"    Enabled: {plugin.enabled}")
                print(f"    Status: {plugin.status}")
                print(f"    Created: {plugin.created_at}")
                print(f"    Updated: {plugin.updated_at}")
                print()
        else:
            print(f"❌ No plugins found for user: {user_id}")

        # If specific plugin requested, check modules too
        if plugin_slug:
            print(f"🔍 Checking modules for plugin: {plugin_slug}")
            print("-" * 40)

            modules_query = text("""
            SELECT m.id, m.name, m.display_name, m.enabled, m.priority, m.created_at
            FROM module m
            JOIN plugin p ON m.plugin_id = p.id
            WHERE p.user_id = :user_id AND p.plugin_slug = :plugin_slug
            ORDER BY m.name
            """)

            result = await db.execute(modules_query, {
                'user_id': user_id,
                'plugin_slug': plugin_slug
            })
            modules = result.fetchall()

            if modules:
                print(f"📋 Found {len(modules)} module(s):")
                for module in modules:
                    print(f"  • {module.name} ({module.display_name})")
                    print(f"    ID: {module.id}")
                    print(f"    Enabled: {module.enabled}")
                    print(f"    Priority: {module.priority}")
                    print(f"    Created: {module.created_at}")
                    print()
            else:
                print(f"❌ No modules found for plugin: {plugin_slug}")

        # Check shared directory
        print("📁 Checking shared plugin directory:")
        print("-" * 40)

        shared_dir = Path("backend/plugins/shared")
        if shared_dir.exists():
            for plugin_dir in shared_dir.iterdir():
                if plugin_dir.is_dir():
                    print(f"  📂 {plugin_dir.name}/")
                    for version_dir in plugin_dir.iterdir():
                        if version_dir.is_dir():
                            lifecycle_manager = version_dir / "lifecycle_manager.py"
                            has_lm = "✅" if lifecycle_manager.exists() else "❌"
                            print(f"    📂 {version_dir.name}/ {has_lm}")
        else:
            print("❌ Shared directory not found")

async def main():
    if len(sys.argv) < 2:
        print("Usage: python debug_plugin_database.py <user_id> [plugin_slug]")
        print("Example: python debug_plugin_database.py 1e6e40ac044f451d82ad7e21fce67499")
        print("Example: python debug_plugin_database.py 1e6e40ac044f451d82ad7e21fce67499 BrainDriveNetworkReview")
        return

    user_id = sys.argv[1]
    plugin_slug = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        await check_plugin_database(user_id, plugin_slug)
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())