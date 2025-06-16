# Plugin Update and Delete Functionality Test

## Overview
This document describes the new update and delete functionality added to the ModuleDetailPage.tsx for plugins that have source URLs.

## Features Added

### 1. Backend Changes
- **Plugin Model**: Added fields for tracking plugin source information:
  - `source_type`: Type of plugin source (github, gitlab, npm, custom, local)
  - `source_url`: Original repository or source URL
  - `update_check_url`: Specific API endpoint for checking updates
  - `last_update_check`: When we last checked for updates
  - `update_available`: Cached flag indicating if update is available
  - `latest_version`: Latest available version (cached)
  - `installation_type`: Installation type (local or remote)
  - `permissions`: JSON array of required permissions

- **API Endpoints**: Added new lifecycle API endpoints:
  - `POST /api/v1/plugins/{plugin_slug}/update`: Update a plugin to the latest version
  - `DELETE /api/v1/plugins/{plugin_slug}/uninstall`: Delete/uninstall a plugin completely
  - `GET /api/v1/plugins/updates/available`: Check for available plugin updates

### 2. Frontend Changes
- **Plugin Types**: Updated Plugin interface to include new source tracking fields
- **Module Service**: Added methods for updating and deleting plugins
- **ModuleDetailHeader**: Added update and delete buttons with confirmation dialogs
- **ModuleDetailPage**: Added handlers for update and delete operations

## How It Works

### Update Button
- **Visibility**: Shows only if `plugin.sourceUrl` exists AND `plugin.updateAvailable` is true
- **Functionality**:
  - Displays a confirmation dialog showing current and latest versions
  - Calls the update API endpoint
  - Refreshes the page after successful update
  - Shows loading state and error handling

### Delete Button
- **Visibility**: Shows only if `plugin.sourceUrl` exists (indicating it's a remotely installed plugin)
- **Functionality**:
  - Displays a confirmation dialog warning about permanent deletion
  - Calls the delete API endpoint
  - Navigates back to plugin manager after successful deletion
  - Shows loading state and error handling

## Testing the Functionality

### Prerequisites
1. A plugin must have a `source_url` field populated in the database
2. For update button to show, `update_available` must be true
3. The plugin must have been installed via the remote installer

### Test Scenario 1: Plugin with Update Available
```sql
-- Example: Update a plugin to show update available
UPDATE plugin
SET source_url = 'https://github.com/example/plugin',
    source_type = 'github',
    update_available = true,
    latest_version = '1.1.0'
WHERE plugin_slug = 'example-plugin';
```

### Test Scenario 2: Plugin with Source URL (Delete Available)
```sql
-- Example: Set a plugin as remotely installed
UPDATE plugin
SET source_url = 'https://github.com/example/plugin',
    source_type = 'github',
    installation_type = 'remote'
WHERE plugin_slug = 'example-plugin';
```

## UI Behavior

### Update Button
- **Text**: "Update Available"
- **Color**: Primary (blue)
- **Icon**: Update icon
- **Position**: Next to the module status toggle

### Delete Button
- **Text**: "Delete Plugin"
- **Color**: Error (red)
- **Icon**: Delete icon
- **Position**: Next to the update button (if present)

### Confirmation Dialogs
- **Update Dialog**: Shows current version → latest version
- **Delete Dialog**: Warns about permanent deletion and data loss
- Both dialogs show loading states and error messages

## Error Handling
- Network errors are caught and displayed in the dialog
- Failed operations show error messages without closing the dialog
- Successful operations close dialogs and perform appropriate navigation

## Integration Notes
- The functionality integrates with the existing plugin lifecycle management system
- Uses the universal plugin lifecycle API for consistent behavior
- Maintains compatibility with existing local plugins (buttons won't show)
- Follows the existing UI patterns and styling