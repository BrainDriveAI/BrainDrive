"""update_settings_for_multiple_scopes

Revision ID: c4aebeac7e8d
Revises: d595ac88c775
Create Date: 2025-03-04 11:24:11.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c4aebeac7e8d'
down_revision = 'd595ac88c775'
branch_labels = None
depends_on = None

def upgrade():
    # Drop existing tables if they exist
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'settings_instances' in inspector.get_table_names():
        op.drop_table('settings_instances')
    if 'settings_definitions' in inspector.get_table_names():
        op.drop_table('settings_definitions')
    
    # Create settings_definitions table with new schema
    op.create_table(
        'settings_definitions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('category', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=False),
        sa.Column('default_value', sa.JSON(), nullable=True),
        sa.Column('allowed_scopes', sa.JSON(), nullable=False, comment='Array of allowed scopes: ["system", "user", "page", "user_page"]'),
        sa.Column('validation', sa.JSON(), nullable=True),
        sa.Column('is_multiple', sa.Boolean(), default=False),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create settings_instances table with new schema
    op.create_table(
        'settings_instances',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('definition_id', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('value', sa.JSON(), nullable=True),
        sa.Column('scope', sa.String(), nullable=False, comment='One of: system, user, page, user_page'),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('page_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['definition_id'], ['settings_definitions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indexes for better query performance
    op.create_index('ix_settings_definitions_name', 'settings_definitions', ['name'])
    op.create_index('ix_settings_definitions_category', 'settings_definitions', ['category'])
    op.create_index('ix_settings_instances_definition_id', 'settings_instances', ['definition_id'])
    op.create_index('ix_settings_instances_user_id', 'settings_instances', ['user_id'])
    op.create_index('ix_settings_instances_page_id', 'settings_instances', ['page_id'])
    op.create_index('ix_settings_instances_scope', 'settings_instances', ['scope'])

def downgrade():
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
