"""standardize_role_uuid_format

Revision ID: fcba819d216c
Revises: f0bc573ed538
Create Date: 2025-04-29 07:42:46.302113

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = 'fcba819d216c'
down_revision: Union[str, None] = 'f0bc573ed538'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Disable foreign key constraints for SQLite
    op.execute('PRAGMA foreign_keys = OFF;')
    
    # Create a connection to execute raw SQL
    connection = op.get_bind()
    
    # Check if the role table exists
    result = connection.execute(text("SELECT name FROM sqlite_master WHERE type='table' AND name='role'"))
    if result.fetchone() is None:
        # If the table doesn't exist, we don't need to do anything
        op.execute('PRAGMA foreign_keys = ON;')
        return
    
    # ==================== Role Model ====================
    # 1. Create new table with desired schema
    op.execute("""
        CREATE TABLE role_new (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            role_name VARCHAR(50) NOT NULL,
            is_global BOOLEAN DEFAULT FALSE,
            description VARCHAR(200)
        );
    """)
    
    # 2. Copy data with transformation
    op.execute("""
        INSERT INTO role_new (id, role_name, is_global, description)
        SELECT REPLACE(id, '-', ''), role_name, is_global, description
        FROM role;
    """)
    
    # 3. Drop old table and rename new one
    op.execute("DROP TABLE role;")
    op.execute("ALTER TABLE role_new RENAME TO role;")
    
    # 4. Create unique index for role_name
    op.execute("CREATE UNIQUE INDEX ix_role_role_name ON role (role_name);")
    
    # Re-enable foreign key constraints
    op.execute('PRAGMA foreign_keys = ON;')


def downgrade() -> None:
    # This is a complex migration to revert, as it would require converting string IDs back to UUIDs
    # For simplicity, we'll just note that a backup should be made before running the upgrade
    pass
