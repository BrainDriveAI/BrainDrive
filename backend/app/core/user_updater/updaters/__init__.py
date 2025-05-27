"""User updater plugins."""

# Import updaters here so they register when the package is imported
from .dummy_updater import TestUpdater

__all__ = ["TestUpdater"]
