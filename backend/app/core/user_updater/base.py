"""Base class for user update steps."""

import abc
import logging
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

class UserUpdaterBase(abc.ABC):
    """Base class for user updater plugins."""

    name: str = "base_updater"
    description: str = "Base updater class"
    priority: int = 100
    dependencies: List[str] = []
    from_version: str = "0.0.0"
    to_version: str = "0.0.0"

    def __init__(self) -> None:
        self.logger = logging.getLogger(f"{__name__}.{self.name}")

    @abc.abstractmethod
    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Apply the update for the given user."""
        pass

    async def rollback(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Rollback the update if something fails."""
        return True
