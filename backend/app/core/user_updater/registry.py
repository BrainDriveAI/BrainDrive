"""Registry for user updater plugins."""

import logging
from typing import Dict, Type, List
from sqlalchemy.ext.asyncio import AsyncSession

from .base import UserUpdaterBase

logger = logging.getLogger(__name__)

_updaters: Dict[str, Type[UserUpdaterBase]] = {}


def register_updater(updater_class: Type[UserUpdaterBase]) -> None:
    """Register a user updater plugin."""
    name = updater_class.name
    if name in _updaters:
        logger.warning(f"Updater '{name}' already registered. Overwriting.")
    _updaters[name] = updater_class
    logger.info(f"Registered updater: {name}")


def get_updaters() -> Dict[str, Type[UserUpdaterBase]]:
    return _updaters


def _parse_version(version: str) -> List[int]:
    return [int(part) for part in version.split(".")]


def _sort_updaters() -> List[Type[UserUpdaterBase]]:
    return sorted(
        _updaters.values(),
        key=lambda cls: (_parse_version(cls.from_version), cls.priority),
    )


async def update_user_data(user, db: AsyncSession, **kwargs) -> bool:
    """Run pending user update steps for the given user."""
    if not _updaters:
        return True

    current_version = user.version or "0.0.0"
    for updater_cls in _sort_updaters():
        if _parse_version(current_version) != _parse_version(updater_cls.from_version):
            continue
        updater = updater_cls()
        try:
            # If the session already has an active transaction (e.g. due to a
            # previous SELECT statement), ``db.begin()`` would raise an error.
            # ``begin_nested()`` works both when a transaction is active and
            # when it isn't, so choose it in that case.
            begin_ctx = db.begin_nested() if db.in_transaction() else db.begin()
            async with begin_ctx:
                success = await updater.apply(user.id, db, **kwargs)
                if not success:
                    raise Exception(f"Updater {updater.name} failed")
                user.version = updater_cls.to_version
                db.add(user)
        except Exception as e:
            logger.error(f"Error applying updater {updater.name}: {e}")
            try:
                await updater.rollback(user.id, db, **kwargs)
            except Exception as rollback_error:
                logger.error(
                    f"Error during rollback of {updater.name}: {rollback_error}"
                )
            return False
        await db.refresh(user)
        current_version = user.version
    return True
