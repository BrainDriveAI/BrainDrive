import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

logger = logging.getLogger(__name__)


class SettingsToV060(UserUpdaterBase):
    """Update users from version 0.4.5 to 0.6.0."""

    name = "settings_to_v060"
    description = "Update users to version 0.6.0"
    from_version = "0.4.5"
    to_version = "0.6.0"
    priority = 1200

    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        """Apply the update for the given user."""
        try:
            logger.info("Updating user %s from version 0.4.5 to 0.6.0", user_id)

            # Add migration logic here if needed for 0.6.0
            # Currently this is a no-op version bump.

            logger.info("Successfully updated user %s to version 0.6.0", user_id)
            return True
        except Exception as e:
            logger.error("Error applying SettingsToV060 updater for %s: %s", user_id, e)
            return False


register_updater(SettingsToV060)

