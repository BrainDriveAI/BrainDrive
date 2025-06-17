# Debugging Lifecycle Manager Loading Issue

## Current Status

The remote plugin installation is now working correctly up to the final step:

✅ **Download & Extract**: Successfully downloads and extracts plugin
✅ **Plugin Slug Extraction**: Correctly extracts `plugin_slug: "BrainDriveNetwork"` from source code
✅ **File Copying**: Files copied to correct location `/backend/plugins/BrainDriveNetwork/`
✅ **Universal Manager Creation**: Successfully creates universal lifecycle manager

❌ **Lifecycle Manager Instantiation**: Still failing to instantiate the NetworkEyes lifecycle manager

## Problem Analysis

The issue is that when the Universal Lifecycle Manager tries to load the copied plugin's lifecycle manager, it's still getting the abstract `BaseLifecycleManager` class instead of the concrete `NetworkEyesLifecycleManager` class.

### Possible Root Causes

1. **Import Context Issue**: When the plugin is copied to `/backend/plugins/BrainDriveNetwork/`, the import context changes and the NetworkEyes lifecycle manager can't properly import `BaseLifecycleManager` from `app.plugins`

2. **Class Resolution Issue**: The lifecycle API might be finding the wrong class or the NetworkEyes class might not be properly extending the base class

3. **Module Loading Issue**: The dynamic import might not be working correctly in the new location

## Debugging Improvements Added

### 1. Enhanced Class Detection
```python
# Find the lifecycle manager class (should end with 'LifecycleManager')
manager_class = None
available_classes = []
for attr_name in dir(module):
    attr = getattr(module, attr_name)
    if isinstance(attr, type):
        available_classes.append(attr_name)
        if (attr_name.endswith('LifecycleManager') and
            attr_name != 'LifecycleManager' and
            attr_name != 'BaseLifecycleManager'):
            manager_class = attr
            logger.info(f"Found lifecycle manager class: {attr_name} for plugin {plugin_slug}")
            break

logger.info(f"Available classes in {plugin_slug} module: {available_classes}")
```

### 2. Enhanced Instantiation Debugging
```python
logger.info(f"Attempting to instantiate {manager_class.__name__} for plugin {plugin_slug}")
logger.info(f"Manager class MRO: {[cls.__name__ for cls in manager_class.__mro__]}")
```

### 3. Improved Module Loading
```python
# Add the plugin directory and the backend directory to Python path
plugin_dir = lifecycle_manager_path.parent
backend_dir = Path(__file__).parent.parent
if str(plugin_dir) not in sys.path:
    sys.path.insert(0, str(plugin_dir))
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
```

## Expected Debug Output

The next test run should show:

1. **Available Classes**: What classes are found in the NetworkEyes module
2. **Found Class**: Which specific lifecycle manager class is detected
3. **Class MRO**: The method resolution order showing the inheritance chain
4. **Module Loading**: Whether the module loads successfully with improved path handling

## Next Steps Based on Debug Output

### If we see `NetworkEyesLifecycleManager` in available classes:
- The class is being found correctly
- The issue is in instantiation
- Need to fix the instantiation parameters

### If we see `BaseLifecycleManager` in the MRO:
- The inheritance is working correctly
- The issue might be with the abstract method implementation

### If we see import errors during module loading:
- The import context issue is confirmed
- Need to fix the import path or provide the BaseLifecycleManager in the plugin context

### If we see the wrong class being selected:
- The class detection logic needs refinement
- Need to be more specific about which class to select

## Potential Solutions

1. **Fix Import Context**: Ensure the copied plugin can properly import BaseLifecycleManager
2. **Bundle Dependencies**: Copy the BaseLifecycleManager to the plugin directory
3. **Modify Import Logic**: Update the NetworkEyes plugin to handle the new import context
4. **Use Absolute Imports**: Ensure the plugin uses absolute imports that work in any context

The debugging output from the next test will help determine which solution to implement.