"""standardize_uuid_format

Revision ID: f0bc573ed538
Revises: b059e76c411a
Create Date: 2025-04-28 16:51:10.138682

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'f0bc573ed538'
down_revision: Union[str, None] = 'b059e76c411a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Disable foreign key constraints for SQLite
    op.execute('PRAGMA foreign_keys = OFF;')
    
    # Create a connection to execute raw SQL
    connection = op.get_bind()
    
    # ==================== Tenant Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE tenants_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            sso_domain VARCHAR(100),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation (remove dashes from UUIDs)
    op.execute("""
        INSERT INTO tenants_new (id, name, description, sso_domain, created_at, updated_at)
        SELECT REPLACE(id, '-', ''), name, description, sso_domain, created_at, updated_at
        FROM tenants;
    """)
    
    # ==================== UserRole Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE user_roles_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            role_name VARCHAR(50) NOT NULL,
            description VARCHAR,
            is_global BOOLEAN DEFAULT FALSE
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO user_roles_new (id, role_name, description, is_global)
        SELECT REPLACE(id, '-', ''), role_name, description, is_global
        FROM user_roles;
    """)
    
    # ==================== RolePermission Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE role_permissions_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            role_id VARCHAR(32) NOT NULL,
            permission_name VARCHAR(100) NOT NULL,
            UNIQUE (role_id, permission_name)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO role_permissions_new (id, role_id, permission_name)
        SELECT REPLACE(id, '-', ''), REPLACE(role_id, '-', ''), permission_name
        FROM role_permissions;
    """)
    
    # ==================== TenantUser Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE tenant_users_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            tenant_id VARCHAR(32) NOT NULL,
            user_id VARCHAR(32) NOT NULL,
            role_id VARCHAR(32) NOT NULL,
            is_owner BOOLEAN DEFAULT FALSE,
            UNIQUE (tenant_id, user_id)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO tenant_users_new (id, tenant_id, user_id, role_id, is_owner)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(tenant_id, '-', ''),
            REPLACE(user_id, '-', ''),
            REPLACE(role_id, '-', ''),
            is_owner
        FROM tenant_users;
    """)
    
    # ==================== Session Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE sessions_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            session_token VARCHAR NOT NULL,
            active_tenant_id VARCHAR(32),
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO sessions_new (id, user_id, session_token, active_tenant_id, expires_at, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(user_id, '-', ''),
            session_token,
            REPLACE(active_tenant_id, '-', ''),
            expires_at,
            created_at,
            updated_at
        FROM sessions;
    """)
    
    # ==================== OAuthAccount Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE oauth_accounts_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            provider_user_id VARCHAR NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            UNIQUE (provider_user_id)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO oauth_accounts_new (id, user_id, provider, provider_user_id, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(user_id, '-', ''),
            provider,
            provider_user_id,
            created_at,
            updated_at
        FROM oauth_accounts;
    """)
    
    # ==================== User Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE users_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            username VARCHAR(50) NOT NULL,
            email VARCHAR(100) NOT NULL,
            hashed_password TEXT NOT NULL,
            full_name VARCHAR(100),
            profile_picture TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            is_verified BOOLEAN DEFAULT FALSE,
            refresh_token TEXT,
            refresh_token_expires TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            UNIQUE (username),
            UNIQUE (email)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO users_new (id, username, email, hashed_password, full_name, profile_picture,
                              is_active, is_verified, refresh_token, refresh_token_expires,
                              created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            username,
            email,
            hashed_password,
            full_name,
            profile_picture,
            is_active,
            is_verified,
            refresh_token,
            refresh_token_expires,
            created_at,
            updated_at
        FROM users;
    """)
    
    # ==================== Component Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE components_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            component_id VARCHAR(100) NOT NULL,
            description TEXT,
            icon VARCHAR(50),
            is_system BOOLEAN DEFAULT FALSE,
            user_id VARCHAR(32) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            UNIQUE (component_id, user_id)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO components_new (id, name, component_id, description, icon, is_system, user_id, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            name,
            component_id,
            description,
            icon,
            is_system,
            REPLACE(user_id, '-', ''),
            created_at,
            updated_at
        FROM components;
    """)
    
    # ==================== Conversation Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE conversations_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            user_id VARCHAR(32) NOT NULL,
            title VARCHAR,
            page_context VARCHAR,
            model VARCHAR,
            server VARCHAR,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO conversations_new (id, user_id, title, page_context, model, server, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(user_id, '-', ''),
            title,
            page_context,
            model,
            server,
            created_at,
            updated_at
        FROM conversations;
    """)
    
    # ==================== Message Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE messages_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            conversation_id VARCHAR(32) NOT NULL,
            sender VARCHAR NOT NULL,
            message TEXT NOT NULL,
            message_metadata TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO messages_new (id, conversation_id, sender, message, message_metadata, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(conversation_id, '-', ''),
            sender,
            message,
            message_metadata,
            created_at,
            updated_at
        FROM messages;
    """)
    
    # ==================== SettingDefinition Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE settings_definitions_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            name VARCHAR NOT NULL,
            description VARCHAR,
            category VARCHAR NOT NULL,
            type VARCHAR NOT NULL,
            default_value TEXT,
            allowed_scopes TEXT NOT NULL,
            validation TEXT,
            is_multiple BOOLEAN DEFAULT FALSE,
            tags TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO settings_definitions_new (id, name, description, category, type, default_value,
                                             allowed_scopes, validation, is_multiple, tags,
                                             created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            name,
            description,
            category,
            type,
            default_value,
            allowed_scopes,
            validation,
            is_multiple,
            tags,
            created_at,
            updated_at
        FROM settings_definitions;
    """)
    
    # ==================== SettingInstance Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE settings_instances_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            definition_id VARCHAR(32) NOT NULL,
            name VARCHAR NOT NULL,
            value TEXT,
            scope VARCHAR NOT NULL,
            user_id VARCHAR(32),
            page_id VARCHAR(32),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO settings_instances_new (id, definition_id, name, value, scope, user_id, page_id, created_at, updated_at)
        SELECT
            REPLACE(id, '-', ''),
            REPLACE(definition_id, '-', ''),
            name,
            value,
            scope,
            REPLACE(user_id, '-', ''),
            REPLACE(page_id, '-', ''),
            created_at,
            updated_at
        FROM settings_instances;
    """)
    
    # ==================== Drop old tables and rename new ones ====================
    # Drop old tables
    op.execute("DROP TABLE settings_instances;")
    op.execute("DROP TABLE settings_definitions;")
    op.execute("DROP TABLE messages;")
    op.execute("DROP TABLE conversations;")
    op.execute("DROP TABLE components;")
    op.execute("DROP TABLE oauth_accounts;")
    op.execute("DROP TABLE sessions;")
    op.execute("DROP TABLE tenant_users;")
    op.execute("DROP TABLE role_permissions;")
    op.execute("DROP TABLE user_roles;")
    op.execute("DROP TABLE tenants;")
    op.execute("DROP TABLE users;")
    
    # Rename new tables to original names
    op.execute("ALTER TABLE settings_instances_new RENAME TO settings_instances;")
    op.execute("ALTER TABLE settings_definitions_new RENAME TO settings_definitions;")
    op.execute("ALTER TABLE messages_new RENAME TO messages;")
    op.execute("ALTER TABLE conversations_new RENAME TO conversations;")
    op.execute("ALTER TABLE components_new RENAME TO components;")
    op.execute("ALTER TABLE oauth_accounts_new RENAME TO oauth_accounts;")
    op.execute("ALTER TABLE sessions_new RENAME TO sessions;")
    op.execute("ALTER TABLE tenant_users_new RENAME TO tenant_users;")
    op.execute("ALTER TABLE role_permissions_new RENAME TO role_permissions;")
    op.execute("ALTER TABLE user_roles_new RENAME TO user_roles;")
    op.execute("ALTER TABLE tenants_new RENAME TO tenants;")
    op.execute("ALTER TABLE users_new RENAME TO users;")
    
    # ==================== Create indexes and foreign keys ====================
    # Create indexes for foreign keys
    op.execute("CREATE INDEX ix_tenant_users_tenant_id ON tenant_users (tenant_id);")
    op.execute("CREATE INDEX ix_tenant_users_user_id ON tenant_users (user_id);")
    op.execute("CREATE INDEX ix_tenant_users_role_id ON tenant_users (role_id);")
    op.execute("CREATE INDEX ix_role_permissions_role_id ON role_permissions (role_id);")
    op.execute("CREATE INDEX ix_sessions_user_id ON sessions (user_id);")
    op.execute("CREATE INDEX ix_sessions_active_tenant_id ON sessions (active_tenant_id);")
    op.execute("CREATE INDEX ix_oauth_accounts_user_id ON oauth_accounts (user_id);")
    op.execute("CREATE INDEX ix_components_user_id ON components (user_id);")
    op.execute("CREATE INDEX ix_conversations_user_id ON conversations (user_id);")
    op.execute("CREATE INDEX ix_messages_conversation_id ON messages (conversation_id);")
    op.execute("CREATE INDEX ix_settings_instances_definition_id ON settings_instances (definition_id);")
    op.execute("CREATE INDEX ix_settings_instances_user_id ON settings_instances (user_id);")
    op.execute("CREATE INDEX ix_settings_instances_page_id ON settings_instances (page_id);")
    
    # Re-enable foreign key constraints
    op.execute('PRAGMA foreign_keys = ON;')


def downgrade() -> None:
    # This is a complex migration to revert, as it would require converting string IDs back to UUIDs
    # For simplicity, we'll just note that a backup should be made before running the upgrade
    pass
