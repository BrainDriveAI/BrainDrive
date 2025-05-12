"""add_component_table_and_route_fields

Revision ID: a1b2c3d4e5f6
Revises: 235727458fb6
Create Date: 2025-03-19 16:15:00.000000

"""
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '235727458fb6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create components table
    op.create_table(
        'components',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('component_id', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('icon', sa.String(50), nullable=True),
        sa.Column('is_system', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('component_id')
    )
    
    # Add new columns to navigation_routes table
    op.add_column('navigation_routes', sa.Column('is_system_route', sa.Boolean(), nullable=True))
    op.add_column('navigation_routes', sa.Column('default_component_id', sa.String(100), nullable=True))
    op.add_column('navigation_routes', sa.Column('default_page_id', sa.String(36), nullable=True))
    
    # SQLite doesn't support ALTER TABLE ADD CONSTRAINT
    # We'll skip the foreign key constraint for SQLite
    # The model will still enforce the relationship
    
    # Insert system components with Python-generated UUIDs
    dashboard_id = str(uuid4())
    plugin_studio_id = str(uuid4())
    settings_id = str(uuid4())
    
    op.bulk_insert(
        sa.table(
            'components',
            sa.column('id', sa.String),
            sa.column('name', sa.String),
            sa.column('component_id', sa.String),
            sa.column('description', sa.String),
            sa.column('icon', sa.String),
            sa.column('is_system', sa.Boolean),
            sa.column('created_at', sa.DateTime),
            sa.column('updated_at', sa.DateTime)
        ),
        [
            {
                'id': dashboard_id,
                'name': 'Dashboard',
                'component_id': 'dashboard',
                'description': 'Main dashboard component',
                'icon': 'Dashboard',
                'is_system': True,
                'created_at': sa.func.now(),
                'updated_at': sa.func.now()
            },
            {
                'id': plugin_studio_id,
                'name': 'Plugin Studio',
                'component_id': 'plugin-studio',
                'description': 'Plugin development environment',
                'icon': 'Extension',
                'is_system': True,
                'created_at': sa.func.now(),
                'updated_at': sa.func.now()
            },
            {
                'id': settings_id,
                'name': 'Settings',
                'component_id': 'settings',
                'description': 'System settings',
                'icon': 'Settings',
                'is_system': True,
                'created_at': sa.func.now(),
                'updated_at': sa.func.now()
            }
        ]
    )
    
    # Update existing system routes if they exist
    conn = op.get_bind()
    
    # Check if dashboard route exists
    dashboard_exists = conn.execute("SELECT COUNT(*) FROM navigation_routes WHERE route = 'dashboard'").scalar()
    if dashboard_exists > 0:
        op.execute("""
        UPDATE navigation_routes
        SET is_system_route = true, default_component_id = 'dashboard'
        WHERE route = 'dashboard'
        """)
    
    # Check if plugin-studio route exists
    plugin_studio_exists = conn.execute("SELECT COUNT(*) FROM navigation_routes WHERE route = 'plugin-studio'").scalar()
    if plugin_studio_exists > 0:
        op.execute("""
        UPDATE navigation_routes
        SET is_system_route = true, default_component_id = 'plugin-studio'
        WHERE route = 'plugin-studio'
        """)
    
    # Check if settings route exists
    settings_exists = conn.execute("SELECT COUNT(*) FROM navigation_routes WHERE route = 'settings'").scalar()
    if settings_exists > 0:
        op.execute("""
        UPDATE navigation_routes
        SET is_system_route = true, default_component_id = 'settings'
        WHERE route = 'settings'
        """)


def downgrade() -> None:
    # Remove columns from navigation_routes
    op.drop_column('navigation_routes', 'default_page_id')
    op.drop_column('navigation_routes', 'default_component_id')
    op.drop_column('navigation_routes', 'is_system_route')
    
    # Drop components table
    op.drop_table('components')
