# Plugin Manager

The Plugin Manager is a feature that allows users to browse, search, and manage plugins and their modules in the PluginStudio application.

## Architecture

The Plugin Manager follows a modular architecture with reusable components and clear separation of concerns:

```
plugin-manager/
├── components/             # Plugin Manager specific components
│   ├── ModuleCard.tsx      # Reusable card for displaying module info
│   ├── ModuleGrid.tsx      # Grid component for displaying modules
│   ├── ModuleSearch.tsx    # Search component for modules
│   ├── ModuleFilters.tsx   # Filters for modules (category, tags, etc.)
│   ├── ModuleStatusToggle.tsx  # Toggle for enabling/disabling modules
│   └── ModuleDetailHeader.tsx  # Header for module detail page
├── hooks/                  # Plugin Manager specific hooks
│   ├── useModules.ts       # Hook for fetching and managing modules
│   ├── useModuleDetail.ts  # Hook for fetching module details
│   └── useModuleFilters.ts # Hook for managing module filters
├── services/               # Plugin Manager specific services
│   └── moduleService.ts    # Service for interacting with the API
├── types.ts                # Type definitions for the Plugin Manager
└── index.ts                # Exports all components, hooks, and services
```

## Pages

The Plugin Manager consists of two main pages:

1. **PluginManagerPage**: The main page for browsing and searching modules
2. **ModuleDetailPage**: The detail page for a specific module

These pages are defined in the `src/pages` directory and are registered in the application's routing system.

## Components

### ModuleCard

A reusable card component that displays key information about a module:

- Display module name, author, category, and description
- Show tags as badges
- Display enabled/disabled status with toggle
- Handle click to navigate to detail page
- Support compact mode for related modules display

### ModuleGrid

A grid component for displaying multiple module cards:

- Display modules in a responsive grid (4 columns on large screens, fewer on smaller screens)
- Support pagination
- Show loading state
- Handle module click and status toggle events
- Support compact mode for related modules display

### ModuleSearch

A search component for finding modules:

- Input field for search query
- Debounced search to avoid excessive API calls
- Clear button to reset search

### ModuleFilters

A component for filtering modules by category, tags, etc.:

- Dropdown for selecting category
- Multi-select for tags
- Clear filters button

### ModuleStatusToggle

A toggle component for enabling/disabling modules:

- Toggle switch for enabled/disabled status
- Handle API call to update status
- Show loading state during API call

### ModuleDetailHeader

A header component for the module detail page:

- Display module name, author, category, and description
- Show tags as badges
- Display enabled/disabled status with toggle
- Back button to return to the main page

## Hooks

### useModules

A hook for fetching and managing modules:

- Fetch modules with optional filtering
- Handle pagination
- Toggle module status
- Handle loading and error states

### useModuleDetail

A hook for fetching module details:

- Fetch module and plugin details
- Fetch related modules from the same plugin
- Toggle module status
- Handle loading and error states

### useModuleFilters

A hook for managing module filters:

- Fetch available categories and tags
- Manage selected category and tags
- Handle loading and error states

## Services

### moduleService

A service for interacting with the Plugin Manager API:

- Get all modules with optional filtering
- Get a specific module by ID
- Get all modules for a specific plugin
- Toggle a module's enabled status
- Toggle a plugin's enabled status
- Get all available categories and tags

## API Integration

The Plugin Manager is designed to interact with the following API endpoints:

1. **Get All Modules**
   - `GET /api/v1/plugins/manager`
   - Query parameters:
     - `search`: Search query
     - `category`: Filter by category
     - `tags`: Filter by tags (comma-separated)
     - `page`: Page number
     - `pageSize`: Number of items per page

2. **Get Module Details**
   - `GET /api/v1/plugins/{pluginId}/modules/{moduleId}`

3. **Toggle Module Status**
   - `PATCH /api/v1/plugins/{pluginId}/modules/{moduleId}`
   - Body: `{ "enabled": boolean }`

4. **Toggle Plugin Status**
   - `PATCH /api/v1/plugins/{pluginId}`
   - Body: `{ "enabled": boolean }`

### Mock Data Implementation

Currently, the Plugin Manager frontend uses mock data since the backend API endpoints are not yet implemented. The mock data implementation:

1. Simulates API calls with delays to mimic real-world behavior
2. Provides realistic mock data for modules and plugins
3. Supports all the filtering, searching, and pagination functionality
4. Maintains state for toggling module status

Once the backend API is implemented, the mock data can be replaced with real API calls by updating the service layer without changing the components or hooks.

## Usage

To use the Plugin Manager in your application:

1. Import the components, hooks, and services from the `features/plugin-manager` directory:

```tsx
import { 
  ModuleCard, 
  ModuleGrid, 
  useModules, 
  moduleService 
} from '../features/plugin-manager';
```

2. Use the hooks to fetch and manage modules:

```tsx
const { 
  modules, 
  totalModules, 
  loading, 
  error, 
  toggleModuleStatus 
} = useModules({
  search: searchQuery,
  category: selectedCategory,
  tags: selectedTags,
  page,
  pageSize
});
```

3. Render the components:

```tsx
<ModuleGrid
  modules={modules}
  onModuleClick={handleModuleClick}
  onToggleStatus={handleToggleStatus}
  loading={loading}
  pagination={{
    page,
    pageSize,
    totalItems: totalModules,
    onPageChange: handlePageChange
  }}
/>
```

## Routing

The Plugin Manager is integrated into the application's routing system:

```tsx
<Route path="plugin-manager" element={<PluginManagerPage />} />
<Route path="plugin-manager/:pluginId/:moduleId" element={<ModuleDetailPage />} />
```

## Navigation

To add the Plugin Manager to the navigation sidebar, you can use one of the scripts provided in the `src/scripts` directory:

1. **TypeScript Script**: `add-plugin-manager-to-nav.ts`
2. **SQL Script**: `add-plugin-manager-to-nav.sql`

See the README.md in the scripts directory for detailed instructions on how to run these scripts.

After running one of these scripts, the Plugin Manager will appear in the navigation sidebar for logged-in users.
