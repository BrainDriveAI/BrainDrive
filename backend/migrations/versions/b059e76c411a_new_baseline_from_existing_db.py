"""
new_baseline_from_existing_db

Revision ID: b059e76c411a
Revises: 
Create Date: 2025-04-28 13:37:15.992235

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = 'b059e76c411a'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create tables based on the current database schema
    # Note: We're using execute() with raw SQL to ensure exact schema match
    
    # Drop tables if they exist (commented out for safety)
    # op.execute("DROP TABLE IF EXISTS users;")
    # ... (other tables)
    
    # Create tables
    op.execute("""CREATE TABLE user_roles (
	id VARCHAR NOT NULL, 
	role_name VARCHAR(50) NOT NULL, 
	description TEXT, 
	is_global BOOLEAN, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	UNIQUE (role_name)
)""")
    op.execute("""CREATE TABLE users (
	id VARCHAR NOT NULL, 
	username VARCHAR(50) NOT NULL, 
	email VARCHAR(100) NOT NULL, 
	hashed_password TEXT NOT NULL, 
	full_name VARCHAR(100), 
	profile_picture TEXT, 
	is_active BOOLEAN, 
	is_verified BOOLEAN, 
	refresh_token TEXT, 
	refresh_token_expires TEXT, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	UNIQUE (email), 
	UNIQUE (username)
)""")
    op.execute("""CREATE TABLE tenants (
	id VARCHAR NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	description TEXT, 
	sso_domain VARCHAR(100), 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	UNIQUE (name), 
	UNIQUE (sso_domain)
)""")
    op.execute("""CREATE TABLE tenant_users (
	id VARCHAR NOT NULL, 
	tenant_id VARCHAR, 
	user_id VARCHAR, 
	role_id VARCHAR, 
	is_owner BOOLEAN, 
	PRIMARY KEY (id), 
	FOREIGN KEY(role_id) REFERENCES user_roles (id) ON DELETE CASCADE, 
	FOREIGN KEY(tenant_id) REFERENCES tenants (id) ON DELETE CASCADE, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
)""")
    op.execute("""CREATE TABLE role_permissions (
	id VARCHAR NOT NULL, 
	role_id VARCHAR, 
	permission_name VARCHAR(100) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(role_id) REFERENCES user_roles (id) ON DELETE CASCADE, 
	CONSTRAINT uq_role_permission UNIQUE (role_id, permission_name)
)""")
    op.execute("""CREATE TABLE sessions (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	session_token VARCHAR NOT NULL, 
	active_tenant_id VARCHAR, 
	expires_at DATETIME NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(active_tenant_id) REFERENCES tenants (id) ON DELETE SET NULL, 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	UNIQUE (session_token)
)""")
    op.execute("""CREATE TABLE oauth_accounts (
	id VARCHAR NOT NULL, 
	user_id VARCHAR, 
	provider VARCHAR(50) NOT NULL, 
	provider_user_id VARCHAR NOT NULL, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	CONSTRAINT uq_oauth_account UNIQUE (provider, provider_user_id)
)""")
    op.execute("""CREATE TABLE settings_definitions (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description VARCHAR, 
	category VARCHAR NOT NULL, 
	type VARCHAR NOT NULL, 
	default_value JSON, 
	allowed_scopes JSON NOT NULL, 
	validation JSON, 
	is_multiple BOOLEAN, 
	tags JSON, 
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
	PRIMARY KEY (id)
)""")
    op.execute("""CREATE TABLE pages_temp (
            id VARCHAR NOT NULL,
            name VARCHAR(100) NOT NULL,
            route VARCHAR(255) NOT NULL,
            parent_route VARCHAR(255),
            content JSON NOT NULL,
            content_backup JSON,
            backup_date DATETIME,
            creator_id VARCHAR NOT NULL,
            navigation_route_id VARCHAR,
            is_published BOOLEAN,
            publish_date DATETIME,
            description TEXT,
            icon VARCHAR(50),
            created_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
            parent_type VARCHAR(50),
            is_parent_page BOOLEAN,
            PRIMARY KEY (id),
            FOREIGN KEY(creator_id) REFERENCES users (id),
            FOREIGN KEY(navigation_route_id) REFERENCES navigation_routes (id)
        )""")
    op.execute("""CREATE TABLE conversations (
	id VARCHAR NOT NULL, 
	user_id UUID NOT NULL, 
	title VARCHAR, 
	page_context VARCHAR, 
	model VARCHAR, 
	server VARCHAR, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)""")
    op.execute("""CREATE TABLE tags (
	id VARCHAR NOT NULL, 
	user_id UUID NOT NULL, 
	name VARCHAR(50) NOT NULL, 
	color VARCHAR(7), 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)""")
    op.execute("""CREATE TABLE messages (
	id VARCHAR NOT NULL, 
	conversation_id VARCHAR NOT NULL, 
	sender VARCHAR NOT NULL, 
	message TEXT NOT NULL, 
	message_metadata TEXT, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	FOREIGN KEY(conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
)""")
    op.execute("""CREATE TABLE conversation_tags (
	conversation_id VARCHAR NOT NULL, 
	tag_id VARCHAR NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (conversation_id, tag_id), 
	FOREIGN KEY(conversation_id) REFERENCES conversations (id) ON DELETE CASCADE, 
	FOREIGN KEY(tag_id) REFERENCES tags (id) ON DELETE CASCADE
)""")
    op.execute("""CREATE TABLE \"settings_instances\" (
	id VARCHAR NOT NULL, 
	definition_id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	value JSON, 
	scope VARCHAR NOT NULL, 
	user_id VARCHAR, 
	page_id VARCHAR, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT fk_settings_instances_user_id FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT fk_settings_instances_page_id FOREIGN KEY(page_id) REFERENCES pages (id), 
	FOREIGN KEY(definition_id) REFERENCES settings_definitions (id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)""")
    op.execute("""CREATE TABLE role (
	id UUID NOT NULL, 
	role_name VARCHAR(50) NOT NULL, 
	is_global BOOLEAN, 
	description VARCHAR(200), 
	PRIMARY KEY (id), 
	UNIQUE (role_name)
)""")
    op.execute("""CREATE TABLE \"module\" (
	id VARCHAR NOT NULL, 
	plugin_id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	display_name VARCHAR, 
	description VARCHAR, 
	icon VARCHAR, 
	category VARCHAR, 
	enabled BOOLEAN, 
	priority INTEGER, 
	props TEXT, 
	config_fields TEXT, 
	messages TEXT, 
	required_services TEXT, 
	dependencies TEXT, 
	layout TEXT, 
	tags TEXT, 
	created_at VARCHAR, 
	updated_at VARCHAR, 
	user_id VARCHAR NOT NULL, 
	PRIMARY KEY (id, plugin_id), 
	CONSTRAINT fk_module_user_id FOREIGN KEY(user_id) REFERENCES users (id), 
	FOREIGN KEY(plugin_id) REFERENCES plugin (id) ON DELETE CASCADE
)""")
    op.execute("""CREATE TABLE \"pages\" (
    id VARCHAR NOT NULL, 
    name VARCHAR(100) NOT NULL, 
    route VARCHAR(255) NOT NULL, 
    parent_route VARCHAR(255), 
    content JSON NOT NULL, 
    content_backup JSON, 
    backup_date DATETIME, 
    creator_id VARCHAR NOT NULL, 
    navigation_route_id VARCHAR, 
    is_published BOOLEAN, 
    publish_date DATETIME, 
    description TEXT, 
    icon VARCHAR(50), 
    created_at DATETIME DEFAULT (CURRENT_TIMESTAMP), 
    updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP),
    parent_type VARCHAR(50),
    is_parent_page BOOLEAN, 
    PRIMARY KEY (id), 
    FOREIGN KEY(creator_id) REFERENCES users (id), 
    FOREIGN KEY(navigation_route_id) REFERENCES navigation_routes (id), 
    UNIQUE (route, creator_id)
)""")
    op.execute("""CREATE TABLE \"navigation_routes\" (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    route VARCHAR(100) NOT NULL,
    icon VARCHAR(50),
    description TEXT,
    \"order\" INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT TRUE,
    is_system_route BOOLEAN DEFAULT FALSE,
    default_component_id VARCHAR(100),
    default_page_id VARCHAR(36),
    can_change_default BOOLEAN DEFAULT FALSE,
    creator_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES users(id),
    UNIQUE (route, creator_id)
)""")
    op.execute("""CREATE TABLE \"components\" (
	id VARCHAR(36), 
	name VARCHAR(100) NOT NULL, 
	component_id VARCHAR(100) NOT NULL, 
	description TEXT, 
	icon VARCHAR(50), 
	is_system BOOLEAN DEFAULT (FALSE), 
	user_id VARCHAR(36) NOT NULL, 
	created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP), 
	updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP), 
	PRIMARY KEY (id), 
	CONSTRAINT components_component_id_user_id_key UNIQUE (component_id, user_id), 
	UNIQUE (component_id, user_id), 
	FOREIGN KEY(user_id) REFERENCES users (id)
)""")
    op.execute("""CREATE TABLE \"plugin\" (
	id VARCHAR NOT NULL, 
	name VARCHAR NOT NULL, 
	description VARCHAR NOT NULL, 
	version VARCHAR NOT NULL, 
	type VARCHAR, 
	enabled BOOLEAN, 
	icon VARCHAR, 
	category VARCHAR, 
	status VARCHAR, 
	official BOOLEAN, 
	author VARCHAR, 
	last_updated VARCHAR, 
	compatibility VARCHAR, 
	downloads INTEGER, 
	scope VARCHAR, 
	bundle_method VARCHAR, 
	bundle_location VARCHAR, 
	is_local BOOLEAN, 
	long_description TEXT, 
	config_fields TEXT, 
	messages TEXT, 
	dependencies TEXT, 
	created_at VARCHAR, 
	updated_at VARCHAR, 
	user_id VARCHAR NOT NULL, 
	plugin_slug VARCHAR, 
	PRIMARY KEY (id), 
	CONSTRAINT fk_plugin_user_id FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT unique_plugin_per_user UNIQUE (user_id, plugin_slug)
)""")

    # Create indexes


def downgrade() -> None:
    # This is a baseline migration, downgrade would drop all tables
    # Commented out for safety
    # op.execute("DROP TABLE IF EXISTS users;")
    # ... (other tables)
    pass
