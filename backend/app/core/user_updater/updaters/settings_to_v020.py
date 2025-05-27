import logging
import json
from datetime import datetime
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.core.user_updater.base import UserUpdaterBase
from app.core.user_updater.registry import register_updater

logger = logging.getLogger(__name__)


class SettingsToV020(UserUpdaterBase):
    """Update existing users to include the new general settings entry."""

    name = "settings_to_v020"
    description = "Add general settings for existing users"
    from_version = "0.1.0"
    to_version = "0.2.0"
    priority = 900

    GENERAL_DEFINITION = {
        "id": "general_settings",
        "name": "General Settings",
        "description": "Auto-generated definition for General Settings",
        "category": "auto_generated",
        "type": "object",
        "default_value": '{"settings":[{"Setting_Name":"default_page","Setting_Data":"Dashboard","Setting_Help":"This is the first page to be displayed after logging in to BrainDrive"}]}',
        "allowed_scopes": '["system", "user", "page", "user_page"]',
        "validation": None,
        "is_multiple": False,
        "tags": '["auto_generated"]',
    }

    async def _ensure_definition(self, db: AsyncSession) -> None:
        check_stmt = text(
            "SELECT id FROM settings_definitions WHERE id = :id"
        )
        res = await db.execute(check_stmt, {"id": self.GENERAL_DEFINITION["id"]})
        if not res.scalar_one_or_none():
            current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            insert_stmt = text(
                """
                INSERT INTO settings_definitions
                (id, name, description, category, type, default_value, allowed_scopes, validation, is_multiple, tags, created_at, updated_at)
                VALUES
                (:id, :name, :description, :category, :type, :default_value, :allowed_scopes, :validation, :is_multiple, :tags, :created_at, :updated_at)
                """
            )
            await db.execute(
                insert_stmt,
                {
                    **self.GENERAL_DEFINITION,
                    "created_at": current_time,
                    "updated_at": current_time,
                },
            )
            logger.info("Created general settings definition")

    async def apply(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        try:
            await self._ensure_definition(db)

            page_stmt = text(
                "SELECT id FROM pages WHERE name = :name AND creator_id = :uid LIMIT 1"
            )
            result = await db.execute(page_stmt, {"name": "AI Chat", "uid": user_id})
            ai_chat_page_id = result.scalar_one_or_none()

            default_page_value = ai_chat_page_id if ai_chat_page_id else "Dashboard"
            setting_value = json.dumps(
                {
                    "settings": [
                        {
                            "Setting_Name": "default_page",
                            "Setting_Data": default_page_value,
                            "Setting_Help": "This is the first page to be displayed after logging in to BrainDrive",
                        }
                    ]
                }
            )

            check_stmt = text(
                "SELECT id FROM settings_instances WHERE definition_id = :def_id AND user_id = :uid"
            )
            res = await db.execute(check_stmt, {"def_id": "general_settings", "uid": user_id})
            existing = res.scalar_one_or_none()
            if not existing:
                current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                insert_stmt = text(
                    """
                    INSERT INTO settings_instances
                    (id, definition_id, name, value, scope, user_id, page_id, created_at, updated_at)
                    VALUES
                    (:id, :definition_id, :name, :value, :scope, :user_id, :page_id, :created_at, :updated_at)
                    """
                )
                await db.execute(
                    insert_stmt,
                    {
                        "id": kwargs.get("id") or str(uuid4()).replace("-", ""),
                        "definition_id": "general_settings",
                        "name": "General Settings",
                        "value": setting_value,
                        "scope": "user",
                        "user_id": user_id,
                        "page_id": None,
                        "created_at": current_time,
                        "updated_at": current_time,
                    },
                )
                logger.info("Inserted general settings for user %s", user_id)

            # ensure general settings module exists
            plugin_id = f"{user_id}_BrainDriveSettings"
            mod_check = text(
                "SELECT id FROM module WHERE plugin_id = :pid AND name = 'ComponentGeneralSettings' AND user_id = :uid"
            )
            res = await db.execute(mod_check, {"pid": plugin_id, "uid": user_id})
            if not res.scalar_one_or_none():
                current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                insert_mod = text(
                    """
                    INSERT INTO module
                    (id, plugin_id, name, display_name, description, icon, category,
                     enabled, priority, props, config_fields, messages, required_services,
                     dependencies, layout, tags, created_at, updated_at, user_id)
                    VALUES
                    (:id, :plugin_id, :name, :display_name, :description, :icon, :category,
                     :enabled, :priority, :props, :config_fields, :messages, :required_services,
                     :dependencies, :layout, :tags, :created_at, :updated_at, :user_id)
                    """
                )
                await db.execute(
                    insert_mod,
                    {
                        "id": str(uuid4()).replace('-', ''),
                        "plugin_id": plugin_id,
                        "name": "ComponentGeneralSettings",
                        "display_name": "General Settings",
                        "description": "Manage general application settings",
                        "icon": "Settings",
                        "category": "Settings",
                        "enabled": True,
                        "priority": 1,
                        "props": "{}",
                        "config_fields": "{}",
                        "messages": "{\"sends\": [], \"receives\": []}",
                        "required_services": "{\"api\": {\"methods\": [\"get\", \"post\"], \"version\": \"1.0.0\"}, \"theme\": {\"methods\": [\"getCurrentTheme\", \"addThemeChangeListener\", \"removeThemeChangeListener\"], \"version\": \"1.0.0\"}}",
                        "dependencies": "[]",
                        "layout": "{\"minWidth\": 6, \"minHeight\": 1, \"defaultWidth\": 12, \"defaultHeight\": 1}",
                        "tags": "[\"Settings\", \"General Settings\"]",
                        "created_at": current_time,
                        "updated_at": current_time,
                        "user_id": user_id,
                    },
                )
                logger.info("Inserted General Settings module for user %s", user_id)
            return True
        except Exception as e:
            logger.error("Error applying SettingsToV020 updater for %s: %s", user_id, e)
            return False


register_updater(SettingsToV020)

