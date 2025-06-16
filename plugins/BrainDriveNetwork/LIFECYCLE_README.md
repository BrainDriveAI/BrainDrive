# BrainDrive Network Plugin Lifecycle Management

This document explains how to use the lifecycle management system for the BrainDrive Network plugin, which provides user-scoped plugin installation without affecting other users.

## Overview

The lifecycle management system solves the critical design flaw where plugins installed by one user would automatically be available to all new users. This system ensures that:

- **User A installs plugin** → Only User A gets the plugin
- **User B logs in** → User B does NOT automatically get User A's plugin
- **Plugins are user-scoped** → Each user controls their own plugin installations

## Architecture

```
BrainDrive Network Plugin Lifecycle System
├── lifecycle_manager.py     # Core lifecycle operations
├── api_endpoints.py         # REST API endpoints
├── plugin_initializer.py    # Original initializer (deprecated for new installs)
└── LIFECYCLE_README.md      # This documentation
```

## Core Components

### 1. Lifecycle Manager (`lifecycle_manager.py`)

The main class that handles all plugin operations:

```python
from plugins.BrainDriveNetwork.lifecycle_manager import BrainDriveNetworkLifecycleManager

manager = BrainDriveNetworkLifecycleManager()

# Install plugin for specific user
result = await manager.install_plugin(user_id, db_session)

# Delete plugin for specific user
result = await manager.delete_plugin(user_id, db_session)

# Check plugin status
status = await manager.get_plugin_status(user_id, db_session)
```

### 2. Universal API Endpoints (`backend/app/plugins/lifecycle_api.py`)

Universal REST API endpoints that work with ANY plugin:

- `POST /api/plugins/{plugin_slug}/install` - Install any plugin
- `DELETE /api/plugins/{plugin_slug}/uninstall` - Remove any plugin
- `GET /api/plugins/{plugin_slug}/status` - Check any plugin status
- `GET /api/plugins/{plugin_slug}/info` - Get any plugin info
- `POST /api/plugins/{plugin_slug}/repair` - Repair any plugin
- `GET /api/plugins/available` - List all available plugins

**No need to create custom endpoints for each plugin!**

## Installation Process

### User-Scoped Installation

When a user installs the plugin:

1. **Directory Creation**: Creates `plugins/{user_id}/braindrive_network/`
2. **File Copying**: Copies plugin files to user directory
3. **Database Records**: Creates plugin and module records with `user_id`
4. **Validation**: Ensures installation integrity
5. **Isolation**: Plugin only available to installing user

### Database Structure

The system uses existing database tables with proper user scoping:

```sql
-- Plugin record (user-specific)
INSERT INTO plugin (id, user_id, plugin_slug, ...)
VALUES ('user123_braindrive_network', 'user123', 'braindrive_network', ...);

-- Module records (user-specific)
INSERT INTO module (id, plugin_id, user_id, ...)
VALUES ('user123_braindrive_network_ComponentNetworkStatus', 'user123_braindrive_network', 'user123', ...);
```

## Usage Examples

### 1. Direct Python Usage

```python
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from plugins.BrainDriveNetwork.lifecycle_manager import BrainDriveNetworkLifecycleManager

async def install_for_user(user_id: str, db: AsyncSession):
    manager = BrainDriveNetworkLifecycleManager()

    # Install plugin
    result = await manager.install_plugin(user_id, db)

    if result['success']:
        print(f"Plugin installed successfully!")
        print(f"Plugin ID: {result['plugin_id']}")
        print(f"Modules created: {len(result['modules_created'])}")
    else:
        print(f"Installation failed: {result['error']}")

# Usage
# await install_for_user("user123", db_session)
```

### 2. Universal API Usage

```bash
# Install ANY plugin for authenticated user (using plugin slug)
curl -X POST /api/plugins/braindrive-network/install \
  -H "Authorization: Bearer <token>"

# Install a different plugin
curl -X POST /api/plugins/my-custom-plugin/install \
  -H "Authorization: Bearer <token>"

# Check installation status of any plugin
curl -X GET /api/plugins/braindrive-network/status \
  -H "Authorization: Bearer <token>"

# List all available plugins
curl -X GET /api/plugins/available

# Get info about any plugin
curl -X GET /api/plugins/braindrive-network/info

# Uninstall any plugin
curl -X DELETE /api/plugins/braindrive-network/uninstall \
  -H "Authorization: Bearer <token>"
```

### 3. Frontend Integration

```javascript
// Universal plugin installation function
const installPlugin = async (pluginSlug) => {
  try {
    const response = await fetch(`/api/plugins/${pluginSlug}/install`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.status === 'success') {
      console.log(`Plugin '${pluginSlug}' installed successfully!`);
      // Refresh plugin list or show success message
    }
  } catch (error) {
    console.error('Installation failed:', error);
  }
};

// Check any plugin status
const checkPluginStatus = async (pluginSlug) => {
  const response = await fetch(`/api/plugins/${pluginSlug}/status`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });

  const result = await response.json();
  return result.data;
};

// Get list of available plugins
const getAvailablePlugins = async () => {
  const response = await fetch('/api/plugins/available');
  const result = await response.json();
  return result.data.available_plugins;
};

// Usage examples:
// installPlugin('braindrive-network');
// installPlugin('my-custom-plugin');
// checkPluginStatus('braindrive-network');
```

