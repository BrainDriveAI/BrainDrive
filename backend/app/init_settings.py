"""
Initialize settings definitions in the database.
Run this script to create the required settings definitions.
"""
import asyncio
import logging
from app.core.database import get_db
from app.models.settings import SettingDefinition, SettingScope, SettingInstance
from sqlalchemy.ext.asyncio import AsyncSession

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def create_setting_definition(db: AsyncSession, definition_data):
    """Create a setting definition if it doesn't exist."""
    existing = await SettingDefinition.get_by_name(db, definition_data["name"])
    if existing:
        logger.info(f"Setting definition '{definition_data['name']}' already exists.")
        return existing

    definition = SettingDefinition(**definition_data)
    await definition.save(db)
    logger.info(f"Created setting definition: {definition.name}")
    return definition

async def init_settings():
    """Initialize all required settings definitions."""
    db = await anext(get_db())
    
    try:
        # Ollama Server Settings (legacy - keep for backward compatibility)
        await create_setting_definition(db, {
            "id": "ollama_settings",
            "name": "Ollama Server Settings",
            "description": "Settings for connecting to Ollama server",
            "category": "servers",
            "type": "object",
            "default_value": {
                "serverAddress": "http://localhost:11434",
                "serverName": "Default Ollama Server",
                "apiKey": ""
            },
            "allowed_scopes": [SettingScope.USER, SettingScope.SYSTEM],
            "is_multiple": False,
            "tags": ["ollama", "server"]
        })
        
        # Ollama Servers Settings (new format expected by the frontend)
        await create_setting_definition(db, {
            "id": "ollama_servers_settings",
            "name": "Ollama Servers",
            "description": "Configuration for multiple Ollama servers",
            "category": "ai",
            "type": "object",
            "default_value": {
                "servers": [
                    {
                        "id": "server_1538843993_8e87ea7654",
                        "serverName": "Default Ollama Server",
                        "serverAddress": "http://localhost:11434",
                        "apiKey": ""
                    }
                ]
            },
            "allowed_scopes": [SettingScope.USER, SettingScope.SYSTEM],
            "is_multiple": True,
            "tags": ["ollama", "ai", "server"]
        })
        
        # Add more settings definitions here as needed
        
        logger.info("Settings initialization completed successfully.")
    except Exception as e:
        logger.error(f"Error initializing settings: {e}")
    finally:
        await db.close()

async def init_ollama_settings():
    """Initialize Ollama server settings if they don't exist."""
    db = await anext(get_db())
    try:
        # Check if settings definition exists
        definition = await SettingDefinition.get_by_id(db, "ollama_servers_settings")
        if not definition:
            # Create the settings definition
            definition = SettingDefinition(
                id="ollama_servers_settings",
                name="Ollama Servers",
                description="Configuration for Ollama servers",
                category="ai",
                type="object",
                allowed_scopes=[SettingScope.USER],
                is_multiple=True,
                tags=["ollama", "ai"]
            )
            await definition.save(db)
            logger.info("Created Ollama servers settings definition")
            
        # Check if there's a setting instance for the default user
        settings = await SettingInstance.get_all_parameterized(
            db,
            definition_id="ollama_servers_settings",
            scope=SettingScope.USER.value,
            user_id="current"
        )
        
        if not settings or len(settings) == 0:
            # Create a default setting instance
            setting = SettingInstance(
                definition_id="ollama_servers_settings",
                scope=SettingScope.USER.value,
                user_id="current",
                value={
                    "servers": [
                        {
                            "id": "server_1538843993_8e87ea7654",
                            "serverName": "Default Ollama Server",
                            "serverAddress": "http://localhost:11434",
                            "apiKey": ""
                        }
                    ]
                }
            )
            await setting.save(db)
            logger.info("Created default Ollama server settings instance")
        else:
            logger.info("Ollama server settings instance already exists")
            
    except Exception as e:
        logger.error(f"Error initializing Ollama settings: {e}")
    finally:
        await db.close()

if __name__ == "__main__":
    asyncio.run(init_settings())
    asyncio.run(init_ollama_settings())
