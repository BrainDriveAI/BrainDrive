"""create settings tables

Revision ID: 4599871357d8
Revises: 
Create Date: 2025-03-04 09:40:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision = '4599871357d8'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create settings_definitions table
    op.create_table(
        'settings_definitions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('default_value', sqlite.JSON(), nullable=True),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('validation', sqlite.JSON(), nullable=True),
        sa.Column('is_multiple', sa.Boolean(), default=False),
        sa.Column('tags', sqlite.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for settings_definitions
    op.create_index('idx_settings_def_category', 'settings_definitions', ['category'])
    op.create_index('idx_settings_def_scope', 'settings_definitions', ['scope'])

    # Create settings_instances table
    op.create_table(
        'settings_instances',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('definition_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('value', sqlite.JSON(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('workspace_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['definition_id'], ['settings_definitions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )

    # Create indexes for settings_instances
    op.create_index('idx_settings_inst_definition', 'settings_instances', ['definition_id'])
    op.create_index('idx_settings_inst_scope', 'settings_instances', ['scope'])
    op.create_index('idx_settings_inst_user', 'settings_instances', ['user_id'])
    op.create_index('idx_settings_inst_workspace', 'settings_instances', ['workspace_id'])


def downgrade() -> None:
    # Drop tables and their indexes
    op.drop_table('settings_instances')
    op.drop_table('settings_definitions')
