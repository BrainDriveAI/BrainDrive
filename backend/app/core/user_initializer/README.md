# User Initialization System

This module provides a modular system for initializing data for new users when they register. It allows both core components and plugins to register initialization handlers that will be called when a new user is created.

## Overview

The user initialization system:

1. Automatically discovers and loads initializer plugins
2. Manages dependencies between initializers
3. Executes initializers in the correct order
4. Handles rollback if initialization fails
5. Provides utilities for common initialization tasks

## Architecture

The system consists of the following components:

- **Base Class**: `UserInitializerBase` - All initializers inherit from this
- **Registry**: Manages registration and execution of initializers
- **Discovery**: Automatically finds and loads initializers
- **Core Initializers**: Built-in initializers for core functionality
- **Plugin Initializers**: Custom initializers provided by plugins

## Core Initializers

The system includes the following core initializers:

1. **Settings Initializer**: Sets up default settings for the user
2. **Components Initializer**: Creates default components
3. **Navigation Initializer**: Sets up navigation routes
4. **Pages Initializer**: Creates default pages

## Creating a Custom Initializer

Plugins can create their own initializers by:

1. Creating a class that inherits from `UserInitializerBase`
2. Implementing the required methods
3. Registering the initializer

### Example

```python
from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer

class MyPluginInitializer(UserInitializerBase):
    name = "my_plugin_initializer"
    description = "Initializes data for my plugin"
    priority = 500  # Lower priority than core initializers
    dependencies = ["pages_initializer"]  # Depends on pages
    
    async def initialize(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        try:
            # Initialize your plugin's data here
            return True
        except Exception as e:
            logger.error(f"Error initializing: {e}")
            return False
    
    async def cleanup(self, user_id: str, db: AsyncSession, **kwargs) -> bool:
        try:
            # Clean up if initialization fails
            return True
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
            return False

# Register the initializer
register_initializer(MyPluginInitializer)
```

## Initialization Process

When a new user registers:

1. The user record is created in the database
2. The `initialize_user_data` function is called with the user's ID
3. All registered initializers are sorted by priority and dependencies
4. Each initializer's `initialize` method is called in order
5. If any initializer fails, the `cleanup` method is called for all successful initializers in reverse order

## Template Data

Initializers use JSON templates exported from an existing database to create default data for new users. These templates are located in the `backend/data_export` directory.

## Utilities

The system provides utility functions for common tasks:

- Generating UUIDs
- Getting current timestamps
- Preparing records for new users
- Querying database entities
- Replacing IDs in data structures

### Hardcoded Default Data

Each initializer now contains hardcoded default data instead of loading from JSON files:

```python
# Example from components_initializer.py
DEFAULT_COMPONENTS = [
    {
        "name": "Dashboard",
        "component_id": "dashboard",
        "description": "Main dashboard component",
        "icon": "Dashboard",
        "is_system": True
    },
    {
        "name": "Plugin Studio",
        "component_id": "plugin-studio",
        "description": "Plugin development environment",
        "icon": "Extension",
        "is_system": True
    }
    # ...more components
]
```

### Preparing Records for New Users

The `prepare_record_for_new_user` utility function makes it easy to prepare data for a new user:

```python
from app.core.user_initializer.utils import prepare_record_for_new_user

# Default component data
component_data = {
    "name": "Dashboard",
    "component_id": "dashboard",
    "description": "Main dashboard component",
    "icon": "Dashboard",
    "is_system": True
}

# Prepare for new user
new_user_id = "new_user_uuid_here"
prepared_data = prepare_record_for_new_user(
    component_data,
    new_user_id,
    preserve_fields=["component_id", "is_system"],  # Fields to keep from default data
    user_id_field="user_id"  # Explicitly specify which field to use for the user ID
)

# Result:
# {
#     "id": "newly_generated_uuid",
#     "name": "Dashboard",
#     "component_id": "dashboard",  # Preserved from default data
#     "description": "Main dashboard component",
#     "icon": "Dashboard",
#     "is_system": True,  # Preserved from default data
#     "created_at": "current_timestamp",
#     "updated_at": "current_timestamp",
#     "user_id": "new_user_uuid_here"  # Uses the specified field name
# }
```

This utility handles:
1. Generating a new UUID for the record
2. Setting the user_id/creator_id to the new user's ID (using the specified field name)
3. Updating timestamps to the current time
4. Preserving specified fields from the original data

### Different User ID Field Names

Different models use different field names for the user ID:
- Components: `user_id`
- Navigation Routes: `creator_id`
- Pages: `creator_id`
- Settings: `user_id`

The `prepare_record_for_new_user` function allows you to specify which field to use:

```python
# For components
prepared_data = prepare_record_for_new_user(data, user_id, user_id_field="user_id")

# For navigation routes and pages
prepared_data = prepare_record_for_new_user(data, user_id, user_id_field="creator_id")
```

## Adding to the System

To extend the system:

1. Create a new initializer class in `app/core/user_initializer/initializers/` or in your plugin
2. Register it using `register_initializer`
3. Make sure it's imported when the application starts

The discovery system will automatically find and load your initializer.