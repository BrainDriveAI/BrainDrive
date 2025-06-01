"""Discovery utilities for user updater plugins."""

import logging
import importlib
import pkgutil
from typing import Dict, Type

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import get_updaters, register_updater

logger = logging.getLogger(__name__)


def discover_updaters(package_name: str) -> None:
    """Discover and import updaters from a package."""
    try:
        package = importlib.import_module(package_name)
        modules = list(pkgutil.iter_modules(package.__path__, package.__name__ + "."))
        for _, name, is_pkg in modules:
            try:
                importlib.import_module(name)
                if is_pkg:
                    discover_updaters(name)
            except Exception as e:
                logger.error(f"Error importing updater module {name}: {e}")
    except Exception as e:
        logger.error(f"Error discovering updaters in {package_name}: {e}")


def discover_all_updaters() -> Dict[str, Type[UserUpdaterBase]]:
    logger.info("Discovering user updaters...")
    discover_updaters("app.core.user_updater.updaters")
    try:
        import app.plugins
        for _, name, is_pkg in pkgutil.iter_modules(app.plugins.__path__, app.plugins.__name__ + "."):
            if is_pkg:
                try:
                    importlib.import_module(f"{name}.user_updater")
                except ImportError:
                    pass
                except Exception as e:
                    logger.error(f"Error importing updater from plugin {name}: {e}")
    except Exception as e:
        logger.error(f"Error discovering plugin updaters: {e}")
    updaters = get_updaters()
    for name, cls in updaters.items():
        logger.info(f"  - {name} (from {cls.from_version} to {cls.to_version})")
    return updaters