## File System Structure

After installation, the plugin creates this structure:

```
plugins/
├── user123/                           # User-specific directory
│   └── braindrive_network/           # Plugin directory
│       ├── dist/                     # Built plugin files
│       │   └── remoteEntry.js        # Main plugin bundle
│       ├── src/                      # Source files (copied)
│       ├── public/                   # Public assets
│       ├── package.json              # Plugin metadata
│       ├── README.md                 # Plugin documentation
│       └── plugin_metadata.json     # Installation metadata
└── user456/                          # Another user's plugins
    └── braindrive_network/           # Same plugin, different user
        └── ...                       # Independent installation
```

## Integration with BrainDrive Backend

### 1. Register Universal API Routes

```python
# In main BrainDrive backend
from backend.app.plugins.lifecycle_api import register_universal_plugin_routes

# Register the universal plugin lifecycle routes (works for ALL plugins)
register_universal_plugin_routes(main_app.router)
```

**This single registration provides lifecycle management for ALL plugins!**

### 2. Database Dependencies

The lifecycle manager requires access to:
- `AsyncSession` for database operations
- `plugin` and `module` tables
- User authentication system

### 3. File System Permissions

Ensure the BrainDrive backend has:
- Read/write access to `plugins/` directory
- Ability to create user-specific subdirectories
- Proper file permissions for plugin files

## Error Handling

The system provides comprehensive error handling:

### Installation Errors

```python
result = await manager.install_plugin(user_id, db)

if not result['success']:
    error_type = result['error']

    if 'already installed' in error_type:
        # Plugin already exists for user
        pass
    elif 'Failed to create' in error_type:
        # File system permission issue
        pass
    elif 'database' in error_type.lower():
        # Database operation failed
        pass
```

### Status Checking

```python
status = await manager.get_plugin_status(user_id, db)

if status['exists']:
    if status['status'] == 'healthy':
        # Plugin is working correctly
        pass
    elif status['status'] == 'files_missing':
        # Files deleted but database records exist
        # Use repair endpoint
        pass
    elif status['status'] == 'modules_corrupted':
        # Database inconsistency
        pass
```

## Migration from UserInitializerBase

If you have existing plugins using the old `UserInitializerBase` system:

### 1. Identify Affected Users

```sql
-- Find users who have the plugin from old system
SELECT DISTINCT user_id
FROM plugin
WHERE plugin_slug = 'braindrive_network';
```

### 2. Migrate to New System

```python
async def migrate_existing_installations():
    # For each user with existing plugin
    for user_id in affected_users:
        # Check if files exist in old location
        # Move to new user-scoped location
        # Update database records if needed
        pass
```

### 3. Disable Old Initializer

Remove or comment out the `UserInitializerBase` registration to prevent automatic installation for new users.

## Security Considerations

### User Isolation

- Each user's plugins are stored in separate directories
- Database records include `user_id` for proper scoping
- API endpoints verify user ownership before operations

### File System Security

- Plugin files are copied, not linked (prevents modification of source)
- User directories have appropriate permissions
- Validation ensures files haven't been tampered with

### Database Security

- All operations include user verification
- Foreign key constraints prevent orphaned records
- Transactions ensure consistency

## Troubleshooting

### Common Issues

1. **Plugin appears for all users**
   - Check if old `UserInitializerBase` is still active
   - Verify new lifecycle system is being used

2. **Installation fails with permission error**
   - Check file system permissions on `plugins/` directory
   - Ensure BrainDrive backend can create directories

3. **Database errors during installation**
   - Verify database schema is up to date
   - Check for foreign key constraint issues

4. **Plugin files missing after installation**
   - Check if source plugin files exist
   - Verify copy operation completed successfully

### Debug Commands

```bash
# Check plugin status via CLI
python plugins/BrainDriveNetwork/lifecycle_manager.py status user123

# Validate installation
python plugins/BrainDriveNetwork/lifecycle_manager.py install user123
```

## Performance Considerations

### File Operations

- Plugin files are copied once per user installation
- Consider disk space usage for multiple users
- Implement cleanup for deleted users

### Database Operations

- All operations are scoped by `user_id`
- Indexes on `user_id` and `plugin_slug` recommended
- Batch operations for multiple users if needed

### Caching

- Plugin metadata can be cached per user
- File system checks can be optimized
- Consider Redis for status caching

## Future Enhancements

### Planned Features

1. **Plugin Updates**: Update existing installations to new versions
2. **Bulk Operations**: Install/uninstall for multiple users
3. **Plugin Sharing**: Allow users to share plugins with others
4. **Version Management**: Support multiple plugin versions
5. **Dependency Management**: Handle plugin dependencies

### API Extensions

- `PUT /api/plugins/braindrive-network/update` - Update plugin
- `POST /api/plugins/braindrive-network/share` - Share with other users
- `GET /api/plugins/braindrive-network/versions` - List available versions

This lifecycle management system provides a robust, secure, and scalable solution for user-scoped plugin management in BrainDrive.