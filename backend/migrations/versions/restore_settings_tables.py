"""restore settings tables

Revision ID: restore_settings_tables
Revises: add_conversation_type_simple
Create Date: 2025-06-24 08:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = 'restore_settings_tables'
down_revision: Union[str, None] = 'add_conversation_type_simple'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade with conditional table creation to prevent conflicts."""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Create settings_definitions table only if it doesn't exist
    if 'settings_definitions' not in existing_tables:
        print("Creating settings_definitions table...")
        op.create_table('settings_definitions',
            sa.Column('id', sa.String(length=32), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('category', sa.String(), nullable=False),
            sa.Column('type', sa.String(), nullable=False),
            sa.Column('default_value', sa.JSON(), nullable=True),
            sa.Column('allowed_scopes', sa.JSON(), nullable=False),
            sa.Column('validation', sa.JSON(), nullable=True),
            sa.Column('is_multiple', sa.Boolean(), nullable=True),
            sa.Column('tags', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
    else:
        print("settings_definitions table already exists, skipping creation")

    # Create settings_instances table only if it doesn't exist
    if 'settings_instances' not in existing_tables:
        print("Creating settings_instances table...")
        op.create_table('settings_instances',
            sa.Column('id', sa.String(length=32), nullable=False),
            sa.Column('definition_id', sa.String(length=32), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('value', sa.TEXT(), nullable=True),  # Encrypted column
            sa.Column('scope', sa.Enum('SYSTEM', 'USER', 'PAGE', 'USER_PAGE', name='settingscope'), nullable=False),
            sa.Column('user_id', sa.String(length=32), nullable=True),
            sa.Column('page_id', sa.String(length=32), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['definition_id'], ['settings_definitions.id'], ),
            sa.ForeignKeyConstraint(['page_id'], ['pages.id'], ),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
        )

        # Create indexes for better performance
        with op.batch_alter_table('settings_instances', schema=None) as batch_op:
            batch_op.create_index('ix_settings_instances_definition_id', ['definition_id'], unique=False)
            batch_op.create_index('ix_settings_instances_user_id', ['user_id'], unique=False)
            batch_op.create_index('ix_settings_instances_page_id', ['page_id'], unique=False)
    else:
        print("settings_instances table already exists, skipping creation")


def downgrade() -> None:
    """Downgrade with conditional table dropping."""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Drop settings_instances table if it exists
    if 'settings_instances' in existing_tables:
        op.drop_table('settings_instances')
    
    # Drop settings_definitions table if it exists
    if 'settings_definitions' in existing_tables:
        op.drop_table('settings_definitions')
    
    # Drop the enum type if it exists (SQLite doesn't support this, but PostgreSQL does)
    try:
        op.execute('DROP TYPE IF EXISTS settingscope')
    except Exception:
        # Ignore errors for SQLite
        pass