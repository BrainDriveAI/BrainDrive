# BrainDrive Network Plugin

A network status monitoring plugin for BrainDrive that provides real-time connectivity checking and status monitoring for critical services.

## Features

- **Real-time Network Monitoring**: Monitor connectivity to Ollama services and other network endpoints
- **Visual Status Indicators**: Clear visual feedback on service availability
- **Configurable Targets**: Easily add or modify monitoring targets
- **Automatic Refresh**: Periodic status updates with configurable intervals
- **Error Handling**: Robust timeout and error handling for network requests

## Components

### ComponentNetworkStatus
The main monitoring component that displays network status for configured targets:
- Ollama (https://www.ollama.com)
- Local Ollama (http://localhost:11434)

## Installation

### Prerequisites
- BrainDrive instance (v1.0.0 or higher)
- Node.js (v18 or higher)
- Python 3.7+

### Automatic Installation (Recommended)

The plugin includes an automated installation system that follows BrainDrive's plugin lifecycle management patterns.

1. **Build the Plugin**:
   ```bash
   cd plugins/BrainDriveNetwork
   npm install
   npm run build
   ```

2. **Validate the Plugin**:
   ```bash
   npm run validate
   ```

3. **Install for a User**:
   ```bash
   python3 scripts/install.py <user_id> <plugin_directory>
   ```

### Manual Installation

If you need to install manually or integrate with a custom deployment:

1. **Copy Plugin Files**:
   ```bash
   # Copy to user's plugin directory
   cp -r plugins/BrainDriveNetwork /path/to/braindrive/plugins/<user_id>/braindrive_network/
   ```

2. **Run Plugin Initializer**:
   ```python
   # In your BrainDrive environment
   from plugins.BrainDriveNetwork.plugin_initializer import BrainDriveNetworkInitializer

   initializer = BrainDriveNetworkInitializer()
   await initializer.initialize(user_id, db_session)
   ```

## Development

### Project Structure
```
plugins/BrainDriveNetwork/
├── src/
│   ├── ComponentNetworkStatus.tsx    # Main monitoring component
│   ├── ComponentNetworkStatus.css    # Component styles
│   ├── index.tsx                     # Plugin entry point
│   ├── index.css                     # Global styles
│   └── bootstrap.tsx                 # Bootstrap configuration
├── scripts/
│   ├── install.py                    # Installation script
│   ├── validate.py                   # Validation script
│   └── build.sh                      # Build script
├── dist/                             # Built files (generated)
├── plugin_initializer.py             # BrainDrive plugin initializer
├── package.json                      # NPM configuration
├── webpack.config.js                 # Webpack configuration
├── tsconfig.json                     # TypeScript configuration
├── tailwind.config.js                # Tailwind CSS configuration
└── README.md                         # This file
```

### Building

```bash
# Install dependencies
npm install

# Development build with watch
npm run start

# Production build
npm run build

# Build with validation
npm run prepare-release
```

### Validation

The plugin includes comprehensive validation:

```bash
# Run validation
npm run validate

# Or run directly
python3 scripts/validate.py
```

Validation checks:
- ✅ Required files presence
- ✅ Plugin initializer structure
- ✅ Package.json configuration
- ✅ TypeScript compilation
- ✅ React component structure
- ✅ Network monitoring functionality
- ✅ Build artifacts

### Configuration

#### Network Targets
Configure monitoring targets in the plugin data directory:

```json
{
  "monitoring_targets": [
    {
      "name": "Ollama",
      "url": "https://www.ollama.com",
      "enabled": true,
      "timeout": 3000
    },
    {
      "name": "Local Ollama",
      "url": "http://localhost:11434",
      "enabled": true,
      "timeout": 3000
    }
  ],
  "check_interval": 30000,
  "retry_attempts": 3,
  "notification_enabled": true
}
```

#### Module Configuration
The plugin module supports these configuration options:

- `refresh_interval`: Auto-refresh interval in seconds (default: 30)
- `show_details`: Show detailed connection information (default: true)
- `timeout`: Request timeout in milliseconds (default: 3000)

## Plugin Architecture

### Initializer Pattern
This plugin follows BrainDrive's initializer pattern for robust plugin management:

- **Database Integration**: Automatic plugin and module registration
- **User Isolation**: Per-user plugin instances and data
- **Error Handling**: Comprehensive cleanup on installation failure
- **File Management**: Automatic directory structure and file copying
- **Extensibility**: Easy to extend with additional modules

### Key Components

1. **Plugin Initializer** (`plugin_initializer.py`):
   - Handles database registration
   - Creates user-specific plugin instances
   - Sets up file structure and permissions
   - Manages cleanup on failure

2. **Installation Script** (`scripts/install.py`):
   - Plugin-specific installation logic
   - Network monitoring configuration
   - Data directory setup
   - Permission management

3. **Validation Script** (`scripts/validate.py`):
   - Comprehensive plugin validation
   - Structure verification
   - Functionality testing
   - Build artifact checking

## API Integration

### Required Services
The plugin requires these BrainDrive services:

- `api`: For general API access (GET methods)
- `network`: For network monitoring capabilities

### Permissions
Required permissions:
- `network.read`: Access to network monitoring APIs
- `storage.read`: Read access to plugin data
- `storage.write`: Write access to plugin configuration

## Troubleshooting

### Common Issues

1. **Build Failures**:
   ```bash
   # Clean and rebuild
   rm -rf node_modules dist
   npm install
   npm run build
   ```

2. **Validation Errors**:
   ```bash
   # Check specific validation output
   python3 scripts/validate.py
   ```

3. **Network Connectivity Issues**:
   - Check CORS settings for external URLs
   - Verify local services are running
   - Check firewall and network policies

4. **Installation Failures**:
   ```bash
   # Check installation logs
   python3 scripts/install.py <user_id> <plugin_dir>
   ```

### Debug Mode

Enable debug logging in the plugin initializer:

```python
import logging
logging.getLogger('plugins.BrainDriveNetwork').setLevel(logging.DEBUG)
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run validation: `npm run validate`
5. Test the installation process
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and support:
- Check the troubleshooting section above
- Review BrainDrive plugin documentation
- Submit issues through the project repository

## Changelog

### v1.0.0
- Initial release
- Network status monitoring for Ollama services
- Automated installation and validation system
- Comprehensive plugin initializer following BrainDrive patterns