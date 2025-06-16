# Plugin Installer Feature

A React-based feature for installing plugins from GitHub repositories in BrainDrive. This feature provides a user-friendly interface for downloading, validating, and installing plugins with real-time progress tracking.

## Overview

The Plugin Installer feature allows users to:
- Install plugins directly from GitHub repository URLs
- Track installation progress with detailed steps
- View installation results and plugin information
- Navigate seamlessly between plugin management interfaces

## Architecture

### Components

#### `PluginInstallerPage`
The main page component that orchestrates the entire installation flow.

**Features:**
- Breadcrumb navigation
- Installation form
- Progress tracking
- Result display
- Error handling
- Help documentation

#### `PluginInstallForm`
A form component for entering plugin repository details.

**Features:**
- GitHub URL validation
- Version selection (latest or specific)
- Example URLs for guidance
- Real-time URL validation feedback
- Clear/reset functionality

#### `InstallationProgress`
A stepper component that shows installation progress.

**Features:**
- Visual step-by-step progress
- Status indicators (pending, in-progress, completed, error)
- Detailed messages for each step
- Error display with context

#### `InstallationResult`
A component that displays the final installation result.

**Features:**
- Success/failure status
- Plugin details (ID, version, modules)
- Action buttons (install another, go to manager)
- User-scoped installation information

### Hooks

#### `usePluginInstaller`
A custom hook that manages the installation state and API calls.

**Features:**
- Installation state management
- Step-by-step progress tracking
- API integration
- URL validation
- Error handling

### Services

#### `pluginInstallerService`
A service class that handles API communication.

**Features:**
- Plugin installation from URLs
- Plugin status checking
- Available updates checking
- Plugin uninstallation
- URL validation and normalization

### Types

Comprehensive TypeScript types for:
- Installation requests and responses
- Progress tracking
- Plugin information
- Error handling

## Usage

### Basic Installation Flow

1. User navigates to Plugin Manager
2. Clicks "Install Plugins" button
3. Enters GitHub repository URL
4. Selects version (latest or specific)
5. Clicks "Install Plugin"
6. Watches real-time progress
7. Views installation result
8. Can install another or return to manager

### API Integration

The feature integrates with the universal plugin lifecycle API:

```typescript
// Install plugin from URL
POST /api/plugins/install-from-url
{
  "repo_url": "https://github.com/user/plugin",
  "version": "latest"
}

// Check plugin status
GET /api/plugins/{slug}/status

// Get available updates
GET /api/plugins/updates/available
```

### Navigation

- **Entry Point**: Plugin Manager → "Install Plugins" button
- **Route**: `/plugin-installer`
- **Exit Points**:
  - Back button → Plugin Manager
  - "Go to Plugin Manager" → Plugin Manager
  - Breadcrumb → Plugin Manager

## Installation Steps

The installation process follows these steps:

1. **Validate**: Check repository URL format
2. **Download**: Fetch plugin from GitHub releases
3. **Extract**: Extract and validate plugin structure
4. **Install**: Install plugin for user account
5. **Complete**: Finalize installation and show results

## Error Handling

The feature handles various error scenarios:

- Invalid repository URLs
- Network connectivity issues
- Repository not found
- Invalid plugin structure
- Installation failures
- API errors

Each error is displayed with context and suggested actions.

## User Experience Features

### Progressive Enhancement
- Real-time URL validation
- Step-by-step progress tracking
- Contextual help and examples
- Clear error messages

### Accessibility
- Proper ARIA labels
- Keyboard navigation support
- Screen reader friendly
- High contrast support

### Responsive Design
- Mobile-friendly layout
- Flexible grid system
- Adaptive typography
- Touch-friendly controls

## Security Considerations

### User Isolation
- Plugins installed only for the requesting user
- No cross-user plugin access
- User-scoped file system isolation

### Validation
- Repository URL validation
- Plugin structure validation
- File type verification
- Size limits enforcement

### Error Prevention
- Input sanitization
- Rate limiting consideration
- Timeout handling
- Graceful degradation

## Integration Points

### Plugin Manager
- "Install Plugins" button integration
- Navigation between features
- Shared state management

### Universal API
- Consistent API patterns
- Error handling standards
- Authentication integration

### Theme System
- Material-UI theme integration
- Dark/light mode support
- Consistent styling

## Development Guidelines

### Component Structure
```
components/
├── PluginInstallerPage.tsx    # Main page
├── PluginInstallForm.tsx      # Installation form
├── InstallationProgress.tsx   # Progress tracking
├── InstallationResult.tsx     # Result display
└── index.ts                   # Exports
```

### State Management
- Local state with hooks
- No global state dependencies
- Clean state transitions
- Error boundary integration

### Testing Considerations
- Component unit tests
- Hook testing
- API mocking
- Error scenario testing
- User interaction testing

## Future Enhancements

### Planned Features
- Plugin marketplace integration
- Bulk plugin installation
- Plugin dependency management
- Installation history
- Plugin recommendations

### Performance Optimizations
- Lazy loading
- Caching strategies
- Background downloads
- Progress persistence

## Troubleshooting

### Common Issues

**Plugin not found**
- Verify repository URL
- Check repository accessibility
- Ensure releases exist

**Installation fails**
- Check network connectivity
- Verify plugin structure
- Review error messages

**Progress stuck**
- Refresh page
- Check browser console
- Retry installation

### Debug Information
- Browser console logs
- Network tab inspection
- API response analysis
- State inspection tools