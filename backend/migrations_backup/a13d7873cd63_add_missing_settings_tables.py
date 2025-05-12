"""add_missing_settings_tables

Revision ID: a13d7873cd63
Revises: b1aaa774db30
Create Date: 2025-03-15 11:49:40.174366

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite


# revision identifiers, used by Alembic.
revision: str = 'a13d7873cd63'
down_revision: Union[str, None] = 'b1aaa774db30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Check if settings_definitions table already exists
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    
    if 'settings_definitions' not in tables:
        # Create settings_definitions table
        op.create_table(
            'settings_definitions',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('category', sa.String(), nullable=False),
            sa.Column('type', sa.String(), nullable=False),
            sa.Column('default_value', sqlite.JSON(), nullable=True),
            sa.Column('allowed_scopes', sqlite.JSON(), nullable=False),
            sa.Column('validation', sqlite.JSON(), nullable=True),
            sa.Column('is_multiple', sa.Boolean(), nullable=True),
            sa.Column('tags', sqlite.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.PrimaryKeyConstraint('id')
        )
        
        # Create indexes for settings_definitions
        op.create_index('ix_settings_definitions_name', 'settings_definitions', ['name'])
        op.create_index('ix_settings_definitions_category', 'settings_definitions', ['category'])
    
    if 'settings_instances' not in tables:
        # Create settings_instances table
        op.create_table(
            'settings_instances',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('definition_id', sa.String(), nullable=False),
            sa.Column('name', sa.String(), nullable=False),
            sa.Column('value', sqlite.JSON(), nullable=True),
            sa.Column('scope', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=True),
            sa.Column('page_id', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
            sa.ForeignKeyConstraint(['definition_id'], ['settings_definitions.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id')
        )
        
        # Create indexes for settings_instances
        op.create_index('ix_settings_instances_definition_id', 'settings_instances', ['definition_id'])
        op.create_index('ix_settings_instances_user_id', 'settings_instances', ['user_id'])
        op.create_index('ix_settings_instances_page_id', 'settings_instances', ['page_id'])
        op.create_index('ix_settings_instances_scope', 'settings_instances', ['scope'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_settings_instances_scope', 'settings_instances')
    op.drop_index('ix_settings_instances_page_id', 'settings_instances')
    op.drop_index('ix_settings_instances_user_id', 'settings_instances')
    op.drop_index('ix_settings_instances_definition_id', 'settings_instances')
    op.drop_index('ix_settings_definitions_category', 'settings_definitions')
    op.drop_index('ix_settings_definitions_name', 'settings_definitions')
    
    # Drop tables
    op.drop_table('settings_instances')
    op.drop_table('settings_definitions')
