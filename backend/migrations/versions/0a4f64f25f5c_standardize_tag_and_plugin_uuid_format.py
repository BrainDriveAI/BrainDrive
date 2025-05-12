"""standardize_tag_and_plugin_uuid_format

Revision ID: 0a4f64f25f5c
Revises: fcba819d216c
Create Date: 2025-04-29 07:49:00.710915

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '0a4f64f25f5c'
down_revision: Union[str, None] = 'fcba819d216c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Disable foreign key constraints for SQLite
    op.execute('PRAGMA foreign_keys = OFF;')
    
    # Create a connection to execute raw SQL
    connection = op.get_bind()
    
    # ==================== Tag Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE tags_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            name VARCHAR(50) NOT NULL,
            color VARCHAR(7),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO tags_new (id, user_id, name, color, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(user_id, '-', ''),
            name,
            color,
            created_at,
            updated_at
        FROM tags;
    """)
    
    # ==================== ConversationTag Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE conversation_tags_new (
            conversation_id VARCHAR(32) NOT NULL,
            tag_id VARCHAR(32) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (conversation_id, tag_id)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO conversation_tags_new (conversation_id, tag_id, created_at)
        SELECT
            REPLACE(conversation_id, '-', ''),
            REPLACE(tag_id, '-', ''),
            created_at
        FROM conversation_tags;
    """)
    
    # ==================== Plugin Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE plugin_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            plugin_slug VARCHAR NOT NULL,
            name VARCHAR NOT NULL,
            description VARCHAR NOT NULL,
            version VARCHAR NOT NULL,
            type VARCHAR DEFAULT 'frontend',
            enabled BOOLEAN DEFAULT TRUE,
            icon VARCHAR,
            category VARCHAR,
            status VARCHAR DEFAULT 'activated',
            official BOOLEAN DEFAULT TRUE,
            author VARCHAR DEFAULT 'BrainDrive Team',
            last_updated VARCHAR,
            compatibility VARCHAR DEFAULT '1.0.0',
            downloads INTEGER DEFAULT 0,
            scope VARCHAR,
            bundle_method VARCHAR,
            bundle_location VARCHAR,
            is_local BOOLEAN DEFAULT FALSE,
            long_description TEXT,
            config_fields TEXT,
            messages TEXT,
            dependencies TEXT,
            created_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
            updated_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
            user_id VARCHAR(32) NOT NULL,
            UNIQUE (user_id, plugin_slug)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO plugin_new (
            id, plugin_slug, name, description, version, type, enabled, icon, category,
            status, official, author, last_updated, compatibility, downloads, scope,
            bundle_method, bundle_location, is_local, long_description, config_fields,
            messages, dependencies, created_at, updated_at, user_id
        )
        SELECT
            REPLACE(id, '-', ''),
            plugin_slug,
            name,
            description,
            version,
            type,
            enabled,
            icon,
            category,
            status,
            official,
            author,
            last_updated,
            compatibility,
            downloads,
            scope,
            bundle_method,
            bundle_location,
            is_local,
            long_description,
            config_fields,
            messages,
            dependencies,
            created_at,
            updated_at,
            REPLACE(user_id, '-', '')
        FROM plugin;
    """)
    
    # ==================== Module Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE module_new (
            id VARCHAR(32) NOT NULL,
            plugin_id VARCHAR(32) NOT NULL,
            name VARCHAR NOT NULL,
            display_name VARCHAR,
            description VARCHAR,
            icon VARCHAR,
            category VARCHAR,
            enabled BOOLEAN DEFAULT TRUE,
            priority INTEGER DEFAULT 0,
            props TEXT,
            config_fields TEXT,
            messages TEXT,
            required_services TEXT,
            dependencies TEXT,
            layout TEXT,
            tags TEXT,
            created_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
            updated_at VARCHAR DEFAULT CURRENT_TIMESTAMP,
            user_id VARCHAR(32) NOT NULL,
            PRIMARY KEY (id, plugin_id)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO module_new (
            id, plugin_id, name, display_name, description, icon, category, enabled,
            priority, props, config_fields, messages, required_services, dependencies,
            layout, tags, created_at, updated_at, user_id
        )
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(plugin_id, '-', ''),
            name,
            display_name,
            description,
            icon,
            category,
            enabled,
            priority,
            props,
            config_fields,
            messages,
            required_services,
            dependencies,
            layout,
            tags,
            created_at,
            updated_at,
            REPLACE(user_id, '-', '')
        FROM module;
    """)
    
    # ==================== Drop old tables and rename new ones ====================
    # Drop old tables
    op.execute("DROP TABLE module;")
    op.execute("DROP TABLE plugin;")
    op.execute("DROP TABLE conversation_tags;")
    op.execute("DROP TABLE tags;")
    
    # Rename new tables to original names
    op.execute("ALTER TABLE module_new RENAME TO module;")
    op.execute("ALTER TABLE plugin_new RENAME TO plugin;")
    op.execute("ALTER TABLE conversation_tags_new RENAME TO conversation_tags;")
    op.execute("ALTER TABLE tags_new RENAME TO tags;")
    
    # ==================== Create indexes and foreign keys ====================
    # Create indexes for foreign keys
    op.execute("CREATE INDEX ix_tags_user_id ON tags (user_id);")
    op.execute("CREATE INDEX ix_conversation_tags_conversation_id ON conversation_tags (conversation_id);")
    op.execute("CREATE INDEX ix_conversation_tags_tag_id ON conversation_tags (tag_id);")
    op.execute("CREATE INDEX ix_plugin_user_id ON plugin (user_id);")
    op.execute("CREATE INDEX ix_module_plugin_id ON module (plugin_id);")
    op.execute("CREATE INDEX ix_module_user_id ON module (user_id);")
    
    # Re-enable foreign key constraints
    op.execute('PRAGMA foreign_keys = ON;')


def downgrade() -> None:
    # This is a complex migration to revert, as it would require converting string IDs back to UUIDs
    # For simplicity, we'll just note that a backup should be made before running the upgrade
    pass
