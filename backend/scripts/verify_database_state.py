#!/usr/bin/env python3
"""
Verify database state matches expected schema.
Usage: python scripts/verify_database_state.py
"""

import sys
import os
import argparse
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import sqlalchemy as sa
from sqlalchemy import inspect
from app.core.config import settings
from app.models import Base

def get_table_schema(inspector, table_name):
    """Get detailed schema information for a table."""
    columns = inspector.get_columns(table_name)
    indexes = inspector.get_indexes(table_name)
    foreign_keys = inspector.get_foreign_keys(table_name)
    
    return {
        'columns': {col['name']: col for col in columns},
        'indexes': indexes,
        'foreign_keys': foreign_keys
    }

def compare_schemas(db_schema, model_schema, table_name):
    """Compare database schema with model schema."""
    issues = []
    
    # Compare columns
    db_columns = set(db_schema['columns'].keys())
    model_columns = set(col.name for col in model_schema.columns)
    
    missing_columns = model_columns - db_columns
    extra_columns = db_columns - model_columns
    
    if missing_columns:
        issues.append(f"Missing columns in {table_name}: {missing_columns}")
    
    if extra_columns:
        issues.append(f"Extra columns in {table_name}: {extra_columns}")
    
    # Compare column types for common columns
    common_columns = db_columns & model_columns
    for col_name in common_columns:
        db_col = db_schema['columns'][col_name]
        model_col = next(col for col in model_schema.columns if col.name == col_name)
        
        # Basic type comparison (this could be more sophisticated)
        db_type = str(db_col['type']).upper()
        model_type = str(model_col.type).upper()
        
        if db_type != model_type:
            issues.append(f"Type mismatch in {table_name}.{col_name}: DB={db_type}, Model={model_type}")
    
    return issues

def verify_database_state(database_url=None, verbose=False):
    """Verify current database matches model definitions."""
    try:
        url = database_url or settings.DATABASE_URL
        engine = sa.create_engine(url)
        inspector = inspect(engine)
        
        # Get current database tables
        db_tables = set(inspector.get_table_names())
        
        # Get expected tables from models
        model_tables = set(Base.metadata.tables.keys())
        
        issues = []
        
        # Check for missing tables
        missing_tables = model_tables - db_tables
        if missing_tables:
            issues.append(f"Missing tables: {missing_tables}")
        
        # Check for extra tables (excluding alembic_version)
        extra_tables = db_tables - model_tables - {'alembic_version'}
        if extra_tables:
            issues.append(f"Extra tables: {extra_tables}")
        
        # Check schema for common tables
        common_tables = db_tables & model_tables
        for table_name in common_tables:
            if verbose:
                print(f"Checking schema for table: {table_name}")
            
            db_schema = get_table_schema(inspector, table_name)
            model_table = Base.metadata.tables[table_name]
            
            table_issues = compare_schemas(db_schema, model_table, table_name)
            issues.extend(table_issues)
        
        # Report results
        if issues:
            print("❌ Database state verification failed:")
            for issue in issues:
                print(f"  - {issue}")
            return False
        else:
            print("✅ Database state verification passed")
            if verbose:
                print(f"Verified {len(common_tables)} tables")
            return True
            
    except Exception as e:
        print(f"❌ Error during verification: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Verify database state")
    parser.add_argument("--database-url", help="Database URL (defaults to settings)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    
    args = parser.parse_args()
    
    success = verify_database_state(args.database_url, args.verbose)
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())