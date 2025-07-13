#!/usr/bin/env python3
"""
Check migration naming conventions.
Usage: python scripts/check_migration_naming.py [file1.py] [file2.py] ...
"""

import sys
import re
from pathlib import Path

def check_migration_naming(file_path):
    """Check if migration file follows naming conventions."""
    issues = []
    
    file_name = Path(file_path).name
    
    # Check basic format: revision_description.py
    if not re.match(r'^[a-f0-9]+_[a-z_]+\.py$', file_name):
        issues.append(f"File name should follow format: revision_description.py")
    
    # Check for descriptive name (at least 3 parts when split by _)
    name_parts = file_name.replace('.py', '').split('_')
    if len(name_parts) < 3:
        issues.append(f"Migration name should be more descriptive (at least 3 parts)")
    
    # Check for common anti-patterns
    bad_patterns = ['temp', 'test', 'fix', 'update', 'change']
    for pattern in bad_patterns:
        if pattern in file_name.lower():
            issues.append(f"Avoid generic terms like '{pattern}' in migration names")
    
    # Read file content for additional checks
    try:
        with open(file_path, 'r') as f:
            content = f.read()
        
        # Check for revision ID in content
        revision_match = re.search(r"revision:\s*str\s*=\s*['\"]([^'\"]+)['\"]", content)
        if revision_match:
            revision_id = revision_match.group(1)
            if revision_id not in file_name:
                issues.append(f"Revision ID '{revision_id}' should be in filename")
        
        # Check for docstring
        if '"""' not in content:
            issues.append("Migration should have a descriptive docstring")
        
        # Check for both upgrade and downgrade functions
        if 'def upgrade(' not in content:
            issues.append("Migration must have an upgrade() function")
        
        if 'def downgrade(' not in content:
            issues.append("Migration must have a downgrade() function")
    
    except Exception as e:
        issues.append(f"Error reading file: {e}")
    
    return issues

def main():
    if len(sys.argv) < 2:
        print("Usage: python check_migration_naming.py <migration_file> [...]")
        return 1
    
    total_issues = 0
    
    for file_path in sys.argv[1:]:
        issues = check_migration_naming(file_path)
        
        if issues:
            print(f"❌ Issues in {file_path}:")
            for issue in issues:
                print(f"  - {issue}")
            total_issues += len(issues)
        else:
            print(f"✅ {file_path} follows naming conventions")
    
    if total_issues > 0:
        print(f"\n❌ Found {total_issues} naming issues")
        return 1
    else:
        print(f"\n✅ All files follow naming conventions")
        return 0

if __name__ == "__main__":
    sys.exit(main())