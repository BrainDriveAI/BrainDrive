import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  useTheme,
  useMediaQuery,
  IconButton,
  Tooltip,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Collapse,
  Divider,
  Tab,
  Tabs,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  FormHelperText,
  Grid,
  Paper,
  Switch,
  FormControlLabel,
  ListSubheader
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import PageIcon from '@mui/icons-material/Description';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { Page } from '../pages';
import { pageService } from '../services/pageService';
import { navigationService } from '../services/navigationService';
import { componentService } from '../services/componentService';
import { IconResolver } from './IconResolver';
import * as Icons from '@mui/icons-material';
import { Component } from '../types/component';

// Get all available icon names from Material UI
const availableIcons = Object.keys(Icons).filter(
  key => typeof Icons[key as keyof typeof Icons] === 'object'
);

interface RouteManagementDialogProps {
  open: boolean;
  onClose: () => void;
  pages: Page[];
  onUpdatePage: (pageId: string, updates: Partial<Page>) => Promise<void>;
  onRefreshPages: () => Promise<void>;
}

interface RouteNode {
  id: string;
  name: string;
  type: 'core' | 'route';
  route: string;
  icon?: string;
  description?: string;
  order?: number;
  isVisible?: boolean;
  isSystemRoute?: boolean;
  defaultComponentId?: string;
  defaultPageId?: string;
  canChangeDefault?: boolean;
  children: RouteNode[];
}

interface NavigationRoute {
  id: string;
  name: string;
  route: string;
  icon?: string;
  description?: string;
  order?: number;
  is_visible?: boolean;
  is_system_route?: boolean;
  default_component_id?: string;
  default_page_id?: string;
  can_change_default?: boolean;
  creator_id: string;
  created_at?: string;
  updated_at?: string;
}

