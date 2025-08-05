import React, { useState, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Alert,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Card,
  CardContent,
  CardActions,
  Grid,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Link as LinkIcon,
  LinkOff as UnlinkIcon,
  Visibility as PreviewIcon,
  ExpandMore as ExpandMoreIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Route as RouteIcon,
} from '@mui/icons-material';

interface RouteConfig {
  id: string;
  path: string;
  pageId: string;
  pageName: string;
  isActive: boolean;
  parameters?: string[];
  redirects?: string[];
  middleware?: string[];
  metadata?: {
    title?: string;
    description?: string;
    canonical?: string;
  };
  createdAt: string;
  lastModified: string;
}

interface RouteValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface EnhancedRouteManagementDialogProps {
  open: boolean;
  onClose: () => void;
  routes: RouteConfig[];
  pages: Array<{ id: string; name: string; route: string }>;
  onRouteCreate: (route: Partial<RouteConfig>) => void;
  onRouteUpdate: (routeId: string, route: Partial<RouteConfig>) => void;
  onRouteDelete: (routeId: string) => void;
  onRouteActivate: (routeId: string, active: boolean) => void;
}

export const EnhancedRouteManagementDialog: React.FC<EnhancedRouteManagementDialogProps> = ({
  open,
  onClose,
  routes,
  pages,
  onRouteCreate,
  onRouteUpdate,
  onRouteDelete,
  onRouteActivate,
}) => {
  const [editingRoute, setEditingRoute] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRouteData, setNewRouteData] = useState<Partial<RouteConfig>>({
    path: '',
    pageId: '',
    isActive: true,
    parameters: [],
    redirects: [],
    middleware: [],
    metadata: {},
  });
  const [validationResults, setValidationResults] = useState<Record<string, RouteValidation>>({});

  // Validate route path
  const validateRoute = useCallback((path: string, routeId?: string): RouteValidation => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const safeRoutes = routes || [];

    // Check if path is empty
    if (!path.trim()) {
      errors.push('Route path cannot be empty');
    }

    // Check if path starts with /
    if (path && !path.startsWith('/')) {
      errors.push('Route path must start with /');
    }

    // Check for invalid characters
    const invalidChars = /[^a-zA-Z0-9\-_\/:\*\?]/;
    if (invalidChars.test(path)) {
      errors.push('Route path contains invalid characters');
    }

    // Check for duplicate paths
    const existingRoute = safeRoutes.find(r => r.path === path && r.id !== routeId);
    if (existingRoute) {
      errors.push(`Route path conflicts with existing route (${existingRoute.pageName})`);
    }

    // Check for potential conflicts with dynamic routes
    const dynamicPattern = /\/:[^\/]+/g;
    const hasDynamicSegments = dynamicPattern.test(path);
    if (hasDynamicSegments) {
      const conflictingRoutes = safeRoutes.filter(r => {
        if (r.id === routeId) return false;
        const segments1 = path.split('/');
        const segments2 = r.path.split('/');
        if (segments1.length !== segments2.length) return false;
        
        return segments1.every((seg, i) => {
          const isDynamic1 = seg.startsWith(':');
          const isDynamic2 = segments2[i].startsWith(':');
          return isDynamic1 || isDynamic2 || seg === segments2[i];
        });
      });
      
      if (conflictingRoutes.length > 0) {
        warnings.push('Route may conflict with dynamic routes');
      }
    }

    // Check for trailing slashes
    if (path.length > 1 && path.endsWith('/')) {
      warnings.push('Route path has trailing slash');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }, [routes]);

  // Update validation results when routes change
  React.useEffect(() => {
    const results: Record<string, RouteValidation> = {};
    const safeRoutes = routes || [];
    safeRoutes.forEach(route => {
      results[route.id] = validateRoute(route.path, route.id);
    });
    setValidationResults(results);
  }, [routes, validateRoute]);

  // Handle route creation
  const handleCreateRoute = useCallback(() => {
    if (!newRouteData.path || !newRouteData.pageId) return;
    
    const validation = validateRoute(newRouteData.path);
    if (!validation.isValid) return;
    
    const routeData: Partial<RouteConfig> = {
      ...newRouteData,
      id: `route-${Date.now()}`,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    
    onRouteCreate(routeData);
    setNewRouteData({
      path: '',
      pageId: '',
      isActive: true,
      parameters: [],
      redirects: [],
      middleware: [],
      metadata: {},
    });
    setShowCreateForm(false);
  }, [newRouteData, onRouteCreate, validateRoute]);

  // Handle route update
  const handleUpdateRoute = useCallback((routeId: string, updates: Partial<RouteConfig>) => {
    onRouteUpdate(routeId, {
      ...updates,
      lastModified: new Date().toISOString(),
    });
    setEditingRoute(null);
  }, [onRouteUpdate]);

  // Get route statistics
  const routeStats = useMemo(() => {
    if (!routes || !Array.isArray(routes)) return { total: 0, active: 0, inactive: 0, withErrors: 0, withWarnings: 0 };
    
    const total = (routes || []).length;
    const active = (routes || []).filter(r => r.isActive).length;
    const inactive = total - active;
    const withErrors = Object.values(validationResults).filter(v => !v.isValid).length;
    const withWarnings = Object.values(validationResults).filter(v => v.warnings.length > 0).length;
    
    return { total, active, inactive, withErrors, withWarnings };
  }, [routes, validationResults]);

  // Get page name by ID
  const getPageName = useCallback((pageId: string) => {
    if (!pages || !Array.isArray(pages)) return 'Unknown Page';
    return pages.find(p => p.id === pageId)?.name || 'Unknown Page';
  }, [pages]);

  // Format date for display
  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: { height: '90vh', display: 'flex', flexDirection: 'column' }
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <RouteIcon />
            <Typography variant="h6">Route Management</Typography>
          </Box>
          <Box display="flex" alignItems="center" gap={2}>
            <Box display="flex" gap={1}>
              {routeStats.withErrors > 0 && (
                <Chip
                  icon={<ErrorIcon />}
                  label={`${routeStats.withErrors} errors`}
                  color="error"
                  size="small"
                />
              )}
              {routeStats.withWarnings > 0 && (
                <Chip
                  icon={<WarningIcon />}
                  label={`${routeStats.withWarnings} warnings`}
                  color="warning"
                  size="small"
                />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">
              {routeStats.total} routes ({routeStats.active} active)
            </Typography>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => setShowCreateForm(true)}
            >
              New Route
            </Button>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2 }}>
        {/* Create New Route Form */}
        {showCreateForm && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Create New Route</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Route Path"
                    value={newRouteData.path}
                    onChange={(e) => setNewRouteData(prev => ({ ...prev, path: e.target.value }))}
                    placeholder="/example/path"
                    required
                    error={newRouteData.path ? !validateRoute(newRouteData.path).isValid : false}
                    helperText={newRouteData.path ? validateRoute(newRouteData.path).errors[0] : 'Use :param for dynamic segments'}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth required>
                    <InputLabel>Target Page</InputLabel>
                    <Select
                      value={newRouteData.pageId || ''}
                      onChange={(e) => setNewRouteData(prev => ({ ...prev, pageId: e.target.value }))}
                      label="Target Page"
                    >
                      {(pages || []).map(page => (
                        <MenuItem key={page.id} value={page.id}>
                          {page.name} ({page.route})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Page Title"
                    value={newRouteData.metadata?.title || ''}
                    onChange={(e) => setNewRouteData(prev => ({
                      ...prev,
                      metadata: { ...prev.metadata, title: e.target.value }
                    }))}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={newRouteData.isActive || false}
                        onChange={(e) => setNewRouteData(prev => ({ ...prev, isActive: e.target.checked }))}
                      />
                    }
                    label="Active"
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="Description"
                    multiline
                    rows={2}
                    value={newRouteData.metadata?.description || ''}
                    onChange={(e) => setNewRouteData(prev => ({
                      ...prev,
                      metadata: { ...prev.metadata, description: e.target.value }
                    }))}
                  />
                </Grid>
              </Grid>
            </CardContent>
            <CardActions>
              <Button onClick={() => setShowCreateForm(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={handleCreateRoute}
                disabled={!newRouteData.path || !newRouteData.pageId || !validateRoute(newRouteData.path || '').isValid}
              >
                Create Route
              </Button>
            </CardActions>
          </Card>
        )}

        {/* Routes Table */}
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <TableContainer component={Paper}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Route Path</TableCell>
                  <TableCell>Target Page</TableCell>
                  <TableCell>Last Modified</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(routes || []).map((route) => {
                  const validation = validationResults[route.id];
                  return (
                    <TableRow key={route.id}>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          {route.isActive ? (
                            <Chip label="Active" color="success" size="small" />
                          ) : (
                            <Chip label="Inactive" color="default" size="small" />
                          )}
                          {validation && !validation.isValid && (
                            <Tooltip title={validation.errors.join(', ')}>
                              <ErrorIcon color="error" fontSize="small" />
                            </Tooltip>
                          )}
                          {validation && validation.warnings.length > 0 && (
                            <Tooltip title={validation.warnings.join(', ')}>
                              <WarningIcon color="warning" fontSize="small" />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2" fontFamily="monospace">
                            {route.path}
                          </Typography>
                          {route.parameters && route.parameters.length > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              Params: {route.parameters.join(', ')}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box>
                          <Typography variant="body2">
                            {getPageName(route.pageId)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            ID: {route.pageId}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {formatDate(route.lastModified)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box display="flex" gap={0.5}>
                          <Tooltip title="Edit route">
                            <IconButton
                              size="small"
                              onClick={() => setEditingRoute(route.id)}
                            >
                              <EditIcon />
                            </IconButton>
                          </Tooltip>
                          
                          <Tooltip title={route.isActive ? 'Deactivate' : 'Activate'}>
                            <IconButton
                              size="small"
                              onClick={() => onRouteActivate(route.id, !route.isActive)}
                              color={route.isActive ? 'success' : 'default'}
                            >
                              {route.isActive ? <LinkIcon /> : <UnlinkIcon />}
                            </IconButton>
                          </Tooltip>
                          
                          <Tooltip title="Delete route">
                            <IconButton
                              size="small"
                              onClick={() => onRouteDelete(route.id)}
                              color="error"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {(routes || []).length === 0 && (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No routes configured. Create your first route to get started.
              </Typography>
            </Box>
          )}
        </Box>

        {/* Route Analysis */}
        <Accordion sx={{ mt: 2 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="h6">Route Analysis</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="primary">
                      {routeStats.total}
                    </Typography>
                    <Typography color="text.secondary">
                      Total Routes
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="success.main">
                      {routeStats.active}
                    </Typography>
                    <Typography color="text.secondary">
                      Active Routes
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="error.main">
                      {routeStats.withErrors}
                    </Typography>
                    <Typography color="text.secondary">
                      Routes with Errors
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={3}>
                <Card>
                  <CardContent>
                    <Typography variant="h4" color="warning.main">
                      {routeStats.withWarnings}
                    </Typography>
                    <Typography color="text.secondary">
                      Routes with Warnings
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EnhancedRouteManagementDialog;