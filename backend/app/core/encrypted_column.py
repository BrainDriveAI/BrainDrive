"""
SQLAlchemy encrypted column type for automatic field encryption/decryption
"""
import logging
from typing import Any, Optional
from sqlalchemy import TypeDecorator, Text
from sqlalchemy.engine import Dialect

from .encryption import encryption_service, EncryptionError

logger = logging.getLogger(__name__)

class EncryptedType(TypeDecorator):
    """
    SQLAlchemy column type that automatically encrypts/decrypts field values
    based on configuration
    """
    
    # Use Text as the underlying SQL type to store base64-encoded encrypted data
    impl = Text
    cache_ok = True  # Enable SQLAlchemy query caching
    
    def __init__(self, table_name: str, field_name: str, *args, **kwargs):
        """
        Initialize encrypted column type
        
        Args:
            table_name: Name of the database table
            field_name: Name of the field being encrypted
        """
        self.table_name = table_name
        self.field_name = field_name
        super().__init__(*args, **kwargs)
    
    def process_bind_param(self, value: Any, dialect: Dialect) -> Optional[str]:
        """
        Process value when binding to database (encrypt on save)
        
        Args:
            value: The original value to be stored
            dialect: SQLAlchemy dialect (not used)
            
        Returns:
            Encrypted string or None
        """
        if value is None:
            return None
            
        # Check if field should be encrypted
        if not encryption_service.should_encrypt_field(self.table_name, self.field_name):
            # If encryption is disabled for this field, store as JSON string
            import json
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            return str(value)
        
        try:
            # Encrypt the value
            encrypted_value = encryption_service.encrypt_field(
                self.table_name, 
                self.field_name, 
                value
            )
            
            logger.debug(f"Encrypted field {self.table_name}.{self.field_name}")
            return encrypted_value
            
        except EncryptionError as e:
            logger.error(f"Failed to encrypt {self.table_name}.{self.field_name}: {e}")
            # In production, you might want to raise the error
            # For now, we'll store the value unencrypted as fallback
            import json
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
            return str(value)
    
    def process_result_value(self, value: Optional[str], dialect: Dialect) -> Any:
        """
        Process value when loading from database (decrypt on load)
        
        Args:
            value: The encrypted string from database
            dialect: SQLAlchemy dialect (not used)
            
        Returns:
            Decrypted original value or None
        """
        if value is None:
            return None
            
        # Check if field should be encrypted
        if not encryption_service.should_encrypt_field(self.table_name, self.field_name):
            # If encryption is disabled, try to parse as JSON
            try:
                import json
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value
        
        try:
            # Check if the value appears to be encrypted
            if encryption_service.is_encrypted_value(value):
                # Decrypt the value
                decrypted_value = encryption_service.decrypt_field(
                    self.table_name,
                    self.field_name,
                    value
                )
                
                logger.debug(f"Decrypted field {self.table_name}.{self.field_name}")
                return decrypted_value
            else:
                # Value is not encrypted (legacy data or encryption disabled)
                # Try to parse as JSON
                try:
                    import json
                    return json.loads(value)
                except (json.JSONDecodeError, TypeError):
                    return value
                    
        except EncryptionError as e:
            logger.error(f"Failed to decrypt {self.table_name}.{self.field_name}: {e}")
            # Return the raw value as fallback
            try:
                import json
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value

class EncryptedJSON(EncryptedType):
    """
    Specialized encrypted type for JSON fields
    Provides better type hints and validation
    """
    
    def __init__(self, table_name: str, field_name: str, *args, **kwargs):
        super().__init__(table_name, field_name, *args, **kwargs)
    
    def process_bind_param(self, value: Any, dialect: Dialect) -> Optional[str]:
        """Ensure value is JSON-serializable before encryption"""
        if value is None:
            return None
            
        # Validate that the value is JSON-serializable
        try:
            import json
            json.dumps(value)  # Test serialization
        except (TypeError, ValueError) as e:
            logger.error(f"Value for {self.table_name}.{self.field_name} is not JSON-serializable: {e}")
            raise ValueError(f"Value must be JSON-serializable: {e}")
        
        return super().process_bind_param(value, dialect)

def create_encrypted_column(table_name: str, field_name: str, json_type: bool = True):
    """
    Factory function to create encrypted column types
    
    Args:
        table_name: Name of the database table
        field_name: Name of the field
        json_type: Whether to use EncryptedJSON (True) or EncryptedType (False)
        
    Returns:
        Configured encrypted column type
    """
    if json_type:
        return EncryptedJSON(table_name, field_name)
    else:
        return EncryptedType(table_name, field_name)