# BrainDrive Plugin System

This document provides comprehensive information about the BrainDrive plugin system, including plugin components, architecture, development guidelines, and examples.

## Table of Contents

- [Overview](#overview)
- [Plugin Architecture](#plugin-architecture)
- [Plugin Components](#plugin-components)
- [Plugin Structure](#plugin-structure)
- [Creating a Plugin](#creating-a-plugin)
- [Plugin Configuration](#plugin-configuration)
- [Module Configuration](#module-configuration)
- [Plugin Services](#plugin-services)
- [Message System](#message-system)
- [User Initialization](#user-initialization)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

The BrainDrive plugin system allows developers to extend the platform's functionality through modular components. Plugins can add new features, integrate with external services, and customize the user experience. The system is designed to be:

- **Modular**: Each plugin is self-contained with its own components and services
- **Extensible**: Developers can create custom plugins for specific needs
- **Secure**: Plugins operate within a controlled environment with defined permissions
- **User-specific**: Plugins are scoped to individual users for data isolation

## Plugin Architecture

The plugin system consists of several key components:

1. **Plugin Registry**: Manages the registration and discovery of plugins
2. **Plugin Manager**: Handles plugin lifecycle, activation, and deactivation
3. **Plugin Components**: UI elements that plugins can provide
4. **Plugin Services**: Backend services that plugins can access or provide
5. **Message System**: Inter-plugin communication mechanism
6. **User Initialization**: System for setting up plugin data for new users

## Plugin Components

Plugins can provide various components that integrate into the BrainDrive interface:

- **UI Components**: Visual elements that users can interact with
- **Settings Components**: Configuration interfaces for plugin settings
- **Service Components**: Background services that provide functionality
- **Integration Components**: Components that connect to external systems

Each component is defined with properties, configuration options, and layout information.

## Plugin Structure

A typical plugin consists of:

```
plugin-name/
├── plugin.json         # Plugin manifest
├── frontend/           # Frontend code
│   ├── src/            # Source code
│   ├── dist/           # Compiled assets
│   └── package.json    # Dependencies
└── backend/            # Backend code (optional)
    └── main.py         # Backend implementation
```

## Creating a Plugin

To create a new plugin:

1. Create a directory with your plugin name
2. Create a `plugin.json` manifest file
3. Implement your frontend components
4. Implement backend services (if needed)
5. Register your plugin with BrainDrive

## Plugin Configuration

The `plugin.json` file defines the plugin's metadata and components:

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "description": "Description of your plugin",
  "version": "1.0.0",
  "scope": "YourPluginScope",
  "type": "frontend",
  "bundlemethod": "webpack",
  "bundlelocation": "frontend/dist/remoteEntry.js",
  "islocal": false,
  "icon": "Extension",
  "category": "Utilities",
  "status": "activated",
  "official": false,
  "author": "Your Name",
  "lastUpdated": "2025-05-08",
  "compatibility": "1.0.0",
  "modules": [
    // Module definitions go here
  ]
}
```

## Module Configuration

Each plugin can contain multiple modules, defined in the `modules` array:

```json
{
  "id": "module-id",
  "name": "ModuleName",
  "displayName": "Module Display Name",
  "description": "Description of the module",
  "icon": "ModuleIcon",
  "category": "Module Category",
  "tags": ["tag1", "tag2"],
  "enabled": true,
  "props": {
    // Default properties
  },
  "configFields": {
    // Configuration field definitions
  },
  "requiredServices": {
    // Required service definitions
  },
  "messages": {
    // Message definitions
  },
  "priority": 1,
  "dependencies": [],
  "layout": {
    "minWidth": 3,
    "minHeight": 2,
    "defaultWidth": 6,
    "defaultHeight": 4
  }
}
```

### Configuration Fields

The `configFields` section defines the configuration options for a module:

```json
"configFields": {
  "fieldName": {
    "type": "string",
    "label": "Field Label",
    "default": "Default Value",
    "description": "Field description"
  },
  "selectField": {
    "type": "select",
    "label": "Select Option",
    "default": "option1",
    "options": [
      { "value": "option1", "label": "Option 1" },
      { "value": "option2", "label": "Option 2" }
    ]
  }
}
```

Supported field types:
- `string`: Text input
- `number`: Numeric input
- `boolean`: Toggle/checkbox
- `select`: Dropdown selection
- `array`: List of values
- `object`: Nested object

## Plugin Services

Plugins can require and use various services:

```json
"requiredServices": {
  "api": {
    "methods": ["get", "post", "postStreaming"],
    "version": "1.0.0"
  },
  "event": {
    "methods": ["sendMessage", "subscribeToMessages", "unsubscribeFromMessages"],
    "version": "1.0.0"
  },
  "theme": {
    "methods": ["getCurrentTheme", "addThemeChangeListener", "removeThemeChangeListener"],
    "version": "1.0.0"
  },
  "settings": {
    "methods": ["getSetting", "setSetting", "getSettingDefinitions"],
    "version": "1.0.0"
  }
}
```

Available services:
- `api`: HTTP requests to backend endpoints
- `event`: Inter-plugin communication
- `theme`: Theme management
- `settings`: User settings management

## Message System

Plugins can communicate with each other using the message system:

```json
"messages": {
  "sends": [
    {
      "type": "message.type",
      "description": "Description of the message",
      "contentSchema": {
        "type": "object",
        "properties": {
          "property1": {
            "type": "string",
            "description": "Property description",
            "required": true
          }
        }
      }
    }
  ],
  "receives": [
    // Message types this module can receive
  ]
}
```

## User Initialization

Plugins can provide initializers that set up data for new users:

```python
from app.core.user_initializer.base import UserInitializerBase
from app.core.user_initializer.registry import register_initializer

class MyPluginInitializer(UserInitializerBase):
    name = "my_plugin_initializer"
    description = "Initializes data for my plugin"
    priority = 500
    dependencies = ["pages_initializer"]
    
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

## Best Practices

1. **Modular Design**: Keep your plugin components modular and focused on specific functionality
2. **Error Handling**: Implement robust error handling in both frontend and backend code
3. **User Experience**: Design your plugin UI to be consistent with the BrainDrive interface
4. **Performance**: Optimize your plugin for performance, especially for resource-intensive operations
5. **Security**: Follow security best practices and validate all inputs
6. **Documentation**: Document your plugin's features, configuration options, and APIs
7. **Testing**: Test your plugin thoroughly before deployment

## Examples

### Basic AI Chat Plugin

The BrainDriveBasicAIChat plugin provides interactive chat interfaces for AI models:

```json
{
  "id": "BrainDriveBasicAIChat",
  "name": "BrainDrive Basic AI Chat",
  "description": "Basic AI Chat Modules",
  "version": "1.0.0",
  "modules": [
    {
      "id": "ai-prompt-chat-v2",
      "name": "AIPromptChat",
      "displayName": "AI Prompt Chat V2",
      "description": "Interactive chat interface for AI prompts and responses",
      "icon": "Chat",
      "category": "AI Tools",
      "tags": ["AI", "Chat", "Prompt", "LLM"],
      "enabled": true,
      "props": {
        "initialGreeting": "Hello! How can I assist you today?",
        "promptQuestion": "Type your message here..."
      },
      "configFields": {
        "initialGreeting": {
          "type": "string",
          "label": "Initial Greeting",
          "default": "Hello! How can I assist you today?"
        },
        "promptQuestion": {
          "type": "string",
          "label": "Prompt Placeholder",
          "default": "Type your message here..."
        }
      }
    }
  ]
}
```

### Settings Plugin

The BrainDriveSettings plugin provides configuration interfaces for various settings:

```json
{
  "id": "BrainDriveSettings",
  "name": "BrainDrive Settings",
  "description": "Core settings components",
  "version": "1.0.0",
  "modules": [
    {
      "id": "theme-settings",
      "name": "ComponentTheme",
      "displayName": "Theme Settings",
      "description": "Configure application theme",
      "icon": "Palette",
      "category": "Settings",
      "tags": ["Settings", "Theme", "Appearance"],
      "enabled": true
    },
    {
      "id": "ollama-server-settings",
      "name": "ComponentOllamaServer",
      "displayName": "Ollama Server Settings",
      "description": "Configure Ollama server connections",
      "icon": "Storage",
      "category": "AI Settings",
      "tags": ["Settings", "AI", "Ollama", "Server"],
      "enabled": true
    }
  ]
}
```

For more examples and detailed documentation, refer to the existing plugins in the BrainDrive system.