export const RouteManagementDialog: React.FC<RouteManagementDialogProps> = ({
  open,
  onClose,
  pages,
  onUpdatePage,
  onRefreshPages
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [routeTree, setRouteTree] = useState<RouteNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRoute, setEditRoute] = useState('');
  const [editIcon, setEditIcon] = useState<string>('');
  const [editDescription, setEditDescription] = useState('');
  const [editOrder, setEditOrder] = useState<number>(0);
  const [editIsVisible, setEditIsVisible] = useState<boolean>(true);
  const [editCanChangeDefault, setEditCanChangeDefault] = useState<boolean>(false);
  const [editDefaultComponentId, setEditDefaultComponentId] = useState<string | undefined>(undefined);
  const [editDefaultPageId, setEditDefaultPageId] = useState<string | undefined>(undefined);
  const [components, setComponents] = useState<Component[]>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [navigationRoutes, setNavigationRoutes] = useState<NavigationRoute[]>([]);
  const [activeTab, setActiveTab] = useState(0);
  const [isCreatingRoute, setIsCreatingRoute] = useState(false);
  const [newRoute, setNewRoute] = useState<Partial<NavigationRoute>>({
    name: '',
    route: '',
    icon: 'Folder',
    description: '',
    order: 0,
    is_visible: true,
    default_component_id: undefined,
    default_page_id: undefined,
    can_change_default: false
  });

  // Function to generate a valid route from a name
  const generateRouteFromName = (name: string): string => {
    // Convert to lowercase
    let route = name.toLowerCase();
    // Replace spaces with hyphens
    route = route.replace(/\s+/g, '-');
    // Remove any characters that aren't lowercase letters, numbers, or hyphens
    route = route.replace(/[^a-z0-9-]/g, '');
    // Remove any consecutive hyphens
    route = route.replace(/-+/g, '-');
    // Remove leading and trailing hyphens
    route = route.replace(/^-+|-+$/g, '');
    
    return route;
  };
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Fetch components
  const fetchComponents = async () => {
    try {
      setLoadingComponents(true);
      const data = await componentService.getComponents();
      setComponents(data);
    } catch (err: any) {
      // Set components to empty array in case of error
      setComponents([]);
      // Only show error if it's critical
      if (err?.message && err.message !== 'Network Error') {
        setError(`Error fetching components: ${err.message}`);
      }
    } finally {
      setLoadingComponents(false);
    }
  };

  // Fetch navigation routes
  const fetchNavigationRoutes = async (suppressErrors = false) => {
    try {
      setLoading(true);
      const data = await navigationService.getNavigationRoutes();
      
      // Check if we got a valid array
      if (Array.isArray(data)) {
        setNavigationRoutes(data);
        
        // Clear any previous error messages related to fetching routes
        if (error && error.includes('Error fetching navigation routes')) {
          setError(null);
        }
      } else {
        setNavigationRoutes([]);
      }
    } catch (err: any) {
      setNavigationRoutes([]);
      
      // Only show errors if not suppressed
      if (!suppressErrors) {
        setError(`Error fetching navigation routes: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Build the route tree
  useEffect(() => {
    fetchNavigationRoutes();
    fetchComponents();
  }, []);

  useEffect(() => {
    buildRouteTree();
  }, [navigationRoutes]);

  const buildRouteTree = () => {
    // Create tree from all navigation routes
    const tree: RouteNode[] = [];

    // Add all navigation routes
    navigationRoutes.forEach(navRoute => {
      tree.push({
        id: navRoute.id,
        name: navRoute.name,
        type: navRoute.is_system_route ? 'core' : 'route',
        route: navRoute.route,
        icon: navRoute.icon,
        description: navRoute.description,
        order: navRoute.order,
        isVisible: navRoute.is_visible,
        isSystemRoute: navRoute.is_system_route,
        defaultComponentId: navRoute.default_component_id,
        defaultPageId: navRoute.default_page_id,
        canChangeDefault: navRoute.can_change_default,
        children: []
      });
    });

    // Create a map of all nodes by route
    const nodeMap: Record<string, RouteNode> = {};
    tree.forEach(node => {
      nodeMap[node.route] = node;
      setExpandedNodes(prev => ({ ...prev, [node.route]: true }));
    });

    // Sort routes by name
    tree.sort((a, b) => a.name.localeCompare(b.name));

    setRouteTree(tree);
  };

  const handleToggleExpand = (nodeId: string) => {
    setExpandedNodes(prev => ({
      ...prev,
      [nodeId]: !prev[nodeId]
    }));
  };

  const handleEditNode = (node: RouteNode) => {
    setEditingNode(node.id);
    setEditName(node.name);
    setEditRoute(node.route);
    setEditIcon(node.icon || '');
    setEditDescription(node.description || '');
    setEditOrder(node.order || 0);
    setEditIsVisible(node.isVisible !== false);
    setEditCanChangeDefault(node.canChangeDefault || false);
    setEditDefaultComponentId(node.defaultComponentId);
    setEditDefaultPageId(node.defaultPageId);
  };

  const validateRoute = (route: string, id?: string): boolean => {
    // Check if route is empty
    if (!route.trim()) {
      setValidationErrors(prev => ({ ...prev, route: 'Route cannot be empty' }));
      return false;
    }

    // Check if route contains only valid characters
    if (!/^[a-z0-9-]+$/.test(route)) {
      setValidationErrors(prev => ({ 
        ...prev, 
        route: 'Route can only contain lowercase letters, numbers, and hyphens' 
      }));
      return false;
    }

    // Check if route is unique
    const isDuplicate = navigationRoutes.some(r => 
      r.route === route && (!id || r.id !== id)
    );
    
    if (isDuplicate) {
      setValidationErrors(prev => ({ ...prev, route: 'Route must be unique' }));
      return false;
    }

    return true;
  };

  // This function is used when editing a route from the list view
  const handleSaveEdit = async (node: RouteNode) => {
    setValidationErrors({});
    
    if (node.type === 'route' || node.type === 'core') {
      // Validate route
      if (!validateRoute(editRoute, node.id)) {
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Create the request data object
        const requestData: any = {
          name: editName,
          route: editRoute,
          icon: editIcon,
          description: editDescription,
          order: editOrder,
          is_visible: editIsVisible,
          default_component_id: editDefaultComponentId || undefined,
          // Explicitly set default_page_id to null when it's not provided
          default_page_id: editDefaultPageId || null,
          can_change_default: editCanChangeDefault
        };

        await navigationService.updateNavigationRoute(node.id, requestData);

        setSuccess('Route updated successfully');
        setEditingNode(null);
        await fetchNavigationRoutes(true);
        
        // Refresh the sidebar navigation
        if (window.refreshSidebar) {
          window.refreshSidebar();
        }
      } catch (err: any) {
        setError(`Failed to update route: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // This function is used when editing a route from the form view
  const handleSaveEditForm = async () => {
    setValidationErrors({});
    
    if (editingNode) {
      // Find the node being edited
      const currentNode = routeTree.find(n => n.id === editingNode);
      if (currentNode && (currentNode.type === 'route' || currentNode.type === 'core')) {
        // Validate route
        if (!validateRoute(editRoute, currentNode.id)) {
          return;
        }

        try {
          setLoading(true);
          setError(null);

          // Create the request data object
          const requestData: any = {
            name: editName,
            route: editRoute,
            icon: editIcon,
            description: editDescription,
            order: editOrder,
            is_visible: editIsVisible,
            default_component_id: editDefaultComponentId || undefined,
            // Explicitly set default_page_id to null when it's not provided
            default_page_id: editDefaultPageId || null,
            can_change_default: editCanChangeDefault
          };

          await navigationService.updateNavigationRoute(currentNode.id, requestData);

          setSuccess('Route updated successfully');
          setEditingNode(null);
          await fetchNavigationRoutes(true);
          
          // Refresh the sidebar navigation
          if (window.refreshSidebar) {
            window.refreshSidebar();
          }
          
          // Switch back to the Routes tab to show the updated route
          setActiveTab(0);
        } catch (err: any) {
          setError(`Failed to update route: ${err.message || 'Unknown error'}`);
        } finally {
          setLoading(false);
        }
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingNode(null);
    setValidationErrors({});
  };

  const handleDeleteRoute = async (node: RouteNode) => {
    if (node.type !== 'route' && node.type !== 'core') return;
    
    // Prevent deletion of system routes
    if (node.isSystemRoute) {
      setError(`Cannot delete system route: ${node.name}`);
      return;
    }

    // Check if any pages are using this route
    const pagesUsingRoute = pages.filter(page => 
      page.navigation_route_id === node.id
    );

    if (pagesUsingRoute.length > 0) {
      setError(`Cannot delete route: ${pagesUsingRoute.length} page(s) are using this route`);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await navigationService.deleteNavigationRoute(node.id);

      setSuccess('Route deleted successfully');
      await fetchNavigationRoutes(true);
      
      // Refresh the sidebar navigation
      if (window.refreshSidebar) {
        window.refreshSidebar();
      }
    } catch (err: any) {
      setError(`Failed to delete route: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRoute = async () => {
    setValidationErrors({});
    
    // Validate required fields
    let isValid = true;
    
    if (!newRoute.name?.trim()) {
      setValidationErrors(prev => ({ ...prev, name: 'Name is required' }));
      isValid = false;
    }
    
    if (!validateRoute(newRoute.route || '')) {
      isValid = false;
    }
    
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);

      // Create the request data object
      const requestData: any = {
        ...newRoute,
        default_component_id: newRoute.default_component_id || undefined,
        // Explicitly set default_page_id to null when it's not provided
        default_page_id: newRoute.default_page_id || null
      };

      await navigationService.createNavigationRoute(requestData);

      setSuccess('Route created successfully');
      setIsCreatingRoute(false);
      setNewRoute({
        name: '',
        route: '',
        icon: 'Folder',
        description: '',
        order: 0,
        is_visible: true,
        default_component_id: undefined,
        default_page_id: undefined,
        can_change_default: false
      });
      
      // Try to fetch routes but suppress errors to avoid showing error messages
      // after a successful creation
      await fetchNavigationRoutes(true);
      
      // Refresh the sidebar navigation
      if (window.refreshSidebar) {
        window.refreshSidebar();
      }
      
      // Switch back to the Routes tab to show the newly created route
      setActiveTab(0);
    } catch (err: any) {
      setError(`Failed to create route: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const renderRouteNode = (node: RouteNode) => {
    const isExpanded = expandedNodes[node.route] || false;
    const isEditing = editingNode === node.id;

    const getIcon = () => {
      if (node.type === 'core') {
        if (node.route === 'dashboard') return <DashboardIcon />;
        if (node.route === 'plugin-studio') return <ExtensionIcon />;
        if (node.route === 'settings') return <SettingsIcon />;
      } else if (node.icon) {
        return <IconResolver icon={node.icon} />;
      }

      return <FolderIcon />;
    };

    return (
      <React.Fragment key={node.id}>
        <ListItem
          button
          onClick={() => handleToggleExpand(node.route)}
          sx={{
            pl: 1,
            '&:hover .edit-actions': {
              opacity: 1
            }
          }}
        >
          <ListItemIcon>
            {getIcon()}
          </ListItemIcon>

          {isEditing ? (
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    value={editName}
                    onChange={(e) => {
                      const name = e.target.value;
                      setEditName(name);
                      // Auto-generate route from name when editing inline
                      setEditRoute(generateRouteFromName(name));
                    }}
                    size="small"
                    label="Name"
                    sx={{ flexGrow: 1 }}
                    disabled={node.isSystemRoute} // Name field is disabled for system routes
                  />
                  {(node.type === 'route' || node.type === 'core') && (
                    <TextField
                      value={editRoute}
                      onChange={(e) => setEditRoute(e.target.value)}
                      size="small"
                      label="Route"
                      sx={{ flexGrow: 1 }}
                      error={!!validationErrors.route}
                      helperText={validationErrors.route}
                      disabled={node.isSystemRoute} // Route field is disabled for system routes
                    />
                  )}
                  <IconButton size="small" onClick={() => handleSaveEdit(node)}>
                    <SaveIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={handleCancelEdit}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
                
                {/* Show edit actions for both regular and system routes */}
              {(node.type === 'route' || node.type === 'core') && (
                  <>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1, flexGrow: 1 }}>
                        <TextField
                          value={editIcon}
                          onChange={(e) => setEditIcon(e.target.value)}
                          size="small"
                          label="Icon"
                          placeholder="e.g., Dashboard, Folder, Settings"
                          sx={{ flexGrow: 1 }}
                          InputProps={{
                            startAdornment: editIcon ? (
                              <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                                <IconResolver icon={editIcon} />
                              </Box>
                            ) : null,
                            endAdornment: (
                              <Tooltip title="Enter a Material-UI icon name (case-sensitive)">
                                <Icons.HelpOutline fontSize="small" />
                              </Tooltip>
                            )
                          }}
                        />
                        
                        {/* Add default page dropdown for all routes */}
                        <FormControl size="small" sx={{ flexGrow: 1 }}>
                          <InputLabel>Default Page</InputLabel>
                          <Select
                            value={editDefaultPageId ? `page_${editDefaultPageId}` : ''}
                            onChange={(e) => {
                              const value = e.target.value;
                // Utility function to format UUIDs with hyphens
                const formatUuid = (id: string): string => {
                  if (!id) return id;
                  // If it already has hyphens, return as is
                  if (id.includes('-')) return id;
                  // Otherwise, add hyphens in the standard UUID format
                  return id.replace(/([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i, '$1-$2-$3-$4-$5');
                };
                
                if (value.startsWith('page_')) {
                  const rawPageId = value.replace('page_', '');
                  // Format the UUID with proper hyphens
                  const formattedPageId = formatUuid(rawPageId);
                  setEditDefaultComponentId(undefined);
                  setEditDefaultPageId(formattedPageId);
                } else {
                  setEditDefaultComponentId(undefined);
                  // Set to empty string instead of undefined
                  setEditDefaultPageId("");
                }
                            }}
                            label="Default Page"
                            disabled={!node.canChangeDefault && node.defaultPageId !== undefined}
                          >
                            <MenuItem value="">
                              <em>None</em>
                            </MenuItem>
                            {/* Filter pages to only show those using this route */}
                            {/* Pages can be associated with routes in two ways:
                             * 1. Through navigation_route_id (for custom routes)
                             * 2. Through parent_type (for system routes)
                             */}
                            {pages
                              .filter(page => {
                                return page.navigation_route_id === node.id ||
                                  (node.isSystemRoute && page.parent_type === node.route);
                              })
                              .map(page => (
                                <MenuItem key={page.id} value={`page_${page.id}`}>
                                  {page.name} ({page.id})
                                </MenuItem>
                              ))}
                          </Select>
                          <FormHelperText>
                            {!node.canChangeDefault && node.defaultPageId !== undefined 
                              ? "This route's default page cannot be changed" 
                              : "Select a page to display when this route is selected"}
                          </FormHelperText>
                        </FormControl>
                      </Box>
                      
                      <TextField
                        value={editOrder}
                        onChange={(e) => setEditOrder(parseInt(e.target.value) || 0)}
                        size="small"
                        label="Priority"
                        type="number"
                        sx={{ width: '100px' }}
                        InputProps={{
                          endAdornment: (
                            <Tooltip title="Lower numbers appear first">
                              <Icons.HelpOutline fontSize="small" />
                            </Tooltip>
                          )
                        }}
                      />
                    </Box>
                    <TextField
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      size="small"
                      label="Description"
                      placeholder="Brief description of this route"
                      fullWidth
                    />
                  </>
                )}
              </Box>
            </Box>
          ) : (
            <>
              <ListItemText
                primary={node.name}
                secondary={node.type !== 'core' ? node.route : undefined}
              />

              {/* Show edit actions for both regular and system routes */}
              {(node.type === 'route' || node.type === 'core') && (
                <Box
                  className="edit-actions"
                  sx={{
                    opacity: 0,
                    transition: 'opacity 0.2s',
                    display: 'flex',
                    gap: 1
                  }}
                >
                  <IconButton size="small" onClick={(e) => {
                    e.stopPropagation();
                    handleEditNode(node);
                  }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  
            <IconButton 
              size="small" 
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteRoute(node);
              }}
              color="error"
              disabled={node.isSystemRoute}
              sx={{
                opacity: node.isSystemRoute ? 0.5 : 1,
                cursor: node.isSystemRoute ? 'not-allowed' : 'pointer'
              }}
              title={node.isSystemRoute ? "System routes cannot be deleted" : "Delete route"}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
                </Box>
              )}
            </>
          )}
        </ListItem>
      </React.Fragment>
    );
  };

  const renderRouteForm = () => {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          {isCreatingRoute ? 'Create New Route' : 'Route Details'}
        </Typography>
        
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Name"
              value={isCreatingRoute ? newRoute.name : editName}
              onChange={(e) => {
                const name = e.target.value;
                if (isCreatingRoute) {
                  // Auto-generate route from name
                  const route = generateRouteFromName(name);
                  setNewRoute({...newRoute, name, route});
                } else {
                  setEditName(name);
                  // Auto-update route when editing as well
                  setEditRoute(generateRouteFromName(name));
                }
              }}
              disabled={!isCreatingRoute && routeTree.find(n => n.id === editingNode)?.isSystemRoute} // Name field is disabled for system routes
              error={!!validationErrors.name}
              helperText={validationErrors.name}
              margin="normal"
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Route"
              value={isCreatingRoute ? newRoute.route : editRoute}
              onChange={(e) => isCreatingRoute 
                ? setNewRoute({...newRoute, route: e.target.value})
                : setEditRoute(e.target.value)
              }
              error={!!validationErrors.route}
              helperText={validationErrors.route || 'Use lowercase letters, numbers, and hyphens only'}
              margin="normal"
              disabled={!isCreatingRoute && routeTree.find(n => n.id === editingNode)?.isSystemRoute} // Route field is disabled for system routes
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Icon"
              value={isCreatingRoute ? newRoute.icon : editIcon}
              onChange={(e) => isCreatingRoute 
                ? setNewRoute({...newRoute, icon: e.target.value})
                : setEditIcon(e.target.value)
              }
              margin="normal"
              placeholder="e.g., Dashboard, Folder, Settings"
              helperText="Enter a Material-UI icon name (case-sensitive)"
              disabled={false} // Icon field should be editable for all routes, including system routes
              InputProps={{
                endAdornment: (
                  <Tooltip title="The icon name must match a valid Material-UI icon name. Examples: Dashboard, Folder, Settings, Home, Person, etc.">
                    <IconButton size="small" edge="end">
                      <Icons.HelpOutline fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ),
                startAdornment: (
                  isCreatingRoute && newRoute.icon ? 
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <IconResolver icon={newRoute.icon} />
                  </Box> : 
                  !isCreatingRoute && editIcon ? 
                  <Box sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    <IconResolver icon={editIcon} />
                  </Box> : null
                )
              }}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Order"
              type="number"
              value={isCreatingRoute ? newRoute.order : editOrder}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                isCreatingRoute 
                  ? setNewRoute({...newRoute, order: value})
                  : setEditOrder(value);
              }}
              margin="normal"
              helperText="Lower numbers appear first"
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Description"
              multiline
              rows={2}
              value={isCreatingRoute ? newRoute.description : editDescription}
              onChange={(e) => isCreatingRoute 
                ? setNewRoute({...newRoute, description: e.target.value})
                : setEditDescription(e.target.value)
              }
              margin="normal"
            />
          </Grid>
          
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={isCreatingRoute ? newRoute.is_visible : editIsVisible}
                    onChange={(e) => isCreatingRoute 
                      ? setNewRoute({...newRoute, is_visible: e.target.checked})
                      : setEditIsVisible(e.target.checked)
                    }
                  />
                }
                label="Visible in navigation"
              />
              {/* can_change_default is managed internally and not exposed in the UI */}
            </Box>
          </Grid>
          
          <Grid item xs={12}>
            <FormControl fullWidth margin="normal">
              <InputLabel>Default Page</InputLabel>
              <Select
                value={isCreatingRoute 
                  ? (newRoute.default_page_id ? `page_${newRoute.default_page_id}` : '')
                  : (editDefaultPageId ? `page_${editDefaultPageId}` : '')}
                disabled={!isCreatingRoute && !editCanChangeDefault}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isCreatingRoute) {
                    if (value.startsWith('page_')) {
                      const pageId = value.replace('page_', '');
                      setNewRoute({
                        ...newRoute, 
                        default_component_id: undefined,
                        default_page_id: pageId
                      });
                    } else {
                      // Clear both if "None" is selected
                      setNewRoute({
                        ...newRoute,
                        default_component_id: undefined,
                        default_page_id: "" // Use empty string instead of undefined
                      });
                    }
                  } else {
                    // Same logic for editing
                    if (value.startsWith('page_')) {
                      const rawPageId = value.replace('page_', '');
                      // Format the UUID with proper hyphens
                      const formattedPageId = rawPageId.replace(
                        /([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i,
                        '$1-$2-$3-$4-$5'
                      );
                      setEditDefaultComponentId(undefined);
                      setEditDefaultPageId(formattedPageId);
                    } else {
                      setEditDefaultComponentId(undefined);
                      // Set to empty string instead of undefined
                      setEditDefaultPageId("");
                    }
                  }
                }}
                label="Default Page"
              >
                <MenuItem value="">
                  <em>None</em>
                </MenuItem>
                {/* Filter pages to only show those using this route */}
                {isCreatingRoute ? (
                  // When creating a new route, no pages will be associated with it yet
                  <MenuItem value="">
                    <em>Create the route first, then add pages to it</em>
                  </MenuItem>
                ) : (
                  // When editing, show only pages associated with this route
                  // Pages can be associated with routes in two ways:
                  // 1. Through navigation_route_id (for custom routes)
                  // 2. Through parent_type (for system routes)
                  pages
                    .filter(page => {
                      const currentNode = routeTree.find(n => n.id === editingNode);
                      return page.navigation_route_id === editingNode ||
                        (currentNode?.isSystemRoute && page.parent_type === currentNode.route);
                    })
                    .map(page => (
                      <MenuItem key={page.id} value={`page_${page.id}`}>
                        {page.name}
                      </MenuItem>
                    ))
                )}
              </Select>
              <FormHelperText>
                {!isCreatingRoute && !editCanChangeDefault 
                  ? "This route does not allow changing the default content"
                  : "Select a component or page to display when this route is selected"}
              </FormHelperText>
            </FormControl>
          </Grid>
          
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
              <Button 
                variant="outlined" 
                onClick={() => {
                  setIsCreatingRoute(false);
                  setValidationErrors({});
                }}
              >
                Cancel
              </Button>
              <Button 
                variant="contained" 
                startIcon={<SaveIcon />}
                onClick={isCreatingRoute ? handleCreateRoute : handleSaveEditForm}
              >
                {isCreatingRoute ? 'Create Route' : 'Save Changes'}
              </Button>
            </Box>
          </Grid>
        </Grid>
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Route Management
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Tabs
        value={activeTab}
        onChange={(_, newValue) => {
          setActiveTab(newValue);
          // If switching to Create Route tab, automatically set up for creating a new route
          if (newValue === 1) {
            setIsCreatingRoute(true);
          }
        }}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Routes" />
        <Tab label="Create Route" />
      </Tabs>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        {activeTab === 0 && (
          <>
            <Typography variant="body2" color="text.secondary" paragraph>
              Manage your routes. Click on a route to edit its properties.
            </Typography>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setActiveTab(1);
                  setIsCreatingRoute(true);
                }}
              >
                Create New Route
              </Button>
            </Box>

            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ maxHeight: '300px', overflow: 'auto' }}>
                <List>
                  {routeTree.map(node => renderRouteNode(node))}
                </List>
              </Box>
            )}
          </>
        )}

        {activeTab === 1 && renderRouteForm()}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
