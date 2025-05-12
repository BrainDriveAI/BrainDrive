#!/usr/bin/env python3
"""
Migration script to move plugin data from JSON files to SQLite database.
This script reads all plugin.json files from the plugins directory and
inserts the data into the SQLite database using SQLAlchemy models.
"""

import json
import os
import sys
import asyncio
from pathlib import Path
import argparse
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import db_factory
from app.models.plugin import Plugin, Module
from app.plugins.repository import PluginRepository

logger = structlog.get_logger()

async def load_plugin_json(plugin_dir: Path) -> dict:
    """Load plugin configuration from plugin.json file."""
    config_path = plugin_dir / "plugin.json"
    if not config_path.exists():
        logger.warning(f"No plugin.json found in {plugin_dir}")
        return None
    
    try:
        with open(config_path) as f:
            config = json.load(f)
        
        # Set default values if not present
        if "id" not in config:
            config["id"] = plugin_dir.name
            
        return config
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing plugin.json in {plugin_dir}: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Error loading plugin.json in {plugin_dir}: {str(e)}")
        return None

async def migrate_plugins(plugins_dir: Path, dry_run: bool = False) -> bool:
    """
    Migrate all plugins from JSON files to SQLite database.
    
    Args:
        plugins_dir: Path to the plugins directory
        dry_run: If True, don't actually insert data into the database
        
    Returns:
        bool: True if migration was successful, False otherwise
    """
    try:
        # Track statistics
        stats = {
            "total_plugins": 0,
            "migrated_plugins": 0,
            "failed_plugins": 0,
            "total_modules": 0,
            "migrated_modules": 0,
            "failed_modules": 0
        }
        
        # Create database session
        if not dry_run:
            db = db_factory.session_factory()
            repo = PluginRepository(db)
        
        # Process each plugin directory
        for plugin_dir in plugins_dir.iterdir():
            if not plugin_dir.is_dir() or plugin_dir.name.startswith('.') or plugin_dir.name == 'static':
                continue
            
            stats["total_plugins"] += 1
            logger.info(f"Processing plugin directory: {plugin_dir.name}")
            
            # Load plugin configuration
            plugin_config = await load_plugin_json(plugin_dir)
            if not plugin_config:
                stats["failed_plugins"] += 1
                continue
            
            # Count modules
            modules = plugin_config.get("modules", [])
            stats["total_modules"] += len(modules)
            
            # Insert plugin into database
            try:
                if not dry_run:
                    plugin_id = await repo.insert_plugin(plugin_config)
                    logger.info(f"Migrated plugin: {plugin_id}")
                else:
                    logger.info(f"Would migrate plugin: {plugin_config.get('id', plugin_dir.name)}")
                
                stats["migrated_plugins"] += 1
                stats["migrated_modules"] += len(modules)
            except Exception as e:
                logger.error(f"Error migrating plugin {plugin_dir.name}: {str(e)}")
                stats["failed_plugins"] += 1
                stats["failed_modules"] += len(modules)
        
        # Print migration statistics
        logger.info("Migration completed")
        logger.info(f"Total plugins: {stats['total_plugins']}")
        logger.info(f"Migrated plugins: {stats['migrated_plugins']}")
        logger.info(f"Failed plugins: {stats['failed_plugins']}")
        logger.info(f"Total modules: {stats['total_modules']}")
        logger.info(f"Migrated modules: {stats['migrated_modules']}")
        logger.info(f"Failed modules: {stats['failed_modules']}")
        
        # Close database connection
        if not dry_run:
            await db.close()
        
        return stats["failed_plugins"] == 0
    except Exception as e:
        logger.error(f"Error during migration: {str(e)}")
        return False

