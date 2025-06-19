"""
Encryption configuration for BrainDrive
Defines which table fields should be encrypted
"""
import os
from typing import Dict, List

# Configuration for encrypted fields
# Format: {"table_name": ["field1", "field2"]}
ENCRYPTED_FIELDS: Dict[str, List[str]] = {
    "settings_instances": ["value"],
    # Add more tables and fields as needed
    # "users": ["password"],  # Future: if we want to double-encrypt passwords
    # "sessions": ["session_data"],  # Future: encrypt session data
}

# Per-field encryption settings (optional)
FIELD_ENCRYPTION_SETTINGS: Dict[str, Dict[str, any]] = {
    "settings_instances.value": {
        "algorithm": "AES-256-GCM",
        "key_derivation": "PBKDF2",
        "compress": True,  # Compress JSON before encryption
        "encoding": "base64"
    },
    # Future field settings can be added here
}

class EncryptionConfigService:
    """Service for managing encryption configuration"""
    
    def __init__(self):
        self.use_database = os.getenv('ENCRYPTION_CONFIG_SOURCE', 'file') == 'database'
        self._file_config = ENCRYPTED_FIELDS
        self._field_settings = FIELD_ENCRYPTION_SETTINGS
    
    def get_encrypted_fields(self) -> Dict[str, List[str]]:
        """Get encryption configuration from file (database support in future)"""
        return self._file_config
    
    def should_encrypt_field(self, table_name: str, field_name: str) -> bool:
        """Check if a field should be encrypted based on configuration"""
        config = self.get_encrypted_fields()
        return table_name in config and field_name in config[table_name]
    
    def get_field_settings(self, table_name: str, field_name: str) -> Dict[str, any]:
        """Get encryption settings for a specific field"""
        field_key = f"{table_name}.{field_name}"
        return self._field_settings.get(field_key, {
            "algorithm": "AES-256-GCM",
            "key_derivation": "PBKDF2",
            "compress": False,
            "encoding": "base64"
        })
    
    def get_all_encrypted_fields(self) -> List[str]:
        """Get a flat list of all encrypted fields in table.field format"""
        encrypted_fields = []
        for table_name, fields in self.get_encrypted_fields().items():
            for field_name in fields:
                encrypted_fields.append(f"{table_name}.{field_name}")
        return encrypted_fields

# Global instance
encryption_config = EncryptionConfigService()