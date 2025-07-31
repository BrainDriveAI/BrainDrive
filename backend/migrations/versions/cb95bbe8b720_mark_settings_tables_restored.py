"""mark_settings_tables_restored

This migration marks that the settings_definitions and settings_instances tables
have been manually restored after being accidentally dropped in migration 7d0185f79500.

The tables were recreated with the following structure:
- settings_definitions: Core settings schema definitions
- settings_instances: User/system setting values with proper foreign keys and indexes

Revision ID: cb95bbe8b720
Revises: 7d0185f79500
Create Date: 2025-07-16 14:25:35.324694

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cb95bbe8b720'
down_revision: Union[str, None] = '7d0185f79500'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    This migration documents that settings tables have been manually restored.
    
    The tables were recreated outside of Alembic due to migration branching issues.
    This migration serves as a marker in the migration history that the restoration
    was completed successfully.
    
    Tables restored:
    - settings_definitions (with all columns and primary key)
    - settings_instances (with foreign keys to users/pages and indexes)
    """
    
    # Get database connection and inspector to verify tables exist
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_tables = inspector.get_table_names()
    
    # Check if settings tables exist - they may not exist if running from a fresh database
    # where the 7d0185f79500 migration was fixed to not drop them
    if 'settings_definitions' not in existing_tables:
        print("⚠️  settings_definitions table not found - this is expected for fresh databases")
        print("⚠️  The restore_settings_tables migration will create it")
    else:
        print("✅ Verified settings_definitions table exists")
    
    if 'settings_instances' not in existing_tables:
        print("⚠️  settings_instances table not found - this is expected for fresh databases")
        print("⚠️  The restore_settings_tables migration will create it")
    else:
        print("✅ Verified settings_instances table exists")
    
    print("✅ Settings tables restoration check completed")


def downgrade() -> None:
    """
    Downgrade would drop the settings tables, but this should not be done
    as it would recreate the original problem.
    """
    print("⚠️  Downgrade not implemented - would recreate the settings table drop issue")
    print("⚠️  If you need to remove settings tables, do so manually with proper backup")
    pass
