#!/usr/bin/env python3
"""
Migration Recovery Tools and Procedures
Provides tools and automated procedures for recovering from migration failures,
database corruption, and emergency situations.

Usage: python scripts/migration_recovery.py [command] [options]
"""

import sys
import os
import shutil
import sqlite3
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import argparse
import json

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import sqlalchemy as sa
    from sqlalchemy import inspect, text
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
except ImportError as e:
    print(f"❌ Required dependencies not found: {e}")
    print("Please install: pip install sqlalchemy alembic")
    sys.exit(1)

class MigrationRecoveryTool:
    """Migration recovery and emergency procedures tool."""
    
    def __init__(self, backend_dir: str = ".", database_url: str = None):
        self.backend_dir = Path(backend_dir)
        self.database_url = database_url or os.getenv('DATABASE_URL', 'sqlite:///braindrive.db')
        self.backup_dir = Path("backups/recovery")
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        
    def create_emergency_backup(self, backup_name: str = None) -> str:
        """Create an emergency backup of the database."""
        if not backup_name:
            backup_name = f"emergency_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
        backup_path = self.backup_dir / f"{backup_name}.db"
        
        try:
            if self.database_url.startswith('sqlite:///'):
                # SQLite backup
                source_db = self.database_url.replace('sqlite:///', '')
                if os.path.exists(source_db):
                    shutil.copy2(source_db, backup_path)
                    print(f"✅ Emergency backup created: {backup_path}")
                    return str(backup_path)
                else:
                    print(f"❌ Source database not found: {source_db}")
                    return None
            else:
                # For other databases, use pg_dump, mysqldump, etc.
                print("❌ Non-SQLite backup not implemented yet")
                return None
                
        except Exception as e:
            print(f"❌ Failed to create backup: {e}")
            return None
            
    def restore_from_backup(self, backup_path: str) -> bool:
        """Restore database from backup."""
        try:
            backup_file = Path(backup_path)
            if not backup_file.exists():
                print(f"❌ Backup file not found: {backup_path}")
                return False
                
            if self.database_url.startswith('sqlite:///'):
                target_db = self.database_url.replace('sqlite:///', '')
                
                # Create backup of current database before restore
                current_backup = self.create_emergency_backup("pre_restore_backup")
                if current_backup:
                    print(f"📦 Current database backed up to: {current_backup}")
                    
                # Restore from backup
                shutil.copy2(backup_file, target_db)
                print(f"✅ Database restored from: {backup_path}")
                return True
            else:
                print("❌ Non-SQLite restore not implemented yet")
                return False
                
        except Exception as e:
            print(f"❌ Failed to restore from backup: {e}")
            return False
            
    def get_migration_status(self) -> Dict:
        """Get current migration status and diagnostics."""
        try:
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", self.database_url)
            
            script_dir = ScriptDirectory.from_config(config)
            
            # Get current revision
            engine = sa.create_engine(self.database_url)
            with engine.connect() as conn:
                context = MigrationContext.configure(conn)
                current_rev = context.get_current_revision()
                
            # Get head revision
            head_rev = script_dir.get_current_head()
            
            # Get all revisions
            all_revisions = list(script_dir.walk_revisions())
            
            status = {
                'current_revision': current_rev,
                'head_revision': head_rev,
                'total_migrations': len(all_revisions),
                'is_up_to_date': current_rev == head_rev,
                'database_url': self.database_url,
                'alembic_config': "alembic.ini"
            }
            
            # Check for pending migrations
            if current_rev != head_rev:
                pending = []
                for rev in script_dir.walk_revisions(head_rev, current_rev):
                    if rev.revision != current_rev:
                        pending.append({
                            'revision': rev.revision,
                            'description': rev.doc,
                            'down_revision': rev.down_revision
                        })
                status['pending_migrations'] = pending
                status['pending_count'] = len(pending)
            else:
                status['pending_migrations'] = []
                status['pending_count'] = 0
                
            engine.dispose()
            return status
            
        except Exception as e:
            return {
                'error': str(e),
                'current_revision': None,
                'head_revision': None
            }
            
    def diagnose_migration_issues(self) -> Dict:
        """Diagnose common migration issues."""
        issues = []
        recommendations = []
        
        try:
            # Check database connectivity
            engine = sa.create_engine(self.database_url)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            engine.dispose()
            
        except Exception as e:
            issues.append({
                'type': 'connectivity',
                'severity': 'critical',
                'message': f'Database connection failed: {str(e)}',
                'recommendation': 'Check database URL and ensure database server is running'
            })
            
        try:
            # Check Alembic configuration
            config = Config("alembic.ini")
            script_dir = ScriptDirectory.from_config(config)
            
            # Check for migration file issues
            revisions = list(script_dir.walk_revisions())
            revision_map = {rev.revision: rev for rev in revisions}
            
            # Check for broken migration chain
            for rev in revisions:
                if rev.down_revision:
                    if isinstance(rev.down_revision, tuple):
                        # Merge migration
                        for down_rev in rev.down_revision:
                            if down_rev not in revision_map:
                                issues.append({
                                    'type': 'broken_chain',
                                    'severity': 'high',
                                    'message': f'Migration {rev.revision} references missing revision {down_rev}',
                                    'recommendation': 'Fix migration dependencies or remove broken migration'
                                })
                    else:
                        if rev.down_revision not in revision_map:
                            issues.append({
                                'type': 'broken_chain',
                                'severity': 'high',
                                'message': f'Migration {rev.revision} references missing revision {rev.down_revision}',
                                'recommendation': 'Fix migration dependencies or remove broken migration'
                            })
                            
        except Exception as e:
            issues.append({
                'type': 'alembic_config',
                'severity': 'high',
                'message': f'Alembic configuration error: {str(e)}',
                'recommendation': 'Check alembic.ini file and migration directory'
            })
            
        try:
            # Check for table conflicts
            engine = sa.create_engine(self.database_url)
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            
            # Check if alembic_version table exists
            if 'alembic_version' not in tables:
                issues.append({
                    'type': 'missing_version_table',
                    'severity': 'high',
                    'message': 'Alembic version table not found',
                    'recommendation': 'Initialize Alembic or restore from backup'
                })
            else:
                # Check version table integrity
                with engine.connect() as conn:
                    result = conn.execute(text("SELECT COUNT(*) FROM alembic_version"))
                    count = result.scalar()
                    
                    if count == 0:
                        issues.append({
                            'type': 'empty_version_table',
                            'severity': 'medium',
                            'message': 'Alembic version table is empty',
                            'recommendation': 'Stamp database with current revision'
                        })
                    elif count > 1:
                        issues.append({
                            'type': 'multiple_versions',
                            'severity': 'high',
                            'message': f'Multiple version entries found: {count}',
                            'recommendation': 'Clean up version table to have single entry'
                        })
                        
            engine.dispose()
            
        except Exception as e:
            issues.append({
                'type': 'database_check',
                'severity': 'medium',
                'message': f'Database check failed: {str(e)}',
                'recommendation': 'Investigate database state manually'
            })
            
        # Generate general recommendations
        if not issues:
            recommendations.append("No issues detected. Migration system appears healthy.")
        else:
            critical_issues = [i for i in issues if i['severity'] == 'critical']
            high_issues = [i for i in issues if i['severity'] == 'high']
            
            if critical_issues:
                recommendations.append("CRITICAL: Address database connectivity issues first")
            if high_issues:
                recommendations.append("HIGH PRIORITY: Fix migration chain and configuration issues")
                
            recommendations.append("Consider creating a backup before attempting fixes")
            recommendations.append("Test fixes on a copy of the database first")
            
        return {
            'issues': issues,
            'recommendations': recommendations,
            'issue_count': len(issues),
            'severity_counts': {
                'critical': len([i for i in issues if i['severity'] == 'critical']),
                'high': len([i for i in issues if i['severity'] == 'high']),
                'medium': len([i for i in issues if i['severity'] == 'medium']),
                'low': len([i for i in issues if i['severity'] == 'low'])
            }
        }
        
    def fix_version_table(self, target_revision: str = None) -> bool:
        """Fix Alembic version table issues."""
        try:
            engine = sa.create_engine(self.database_url)
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            
            # Create version table if missing
            if 'alembic_version' not in tables:
                print("📝 Creating missing alembic_version table...")
                with engine.connect() as conn:
                    conn.execute(text("""
                        CREATE TABLE alembic_version (
                            version_num VARCHAR(32) NOT NULL,
                            CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
                        )
                    """))
                    conn.commit()
                print("✅ alembic_version table created")
                
            # Clean up multiple versions
            with engine.connect() as conn:
                result = conn.execute(text("SELECT version_num FROM alembic_version"))
                versions = result.fetchall()
                
                if len(versions) > 1:
                    print(f"🧹 Cleaning up {len(versions)} version entries...")
                    conn.execute(text("DELETE FROM alembic_version"))
                    conn.commit()
                    versions = []
                    
                # Set target revision
                if not versions:
                    if not target_revision:
                        # Get head revision
                        config = Config("alembic.ini")
                        script_dir = ScriptDirectory.from_config(config)
                        target_revision = script_dir.get_current_head()
                        
                    print(f"📌 Setting version to: {target_revision}")
                    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:version)"), 
                               {"version": target_revision})
                    conn.commit()
                    
            engine.dispose()
            print("✅ Version table fixed successfully")
            return True
            
        except Exception as e:
            print(f"❌ Failed to fix version table: {e}")
            return False
            
    def reset_to_revision(self, revision: str, force: bool = False) -> bool:
        """Reset database to specific revision."""
        try:
            if not force:
                response = input(f"⚠️  This will reset database to revision {revision}. Continue? (y/N): ")
                if response.lower() != 'y':
                    print("Operation cancelled")
                    return False
                    
            # Create backup first
            backup_path = self.create_emergency_backup(f"pre_reset_{revision}")
            if not backup_path:
                print("❌ Failed to create backup. Aborting reset.")
                return False
                
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", self.database_url)
            
            print(f"🔄 Resetting to revision: {revision}")
            command.downgrade(config, revision)
            
            print("✅ Database reset successfully")
            return True
            
        except Exception as e:
            print(f"❌ Failed to reset to revision: {e}")
            return False
            
    def emergency_schema_rebuild(self, force: bool = False) -> bool:
        """Emergency schema rebuild from scratch."""
        try:
            if not force:
                response = input("⚠️  This will completely rebuild the database schema. Continue? (y/N): ")
                if response.lower() != 'y':
                    print("Operation cancelled")
                    return False
                    
            # Create backup
            backup_path = self.create_emergency_backup("pre_schema_rebuild")
            if not backup_path:
                print("❌ Failed to create backup. Aborting rebuild.")
                return False
                
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", self.database_url)
            
            print("🗑️  Dropping all tables...")
            
            # Drop all tables
            engine = sa.create_engine(self.database_url)
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            
            with engine.connect() as conn:
                # Disable foreign key constraints for SQLite
                if self.database_url.startswith('sqlite:///'):
                    conn.execute(text("PRAGMA foreign_keys = OFF"))
                    
                for table in tables:
                    conn.execute(text(f"DROP TABLE IF EXISTS {table}"))
                    
                conn.commit()
                
            engine.dispose()
            
            print("🏗️  Rebuilding schema from migrations...")
            command.upgrade(config, "head")
            
            print("✅ Schema rebuilt successfully")
            return True
            
        except Exception as e:
            print(f"❌ Failed to rebuild schema: {e}")
            return False
            
    def validate_recovery(self) -> Dict:
        """Validate database state after recovery."""
        validation_results = {
            'timestamp': datetime.now().isoformat(),
            'checks': {},
            'overall_status': 'UNKNOWN'
        }
        
        try:
            # Check database connectivity
            engine = sa.create_engine(self.database_url)
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            validation_results['checks']['connectivity'] = {'status': 'OK', 'message': 'Database accessible'}
            
            # Check Alembic version table
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            
            if 'alembic_version' in tables:
                with engine.connect() as conn:
                    result = conn.execute(text("SELECT version_num FROM alembic_version"))
                    versions = result.fetchall()
                    
                    if len(versions) == 1:
                        validation_results['checks']['version_table'] = {
                            'status': 'OK', 
                            'message': f'Version table valid, current: {versions[0][0]}'
                        }
                    else:
                        validation_results['checks']['version_table'] = {
                            'status': 'ERROR', 
                            'message': f'Invalid version table state: {len(versions)} entries'
                        }
            else:
                validation_results['checks']['version_table'] = {
                    'status': 'ERROR', 
                    'message': 'Alembic version table missing'
                }
                
            # Check migration consistency
            config = Config("alembic.ini")
            config.set_main_option("sqlalchemy.url", self.database_url)
            
            try:
                # Try to get current revision
                with engine.connect() as conn:
                    context = MigrationContext.configure(conn)
                    current_rev = context.get_current_revision()
                    
                validation_results['checks']['migration_state'] = {
                    'status': 'OK', 
                    'message': f'Migration state consistent, current: {current_rev}'
                }
            except Exception as e:
                validation_results['checks']['migration_state'] = {
                    'status': 'ERROR', 
                    'message': f'Migration state check failed: {str(e)}'
                }
                
            engine.dispose()
            
            # Determine overall status
            statuses = [check['status'] for check in validation_results['checks'].values()]
            if all(status == 'OK' for status in statuses):
                validation_results['overall_status'] = 'HEALTHY'
            elif any(status == 'ERROR' for status in statuses):
                validation_results['overall_status'] = 'ERROR'
            else:
                validation_results['overall_status'] = 'WARNING'
                
        except Exception as e:
            validation_results['checks']['general'] = {
                'status': 'ERROR', 
                'message': f'Validation failed: {str(e)}'
            }
            validation_results['overall_status'] = 'ERROR'
            
        return validation_results
        
    def list_backups(self) -> List[Dict]:
        """List available backups."""
        backups = []
        
        if self.backup_dir.exists():
            for backup_file in self.backup_dir.glob("*.db"):
                try:
                    stat = backup_file.stat()
                    backups.append({
                        'name': backup_file.stem,
                        'path': str(backup_file),
                        'size': stat.st_size,
                        'created': datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })
                except Exception as e:
                    print(f"⚠️  Error reading backup {backup_file}: {e}")
                    
        return sorted(backups, key=lambda x: x['created'], reverse=True)

