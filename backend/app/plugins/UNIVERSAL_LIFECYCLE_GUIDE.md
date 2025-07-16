# Universal Plugin Lifecycle Management Guide

This guide explains how to create plugins that work with the universal lifecycle API system, eliminating the need for custom endpoints for each plugin.

## Overview

The universal lifecycle system provides a single set of API endpoints that can manage ANY plugin, as long as the plugin follows the standard lifecycle manager pattern.

## Benefits

✅ **No Custom Endpoints Needed**: One API handles all plugins
✅ **Consistent Interface**: Same API pattern for every plugin
✅ **User-Scoped Installation**: Plugins only affect the installing user
✅ **Automatic Discovery**: Plugins are automatically detected
✅ **Standardized Management**: Install, uninstall, status, repair for all plugins

## Universal API Endpoints

```
POST   /api/plugins/{plugin_slug}/install     # Install any plugin
DELETE /api/plugins/{plugin_slug}/uninstall   # Uninstall any plugin
GET    /api/plugins/{plugin_slug}/status      # Check any plugin status
GET    /api/plugins/{plugin_slug}/info        # Get any plugin info
POST   /api/plugins/{plugin_slug}/repair      # Repair any plugin
GET    /api/plugins/available                 # List all available plugins
```

## Creating a Plugin with Lifecycle Support

### Step 1: Create Your Plugin Directory

```
plugins/
└── MyAwesomePlugin/
    ├── lifecycle_manager.py    # Required for universal API
    ├── package.json           # Plugin metadata
    ├── src/                   # Your plugin source code
    ├── dist/                  # Built plugin files
    └── README.md              # Plugin documentation
```

### Step 2: Create lifecycle_manager.py

Your plugin needs a `lifecycle_manager.py` file with a class that ends in `LifecycleManager`:

```python
#!/usr/bin/env python3
"""
My Awesome Plugin Lifecycle Manager
"""

import json
import datetime
from pathlib import Path
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import structlog

logger = structlog.get_logger()

class MyAwesomePluginLifecycleManager:
    """Lifecycle manager for My Awesome Plugin"""

    def __init__(self, plugins_base_dir: str = None):
        if plugins_base_dir:
            self.plugins_base_dir = Path(plugins_base_dir)
        else:
            self.plugins_base_dir = Path(__file__).parent.parent

        # Define your plugin metadata
        self.PLUGIN_DATA = {
            "name": "My Awesome Plugin",
            "description": "An awesome plugin that does amazing things",
            "version": "1.0.0",
            "type": "frontend",
            "icon": "Star",
            "category": "productivity",
            "official": False,
            "author": "Your Name",
            "compatibility": "1.0.0",
            "scope": "my_awesome_plugin",
            "bundle_method": "webpack",
            "bundle_location": "dist/remoteEntry.js",
            "is_local": True,
            "long_description": "A detailed description of what your plugin does",
            "plugin_slug": "my_awesome_plugin",
            "source_type": "local",
            "source_url": "local://plugins/MyAwesomePlugin",
            "permissions": ["storage.read", "storage.write"]
        }

        # Define your plugin modules
        self.MODULE_DATA = [
            {
                "name": "AwesomeComponent",
                "display_name": "Awesome Component",
                "description": "The main component of the awesome plugin",
                "icon": "Star",
                "category": "productivity",
                "priority": 1,
                "props": {},
                "config_fields": {
                    "awesome_setting": {
                        "type": "string",
                        "description": "An awesome setting",
                        "default": "awesome_value"
                    }
                },
                "messages": {},
                "required_services": {
                    "api": {"methods": ["get", "post"], "version": "1.0.0"}
                },
                "dependencies": [],
                "layout": {
                    "minWidth": 2,
                    "minHeight": 2,
                    "defaultWidth": 4,
                    "defaultHeight": 3
                },
                "tags": ["productivity", "awesome", "utility"]
            }
        ]

    async def install_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Install plugin for specific user"""
        # Implementation similar to BrainDriveNetwork example
        # See lifecycle_manager_template.py for full implementation
        pass

    async def delete_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Delete plugin for user"""
        # Implementation similar to BrainDriveNetwork example
        pass

    async def get_plugin_status(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        """Get plugin status"""
        # Implementation similar to BrainDriveNetwork example
        pass
```

### Step 3: Test Your Plugin

Once you have `lifecycle_manager.py`, your plugin automatically works with the universal API:

```bash
# Install your plugin
curl -X POST /api/plugins/my-awesome-plugin/install \
  -H "Authorization: Bearer <token>"

# Check status
curl -X GET /api/plugins/my-awesome-plugin/status \
  -H "Authorization: Bearer <token>"

# List all available plugins (yours will appear here)
curl -X GET /api/plugins/available
```

## Plugin Naming Conventions

The universal system automatically detects plugins using these patterns:

### Directory Names
- `MyAwesomePlugin` → slug: `myawesomeplugin`
- `my-awesome-plugin` → slug: `my-awesome-plugin`
- `my_awesome_plugin` → slug: `my_awesome_plugin`

### Class Names
Your lifecycle manager class must end with `LifecycleManager`:
- `MyAwesomePluginLifecycleManager` ✅
- `AwesomeLifecycleManager` ✅
- `MyAwesomePlugin` ❌ (missing LifecycleManager suffix)

## Integration with BrainDrive Backend

### One-Time Setup

Add this to your main BrainDrive backend to enable universal plugin management:

