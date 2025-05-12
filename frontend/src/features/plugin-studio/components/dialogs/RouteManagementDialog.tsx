import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  IconButton,
  TextField,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Switch,
  FormControlLabel,
  Divider,
  Tooltip,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import RouteIcon from '@mui/icons-material/AccountTree';
import { usePluginStudio } from '../../hooks';
import { IconResolver } from '../common';

interface RouteManagementDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Dialog for managing navigation routes
 * @param props The component props
 * @returns The route management dialog component
 */
export const RouteManagementDialog: React.FC<RouteManagementDialogProps> = ({ open, onClose }) => {
  const { currentPage } = usePluginStudio();
  
  // State for routes
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // State for editing
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editingRouteName, setEditingRouteName] = useState('');
  const [editingRouteSegment, setEditingRouteSegment] = useState('');
  const [editingRouteIcon, setEditingRouteIcon] = useState('');
  const [editingRouteVisible, setEditingRouteVisible] = useState(true);
  const [editingRouteParent, setEditingRouteParent] = useState<string | null>(null);
  
  // State for creating
  const [newRouteName, setNewRouteName] = useState('');
  const [newRouteSegment, setNewRouteSegment] = useState('');
  const [newRouteIcon, setNewRouteIcon] = useState('');
  const [newRouteVisible, setNewRouteVisible] = useState(true);
  const [newRouteParent, setNewRouteParent] = useState<string | null>(null);
  
  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      // Reset editing state
      setEditingRouteId(null);
      setEditingRouteName('');
      setEditingRouteSegment('');
      setEditingRouteIcon('');
      setEditingRouteVisible(true);
      setEditingRouteParent(null);
      
      // Reset new route state
      setNewRouteName('');
      setNewRouteSegment('');
      setNewRouteIcon('');
      setNewRouteVisible(true);
      setNewRouteParent(null);
      
      // Reset error
      setError(null);
      
      // Fetch routes
      fetchRoutes();
    }
  }, [open]);
  
  /**
   * Fetch routes from the backend
   */
  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // TODO: Implement actual API call to fetch routes
      // For now, use mock data
      const mockRoutes = [
        {
          id: '1',
          name: 'Dashboard',
          route: 'dashboard',
          icon: 'Dashboard',
          is_visible: true,
          is_system_route: true,
          parent_id: null,
          order: 1
        },
        {
          id: '2',
          name: 'Plugin Studio',
          route: 'plugin-studio',
          icon: 'Extension',
          is_visible: true,
          is_system_route: true,
          parent_id: null,
          order: 2
        },
        {
          id: '3',
          name: 'Settings',
          route: 'settings',
          icon: 'Settings',
          is_visible: true,
          is_system_route: true,
          parent_id: null,
          order: 3
        }
      ];
      
      setRoutes(mockRoutes);
    } catch (err) {
      console.error('Error fetching routes:', err);
      setError('Failed to fetch routes');
    } finally {
      setLoading(false);
    }
  };
  
  /**
   * Handle starting to edit a route
   * @param route The route to edit
   */
  const handleStartEdit = (route: any) => {
    setEditingRouteId(route.id);
    setEditingRouteName(route.name);
    setEditingRouteSegment(route.route);
    setEditingRouteIcon(route.icon || '');
    setEditingRouteVisible(route.is_visible);
    setEditingRouteParent(route.parent_id);
  };
  
  /**
   * Handle saving a route edit
   */
  const handleSaveEdit = async () => {
    if (!editingRouteId || !editingRouteName.trim() || !editingRouteSegment.trim()) {
      setError('Route name and segment are required');
      return;
    }
    
    try {
      // TODO: Implement actual API call to update route
      // For now, update local state
      setRoutes(prev => 
        prev.map(route => 
          route.id === editingRouteId ? {
            ...route,
            name: editingRouteName,
            route: editingRouteSegment,
            icon: editingRouteIcon,
            is_visible: editingRouteVisible,
            parent_id: editingRouteParent
          } : route
        )
      );
      
      // Reset editing state
      setEditingRouteId(null);
      setEditingRouteName('');
      setEditingRouteSegment('');
      setEditingRouteIcon('');
      setEditingRouteVisible(true);
      setEditingRouteParent(null);
      
      setError(null);
    } catch (err) {
      console.error('Error updating route:', err);
      setError('Failed to update route');
    }
  };
  
  /**
   * Handle canceling a route edit
   */
  const handleCancelEdit = () => {
    setEditingRouteId(null);
    setEditingRouteName('');
    setEditingRouteSegment('');
    setEditingRouteIcon('');
    setEditingRouteVisible(true);
    setEditingRouteParent(null);
  };
  
  /**
   * Handle creating a new route
   */
  const handleCreateRoute = async () => {
    if (!newRouteName.trim() || !newRouteSegment.trim()) {
      setError('Route name and segment are required');
      return;
    }
    
    try {
      // TODO: Implement actual API call to create route
      // For now, update local state
      const newRoute = {
        id: `new-${Date.now()}`,
        name: newRouteName,
        route: newRouteSegment,
        icon: newRouteIcon,
        is_visible: newRouteVisible,
        is_system_route: false,
        parent_id: newRouteParent,
        order: routes.length + 1
      };
      
      setRoutes(prev => [...prev, newRoute]);
      
      // Reset new route state
      setNewRouteName('');
      setNewRouteSegment('');
      setNewRouteIcon('');
      setNewRouteVisible(true);
      setNewRouteParent(null);
      
      setError(null);
    } catch (err) {
      console.error('Error creating route:', err);
      setError('Failed to create route');
    }
  };
  
  /**
   * Handle deleting a route
   * @param routeId The ID of the route to delete
   */
  const handleDeleteRoute = async (routeId: string) => {
    try {
      // TODO: Implement actual API call to delete route
      // For now, update local state
      setRoutes(prev => prev.filter(route => route.id !== routeId));
      
      setError(null);
    } catch (err) {
      console.error('Error deleting route:', err);
      setError('Failed to delete route');
    }
  };
  
  /**
   * Get parent route options for select
   * @returns Array of parent route options
   */
  const getParentRouteOptions = () => {
    return routes
      .filter(route => !route.parent_id) // Only top-level routes can be parents
      .map(route => ({
        value: route.id,
        label: route.name
      }));
  };
  
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Manage Navigation Routes</Typography>
        <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ flex: 1, overflow: 'auto' }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        {/* Create New Route */}
        <Box sx={{ mb: 3, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <Typography variant="subtitle1" gutterBottom>
            Create New Route
          </Typography>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Route Name"
              value={newRouteName}
              onChange={(e) => setNewRouteName(e.target.value)}
              variant="outlined"
              size="small"
              fullWidth
              required
            />
            
            <TextField
              label="Route Segment"
              value={newRouteSegment}
              onChange={(e) => setNewRouteSegment(e.target.value)}
              variant="outlined"
              size="small"
              fullWidth
              required
              helperText="The URL segment for this route (e.g., 'dashboard', 'settings')"
            />
            
            <TextField
              label="Icon"
              value={newRouteIcon}
              onChange={(e) => setNewRouteIcon(e.target.value)}
              variant="outlined"
              size="small"
              fullWidth
              helperText="Material-UI icon name (e.g., 'Dashboard', 'Settings')"
            />
            
            <FormControl fullWidth size="small">
              <InputLabel>Parent Route</InputLabel>
              <Select
                value={newRouteParent || ''}
                onChange={(e) => setNewRouteParent(e.target.value as string)}
                label="Parent Route"
              >
                <MenuItem value="">
                  <em>None (Top Level)</em>
                </MenuItem>
                {getParentRouteOptions().map(option => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControlLabel
              control={
                <Switch
                  checked={newRouteVisible}
                  onChange={(e) => setNewRouteVisible(e.target.checked)}
                  color="primary"
                />
              }
              label="Visible in Navigation"
            />
            
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleCreateRoute}
              disabled={!newRouteName.trim() || !newRouteSegment.trim()}
            >
              Create Route
            </Button>
          </Box>
        </Box>
        
        <Divider sx={{ my: 2 }} />
        
        {/* Route List */}
        <Typography variant="subtitle1" gutterBottom>
          Navigation Routes
        </Typography>
        
        <List>
          {routes.map((route) => (
            <ListItem
              key={route.id}
              sx={{
                borderRadius: 1,
                mb: 1,
                border: 1,
                borderColor: 'divider'
              }}
            >
              {editingRouteId === route.id ? (
                <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label="Route Name"
                    value={editingRouteName}
                    onChange={(e) => setEditingRouteName(e.target.value)}
                    variant="outlined"
                    size="small"
                    fullWidth
                    required
                    autoFocus
                  />
                  
                  <TextField
                    label="Route Segment"
                    value={editingRouteSegment}
                    onChange={(e) => setEditingRouteSegment(e.target.value)}
                    variant="outlined"
                    size="small"
                    fullWidth
                    required
                    helperText="The URL segment for this route (e.g., 'dashboard', 'settings')"
                  />
                  
                  <TextField
                    label="Icon"
                    value={editingRouteIcon}
                    onChange={(e) => setEditingRouteIcon(e.target.value)}
                    variant="outlined"
                    size="small"
                    fullWidth
                    helperText="Material-UI icon name (e.g., 'Dashboard', 'Settings')"
                  />
                  
                  <FormControl fullWidth size="small">
                    <InputLabel>Parent Route</InputLabel>
                    <Select
                      value={editingRouteParent || ''}
                      onChange={(e) => setEditingRouteParent(e.target.value as string)}
                      label="Parent Route"
                    >
                      <MenuItem value="">
                        <em>None (Top Level)</em>
                      </MenuItem>
                      {getParentRouteOptions()
                        .filter(option => option.value !== route.id) // Can't be its own parent
                        .map(option => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.label}
                          </MenuItem>
                        ))}
                    </Select>
                  </FormControl>
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={editingRouteVisible}
                        onChange={(e) => setEditingRouteVisible(e.target.checked)}
                        color="primary"
                        disabled={route.is_system_route}
                      />
                    }
                    label="Visible in Navigation"
                  />
                  
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                    <Button onClick={handleCancelEdit}>Cancel</Button>
                    <Button 
                      onClick={handleSaveEdit} 
                      color="primary" 
                      variant="contained"
                      disabled={!editingRouteName.trim() || !editingRouteSegment.trim()}
                    >
                      Save
                    </Button>
                  </Box>
                </Box>
              ) : (
                <>
                  <ListItemIcon>
                    <IconResolver icon={route.icon || 'AccountTree'} />
                  </ListItemIcon>
                  
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {route.name}
                        {route.is_system_route && (
                          <Typography variant="caption" color="text.secondary">
                            (System Route)
                          </Typography>
                        )}
                        {!route.is_visible && (
                          <Typography variant="caption" color="text.secondary">
                            (Hidden)
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                        <Typography variant="caption" component="div">
                          Route: {route.route}
                        </Typography>
                        {route.parent_id && (
                          <Typography variant="caption" component="div">
                            Parent: {routes.find(r => r.id === route.parent_id)?.name || 'Unknown'}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                  
                  <ListItemSecondaryAction>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {/* Edit Button */}
                      <Tooltip title="Edit">
                        <IconButton
                          edge="end"
                          aria-label="edit"
                          onClick={() => handleStartEdit(route)}
                          size="small"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      
                      {/* Delete Button */}
                      <Tooltip title="Delete">
                        <IconButton
                          edge="end"
                          aria-label="delete"
                          onClick={() => handleDeleteRoute(route.id)}
                          size="small"
                          color="error"
                          disabled={route.is_system_route}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItemSecondaryAction>
                </>
              )}
            </ListItem>
          ))}
        </List>
        
        {routes.length === 0 && (
          <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
            No routes found. Create a new route to get started.
          </Typography>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};