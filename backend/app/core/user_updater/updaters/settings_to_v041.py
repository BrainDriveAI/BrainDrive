import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

logger = logging.getLogger(__name__)


class SettingsToV041(UserUpdaterBase):
    """Update users from version 0.2.0 to 0.4.1."""

    name = "settings_to_v041"
    description = "Update users to version 0.4.1"
    from_version = "0.2.0"
    to_version = "0.4.1"
    priority = 1000

    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Apply the update for the given user."""
        try:
            logger.info("Updating user %s from version 0.2.0 to 0.4.1", user_id)
            
            # Add any specific migration logic here if needed
            # For now, this is just a version bump
            
            logger.info("Successfully updated user %s to version 0.4.1", user_id)
            return True
        except Exception as e:
            logger.error("Error applying SettingsToV041 updater for %s: %s", user_id, e)
            return False


register_updater(SettingsToV041)