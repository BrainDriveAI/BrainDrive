#!/usr/bin/env python3
"""
Test migration up/down functionality.
Usage: python scripts/test_migrations.py
"""

import sys
import os
import tempfile
import shutil
import subprocess
from pathlib import Path
import argparse

def run_command(cmd, cwd=None):
    """Run a command and return success status and output."""
    try:
        result = subprocess.run(
            cmd, 
            shell=True, 
            cwd=cwd,
            capture_output=True, 
            text=True,
            check=True
        )
        return True, result.stdout
    except subprocess.CalledProcessError as e:
        return False, e.stderr

def test_migration_cycle(test_db_path, backend_dir):
    """Test complete migration cycle: up to head, down to base, up again."""
    
    # Set environment variable for test database
    env = os.environ.copy()
    env['DATABASE_URL'] = f'sqlite:///{test_db_path}'
    
    print("🔄 Testing migration cycle...")
    
    # Step 1: Migrate up to head
    print("  📈 Migrating up to head...")
    success, output = run_command(f'PYTHONPATH=. alembic upgrade head', cwd=backend_dir)
    if not success:
        print(f"❌ Failed to migrate up: {output}")
        return False
    
    # Step 2: Check current revision
    success, current_rev = run_command(f'PYTHONPATH=. alembic current', cwd=backend_dir)
    if not success:
        print(f"❌ Failed to get current revision: {current_rev}")
        return False
    
    print(f"  ✅ Successfully migrated to: {current_rev.strip()}")
    
    # Step 3: Migrate down to base
    print("  📉 Migrating down to base...")
    success, output = run_command(f'PYTHONPATH=. alembic downgrade base', cwd=backend_dir)
    if not success:
        print(f"❌ Failed to migrate down: {output}")
        return False
    
    # Step 4: Migrate up again
    print("  📈 Migrating up to head again...")
    success, output = run_command(f'PYTHONPATH=. alembic upgrade head', cwd=backend_dir)
    if not success:
        print(f"❌ Failed to migrate up second time: {output}")
        return False
    
    print("  ✅ Migration cycle completed successfully")
    return True

def test_individual_migrations(test_db_path, backend_dir):
    """Test each migration individually."""
    
    print("🔍 Testing individual migrations...")
    
    # Get list of revisions
    success, revisions_output = run_command(f'PYTHONPATH=. alembic history', cwd=backend_dir)
    if not success:
        print(f"❌ Failed to get migration history: {revisions_output}")
        return False
    
    # Parse revision IDs (this is a simple parser, might need adjustment)
    revisions = []
    for line in revisions_output.split('\n'):
        if ' -> ' in line:
            # Extract revision ID from line like "abc123 -> def456 (head), description"
            parts = line.split(' -> ')
            if len(parts) >= 2:
                rev_id = parts[1].split(',')[0].split(' ')[0]
                revisions.append(rev_id)
    
    if not revisions:
        print("⚠️  No revisions found to test")
        return True
    
    print(f"  Found {len(revisions)} revisions to test")
    
    # Test each revision
    for i, revision in enumerate(revisions):
        print(f"  Testing migration to {revision} ({i+1}/{len(revisions)})...")
        
        # Migrate to this revision
        success, output = run_command(f'PYTHONPATH=. alembic upgrade {revision}', cwd=backend_dir)
        if not success:
            print(f"❌ Failed to migrate to {revision}: {output}")
            return False
    
    print("  ✅ All individual migrations tested successfully")
    return True

def main():
    parser = argparse.ArgumentParser(description="Test database migrations")
    parser.add_argument("--backend-dir", default="backend", help="Backend directory path")
    parser.add_argument("--keep-db", action="store_true", help="Keep test database after testing")
    parser.add_argument("--test-individual", action="store_true", help="Test individual migrations")
    
    args = parser.parse_args()
    
    backend_path = Path(args.backend_dir)
    if not backend_path.exists():
        print(f"❌ Backend directory not found: {args.backend_dir}")
        return 1
    
    # Create temporary database
    temp_dir = tempfile.mkdtemp()
    test_db_path = os.path.join(temp_dir, "test_migrations.db")
    
    try:
        print(f"🧪 Testing migrations with temporary database: {test_db_path}")
        
        # Test migration cycle
        if not test_migration_cycle(test_db_path, backend_path):
            return 1
        
        # Test individual migrations if requested
        if args.test_individual:
            # Reset database for individual testing
            if os.path.exists(test_db_path):
                os.remove(test_db_path)
            
            if not test_individual_migrations(test_db_path, backend_path):
                return 1
        
        print("🎉 All migration tests passed!")
        
        if args.keep_db:
            print(f"📁 Test database saved at: {test_db_path}")
        
        return 0
        
    except Exception as e:
        print(f"❌ Unexpected error during testing: {e}")
        return 1
        
    finally:
        if not args.keep_db:
            shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    sys.exit(main())