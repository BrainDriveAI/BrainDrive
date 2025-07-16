"""Add plugin update tracking fields

Revision ID: add_plugin_update_fields
Revises:
Create Date: 2025-05-29 12:58:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'add_plugin_update_fields'
down_revision = '8f37e0df1aaa'  # add version field to users
branch_labels = None
depends_on = None

def upgrade():
    """Add new columns for plugin update tracking and remote installation support"""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if plugin table exists and get its columns
    if 'plugin' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('plugin')]
        
        # Add columns only if they don't exist
        if 'source_type' not in columns:
            op.add_column('plugin', sa.Column('source_type', sa.String(50), nullable=True,
                                             comment='Type of plugin source: github, gitlab, npm, custom, local'))
        if 'source_url' not in columns:
            op.add_column('plugin', sa.Column('source_url', sa.Text(), nullable=True,
                                             comment='Original repository or source URL'))
        if 'update_check_url' not in columns:
            op.add_column('plugin', sa.Column('update_check_url', sa.Text(), nullable=True,
                                             comment='Specific API endpoint for checking updates'))
        if 'last_update_check' not in columns:
            op.add_column('plugin', sa.Column('last_update_check', sa.TIMESTAMP(), nullable=True,
                                             comment='When we last checked for updates'))
        if 'update_available' not in columns:
            op.add_column('plugin', sa.Column('update_available', sa.Boolean(), nullable=False,
                                             server_default='0',
                                             comment='Cached flag indicating if update is available'))
        if 'latest_version' not in columns:
            op.add_column('plugin', sa.Column('latest_version', sa.String(50), nullable=True,
                                             comment='Latest available version (cached)'))
        if 'installation_type' not in columns:
            op.add_column('plugin', sa.Column('installation_type', sa.String(20), nullable=False,
                                             server_default='local',
                                             comment='Installation type: local or remote'))
        if 'permissions' not in columns:
            op.add_column('plugin', sa.Column('permissions', sa.Text(), nullable=True,
                                             comment='JSON array of required permissions'))

def downgrade():
    """Remove the added columns"""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if plugin table exists and get its columns
    if 'plugin' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('plugin')]
        
        # Drop columns only if they exist
        if 'permissions' in columns:
            op.drop_column('plugin', 'permissions')
        if 'installation_type' in columns:
            op.drop_column('plugin', 'installation_type')
        if 'latest_version' in columns:
            op.drop_column('plugin', 'latest_version')
        if 'update_available' in columns:
            op.drop_column('plugin', 'update_available')
        if 'last_update_check' in columns:
            op.drop_column('plugin', 'last_update_check')
        if 'update_check_url' in columns:
            op.drop_column('plugin', 'update_check_url')
        if 'source_url' in columns:
            op.drop_column('plugin', 'source_url')
        if 'source_type' in columns:
            op.drop_column('plugin', 'source_type')