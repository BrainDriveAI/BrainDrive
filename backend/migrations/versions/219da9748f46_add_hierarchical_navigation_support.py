"""add_hierarchical_navigation_support

Revision ID: 219da9748f46
Revises: cb95bbe8b720
Create Date: 2025-08-14 08:25:21.335545

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = '219da9748f46'
down_revision: Union[str, None] = 'cb95bbe8b720'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add hierarchical navigation support"""
    
    # Phase 1: Add new columns to navigation_routes table
    print("Phase 1: Adding hierarchical columns to navigation_routes...")
    
    with op.batch_alter_table('navigation_routes', schema=None) as batch_op:
        # Add hierarchical columns
        batch_op.add_column(sa.Column('parent_id', sa.String(32), nullable=True))
        batch_op.add_column(sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('is_collapsible', sa.Boolean(), nullable=False, server_default='1'))
        batch_op.add_column(sa.Column('is_expanded', sa.Boolean(), nullable=False, server_default='1'))
        
        # Add foreign key constraint for parent_id
        batch_op.create_foreign_key(
            'fk_navigation_routes_parent_id',
            'navigation_routes',
            ['parent_id'],
            ['id'],
            ondelete='CASCADE'
        )
    
    # Add indexes for performance
    op.create_index('idx_navigation_routes_parent_id', 'navigation_routes', ['parent_id'])
    op.create_index('idx_navigation_routes_display_order', 'navigation_routes', ['display_order'])
    op.create_index('idx_navigation_routes_parent_order', 'navigation_routes', ['parent_id', 'display_order'])
    
    print("Phase 1 completed: Hierarchical columns added successfully")
    
    # Phase 2: Create parent routes and migrate existing data
    print("Phase 2: Creating parent routes and migrating data...")
    
    # Get database connection
    connection = op.get_bind()
    
    # Create "Your BrainDrive" parent route
    your_braindrive_id = 'yourbraindriveparent123456789012'  # 32 chars without hyphens
    connection.execute(text("""
        INSERT INTO navigation_routes (
            id, name, route, icon, description, is_visible, creator_id, 
            is_system_route, display_order, is_collapsible, is_expanded,
            created_at, updated_at
        ) VALUES (
            :id, 'Your BrainDrive', 'your-braindrive', 'AccountTree',
            'Core BrainDrive functionality and settings', 1, 'system',
            1, 0, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    """), {
        'id': your_braindrive_id
    })
    
    # Create "Your Pages" parent route
    your_pages_id = 'yourpagesparent1234567890123456'  # 32 chars without hyphens
    connection.execute(text("""
        INSERT INTO navigation_routes (
            id, name, route, icon, description, is_visible, creator_id,
            is_system_route, display_order, is_collapsible, is_expanded,
            created_at, updated_at
        ) VALUES (
            :id, 'Your Pages', 'your-pages', 'CollectionsBookmark',
            'Your custom pages and content', 1, 'system',
            1, 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    """), {
        'id': your_pages_id
    })
    
    # Migrate existing system routes under "Your BrainDrive"
    route_migrations = [
        ('settings', 0, 'Settings'),
        ('personas', 1, 'Personas'), 
        ('plugin-manager', 2, 'Plugin Manager'),
        ('plugin-studio', 3, 'Page Builder')  # Rename BrainDrive Studio to Page Builder
    ]
    
    for route, order, display_name in route_migrations:
        # Update existing route to be under "Your BrainDrive"
        result = connection.execute(text("""
            UPDATE navigation_routes 
            SET parent_id = :parent_id, display_order = :display_order, name = :name
            WHERE route = :route AND is_system_route = 1
        """), {
            'parent_id': your_braindrive_id,
            'display_order': order,
            'name': display_name,
            'route': route
        })
        
        if result.rowcount > 0:
            print(f"Migrated {route} -> {display_name} under Your BrainDrive")
        else:
            print(f"Warning: Route {route} not found for migration")
    
    # Create "Prompt Library" route under "Your BrainDrive" if it doesn't exist
    connection.execute(text("""
        INSERT OR IGNORE INTO navigation_routes (
            id, name, route, icon, description, is_visible, creator_id,
            is_system_route, parent_id, display_order, is_collapsible, is_expanded,
            created_at, updated_at
        ) VALUES (
            'promptlibrary123456789012345678', 'Prompt Library', 'prompt-library', 'LibraryBooks',
            'Manage your AI prompts and templates', 1, 'system',
            1, :parent_id, 4, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    """), {
        'parent_id': your_braindrive_id
    })
    
    print("Phase 2 completed: Parent routes created and data migrated")
    
    # Phase 3: Update display orders for root-level routes
    print("Phase 3: Updating display orders...")
    
    # Update display orders for any remaining root-level routes
    connection.execute(text("""
        UPDATE navigation_routes 
        SET display_order = CASE 
            WHEN route = 'your-braindrive' THEN 0
            WHEN route = 'your-pages' THEN 1
            ELSE display_order + 2
        END
        WHERE parent_id IS NULL
    """))
    
    print("Migration completed successfully!")


def downgrade() -> None:
    """Remove hierarchical navigation support"""
    
    print("Rolling back hierarchical navigation changes...")
    
    # Get database connection
    connection = op.get_bind()
    
    # Phase 1: Remove parent relationships (move children to root level)
    connection.execute(text("""
        UPDATE navigation_routes 
        SET parent_id = NULL, display_order = "order"
        WHERE parent_id IS NOT NULL
    """))
    
    # Phase 2: Remove parent routes that were created
    connection.execute(text("""
        DELETE FROM navigation_routes 
        WHERE route IN ('your-braindrive', 'your-pages') 
        AND is_system_route = 1
    """))
    
    # Phase 3: Remove indexes
    op.drop_index('idx_navigation_routes_parent_order', 'navigation_routes')
    op.drop_index('idx_navigation_routes_display_order', 'navigation_routes')
    op.drop_index('idx_navigation_routes_parent_id', 'navigation_routes')
    
    # Phase 4: Remove columns
    with op.batch_alter_table('navigation_routes', schema=None) as batch_op:
        batch_op.drop_constraint('fk_navigation_routes_parent_id', type_='foreignkey')
        batch_op.drop_column('is_expanded')
        batch_op.drop_column('is_collapsible')
        batch_op.drop_column('display_order')
        batch_op.drop_column('parent_id')
    
    print("Rollback completed successfully!")
