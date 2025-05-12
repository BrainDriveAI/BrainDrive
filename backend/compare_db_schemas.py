#!/usr/bin/env python3
"""
Compare the schemas of two SQLite databases to verify they match.

This script:
1. Connects to two SQLite databases
2. Extracts and compares their schemas (tables, columns, indexes, constraints)
3. Reports any differences found

Usage:
    python compare_db_schemas.py [db1_path] [db2_path]

Example:
    python compare_db_schemas.py braindrive.db test_new_baseline.db
"""

import os
import sys
import sqlite3
import json
from collections import defaultdict


def get_table_info(conn, table_name):
    """Get detailed information about a table's columns."""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name});")
    columns = cursor.fetchall()
    return [
        {
            "cid": col[0],
            "name": col[1],
            "type": col[2],
            "notnull": col[3],
            "default_value": col[4],
            "pk": col[5]
        }
        for col in columns
    ]


def get_table_schema(conn, table_name):
    """Get the CREATE TABLE statement for a given table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table_name}';")
    result = cursor.fetchone()
    if result:
        return result[0]
    return None


def get_index_info(conn, table_name):
    """Get information about indexes on a table."""
    cursor = conn.cursor()
    cursor.execute(f"SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='{table_name}' AND sql IS NOT NULL;")
    indexes = cursor.fetchall()
    return {idx[0]: idx[1] for idx in indexes}


def get_foreign_keys(conn, table_name):
    """Get foreign key constraints for a table."""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA foreign_key_list({table_name});")
    fks = cursor.fetchall()
    return [
        {
            "id": fk[0],
            "seq": fk[1],
            "table": fk[2],
            "from": fk[3],
            "to": fk[4],
            "on_update": fk[5],
            "on_delete": fk[6],
            "match": fk[7]
        }
        for fk in fks
    ]


def get_all_tables(conn):
    """Get a list of all tables in the database, excluding SQLite system tables."""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
    tables = [row[0] for row in cursor.fetchall()]
    return tables


def compare_schemas(db1_path, db2_path):
    """Compare the schemas of two SQLite databases and report differences."""
    # Connect to both databases
    conn1 = sqlite3.connect(db1_path)
    conn2 = sqlite3.connect(db2_path)
    
    # Get all tables from both databases
    tables1 = set(get_all_tables(conn1))
    tables2 = set(get_all_tables(conn2))
    
    # Compare table sets
    only_in_db1 = tables1 - tables2
    only_in_db2 = tables2 - tables1
    common_tables = tables1.intersection(tables2)
    
    print(f"\n=== Comparing {db1_path} and {db2_path} ===\n")
    
    # Report tables that exist in only one database
    if only_in_db1:
        print(f"Tables only in {db1_path}:")
        for table in sorted(only_in_db1):
            print(f"  - {table}")
        print()
    
    if only_in_db2:
        print(f"Tables only in {db2_path}:")
        for table in sorted(only_in_db2):
            print(f"  - {table}")
        print()
    
    # Compare common tables
    differences_found = False
    
    for table in sorted(common_tables):
        if table == 'alembic_version':
            continue  # Skip alembic_version table
            
        # Compare table schemas
        schema1 = get_table_schema(conn1, table)
        schema2 = get_table_schema(conn2, table)
        
        # Normalize schemas for comparison (remove whitespace variations)
        normalized_schema1 = ' '.join(schema1.split())
        normalized_schema2 = ' '.join(schema2.split())
        
        if normalized_schema1 != normalized_schema2:
            differences_found = True
            print(f"Table '{table}' has different schema:")
            print(f"  DB1: {schema1}")
            print(f"  DB2: {schema2}")
            print()
        
        # Compare columns in detail
        columns1 = {col['name']: col for col in get_table_info(conn1, table)}
        columns2 = {col['name']: col for col in get_table_info(conn2, table)}
        
        # Check for columns that exist in only one database
        only_in_db1_cols = set(columns1.keys()) - set(columns2.keys())
        only_in_db2_cols = set(columns2.keys()) - set(columns1.keys())
        
        if only_in_db1_cols:
            differences_found = True
            print(f"Table '{table}' has columns only in {db1_path}:")
            for col in sorted(only_in_db1_cols):
                print(f"  - {col} ({columns1[col]['type']})")
            print()
        
        if only_in_db2_cols:
            differences_found = True
            print(f"Table '{table}' has columns only in {db2_path}:")
            for col in sorted(only_in_db2_cols):
                print(f"  - {col} ({columns2[col]['type']})")
            print()
        
        # Compare common columns
        common_cols = set(columns1.keys()).intersection(set(columns2.keys()))
        for col in sorted(common_cols):
            if columns1[col] != columns2[col]:
                differences_found = True
                print(f"Column '{table}.{col}' differs:")
                print(f"  DB1: {columns1[col]}")
                print(f"  DB2: {columns2[col]}")
                print()
        
        # Compare indexes
        indexes1 = get_index_info(conn1, table)
        indexes2 = get_index_info(conn2, table)
        
        only_in_db1_idx = set(indexes1.keys()) - set(indexes2.keys())
        only_in_db2_idx = set(indexes2.keys()) - set(indexes1.keys())
        common_idx = set(indexes1.keys()).intersection(set(indexes2.keys()))
        
        if only_in_db1_idx:
            differences_found = True
            print(f"Table '{table}' has indexes only in {db1_path}:")
            for idx in sorted(only_in_db1_idx):
                print(f"  - {idx}: {indexes1[idx]}")
            print()
        
        if only_in_db2_idx:
            differences_found = True
            print(f"Table '{table}' has indexes only in {db2_path}:")
            for idx in sorted(only_in_db2_idx):
                print(f"  - {idx}: {indexes2[idx]}")
            print()
        
        for idx in sorted(common_idx):
            if indexes1[idx] != indexes2[idx]:
                differences_found = True
                print(f"Index '{idx}' on table '{table}' differs:")
                print(f"  DB1: {indexes1[idx]}")
                print(f"  DB2: {indexes2[idx]}")
                print()
        
        # Compare foreign keys
        fks1 = get_foreign_keys(conn1, table)
        fks2 = get_foreign_keys(conn2, table)
        
        # Convert to JSON strings for comparison
        fks1_json = json.dumps(sorted(fks1, key=lambda x: (x['table'], x['from'], x['to'])), sort_keys=True)
        fks2_json = json.dumps(sorted(fks2, key=lambda x: (x['table'], x['from'], x['to'])), sort_keys=True)
        
        if fks1_json != fks2_json:
            differences_found = True
            print(f"Foreign keys for table '{table}' differ:")
            print(f"  DB1: {fks1}")
            print(f"  DB2: {fks2}")
            print()
    
    # Close database connections
    conn1.close()
    conn2.close()
    
    # Final summary
    if not differences_found and not only_in_db1 and not only_in_db2:
        print("✅ No schema differences found! The databases have identical schemas.")
    else:
        print("❌ Schema differences found. See details above.")
    
    return not (differences_found or only_in_db1 or only_in_db2)


def main():
    # Get command line arguments
    if len(sys.argv) < 3:
        print("Usage: python compare_db_schemas.py [db1_path] [db2_path]")
        sys.exit(1)
    
    db1_path = sys.argv[1]
    db2_path = sys.argv[2]
    
    # Validate database files exist
    if not os.path.exists(db1_path):
        print(f"Error: Database '{db1_path}' not found.")
        sys.exit(1)
    
    if not os.path.exists(db2_path):
        print(f"Error: Database '{db2_path}' not found.")
        sys.exit(1)
    
    # Compare schemas
    schemas_match = compare_schemas(db1_path, db2_path)
    
    # Exit with appropriate status code
    sys.exit(0 if schemas_match else 1)


if __name__ == "__main__":
    main()