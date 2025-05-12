"""
User Initialization Module

This module provides a modular system for initializing data for new users.
Plugins can register their own initialization handlers to extend the system.
"""

from .registry import register_initializer, get_initializers, initialize_user_data
from .base import UserInitializerBase
from .discovery import discover_all_initializers

__all__ = [
    "register_initializer",
    "get_initializers",
    "initialize_user_data",
    "UserInitializerBase",
    "discover_all_initializers",
]

# Automatically discover initializers when the module is imported
discover_all_initializers()