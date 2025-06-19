#!/usr/bin/env python3
"""
CLI script to migrate existing data to encrypted format
Usage: python migrate_encryption.py [--dry-run] [--verify]
"""
import asyncio
import argparse
import logging
import os
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv()

from app.core.database import get_db
from app.core.encryption_migration import migration_service
from app.core.config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

async def main():
    """Main migration function"""
    parser = argparse.ArgumentParser(description='Migrate existing data to encrypted format')
    parser.add_argument('--dry-run', action='store_true', 
                       help='Analyze data without making changes')
    parser.add_argument('--verify', action='store_true',
                       help='Verify encryption/decryption is working')
    parser.add_argument('--table', type=str,
                       help='Migrate specific table only')
    parser.add_argument('--field', type=str,
                       help='Migrate specific field only (requires --table)')
    
    args = parser.parse_args()
    
    # Check if encryption key is set
    if not os.getenv('ENCRYPTION_MASTER_KEY'):
        print("ERROR: ENCRYPTION_MASTER_KEY environment variable not set!")
        print("Please set it to a secure random string:")
        print("export ENCRYPTION_MASTER_KEY='your-secure-random-key-here'")
        sys.exit(1)
    
    print("Starting encryption migration...")
    print(f"Database: {settings.DATABASE_URL}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE MIGRATION'}")
    
    if args.dry_run:
        print("⚠️  This is a dry run - no changes will be made")
    else:
        print("⚠️  This will modify your database!")
        response = input("Are you sure you want to continue? (yes/no): ")
        if response.lower() != 'yes':
            print("Migration cancelled.")
            sys.exit(0)
    
    try:
        # Get database session
        async for db in get_db():
            if args.verify:
                # Verification mode
                print("\n🔍 Verifying encryption...")
                
                if args.table and args.field:
                    # Verify specific field
                    report = await migration_service.verify_encryption(
                        db, args.table, args.field
                    )
                    print_verification_report(report)
                else:
                    # Verify all configured fields
                    from app.core.encryption_config import encryption_config
                    encrypted_fields = encryption_config.get_encrypted_fields()
                    
                    for table_name, field_names in encrypted_fields.items():
                        for field_name in field_names:
                            report = await migration_service.verify_encryption(
                                db, table_name, field_name
                            )
                            print_verification_report(report)
            
            elif args.table and args.field:
                # Migrate specific field
                print(f"\n🔄 Migrating {args.table}.{args.field}...")
                report = await migration_service.migrate_table_field(
                    db, args.table, args.field, args.dry_run
                )
                migration_service.print_migration_report([report])
                
            elif args.table:
                # Migrate all fields in a specific table
                print(f"\n🔄 Migrating all fields in {args.table}...")
                from app.core.encryption_config import encryption_config
                encrypted_fields = encryption_config.get_encrypted_fields()
                
                if args.table not in encrypted_fields:
                    print(f"❌ Table '{args.table}' is not configured for encryption")
                    sys.exit(1)
                
                reports = []
                for field_name in encrypted_fields[args.table]:
                    report = await migration_service.migrate_table_field(
                        db, args.table, field_name, args.dry_run
                    )
                    reports.append(report)
                
                migration_service.print_migration_report(reports)
                
            else:
                # Migrate all configured fields
                print("\n🔄 Migrating all configured fields...")
                reports = await migration_service.migrate_all_configured_fields(
                    db, args.dry_run
                )
                migration_service.print_migration_report(reports)
            
            break  # Exit the async generator
            
    except Exception as e:
        logger.error(f"Migration failed: {e}")
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)
    
    print("\n✅ Migration completed successfully!")
    
    if args.dry_run:
        print("\nTo perform the actual migration, run without --dry-run flag")

def print_verification_report(report):
    """Print verification report"""
    print(f"\n📊 Verification Report: {report['table_name']}.{report['field_name']}")
    print(f"Total records: {report['total_records']}")
    print(f"Encrypted records: {report['encrypted_records']}")
    print(f"Successful decryption: {report['decryption_successful']}")
    print(f"Failed decryption: {report['decryption_failed']}")
    
    if report['errors']:
        print(f"Errors: {len(report['errors'])}")
        for error in report['errors'][:3]:
            print(f"  - {error}")
        if len(report['errors']) > 3:
            print(f"  ... and {len(report['errors']) - 3} more errors")
    
    if report['decryption_failed'] == 0 and report['encrypted_records'] > 0:
        print("✅ All encrypted records can be decrypted successfully")
    elif report['decryption_failed'] > 0:
        print("❌ Some encrypted records failed to decrypt")

if __name__ == "__main__":
    asyncio.run(main())