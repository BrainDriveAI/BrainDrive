#!/usr/bin/env python3
"""
Migration validation script to detect conflicts before they occur.
Usage: python scripts/validate_migrations.py
"""

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple
import argparse

def get_migration_info(file_path: Path) -> Dict:
    """Extract migration information from a migration file."""
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Extract revision info
    revision_match = re.search(r"revision:\s*str\s*=\s*['\"]([^'\"]+)['\"]", content)
    
    # Handle down_revision which can be a string, None, or tuple
    down_revision_match = re.search(r"down_revision:\s*Union\[str,\s*None\]\s*=\s*(.+)", content)
    down_revision = None
    if down_revision_match:
        down_rev_value = down_revision_match.group(1).strip()
        if down_rev_value == 'None':
            down_revision = None
        elif down_rev_value.startswith("'") or down_rev_value.startswith('"'):
            # Single string revision
            string_match = re.search(r"['\"]([^'\"]*)['\"]", down_rev_value)
            down_revision = string_match.group(1) if string_match else None
        elif down_rev_value.startswith('('):
            # Tuple of revisions (merge migration) - take the first one for dependency checking
            tuple_match = re.search(r"\(['\"]([^'\"]*)['\"]", down_rev_value)
            down_revision = tuple_match.group(1) if tuple_match else None
    
    # Extract table operations
    create_tables = re.findall(r"op\.create_table\(['\"](\w+)['\"]", content)
    drop_tables = re.findall(r"op\.drop_table\(['\"](\w+)['\"]", content)
    alter_tables = re.findall(r"op\.(?:add_column|drop_column|alter_column).*?['\"](\w+)['\"]", content)
    
    return {
        'file': file_path.name,
        'revision': revision_match.group(1) if revision_match else None,
        'down_revision': down_revision,
        'creates': create_tables,
        'drops': drop_tables,
        'alters': alter_tables
    }

def analyze_migration_files(migrations_dir: str = "migrations/versions") -> Dict[str, Dict]:
    """Analyze all migration files for table operations."""
    migrations_path = Path(migrations_dir)
    
    if not migrations_path.exists():
        print(f"❌ Migrations directory not found: {migrations_dir}")
        sys.exit(1)
    
    migrations = {}
    
    for migration_file in migrations_path.glob("*.py"):
        if migration_file.name == "__init__.py":
            continue
            
        try:
            migration_info = get_migration_info(migration_file)
            migrations[migration_file.name] = migration_info
        except Exception as e:
            print(f"⚠️  Error parsing {migration_file.name}: {e}")
    
    return migrations

def detect_table_conflicts(migrations: Dict[str, Dict]) -> List[str]:
    """Detect table creation conflicts."""
    conflicts = []
    table_creators = {}
    
    for migration_name, info in migrations.items():
        for table in info['creates']:
            if table in table_creators:
                conflicts.append(
                    f"Table '{table}' created in both {table_creators[table]} and {migration_name}"
                )
            else:
                table_creators[table] = migration_name
    
    return conflicts

def detect_dependency_issues(migrations: Dict[str, Dict]) -> List[str]:
    """Detect migration dependency issues."""
    issues = []
    revisions = {info['revision']: name for name, info in migrations.items() if info['revision']}
    
    for migration_name, info in migrations.items():
        down_revision = info['down_revision']
        if down_revision and down_revision != 'None' and down_revision != '' and down_revision not in revisions:
            issues.append(
                f"Migration {migration_name} depends on missing revision: {down_revision}"
            )
    
    return issues

def check_migration_naming(migrations: Dict[str, Dict]) -> List[str]:
    """Check migration naming conventions."""
    issues = []
    
    for migration_name, info in migrations.items():
        # Check for descriptive names
        if len(migration_name.split('_')) < 3:
            issues.append(
                f"Migration {migration_name} should have more descriptive name"
            )
        
        # Check for revision ID in filename
        revision = info['revision']
        if revision and revision not in migration_name:
            issues.append(
                f"Migration {migration_name} filename should contain revision ID {revision}"
            )
    
    return issues

def generate_migration_graph(migrations: Dict[str, Dict]) -> str:
    """Generate a simple text representation of migration dependencies."""
    graph_lines = ["Migration Dependency Graph:", "=" * 30]
    
    # Build dependency map
    deps = {}
    for name, info in migrations.items():
        revision = info['revision']
        down_revision = info['down_revision']
        if revision:
            deps[revision] = {
                'name': name,
                'parent': down_revision if down_revision != 'None' else None
            }
    
    # Find root migrations (no parent)
    roots = [rev for rev, info in deps.items() if info['parent'] is None]
    
    def print_tree(revision, indent=0):
        if revision in deps:
            info = deps[revision]
            graph_lines.append("  " * indent + f"├─ {info['name']}")
            
            # Find children
            children = [rev for rev, child_info in deps.items() if child_info['parent'] == revision]
            for child in children:
                print_tree(child, indent + 1)
    
    for root in roots:
        print_tree(root)
    
    return "\n".join(graph_lines)

def main():
    parser = argparse.ArgumentParser(description="Validate database migrations")
    parser.add_argument("--migrations-dir", default="migrations/versions",
                       help="Path to migrations directory")
    parser.add_argument("--verbose", "-v", action="store_true",
                       help="Verbose output")
    parser.add_argument("--graph", "-g", action="store_true",
                       help="Show migration dependency graph")
    
    args = parser.parse_args()
    
    print("🔍 Analyzing migration files...")
    migrations = analyze_migration_files(args.migrations_dir)
    
    if args.verbose:
        print(f"Found {len(migrations)} migration files")
    
    # Check for conflicts
    conflicts = detect_table_conflicts(migrations)
    dependency_issues = detect_dependency_issues(migrations)
    naming_issues = check_migration_naming(migrations)
    
    # Report results
    has_issues = False
    
    if conflicts:
        print("\n❌ Table Creation Conflicts:")
        for conflict in conflicts:
            print(f"  - {conflict}")
        has_issues = True
    
    if dependency_issues:
        print("\n❌ Dependency Issues:")
        for issue in dependency_issues:
            print(f"  - {issue}")
        has_issues = True
    
    if naming_issues and args.verbose:
        print("\n⚠️  Naming Convention Issues:")
        for issue in naming_issues:
            print(f"  - {issue}")
    
    if args.graph:
        print(f"\n{generate_migration_graph(migrations)}")
    
    if not has_issues:
        print("\n✅ No critical migration conflicts detected")
        if naming_issues and not args.verbose:
            print(f"⚠️  {len(naming_issues)} naming convention issues (use -v to see details)")
    
    return 1 if has_issues else 0

if __name__ == "__main__":
    sys.exit(main())