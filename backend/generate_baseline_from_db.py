#!/usr/bin/env python3
"""
Generate a new Alembic baseline migration from an existing SQLite database.

This script:
1. Connects to an existing SQLite database
2. Extracts the complete schema (tables, indexes, constraints)
3. Generates a new Alembic migration file with the exact schema

Usage:
    python generate_baseline_from_db.py [source_db_path] [migration_name]

Example:
    python generate_baseline_from_db.py backend/braindrive.db new_baseline_migration
"""

import os
import sys
import sqlite3
import datetime
import uuid
import re
from pathlib import Path

# Default values
DEFAULT_SOURCE_DB = "braindrive.db"
DEFAULT_MIGRATION_NAME = "new_baseline_from_existing_db"
MIGRATIONS_DIR = "migrations/versions"


def get_table_schema(conn, table_name):
    """Get the CREATE TABLE statement for a given table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}';")
    create_stmt = cursor.fetchone()[0]
    return create_stmt


def get_index_schema(conn, table_name):
    """Get all CREATE INDEX statements for a given table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='{table_name}' AND sql IS NOT NULL;")
    index_stmts = [row[0] for row in cursor.fetchall()]
    return index_stmts


def get_all_tables(conn):
    """Get a list of all tables in the database, excluding SQLite system tables."""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    return tables


def generate_migration_file(source_db, migration_name):
    """Generate a new Alembic migration file with the schema from the source database."""
    # Connect to the source database
    conn = sqlite3.connect(source_db)
    
    # Get all tables
    tables = get_all_tables(conn)
    
    # Generate migration content
    migration_id = uuid.uuid4().hex[:12]
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
    
    # Start building the migration file content
    content = f"""\"\"\"
{migration_name}

Revision ID: {migration_id}
Revises: 
Create Date: {timestamp}

\"\"\"
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

# revision identifiers, used by Alembic.
revision: str = '{migration_id}'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create tables based on the current database schema
    # Note: We're using execute() with raw SQL to ensure exact schema match
    
    # Drop tables if they exist (commented out for safety)
    # op.execute("DROP TABLE IF EXISTS users;")
    # ... (other tables)
    
    # Create tables
"""
    
    # Add CREATE TABLE statements
    for table in tables:
        if table == 'alembic_version':
            continue  # Skip the alembic_version table
            
        create_stmt = get_table_schema(conn, table)
        # Format the statement for inclusion in the Python string
        formatted_stmt = create_stmt.replace('\\', '\\\\').replace('"', '\\"')
        content += f"    op.execute(\"\"\"{formatted_stmt}\"\"\")\n"
    
    # Add CREATE INDEX statements
    content += "\n    # Create indexes\n"
    for table in tables:
        if table == 'alembic_version':
            continue
            
        index_stmts = get_index_schema(conn, table)
        for stmt in index_stmts:
            if stmt:  # Some might be None
                formatted_stmt = stmt.replace('\\', '\\\\').replace('"', '\\"')
                content += f"    op.execute(\"\"\"{formatted_stmt}\"\"\")\n"
    
    # Add downgrade function
    content += """

def downgrade() -> None:
    # This is a baseline migration, downgrade would drop all tables
    # Commented out for safety
    # op.execute("DROP TABLE IF EXISTS users;")
    # ... (other tables)
    pass
"""
    
    # Close the database connection
    conn.close()
    
    # Create the migration file
    os.makedirs(MIGRATIONS_DIR, exist_ok=True)
    file_path = os.path.join(MIGRATIONS_DIR, f"{migration_id}_{migration_name}.py")
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print(f"Migration file created: {file_path}")
    return file_path


def main():
    # Get command line arguments
    source_db = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE_DB
    migration_name = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_MIGRATION_NAME
    
    # Validate source database exists
    if not os.path.exists(source_db):
        print(f"Error: Source database '{source_db}' not found.")
        sys.exit(1)
    
    # Generate the migration file
    migration_file = generate_migration_file(source_db, migration_name)
    
    print("\nNext steps:")
    print(f"1. Review the generated migration file: {migration_file}")
    print("2. Make any necessary adjustments to the migration file")
    print("3. Test the migration by creating a new database:")
    print("   DATABASE_URL=sqlite:///backend/test_new_baseline.db alembic upgrade head")
    print("4. Compare the schemas to verify they match")


if __name__ == "__main__":
    main()