import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

logger = logging.getLogger(__name__)


class TestUpdater(UserUpdaterBase):
    """Dummy updater to verify the user update system."""

    name = "test_updater"
    description = "Dummy updater for testing user update mechanism"
    from_version = "0.0.0"
    to_version = "0.1.0"

    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        logger.info("Running test updater for user %s", user_id)
        print(f"Running test updater for user {user_id}")
        return True


register_updater(TestUpdater)
