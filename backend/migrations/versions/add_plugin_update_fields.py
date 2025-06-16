"""Add plugin update tracking fields

Revision ID: add_plugin_update_fields
Revises:
Create Date: 2025-05-29 12:58:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'add_plugin_update_fields'
down_revision = None  # Replace with actual previous revision
branch_labels = None
depends_on = None

def upgrade():
    """Add new columns for plugin update tracking and remote installation support"""

    # Add update source information
    op.add_column('plugin', sa.Column('source_type', sa.String(50), nullable=True,
                                     comment='Type of plugin source: github, gitlab, npm, custom, local'))
    op.add_column('plugin', sa.Column('source_url', sa.Text(), nullable=True,
                                     comment='Original repository or source URL'))
    op.add_column('plugin', sa.Column('update_check_url', sa.Text(), nullable=True,
                                     comment='Specific API endpoint for checking updates'))

    # Add update tracking information
    op.add_column('plugin', sa.Column('last_update_check', sa.TIMESTAMP(), nullable=True,
                                     comment='When we last checked for updates'))
    op.add_column('plugin', sa.Column('update_available', sa.Boolean(), nullable=False,
                                     server_default='0',
                                     comment='Cached flag indicating if update is available'))
    op.add_column('plugin', sa.Column('latest_version', sa.String(50), nullable=True,
                                     comment='Latest available version (cached)'))

    # Add installation metadata
    op.add_column('plugin', sa.Column('installation_type', sa.String(20), nullable=False,
                                     server_default='local',
                                     comment='Installation type: local or remote'))
    op.add_column('plugin', sa.Column('permissions', sa.Text(), nullable=True,
                                     comment='JSON array of required permissions'))

def downgrade():
    """Remove the added columns"""

    op.drop_column('plugin', 'permissions')
    op.drop_column('plugin', 'installation_type')
    op.drop_column('plugin', 'latest_version')
    op.drop_column('plugin', 'update_available')
    op.drop_column('plugin', 'last_update_check')
    op.drop_column('plugin', 'update_check_url')
    op.drop_column('plugin', 'source_url')
    op.drop_column('plugin', 'source_type')