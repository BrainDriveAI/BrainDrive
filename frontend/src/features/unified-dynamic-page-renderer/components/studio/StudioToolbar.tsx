import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Badge,
  Divider,
  Button,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  Search,
  ExpandMore,
  Add,
  Extension,
  Widgets,
  Settings,
  FilterList,
  Sort,
  ViewModule,
  ViewList,
  Refresh,
  GetApp,
  CloudDownload,
} from '@mui/icons-material';
import { PageData } from '../../types';
import { DragData } from './StudioDropZone';

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  category: string;
  tags: string[];
  isLocal: boolean;
  isOfficial: boolean;
  isEnabled: boolean;
  modules: ModuleInfo[];
  lastUpdated: Date;
  downloads?: number;
  rating?: number;
}

export interface ModuleInfo {
  id: string;
  name: string;
  displayName: string;
  description: string;
  icon?: string;
  category: string;
  tags: string[];
  isEnabled: boolean;
  layout: {
    defaultWidth: number;
    defaultHeight: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    resizable?: boolean;
    draggable?: boolean;
  };
  config?: Record<string, any>;
  requiredServices?: string[];
}

export interface StudioToolbarProps {
  // Plugin data
  availablePlugins: PluginInfo[];
  
  // Current page
  pageData: PageData;
  
  // Event handlers
  onPluginInstall?: (pluginId: string) => Promise<void>;
  onPluginEnable?: (pluginId: string, enabled: boolean) => Promise<void>;
  onPluginRefresh?: () => Promise<void>;
  onModuleDragStart?: (moduleInfo: ModuleInfo, pluginInfo: PluginInfo) => void;
  
  // Configuration
  showCategories?: boolean;
  showSearch?: boolean;
  showFilters?: boolean;
  defaultExpanded?: string[];
  
  // Layout
  width?: number | string;
  maxHeight?: number | string;
}

interface FilterState {
  search: string;
  categories: string[];
  tags: string[];
  showOnlyEnabled: boolean;
  showOnlyLocal: boolean;
  showOnlyOfficial: boolean;
}

const defaultFilter: FilterState = {
  search: '',
  categories: [],
  tags: [],
  showOnlyEnabled: false,
  showOnlyLocal: false,
  showOnlyOfficial: false,
};

/**
 * StudioToolbar - Plugin and module selection toolbar for Plugin Studio
 * 
 * This component provides:
 * - Plugin browsing and management
 * - Module drag-and-drop source
 * - Search and filtering capabilities
 * - Category organization
 * - Plugin installation and management
 */
