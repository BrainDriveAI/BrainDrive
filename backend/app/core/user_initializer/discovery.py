"""
Initializer discovery module.

This module discovers and loads all user initializer plugins.
"""

import logging
import importlib
import pkgutil
from typing import List, Dict, Type

from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import get_initializers, discover_initializers

logger = logging.getLogger(__name__)

def discover_all_initializers() -> Dict[str, Type[UserInitializerBase]]:
    """
    Discover and load all initializer plugins.
    
    This function:
    1. Discovers core initializers in app.core.user_initializer.initializers
    2. Discovers plugin initializers in app.plugins.*
    
    Returns:
        Dict[str, Type[UserInitializerBase]]: Dictionary of initializer name to class
    """
    logger.info("Discovering user initializer plugins...")
    
    # Discover core initializers
    logger.info("Discovering core initializers in app.core.user_initializer.initializers")
    discover_initializers("app.core.user_initializer.initializers")
    
    # Discover plugin initializers
    try:
        # Import the plugins package
        import app.plugins
        
        # Get all plugin packages
        for _, name, is_pkg in pkgutil.iter_modules(app.plugins.__path__, app.plugins.__name__ + "."):
            if is_pkg:
                # Try to import the plugin's user_initializer module
                try:
                    importlib.import_module(f"{name}.user_initializer")
                    logger.info(f"Imported initializer from plugin: {name}")
                except ImportError:
                    # Plugin doesn't have a user_initializer module, that's fine
                    pass
                except Exception as e:
                    logger.error(f"Error importing initializer from plugin {name}: {e}")
    except Exception as e:
        logger.error(f"Error discovering plugin initializers: {e}")
    
    # Get all registered initializers
    initializers = get_initializers()
    logger.info(f"Discovered {len(initializers)} initializer plugins")
    
    if len(initializers) == 0:
        logger.warning("No initializers were discovered! Check imports and registrations.")
    
    for name, initializer_class in initializers.items():
        logger.info(f"  - {name} (priority: {initializer_class.priority}, dependencies: {initializer_class.dependencies})")
    
    return initializers