```python
# In your main FastAPI app
from backend.app.plugins.lifecycle_api import register_universal_plugin_routes

# Register universal plugin routes (works for ALL plugins)
register_universal_plugin_routes(app.router)
```

That's it! No need to register individual plugin routes.

## Frontend Integration

### Universal Plugin Management UI

```javascript
// Get all available plugins
const getAvailablePlugins = async () => {
  const response = await fetch('/api/plugins/available');
  const result = await response.json();
  return result.data.available_plugins;
};

// Install any plugin
const installPlugin = async (pluginSlug) => {
  const response = await fetch(`/api/plugins/${pluginSlug}/install`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};

// Check any plugin status
const getPluginStatus = async (pluginSlug) => {
  const response = await fetch(`/api/plugins/${pluginSlug}/status`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};

// Uninstall any plugin
const uninstallPlugin = async (pluginSlug) => {
  const response = await fetch(`/api/plugins/${pluginSlug}/uninstall`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};
```

### Plugin Store UI Example

```javascript
const PluginStore = () => {
  const [availablePlugins, setAvailablePlugins] = useState({});
  const [installedPlugins, setInstalledPlugins] = useState({});

  useEffect(() => {
    // Load available plugins
    getAvailablePlugins().then(setAvailablePlugins);

    // Check which plugins are installed for current user
    Object.keys(availablePlugins).forEach(async (slug) => {
      const status = await getPluginStatus(slug);
      if (status.data.exists) {
        setInstalledPlugins(prev => ({...prev, [slug]: status.data}));
      }
    });
  }, []);

  const handleInstall = async (pluginSlug) => {
    const result = await installPlugin(pluginSlug);
    if (result.status === 'success') {
      // Refresh installed plugins list
      const status = await getPluginStatus(pluginSlug);
      setInstalledPlugins(prev => ({...prev, [pluginSlug]: status.data}));
    }
  };

  return (
    <div>
      <h2>Available Plugins</h2>
      {Object.entries(availablePlugins).map(([slug, plugin]) => (
        <div key={slug}>
          <h3>{plugin.name}</h3>
          <p>{plugin.description}</p>
          {installedPlugins[slug] ? (
            <span>✅ Installed</span>
          ) : (
            <button onClick={() => handleInstall(slug)}>
              Install
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
```

## Plugin Development Best Practices

### 1. Follow the Standard Structure

```
YourPlugin/
├── lifecycle_manager.py      # Required - implements lifecycle operations
├── package.json             # Plugin metadata
├── src/                     # Source code
│   ├── index.tsx           # Main component
│   └── components/         # Sub-components
├── dist/                   # Built files
│   └── remoteEntry.js      # Webpack module federation entry
├── public/                 # Static assets
├── README.md               # Documentation
└── webpack.config.js       # Build configuration
```

### 2. Use Consistent Metadata

Ensure your `package.json` and `PLUGIN_DATA` have consistent information:

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "description": "An awesome plugin",
  "author": "Your Name",
  "braindrive": {
    "pluginType": "frontend",
    "category": "productivity",
    "permissions": ["storage.read", "storage.write"]
  }
}
```

### 3. Handle Errors Gracefully

```python
async def install_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
    try:
        # Installation logic
        return {'success': True, 'plugin_id': plugin_id}
    except Exception as e:
        logger.error(f"Installation failed: {e}")
        await db.rollback()
        return {'success': False, 'error': str(e)}
```

### 4. Implement Proper Cleanup

```python
async def delete_plugin(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
    try:
        # Clean up database records
        # Clean up files
        # Clean up any external resources
        await db.commit()
        return {'success': True}
    except Exception as e:
        await db.rollback()
        return {'success': False, 'error': str(e)}
```

## Migration from Old System

If you have existing plugins using the `UserInitializerBase` system:

### 1. Create Lifecycle Manager

Create a `lifecycle_manager.py` file in your plugin directory using the pattern above.

### 2. Disable Old Initializer

Comment out or remove the `UserInitializerBase` registration to prevent automatic installation.

### 3. Test Migration

```bash
# Test that your plugin works with universal API
curl -X GET /api/plugins/available
# Your plugin should appear in the list

curl -X POST /api/plugins/your-plugin-slug/install \
  -H "Authorization: Bearer <token>"
```

## Troubleshooting

### Plugin Not Appearing in Available List

1. Check that `lifecycle_manager.py` exists in your plugin directory
2. Verify the class name ends with `LifecycleManager`
3. Check the plugin directory name matches expected patterns
4. Look at server logs for import errors

### Installation Fails

1. Check database permissions and schema
2. Verify file system permissions for plugin directories
3. Check that all required files exist in the plugin directory
4. Review the error message in the API response

### Plugin Status Shows as Corrupted

1. Use the repair endpoint: `POST /api/plugins/{slug}/repair`
2. Check file system integrity
3. Verify database records exist and are consistent
4. Check plugin-specific status requirements

## Example: Complete Plugin

See `plugins/BrainDriveNetwork/` for a complete example of a plugin that works with the universal lifecycle system.

## Summary

The universal lifecycle system eliminates the need for custom API endpoints for each plugin while providing:

- **Consistent API**: Same endpoints work for all plugins
- **User Scoping**: Plugins only affect the installing user
- **Automatic Discovery**: Plugins are detected automatically
- **Standard Operations**: Install, uninstall, status, repair for all plugins
- **Easy Development**: Follow the pattern, get full lifecycle support

This solves the original design flaw where plugins installed by one user would affect all users, while providing a scalable and maintainable plugin management system.