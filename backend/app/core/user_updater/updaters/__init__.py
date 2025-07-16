"""User updater plugins."""

# Import updaters here so they register when the package is imported
from .dummy_updater import TestUpdater
from .settings_to_v020 import SettingsToV020
from .settings_to_v041 import SettingsToV041

__all__ = ["TestUpdater", "SettingsToV020", "SettingsToV041"]
