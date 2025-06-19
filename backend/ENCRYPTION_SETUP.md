# BrainDrive Encryption System Setup

This document explains how to set up and use the new encryption system for API keys and other sensitive data in BrainDrive.

## Overview

The encryption system automatically encrypts sensitive fields (like API keys) when storing them in the database and decrypts them when retrieving. It uses AES-256-GCM encryption with automatic compression for JSON data.

## Quick Setup

### 1. Set Environment Variable

Add the encryption master key to your environment:

```bash
# For development (.env file)
ENCRYPTION_MASTER_KEY=your-very-secure-random-key-here-make-it-long-and-complex

# For production (set in your deployment environment)
export ENCRYPTION_MASTER_KEY="your-very-secure-random-key-here-make-it-long-and-complex"
```

**⚠️ Important**: 
- Use a strong, random key (at least 32 characters)
- Keep this key secure and backed up
- Never commit this key to version control
- If you lose this key, encrypted data cannot be recovered

### 2. Test the System

Run the test script to verify everything works:

```bash
cd backend
python test_encryption.py
```

You should see output like:
```
🧪 Testing BrainDrive Encryption System
==================================================
✅ All tests passed!
```

### 3. Migrate Existing Data

If you have existing API keys in the database, migrate them to encrypted format:

```bash
# First, do a dry run to see what would be encrypted
python migrate_encryption.py --dry-run

# If everything looks good, run the actual migration
python migrate_encryption.py
```

## Configuration

### Encrypted Fields

The system is configured to encrypt these fields by default:

- `settings_instances.value` - Contains API keys and other sensitive settings

To add more fields, edit `backend/app/core/encryption_config.py`:

```python
ENCRYPTED_FIELDS = {
    "settings_instances": ["value"],
    "your_table": ["sensitive_field"],  # Add your fields here
}
```

### Field Settings

You can customize encryption settings per field:

```python
FIELD_ENCRYPTION_SETTINGS = {
    "settings_instances.value": {
        "algorithm": "AES-256-GCM",
        "compress": True,  # Compress JSON before encryption
        "encoding": "base64"
    }
}
```

## Usage

### Automatic Encryption

Once set up, encryption happens automatically:

```python
# When you save a SettingInstance, the value field is automatically encrypted
setting = SettingInstance(
    definition_id="ollama_servers_settings",
    name="My Settings",
    value={
        "servers": [{
            "apiKey": "secret-key-123",  # This gets encrypted automatically
            "serverAddress": "http://localhost:11434"
        }]
    }
)
await db.add(setting)
await db.commit()

# When you retrieve it, the value is automatically decrypted
retrieved = await SettingInstance.get_by_id(db, setting.id)
print(retrieved.value["servers"][0]["apiKey"])  # Prints: "secret-key-123"
```

### Frontend Compatibility

The frontend code doesn't need to change. The ComponentOllamaServer.tsx will continue to work exactly as before because encryption/decryption happens transparently in the backend.

## Migration Commands

### Migrate All Configured Fields
```bash
python migrate_encryption.py
```

### Dry Run (Analyze Only)
```bash
python migrate_encryption.py --dry-run
```

### Migrate Specific Table
```bash
python migrate_encryption.py --table settings_instances
```

### Migrate Specific Field
```bash
python migrate_encryption.py --table settings_instances --field value
```

### Verify Encryption
```bash
python migrate_encryption.py --verify
```

## Security Features

### Encryption Details
- **Algorithm**: AES-256-GCM (Authenticated encryption)
- **Key Derivation**: PBKDF2 with 100,000 iterations
- **IV**: Random 96-bit IV for each encryption
- **Authentication**: Built-in authentication tag prevents tampering
- **Compression**: Optional gzip compression for large JSON data

### Key Management
- Master key stored in environment variable
- Key derivation with static salt
- Future support for key rotation planned

### Data Integrity
- Authentication tag prevents data tampering
- Automatic detection of encrypted vs plain-text data
- Graceful fallback for migration scenarios

## Troubleshooting

### Common Issues

#### "ENCRYPTION_MASTER_KEY environment variable not set"
Set the environment variable as described in step 1.

#### "Failed to decrypt field: data may have been tampered with"
This usually means:
1. The encryption key has changed
2. The data was corrupted
3. The data wasn't actually encrypted

#### Migration fails with "Failed to process record"
Check the logs for specific errors. Common causes:
1. Invalid JSON in existing data
2. Database connection issues
3. Insufficient permissions

### Debug Mode

Enable debug logging to see encryption/decryption operations:

```python
import logging
logging.getLogger('app.core.encryption').setLevel(logging.DEBUG)
```

### Recovery

If you lose the encryption key:
1. Encrypted data cannot be recovered
2. You'll need to reset API keys manually
3. Consider implementing key backup procedures

## Performance

### Benchmarks
Typical performance on modern hardware:
- Encryption: ~1-2ms per operation
- Decryption: ~1-2ms per operation
- Compression reduces storage by ~30-50% for JSON data

### Optimization Tips
1. Enable compression for large JSON fields
2. Consider caching frequently accessed decrypted data
3. Use database connection pooling

## Future Enhancements

### Planned Features
- Database-based configuration management
- Key rotation support
- Multiple encryption algorithms
- Per-user encryption keys
- Hardware security module (HSM) support

### Migration Path
The system is designed to evolve from file-based to database-based configuration without breaking existing functionality.

## Support

For issues or questions:
1. Check the logs for specific error messages
2. Run the test script to verify system health
3. Use the verification command to check data integrity
4. Review this documentation for troubleshooting steps

## Security Best Practices

1. **Key Management**
   - Use a strong, random encryption key
   - Store keys securely (environment variables, key management service)
   - Implement key backup and recovery procedures
   - Consider key rotation policies

2. **Deployment**
   - Never commit encryption keys to version control
   - Use different keys for different environments
   - Implement proper access controls
   - Monitor for encryption/decryption errors

3. **Backup**
   - Backup both encrypted data and encryption keys
   - Test recovery procedures regularly
   - Document key recovery processes
   - Consider offline key storage

4. **Monitoring**
   - Monitor encryption/decryption performance
   - Alert on encryption failures
   - Track key usage and rotation
   - Audit access to encrypted data