"""
Migration utilities for encrypting existing data
"""
import logging
import json
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, update
from sqlalchemy.orm import sessionmaker

from .encryption import encryption_service, EncryptionError
from .encryption_config import encryption_config

logger = logging.getLogger(__name__)

class EncryptionMigrationService:
    """Service for migrating existing plain-text data to encrypted format"""
    
    def __init__(self):
        self.encryption_service = encryption_service
        self.config = encryption_config
    
    async def migrate_table_field(
        self, 
        db: AsyncSession, 
        table_name: str, 
        field_name: str,
        dry_run: bool = True
    ) -> Dict[str, Any]:
        """
        Migrate a specific table field from plain-text to encrypted format
        
        Args:
            db: Database session
            table_name: Name of the table
            field_name: Name of the field to encrypt
            dry_run: If True, only analyze without making changes
            
        Returns:
            Migration report with statistics
        """
        logger.info(f"Starting migration for {table_name}.{field_name} (dry_run={dry_run})")
        
        report = {
            "table_name": table_name,
            "field_name": field_name,
            "dry_run": dry_run,
            "total_records": 0,
            "encrypted_records": 0,
            "plain_text_records": 0,
            "errors": [],
            "migrated_records": 0
        }
        
        try:
            # Get all records from the table
            query = text(f"SELECT id, {field_name} FROM {table_name}")
            result = await db.execute(query)
            records = result.fetchall()
            
            report["total_records"] = len(records)
            
            for record in records:
                record_id = record[0]
                field_value = record[1]
                
                if field_value is None:
                    continue
                
                try:
                    # Check if the value is already encrypted
                    if isinstance(field_value, str) and self.encryption_service.is_encrypted_value(field_value):
                        report["encrypted_records"] += 1
                        logger.debug(f"Record {record_id} already encrypted")
                        continue
                    
                    # Value is plain text, needs encryption
                    report["plain_text_records"] += 1
                    
                    if not dry_run:
                        # Parse the JSON value if it's a string
                        if isinstance(field_value, str):
                            try:
                                parsed_value = json.loads(field_value)
                            except json.JSONDecodeError:
                                parsed_value = field_value
                        else:
                            parsed_value = field_value
                        
                        # Encrypt the value
                        encrypted_value = self.encryption_service.encrypt_field(
                            table_name, 
                            field_name, 
                            parsed_value
                        )
                        
                        # Update the record
                        update_query = text(f"""
                            UPDATE {table_name} 
                            SET {field_name} = :encrypted_value, updated_at = CURRENT_TIMESTAMP 
                            WHERE id = :record_id
                        """)
                        
                        await db.execute(update_query, {
                            "encrypted_value": encrypted_value,
                            "record_id": record_id
                        })
                        
                        report["migrated_records"] += 1
                        logger.debug(f"Encrypted record {record_id}")
                    
                except Exception as e:
                    error_msg = f"Failed to process record {record_id}: {str(e)}"
                    logger.error(error_msg)
                    report["errors"].append(error_msg)
            
            if not dry_run:
                await db.commit()
                logger.info(f"Migration completed: {report['migrated_records']} records encrypted")
            else:
                logger.info(f"Dry run completed: {report['plain_text_records']} records would be encrypted")
                
        except Exception as e:
            error_msg = f"Migration failed for {table_name}.{field_name}: {str(e)}"
            logger.error(error_msg)
            report["errors"].append(error_msg)
            if not dry_run:
                await db.rollback()
        
        return report
    
    async def migrate_all_configured_fields(
        self, 
        db: AsyncSession, 
        dry_run: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Migrate all fields configured for encryption
        
        Args:
            db: Database session
            dry_run: If True, only analyze without making changes
            
        Returns:
            List of migration reports for each field
        """
        reports = []
        encrypted_fields = self.config.get_encrypted_fields()
        
        for table_name, field_names in encrypted_fields.items():
            for field_name in field_names:
                report = await self.migrate_table_field(
                    db, table_name, field_name, dry_run
                )
                reports.append(report)
        
        return reports
    
    async def verify_encryption(
        self, 
        db: AsyncSession, 
        table_name: str, 
        field_name: str
    ) -> Dict[str, Any]:
        """
        Verify that encryption/decryption is working correctly for a field
        
        Args:
            db: Database session
            table_name: Name of the table
            field_name: Name of the field
            
        Returns:
            Verification report
        """
        logger.info(f"Verifying encryption for {table_name}.{field_name}")
        
        report = {
            "table_name": table_name,
            "field_name": field_name,
            "total_records": 0,
            "encrypted_records": 0,
            "decryption_successful": 0,
            "decryption_failed": 0,
            "errors": []
        }
        
        try:
            # Get all records from the table
            query = text(f"SELECT id, {field_name} FROM {table_name}")
            result = await db.execute(query)
            records = result.fetchall()
            
            report["total_records"] = len(records)
            
            for record in records:
                record_id = record[0]
                field_value = record[1]
                
                if field_value is None:
                    continue
                
                try:
                    # Check if the value appears to be encrypted
                    if isinstance(field_value, str) and self.encryption_service.is_encrypted_value(field_value):
                        report["encrypted_records"] += 1
                        
                        # Try to decrypt it
                        decrypted_value = self.encryption_service.decrypt_field(
                            table_name, 
                            field_name, 
                            field_value
                        )
                        
                        if decrypted_value is not None:
                            report["decryption_successful"] += 1
                        else:
                            report["decryption_failed"] += 1
                            
                except Exception as e:
                    error_msg = f"Failed to decrypt record {record_id}: {str(e)}"
                    logger.error(error_msg)
                    report["errors"].append(error_msg)
                    report["decryption_failed"] += 1
                    
        except Exception as e:
            error_msg = f"Verification failed for {table_name}.{field_name}: {str(e)}"
            logger.error(error_msg)
            report["errors"].append(error_msg)
        
        return report
    
    def print_migration_report(self, reports: List[Dict[str, Any]]):
        """Print a formatted migration report"""
        print("\n" + "="*60)
        print("ENCRYPTION MIGRATION REPORT")
        print("="*60)
        
        for report in reports:
            print(f"\nTable: {report['table_name']}.{report['field_name']}")
            print(f"Mode: {'DRY RUN' if report['dry_run'] else 'LIVE MIGRATION'}")
            print(f"Total records: {report['total_records']}")
            print(f"Already encrypted: {report['encrypted_records']}")
            print(f"Plain text records: {report['plain_text_records']}")
            
            if not report['dry_run']:
                print(f"Successfully migrated: {report['migrated_records']}")
            
            if report['errors']:
                print(f"Errors: {len(report['errors'])}")
                for error in report['errors'][:3]:  # Show first 3 errors
                    print(f"  - {error}")
                if len(report['errors']) > 3:
                    print(f"  ... and {len(report['errors']) - 3} more errors")
        
        print("\n" + "="*60)

# Global instance
migration_service = EncryptionMigrationService()