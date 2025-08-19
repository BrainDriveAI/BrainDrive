"""Add required_services_runtime to plugin table

Revision ID: add_required_services_runtime
Revises: add_plugin_update_fields
Create Date: 2025-08-19 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = 'add_required_services_runtime'
down_revision = '219da9748f46'
branch_labels = None
depends_on = None

def upgrade():
    """Add required_services_runtime column to plugin table"""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if plugin table exists and get its columns
    if 'plugin' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('plugin')]
        
        # Add column only if it doesn't exist
        if 'required_services_runtime' not in columns:
            op.add_column('plugin', sa.Column('required_services_runtime', sa.Text(), nullable=True,
                                            comment='JSON string storing runtime service requirements'))

def downgrade():
    """Remove required_services_runtime column from plugin table"""
    
    # Get database connection and inspector
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    
    # Check if plugin table exists and get its columns
    if 'plugin' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('plugin')]
        
        # Drop column only if it exists
        if 'required_services_runtime' in columns:
            op.drop_column('plugin', 'required_services_runtime')