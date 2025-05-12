#!/usr/bin/env python
"""
Script to check the schema of all tables in the database.
"""

import sqlite3
import sys

def check_schema():
    """Check the schema of all tables in the database."""
    try:
        # Connect to the database
        conn = sqlite3.connect("braindrive.db")
        cursor = conn.cursor()
        
        # Get a list of all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print(f"Found {len(tables)} tables in the database:")
        for table in tables:
            table_name = table[0]
            print(f"\n=== Table: {table_name} ===")
            
            # Get the table schema
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            print("Columns:")
            for column in columns:
                print(f"  - {column}")
            
            # Get the table constraints
            cursor.execute(f"PRAGMA index_list({table_name})")
            indexes = cursor.fetchall()
            print("Indexes:")
            for index in indexes:
                print(f"  - {index}")
                
                # Get the index columns
                index_name = index[1]
                cursor.execute(f"PRAGMA index_info({index_name})")
                index_columns = cursor.fetchall()
                print(f"    Columns:")
                for index_column in index_columns:
                    print(f"      - {index_column}")
            
            # Get the table foreign keys
            cursor.execute(f"PRAGMA foreign_key_list({table_name})")
            foreign_keys = cursor.fetchall()
            print("Foreign Keys:")
            for foreign_key in foreign_keys:
                print(f"  - {foreign_key}")
        
        # Close the connection
        conn.close()
        
        return True
        
    except Exception as e:
        print(f"Error checking schema: {e}")
        return False

if __name__ == "__main__":
    success = check_schema()
    sys.exit(0 if success else 1)