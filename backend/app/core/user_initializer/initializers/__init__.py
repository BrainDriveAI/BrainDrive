"""
User initializer plugins.

This package contains plugins for initializing data for new users.
Each plugin should inherit from UserInitializerBase and register itself.
"""

# Import all initializers to ensure they are registered
from . import settings_initializer
from . import components_initializer
from . import navigation_initializer
from . import pages_initializer
from . import brain_drive_basic_ai_chat_initializer
from . import brain_drive_settings_initializer

# Add more imports as needed when new initializers are created