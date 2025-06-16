# Final Plugin Slug Fix

## Problem Identified

The remote plugin installation was still failing because of a plugin slug mismatch:

1. **Package.json**: `"name": "BrainDriveNetwork"` ✅ (Fixed)
2. **Lifecycle Manager**: `"plugin_slug": "BrainDriveNetwork"` ✅ (Correct)
3. **Validation Step**: Could not instantiate lifecycle manager → No `plugin_slug` extracted ❌
4. **Slug Determination**: Fell back to `plugin_info.get('name').lower()` → `"braindrivenetwork"` ❌
5. **Installation Step**: Looked for `braindrivenetwork` but needed `BrainDriveNetwork` ❌

## Root Cause

The validation step couldn't instantiate the NetworkEyes lifecycle manager to extract the real plugin metadata, so it fell back to package.json data and applied `.lower()` transformation, causing a slug mismatch.

## Solution Applied

### 1. Improved Plugin Slug Determination Logic

**Before:**
```python
plugin_slug = plugin_info.get('plugin_slug') or plugin_info.get('name', '').lower().replace(' ', '-')
```

**After:**
```python
# First try to get plugin_slug from the lifecycle manager metadata
plugin_slug = plugin_info.get('plugin_slug')

# If not available, use the name from package.json but preserve casing for proper plugin names
if not plugin_slug:
    name = plugin_info.get('name', '')
    # Only convert to lowercase if it contains spaces or special characters
    if ' ' in name or '-' in name:
        plugin_slug = name.lower().replace(' ', '-')
    else:
        # Preserve the original casing for single-word plugin names
        plugin_slug = name
```

### 2. Added Source Code Extraction Fallback

When the lifecycle manager can't be instantiated during validation, the system now extracts the `plugin_slug` directly from the source code:

```python
# If we couldn't instantiate the manager, try to extract plugin_slug from source code
logger.info("Attempting to extract plugin_slug from lifecycle manager source code")
try:
    lifecycle_manager_path = plugin_dir / "lifecycle_manager.py"
    if lifecycle_manager_path.exists():
        with open(lifecycle_manager_path, 'r') as f:
            content = f.read()
            # Look for plugin_slug in the source code
            import re
            # Look for "plugin_slug": "value" pattern
            slug_match = re.search(r'"plugin_slug":\s*"([^"]+)"', content)
            if slug_match:
                extracted_slug = slug_match.group(1)
                plugin_info['plugin_slug'] = extracted_slug
                logger.info(f"Extracted plugin_slug from source: {extracted_slug}")
except Exception as extract_error:
    logger.warning(f"Could not extract plugin_slug from source: {extract_error}")
```

## Expected Flow Now

1. **Download & Extract**: ✅ Works
2. **Validation**:
   - ❌ Can't instantiate lifecycle manager (expected)
   - ✅ Extracts `plugin_slug: "BrainDriveNetwork"` from source code
   - ✅ Returns correct plugin info with proper slug
3. **Plugin Slug Determination**:
   - ✅ Uses extracted `plugin_slug: "BrainDriveNetwork"` directly
4. **Installation**:
   - ✅ Copies files to `/plugins/BrainDriveNetwork/`
   - ✅ Universal manager loads `BrainDriveNetwork` lifecycle manager
   - ✅ Successfully instantiates `NetworkEyesLifecycleManager`
   - ✅ Completes installation

## Key Benefits

1. **Robust Slug Detection**: Multiple fallback strategies for plugin slug determination
2. **Source Code Analysis**: Can extract metadata even when instantiation fails
3. **Casing Preservation**: Maintains proper plugin name casing for single-word names
4. **Backward Compatibility**: Still handles plugins with spaces/hyphens correctly

This fix should resolve the final plugin slug mismatch issue and allow the NetworkEyes plugin to install successfully.