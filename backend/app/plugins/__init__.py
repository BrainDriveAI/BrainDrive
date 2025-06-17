"""
Enhanced Plugin System

Multi-user plugin lifecycle management with shared storage,
logical references, and optimized resource usage.
"""

from .storage_manager import PluginStorageManager
from .lifecycle_registry import PluginLifecycleRegistry
from .version_manager import PluginVersionManager
from .lifecycle_service import PluginLifecycleService
from .base_lifecycle_manager import BaseLifecycleManager
from .cleanup_service import PluginCleanupService

# For backward compatibility
from .manager import PluginManager

__all__ = [
    'PluginStorageManager',
    'PluginLifecycleRegistry',
    'PluginVersionManager',
    'PluginLifecycleService',
    'BaseLifecycleManager',
    'PluginCleanupService',
    'PluginManager'  # Legacy
]

# Version info
__version__ = '2.0.0'
__description__ = 'Enhanced multi-user plugin lifecycle management system'