def main():
    parser = argparse.ArgumentParser(description="Migration Recovery Tools")
    parser.add_argument("--backend-dir", default="backend", help="Backend directory path")
    parser.add_argument("--database-url", help="Database URL")
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Status command
    status_parser = subparsers.add_parser('status', help='Show migration status')
    
    # Diagnose command
    diagnose_parser = subparsers.add_parser('diagnose', help='Diagnose migration issues')
    
    # Backup command
    backup_parser = subparsers.add_parser('backup', help='Create emergency backup')
    backup_parser.add_argument('--name', help='Backup name')
    
    # Restore command
    restore_parser = subparsers.add_parser('restore', help='Restore from backup')
    restore_parser.add_argument('backup_path', help='Path to backup file')
    
    # Fix version table command
    fix_version_parser = subparsers.add_parser('fix-version', help='Fix Alembic version table')
    fix_version_parser.add_argument('--revision', help='Target revision')
    
    # Reset command
    reset_parser = subparsers.add_parser('reset', help='Reset to specific revision')
    reset_parser.add_argument('revision', help='Target revision')
    reset_parser.add_argument('--force', action='store_true', help='Skip confirmation')
    
    # Rebuild command
    rebuild_parser = subparsers.add_parser('rebuild', help='Emergency schema rebuild')
    rebuild_parser.add_argument('--force', action='store_true', help='Skip confirmation')
    
    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate recovery')
    
    # List backups command
    list_backups_parser = subparsers.add_parser('list-backups', help='List available backups')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return 1
        
    recovery_tool = MigrationRecoveryTool(args.backend_dir, args.database_url)
    
    if args.command == 'status':
        status = recovery_tool.get_migration_status()
        print("📊 Migration Status")
        print("=" * 30)
        for key, value in status.items():
            if key != 'pending_migrations':
                print(f"{key}: {value}")
        
        if status.get('pending_migrations'):
            print(f"\nPending Migrations ({status['pending_count']}):")
            for migration in status['pending_migrations']:
                print(f"  - {migration['revision']}: {migration['description']}")
                
    elif args.command == 'diagnose':
        diagnosis = recovery_tool.diagnose_migration_issues()
        print("🔍 Migration Diagnosis")
        print("=" * 30)
        print(f"Issues found: {diagnosis['issue_count']}")
        
        for severity, count in diagnosis['severity_counts'].items():
            if count > 0:
                print(f"  {severity.upper()}: {count}")
                
        if diagnosis['issues']:
            print("\nIssues:")
            for issue in diagnosis['issues']:
                severity_icon = {'critical': '🚨', 'high': '❌', 'medium': '⚠️', 'low': 'ℹ️'}
                icon = severity_icon.get(issue['severity'], '❓')
                print(f"  {icon} {issue['message']}")
                print(f"    Recommendation: {issue['recommendation']}")
                
        print("\nRecommendations:")
        for rec in diagnosis['recommendations']:
            print(f"  💡 {rec}")
            
    elif args.command == 'backup':
        backup_path = recovery_tool.create_emergency_backup(args.name)
        if backup_path:
            return 0
        else:
            return 1
            
    elif args.command == 'restore':
        success = recovery_tool.restore_from_backup(args.backup_path)
        return 0 if success else 1
        
    elif args.command == 'fix-version':
        success = recovery_tool.fix_version_table(args.revision)
        return 0 if success else 1
        
    elif args.command == 'reset':
        success = recovery_tool.reset_to_revision(args.revision, args.force)
        return 0 if success else 1
        
    elif args.command == 'rebuild':
        success = recovery_tool.emergency_schema_rebuild(args.force)
        return 0 if success else 1
        
    elif args.command == 'validate':
        validation = recovery_tool.validate_recovery()
        print("✅ Recovery Validation")
        print("=" * 30)
        print(f"Overall Status: {validation['overall_status']}")
        print(f"Timestamp: {validation['timestamp']}")
        
        print("\nChecks:")
        for name, check in validation['checks'].items():
            status_icon = {'OK': '✅', 'ERROR': '❌', 'WARNING': '⚠️'}.get(check['status'], '❓')
            print(f"  {status_icon} {name}: {check['message']}")
            
        return 0 if validation['overall_status'] == 'HEALTHY' else 1
        
    elif args.command == 'list-backups':
        backups = recovery_tool.list_backups()
        print("📦 Available Backups")
        print("=" * 50)
        
        if not backups:
            print("No backups found")
        else:
            for backup in backups:
                size_mb = backup['size'] / (1024 * 1024)
                print(f"Name: {backup['name']}")
                print(f"  Path: {backup['path']}")
                print(f"  Size: {size_mb:.2f} MB")
                print(f"  Created: {backup['created']}")
                print()
                
    return 0

if __name__ == "__main__":
    sys.exit(main())