async def validate_migration(plugins_dir: Path) -> bool:
    """
    Validate that all plugins were correctly migrated to the database.
    
    Args:
        plugins_dir: Path to the plugins directory
        
    Returns:
        bool: True if validation was successful, False otherwise
    """
    try:
        # Create database session
        db = db_factory.session_factory()
        repo = PluginRepository(db)
        
        # Get all plugins from database
        db_plugins = {p["id"]: p for p in await repo.get_all_plugins_with_modules()}
        
        # Track validation statistics
        stats = {
            "total_plugins": 0,
            "validated_plugins": 0,
            "failed_plugins": 0,
            "total_modules": 0,
            "validated_modules": 0,
            "failed_modules": 0
        }
        
        # Process each plugin directory
        for plugin_dir in plugins_dir.iterdir():
            if not plugin_dir.is_dir() or plugin_dir.name.startswith('.') or plugin_dir.name == 'static':
                continue
            
            stats["total_plugins"] += 1
            logger.info(f"Validating plugin: {plugin_dir.name}")
            
            # Load plugin configuration
            plugin_config = await load_plugin_json(plugin_dir)
            if not plugin_config:
                stats["failed_plugins"] += 1
                continue
            
            plugin_id = plugin_config.get("id", plugin_dir.name)
            
            # Check if plugin exists in database
            if plugin_id not in db_plugins:
                logger.error(f"Plugin {plugin_id} not found in database")
                stats["failed_plugins"] += 1
                continue
            
            # Compare plugin data
            db_plugin = db_plugins[plugin_id]
            
            # Basic validation of key fields
            validation_errors = []
            
            for field in ["name", "description", "version", "type"]:
                if plugin_config.get(field) != db_plugin.get(field):
                    validation_errors.append(
                        f"Field '{field}' mismatch: "
                        f"JSON: {plugin_config.get(field)}, "
                        f"DB: {db_plugin.get(field)}"
                    )
            
            # Validate modules
            json_modules = {m["id"]: m for m in plugin_config.get("modules", [])}
            db_modules = {m["id"]: m for m in db_plugin.get("modules", [])}
            
            stats["total_modules"] += len(json_modules)
            
            # Check if all modules exist in database
            for module_id, json_module in json_modules.items():
                if module_id not in db_modules:
                    validation_errors.append(f"Module {module_id} not found in database")
                    stats["failed_modules"] += 1
                    continue
                
                # Basic validation of key module fields
                db_module = db_modules[module_id]
                for field in ["name", "description", "enabled"]:
                    if json_module.get(field) != db_module.get(field):
                        validation_errors.append(
                            f"Module {module_id} field '{field}' mismatch: "
                            f"JSON: {json_module.get(field)}, "
                            f"DB: {db_module.get(field)}"
                        )
                
                stats["validated_modules"] += 1
            
            # Report validation results
            if validation_errors:
                logger.error(f"Validation errors for plugin {plugin_id}:")
                for error in validation_errors:
                    logger.error(f"  - {error}")
                stats["failed_plugins"] += 1
            else:
                logger.info(f"Plugin {plugin_id} validated successfully")
                stats["validated_plugins"] += 1
        
        # Print validation statistics
        logger.info("Validation completed")
        logger.info(f"Total plugins: {stats['total_plugins']}")
        logger.info(f"Validated plugins: {stats['validated_plugins']}")
        logger.info(f"Failed plugins: {stats['failed_plugins']}")
        logger.info(f"Total modules: {stats['total_modules']}")
        logger.info(f"Validated modules: {stats['validated_modules']}")
        logger.info(f"Failed modules: {stats['failed_modules']}")
        
        # Close database connection
        await db.close()
        
        return stats["failed_plugins"] == 0
    except Exception as e:
        logger.error(f"Error during validation: {str(e)}")
        return False

async def main_async():
    """Async main entry point for the migration script."""
    parser = argparse.ArgumentParser(description="Migrate plugins from JSON files to SQLite database")
    parser.add_argument("--plugins-dir", type=str, required=True, help="Path to the plugins directory")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually insert data into the database")
    parser.add_argument("--validate", action="store_true", help="Validate migration after completion")
    
    args = parser.parse_args()
    
    plugins_dir = Path(args.plugins_dir)
    if not plugins_dir.exists() or not plugins_dir.is_dir():
        logger.error(f"Plugins directory not found: {args.plugins_dir}")
        return 1
    
    # Migrate plugins
    success = await migrate_plugins(plugins_dir, args.dry_run)
    
    # Validate migration if requested
    if success and args.validate and not args.dry_run:
        success = await validate_migration(plugins_dir)
    
    return 0 if success else 1

def main():
    """Main entry point for the migration script."""
    try:
        exit_code = asyncio.run(main_async())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        logger.info("Migration interrupted by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"Unhandled exception: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
