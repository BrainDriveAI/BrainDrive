
"""User updater framework.

This module allows registration of async callbacks that run for a user
whenever they log in. Plugins may register update functions using
``register_user_updater``. The ``run_user_updaters`` function executes
all registered updaters sequentially.

For versioned user data migrations, the ``update_user_data`` function is
exposed which delegates to the registry-based update system.
"""

from typing import Awaitable, Callable, List
from sqlalchemy.ext.asyncio import AsyncSession
import logging

# Expose the versioned updater helpers
from .registry import update_user_data  # noqa: F401
from .discovery import discover_all_updaters

logger = logging.getLogger(__name__)

# List of registered updater callbacks
_user_updaters: List[Callable[[AsyncSession, str], Awaitable[None]]] = []

__all__ = [
    "register_user_updater",
    "run_user_updaters",
    "update_user_data",
    "discover_all_updaters",
]


def register_user_updater(func: Callable[[AsyncSession, str], Awaitable[None]]) -> None:
    """Register a user updater callback."""
    _user_updaters.append(func)


async def run_user_updaters(session: AsyncSession, user_id: str) -> None:
    """Run all registered user updater callbacks for the given user."""
    for updater in _user_updaters:
        try:
            await updater(session, user_id)
        except Exception as exc:
            logger.error("User updater %s failed: %s", getattr(updater, "__name__", str(updater)), exc)


# Automatically discover updaters when this module is imported
discover_all_updaters()