export const StudioToolbar: React.FC<StudioToolbarProps> = ({
  availablePlugins,
  pageData,
  onPluginInstall,
  onPluginEnable,
  onPluginRefresh,
  onModuleDragStart,
  showCategories = true,
  showSearch = true,
  showFilters = true,
  defaultExpanded = ['widgets'],
  width = 320,
  maxHeight = '100vh',
}) => {
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [expandedCategories, setExpandedCategories] = useState<string[]>(defaultExpanded);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'category' | 'updated' | 'downloads'>('name');
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<null | HTMLElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get all available categories
  const categories = useMemo(() => {
    const categorySet = new Set<string>();
    availablePlugins.forEach(plugin => {
      categorySet.add(plugin.category);
      plugin.modules.forEach(module => {
        categorySet.add(module.category);
      });
    });
    return Array.from(categorySet).sort();
  }, [availablePlugins]);

  // Get all available tags
  const tags = useMemo(() => {
    const tagSet = new Set<string>();
    availablePlugins.forEach(plugin => {
      plugin.tags.forEach(tag => tagSet.add(tag));
      plugin.modules.forEach(module => {
        module.tags.forEach(tag => tagSet.add(tag));
      });
    });
    return Array.from(tagSet).sort();
  }, [availablePlugins]);

  // Filter and sort plugins
  const filteredPlugins = useMemo(() => {
    let filtered = availablePlugins.filter(plugin => {
      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const matchesPlugin = plugin.name.toLowerCase().includes(searchLower) ||
                             plugin.description.toLowerCase().includes(searchLower) ||
                             plugin.author.toLowerCase().includes(searchLower);
        const matchesModule = plugin.modules.some(module =>
          module.name.toLowerCase().includes(searchLower) ||
          module.displayName.toLowerCase().includes(searchLower) ||
          module.description.toLowerCase().includes(searchLower)
        );
        if (!matchesPlugin && !matchesModule) return false;
      }

      // Category filter
      if (filter.categories.length > 0) {
        const hasCategory = filter.categories.includes(plugin.category) ||
                           plugin.modules.some(module => filter.categories.includes(module.category));
        if (!hasCategory) return false;
      }

      // Tag filter
      if (filter.tags.length > 0) {
        const hasTag = filter.tags.some(tag => plugin.tags.includes(tag)) ||
                      plugin.modules.some(module => filter.tags.some(tag => module.tags.includes(tag)));
        if (!hasTag) return false;
      }

      // Enabled filter
      if (filter.showOnlyEnabled && !plugin.isEnabled) return false;

      // Local filter
      if (filter.showOnlyLocal && !plugin.isLocal) return false;

      // Official filter
      if (filter.showOnlyOfficial && !plugin.isOfficial) return false;

      return true;
    });

    // Sort plugins
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'category':
          return a.category.localeCompare(b.category);
        case 'updated':
          return b.lastUpdated.getTime() - a.lastUpdated.getTime();
        case 'downloads':
          return (b.downloads || 0) - (a.downloads || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [availablePlugins, filter, sortBy]);

  // Group plugins by category
  const pluginsByCategory = useMemo(() => {
    const grouped: Record<string, PluginInfo[]> = {};
    filteredPlugins.forEach(plugin => {
      if (!grouped[plugin.category]) {
        grouped[plugin.category] = [];
      }
      grouped[plugin.category].push(plugin);
    });
    return grouped;
  }, [filteredPlugins]);

  // Handle search
  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(prev => ({ ...prev, search: event.target.value }));
  }, []);

  // Handle category expansion
  const handleCategoryToggle = useCallback((category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  }, []);

  // Handle module drag start
  const handleModuleDragStart = useCallback((
    event: React.DragEvent,
    moduleInfo: ModuleInfo,
    pluginInfo: PluginInfo
  ) => {
    const dragData: DragData = {
      type: 'module',
      pluginId: pluginInfo.id,
      moduleId: moduleInfo.id,
      moduleName: moduleInfo.name,
      displayName: moduleInfo.displayName,
      isLocal: pluginInfo.isLocal,
      layout: moduleInfo.layout,
      config: moduleInfo.config,
      metadata: {
        plugin: pluginInfo,
        module: moduleInfo,
      },
    };

    event.dataTransfer.setData('application/json', JSON.stringify(dragData));
    event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    event.dataTransfer.effectAllowed = 'copy';

    onModuleDragStart?.(moduleInfo, pluginInfo);
  }, [onModuleDragStart]);

  // Handle plugin refresh
  const handleRefresh = useCallback(async () => {
    if (!onPluginRefresh) return;
    
    setIsRefreshing(true);
    try {
      await onPluginRefresh();
    } catch (error) {
      console.error('Failed to refresh plugins:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [onPluginRefresh]);

  // Handle filter menu
  const handleFilterMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    setFilterMenuAnchor(event.currentTarget);
  }, []);

  const handleFilterMenuClose = useCallback(() => {
    setFilterMenuAnchor(null);
  }, []);

  // Render module item
  const renderModuleItem = useCallback((module: ModuleInfo, plugin: PluginInfo) => (
    <ListItem
      key={`${plugin.id}-${module.id}`}
      draggable
      onDragStart={(e) => handleModuleDragStart(e, module, plugin)}
      sx={{
        cursor: 'grab',
        '&:hover': {
          backgroundColor: 'action.hover',
        },
        '&:active': {
          cursor: 'grabbing',
        },
      }}
    >
      <ListItemIcon>
        <Avatar
          src={module.icon}
          sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}
        >
          <Widgets />
        </Avatar>
      </ListItemIcon>
      <ListItemText
        primary={module.displayName || module.name}
        secondary={
          <Box>
            <Typography variant="body2" color="text.secondary" noWrap>
              {module.description}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              <Chip
                label={`${module.layout.defaultWidth}×${module.layout.defaultHeight}`}
                size="small"
                variant="outlined"
              />
              {module.requiredServices && module.requiredServices.length > 0 && (
                <Chip
                  label={`${module.requiredServices.length} services`}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
          </Box>
        }
      />
      {!module.isEnabled && (
        <Box sx={{ ml: 1 }}>
          <Chip label="Disabled" size="small" color="warning" />
        </Box>
      )}
    </ListItem>
  ), [handleModuleDragStart]);

  // Render plugin category
  const renderPluginCategory = useCallback((category: string, plugins: PluginInfo[]) => (
    <Accordion
      key={category}
      expanded={expandedCategories.includes(category)}
      onChange={() => handleCategoryToggle(category)}
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Extension color="primary" />
          <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
            {category}
          </Typography>
          <Badge badgeContent={plugins.length} color="primary" sx={{ ml: 'auto' }} />
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <List dense>
          {plugins.map(plugin => (
            <Box key={plugin.id}>
              {/* Plugin Header */}
              <ListItem>
                <ListItemIcon>
                  <Avatar
                    src={plugin.icon}
                    sx={{ width: 24, height: 24, bgcolor: 'secondary.main' }}
                  >
                    <Extension />
                  </Avatar>
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {plugin.name}
                      </Typography>
                      {plugin.isOfficial && (
                        <Chip label="Official" size="small" color="primary" />
                      )}
                      {plugin.isLocal && (
                        <Chip label="Local" size="small" color="secondary" />
                      )}
                    </Box>
                  }
                  secondary={`v${plugin.version} • ${plugin.modules.length} modules`}
                />
                <Box sx={{ ml: 1 }}>
                  <IconButton
                    size="small"
                    onClick={() => onPluginEnable?.(plugin.id, !plugin.isEnabled)}
                    color={plugin.isEnabled ? 'primary' : 'default'}
                  >
                    <Settings />
                  </IconButton>
                </Box>
              </ListItem>
              
              {/* Plugin Modules */}
              {plugin.isEnabled && plugin.modules
                .filter(module => module.isEnabled)
                .map(module => renderModuleItem(module, plugin))
              }
              
              <Divider />
            </Box>
          ))}
        </List>
      </AccordionDetails>
    </Accordion>
  ), [expandedCategories, handleCategoryToggle, renderModuleItem, onPluginEnable]);

  return (
    <Paper
      className="studio-toolbar"
      sx={{
        width,
        maxHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: 'divider',
          backgroundColor: 'background.default',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">Plugins</Typography>
          <Box>
            <Tooltip title="Refresh plugins">
              <IconButton size="small" onClick={handleRefresh} disabled={isRefreshing}>
                <Refresh />
              </IconButton>
            </Tooltip>
            <Tooltip title="Install new plugin">
              <IconButton size="small">
                <Add />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Search */}
        {showSearch && (
          <TextField
            fullWidth
            size="small"
            placeholder="Search plugins and modules..."
            value={filter.search}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1 }}
          />
        )}

        {/* Filters and Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {showFilters && (
            <Button
              size="small"
              startIcon={<FilterList />}
              onClick={handleFilterMenuOpen}
            >
              Filters
            </Button>
          )}
          
          <Button
            size="small"
            startIcon={<Sort />}
            onClick={(e) => {
              // Simple sort toggle for demo
              setSortBy(prev => prev === 'name' ? 'category' : 'name');
            }}
          >
            Sort
          </Button>

          <Box sx={{ ml: 'auto' }}>
            <Typography variant="caption" color="text.secondary">
              {filteredPlugins.length} plugins
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Plugin List */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {showCategories ? (
          Object.entries(pluginsByCategory).map(([category, plugins]) =>
            renderPluginCategory(category, plugins)
          )
        ) : (
          <List>
            {filteredPlugins.map(plugin =>
              plugin.modules
                .filter(module => module.isEnabled)
                .map(module => renderModuleItem(module, plugin))
            )}
          </List>
        )}
      </Box>

      {/* Filter Menu */}
      <Menu
        anchorEl={filterMenuAnchor}
        open={Boolean(filterMenuAnchor)}
        onClose={handleFilterMenuClose}
      >
        <MenuItem onClick={() => setFilter(prev => ({ ...prev, showOnlyEnabled: !prev.showOnlyEnabled }))}>
          Show only enabled
        </MenuItem>
        <MenuItem onClick={() => setFilter(prev => ({ ...prev, showOnlyLocal: !prev.showOnlyLocal }))}>
          Show only local
        </MenuItem>
        <MenuItem onClick={() => setFilter(prev => ({ ...prev, showOnlyOfficial: !prev.showOnlyOfficial }))}>
          Show only official
        </MenuItem>
      </Menu>
    </Paper>
  );
};

export default StudioToolbar;