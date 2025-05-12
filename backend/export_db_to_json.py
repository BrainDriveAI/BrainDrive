#!/usr/bin/env python
"""
Script to export database tables to JSON files.
This can be used to create templates for new user initialization.
"""

import json
import os
import sqlite3
import sys
from datetime import datetime

# Directory to store the exported JSON files
OUTPUT_DIR = "data_export"

# Tables to export
TABLES = [
    "components",
    "navigation_routes",
    "pages",
    "settings_definitions",
    "settings_instances",
    "conversations",
    "messages",
    "plugin",
    "module",
    "user_roles"
]

def ensure_output_dir():
    """Ensure the output directory exists."""
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

def export_table(conn, table_name):
    """Export a table to a JSON file."""
    cursor = conn.cursor()
    
    # Get the table schema
    cursor.execute(f"PRAGMA table_info({table_name})")
    columns = [column[1] for column in cursor.fetchall()]
    
    # Get the table data
    cursor.execute(f"SELECT * FROM {table_name}")
    rows = cursor.fetchall()
    
    # Convert rows to dictionaries
    data = []
    for row in rows:
        row_dict = {}
        for i, column in enumerate(columns):
            row_dict[column] = row[i]
        
        # Fix the swapped user_id and updated_at fields if this is the components table
        if table_name == "components" and "user_id" in row_dict and "updated_at" in row_dict:
            # Check if user_id looks like a timestamp and updated_at looks like a UUID
            if (isinstance(row_dict["user_id"], str) and " " in row_dict["user_id"] and
                isinstance(row_dict["updated_at"], str) and "-" in row_dict["updated_at"] and
                len(row_dict["updated_at"]) == 32):
                # Swap the values
                temp = row_dict["user_id"]
                row_dict["user_id"] = row_dict["updated_at"]
                row_dict["updated_at"] = temp
                print(f"Fixed swapped user_id and updated_at for component {row_dict['name']}")
        
        data.append(row_dict)
    
    # Write to JSON file
    output_file = os.path.join(OUTPUT_DIR, f"{table_name}.json")
    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"Exported {len(data)} rows from {table_name} to {output_file}")
    
    return len(data)

def export_metadata(stats):
    """Export metadata about the export."""
    metadata = {
        "export_date": datetime.now().isoformat(),
        "tables": stats
    }
    
    output_file = os.path.join(OUTPUT_DIR, "export_metadata.json")
    with open(output_file, "w") as f:
        json.dump(metadata, f, indent=2)
    
    print(f"Exported metadata to {output_file}")

def main():
    """Main function."""
    try:
        # Ensure the output directory exists
        ensure_output_dir()
        
        # Connect to the database
        conn = sqlite3.connect("braindrive.db")
        
        # Export each table
        stats = {}
        for table in TABLES:
            try:
                row_count = export_table(conn, table)
                stats[table] = {
                    "row_count": row_count,
                    "status": "success"
                }
            except Exception as e:
                print(f"Error exporting {table}: {e}")
                stats[table] = {
                    "row_count": 0,
                    "status": "error",
                    "error": str(e)
                }
        
        # Export metadata
        export_metadata(stats)
        
        # Close the connection
        conn.close()
        
        print("Export completed successfully!")
        return True
        
    except Exception as e:
        print(f"Error exporting database: {e}")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)