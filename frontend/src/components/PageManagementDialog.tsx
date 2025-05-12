import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Switch,
  FormControlLabel,
  Typography,
  Box,
  Tabs,
  Tab,
  Divider,
  CircularProgress,
  Alert,
  useTheme,
  useMediaQuery,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  ListSubheader,
  Grid,
  Chip,
  FormHelperText
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PublishIcon from '@mui/icons-material/Publish';
import SaveIcon from '@mui/icons-material/Save';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RouteIcon from '@mui/icons-material/Route';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import PageIcon from '@mui/icons-material/Description';
import { Page } from '../pages';
import { pageService } from '../services/pageService';
import { navigationService } from '../services/navigationService';
import { NavigationRoute } from '../types/navigation';
import { usePages } from '../hooks/usePages';
import { IconResolver } from './IconResolver';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`page-tabpanel-${index}`}
      aria-labelledby={`page-tab-${index}`}
      {...other}
      style={{ padding: '16px 0' }}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
}

interface PageManagementDialogProps {
  open: boolean;
  onClose: () => void;
  page: Page;
  onPublish: (pageId: string, publish: boolean) => Promise<void>;
  onBackup: (pageId: string) => Promise<void>;
  onRestore: (pageId: string) => Promise<void>;
  onUpdatePage: (pageId: string, updates: Partial<Page>) => Promise<void>;
}

export const PageManagementDialog: React.FC<PageManagementDialogProps> = ({
  open,
  onClose,
  page,
  onPublish,
  onBackup,
  onRestore,
  onUpdatePage
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { refreshPages } = usePages();

  // Form state
  const [name, setName] = useState(page?.name || '');
  const [parentRoute, setParentRoute] = useState(page?.parent_route || '');
  const [parentType, setParentType] = useState(page?.parent_type || 'page');
  const [isParentPage, setIsParentPage] = useState(page?.is_parent_page || false);
  const [description, setDescription] = useState(page?.description || '');
  const [isPublished, setIsPublished] = useState(page?.is_published || false);
  const [parentPages, setParentPages] = useState<Page[]>([]);
  const [fullPath, setFullPath] = useState(page?.route || '');
  const [navigationRoutes, setNavigationRoutes] = useState<NavigationRoute[]>([]);
  const [selectedNavigationRoute, setSelectedNavigationRoute] = useState<string>(page?.navigation_route_id || '');
  const [nameError, setNameError] = useState<string | null>(null);

  // Fetch parent pages
  useEffect(() => {
    const fetchParentPages = async () => {
      try {
        const pages = await pageService.getParentPages();
        setParentPages(pages);
      } catch (error) {
        console.error('Failed to fetch parent pages:', error);
      }
    };

  const fetchNavigationRoutes = async () => {
    try {
      //console.log('PageManagementDialog: Fetching navigation routes');
      const routes = await navigationService.getNavigationRoutes();
      //console.log('PageManagementDialog: Fetched navigation routes:', routes);
      
      // Check if we got a valid array
      if (Array.isArray(routes)) {
        setNavigationRoutes(routes);
        
        // Log each route for debugging
        //routes.forEach(route => {
        //  console.log('Route:', {
        //    id: route.id,
        //    name: route.name,
        //    route: route.route,
        //    icon: route.icon
        //  });
        //});
      } else {
        console.warn('PageManagementDialog: Navigation routes is not an array:', routes);
        setNavigationRoutes([]);
      }
    } catch (error) {
      console.error('PageManagementDialog: Failed to fetch navigation routes:', error);
      setNavigationRoutes([]);
    }
  };

    fetchParentPages();
    fetchNavigationRoutes();
  }, []);

  // Track if we're in the middle of saving changes
  const [isSaving, setIsSaving] = useState(false);
  
  // Reset form when page changes or dialog opens, but only if we're not in the middle of saving
  useEffect(() => {
    const loadPageData = async () => {
      if (page && page.id && !isSaving) {
        try {
          // Fetch the latest page data directly from the API to ensure we have the most up-to-date information
          //console.log(`Fetching fresh page data for ID: ${page.id}`);
          const freshPageData = await pageService.getPage(page.id);
          
          //console.log('Fresh page data loaded:', {
          //  id: freshPageData.id,
          //  name: freshPageData.name,
          //  parent_type: freshPageData.parent_type,
          //  parent_route: freshPageData.parent_route,
          //  navigation_route_id: freshPageData.navigation_route_id,
          //  route: freshPageData.route
          //});
          
          // Update all form fields with the fresh data
          setName(freshPageData.name || '');
          setParentRoute(freshPageData.parent_route || '');
          setParentType(freshPageData.parent_type || 'page');
          setIsParentPage(freshPageData.is_parent_page || false);
          setDescription(freshPageData.description || '');
          setIsPublished(freshPageData.is_published || false);
          setFullPath(freshPageData.route || '');
          setSelectedNavigationRoute(freshPageData.navigation_route_id || '');
        } catch (error) {
          console.error('Failed to fetch fresh page data:', error);
          
          // Fall back to using the provided page data
          //console.log('Using provided page data as fallback');
          setName(page.name || '');
          setParentRoute(page.parent_route || '');
          setParentType(page.parent_type || 'page');
          setIsParentPage(page.is_parent_page || false);
          setDescription(page.description || '');
          setIsPublished(page.is_published || false);
          setFullPath(page.route || '');
          setSelectedNavigationRoute(page.navigation_route_id || '');
        }
      }
    };
    
    if (open) {
      loadPageData();
    }
  }, [page.id, open, isSaving]); // Only depend on page.id instead of the entire page object

  // Update full path when name, parent route, or parent type changes
  useEffect(() => {
    let path = name;

    if (parentType && parentType !== 'page') {
      // For core routes (dashboard, plugin-studio, settings)
      path = `${parentType}/${name}`;
    } else if (parentRoute) {
      // For page parents
      path = `${parentRoute}/${name}`;
    }

    setFullPath(path);
  }, [name, parentRoute, parentType]);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handlePublishToggle = async () => {
    try {
      setLoading(true);
      setError(null);
      await onPublish(page.id, !isPublished);
      setIsPublished(!isPublished);

      // Refresh the page hierarchy to update the sidebar
      refreshPages();

      // Also refresh the sidebar using the global function if available
      if (window.refreshSidebar) {
        // @ts-ignore
        window.refreshSidebar();
      }

      setSuccess(`Page ${!isPublished ? 'published' : 'unpublished'} successfully`);
      // Close the dialog after successful publish/unpublish
      onClose();
    } catch (err: any) {
      setError(`Failed to ${!isPublished ? 'publish' : 'unpublish'} page: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    try {
      setLoading(true);
      setError(null);
      await onBackup(page.id);
      setSuccess('Page backup created successfully');
    } catch (err: any) {
      setError(`Failed to create backup: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    try {
      setLoading(true);
      setError(null);
      await onRestore(page.id);
      setSuccess('Page restored from backup successfully');
    } catch (err: any) {
      setError(`Failed to restore page: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const validatePageName = async (): Promise<boolean> => {
    // Check if name is empty
    if (!name.trim()) {
      setNameError('Page name is required');
      return false;
    }

    // Check if name contains only valid characters
    if (!/^[a-zA-Z0-9-_\s]+$/.test(name)) {
      setNameError('Page name can only contain letters, numbers, spaces, hyphens, and underscores');
      return false;
    }

    try {
      // Check if name is unique for the same parent
      const allPages = await pageService.getPages();
      const pagesWithSameName = allPages.pages.filter(p => 
        p.name.toLowerCase() === name.toLowerCase() && 
        p.id !== page.id &&
        ((p.parent_type === parentType && p.parent_route === parentRoute) ||
         (p.navigation_route_id === selectedNavigationRoute))
      );

      if (pagesWithSameName.length > 0) {
        setNameError('A page with this name already exists in the same location');
        return false;
      }

      setNameError(null);
      return true;
    } catch (error) {
      console.error('Error validating page name:', error);
      setNameError('Error validating page name');
      return false;
    }
  };

  const handleSaveChanges = async () => {
    try {
      setLoading(true);
      setError(null);
      // Set isSaving to true to prevent the useEffect from reloading the page data
      setIsSaving(true);

      // Name field is now read-only, so no validation needed

      // First update the basic page info
      await onUpdatePage(page.id, {
        description
      } as Partial<Page>);

      // Determine the correct parent_type based on the selected parent
      let finalParentType = parentType;
      let finalParentRoute = parentRoute;

      // Handle different parent types
      if (parentType === 'page') {
        // For page parents ensure parent_type is 'page'
        finalParentType = 'page';
        // Keep finalParentRoute as is (the selected page route)
      } else {
        // For core routes (dashboard, plugin-studio, settings)
        // Keep finalParentType as is
        finalParentRoute = ''; // No parent_route for core routes
      }

      // Utility function to format UUIDs with hyphens
      const formatUuid = (id: string): string => {
        if (!id) return id;
        //console.log(`PageManagementDialog formatUuid input: ${id}`);
        
        // If it already has hyphens, return as is
        if (id.includes('-')) {
          //console.log(`UUID already has hyphens, returning as is: ${id}`);
          return id;
        }
        
        // Otherwise, add hyphens in the standard UUID format
        const formatted = id.replace(/([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})/i, '$1-$2-$3-$4-$5');
       // console.log(`Formatted UUID with hyphens: ${formatted}`);
        return formatted;
      };
      
      // Determine the correct hierarchy based on the selected location
      let hierarchyUpdate = {
        parent_route: '',
        parent_type: 'page',
        is_parent_page: isParentPage
      };

      // If a navigation route is selected, clear parent_type and parent_route
      if (selectedNavigationRoute) {
        //console.log(`Page has navigation_route_id: ${selectedNavigationRoute}, clearing parent_type and parent_route`);
        hierarchyUpdate = {
          parent_route: '',
          parent_type: 'page', // Default to 'page' when using navigation_route_id
          is_parent_page: isParentPage
        };
      } else if (parentType !== 'page') {
        // For core routes, set parent_type and clear parent_route
        //console.log(`Page has parent_type: ${parentType}, clearing parent_route and navigation_route_id`);
        hierarchyUpdate = {
          parent_route: '',
          parent_type: parentType,
          is_parent_page: isParentPage
        };
      } else if (parentRoute) {
        // For page parents, set parent_route and parent_type='page'
        //console.log(`Page has parent_route: ${parentRoute}, setting parent_type to 'page' and clearing navigation_route_id`);
        hierarchyUpdate = {
          parent_route: parentRoute,
          parent_type: 'page',
          is_parent_page: isParentPage
        };
      }

      // Log the hierarchy update before sending
      //console.log("HIERARCHY UPDATE - About to send:", JSON.stringify(hierarchyUpdate, null, 2));
      //console.log("Current selectedNavigationRoute value:", selectedNavigationRoute);
      
      // Update hierarchy info
      const hierarchyResult = await pageService.updatePageHierarchy(page.id, hierarchyUpdate);
      /c//onsole.log("HIERARCHY UPDATE - Response received:", JSON.stringify(hierarchyResult, null, 2));

      // Determine the correct navigation_route_id based on the selected location
      let navigationRouteUpdate: string | null = null;
      if (selectedNavigationRoute) {
        // If a navigation route is selected, format with hyphens and use it
        //console.log(`Selected navigation route before formatting: ${selectedNavigationRoute}`);
        navigationRouteUpdate = formatUuid(selectedNavigationRoute);
        //console.log(`Setting navigation_route_id to: ${navigationRouteUpdate} (formatted from: ${selectedNavigationRoute})`);
      } else {
        // If a core route or parent page is selected, explicitly set navigation_route_id to null
        navigationRouteUpdate = null;
        //console.log(`Clearing navigation_route_id because a core route or parent page is selected`);
      }
      
      // Update navigation route association
      //console.log(`Calling onUpdatePage with navigation_route_id: ${navigationRouteUpdate === null ? 'null' : navigationRouteUpdate}`);
      
      // Always explicitly update the navigation_route_id field
      try {
        // For all cases, explicitly set or clear the navigation_route_id
        if (parentType === 'dashboard' || parentType === 'plugin-studio' || parentType === 'settings') {
          //console.log(`Setting parent_type to ${parentType} for core route and explicitly clearing navigation_route_id`);
          
          // First update the hierarchy
          await pageService.updatePageHierarchy(page.id, {
            parent_route: '',
            parent_type: parentType,
            is_parent_page: isParentPage
          });
          
          // Then explicitly clear the navigation_route_id
          // Use an empty string instead of null to ensure it's properly handled
          //console.log("CORE ROUTE - About to clear navigation_route_id");
          const updateResult = await onUpdatePage(page.id, {
            navigation_route_id: "" // Use empty string instead of null
          } as Partial<Page>);
          //console.log("CORE ROUTE - Update result:", JSON.stringify(updateResult, null, 2));
          
          //console.log(`Successfully updated parent_type to ${parentType} and cleared navigation_route_id`);
        } else if (selectedNavigationRoute) {
          // For navigation routes, explicitly set the navigation_route_id
          //console.log(`Setting navigation_route_id to ${navigationRouteUpdate}`);
          
          //console.log("NAV ROUTE - About to set navigation_route_id to:", navigationRouteUpdate);
          const updateResult = await onUpdatePage(page.id, {
            navigation_route_id: navigationRouteUpdate
          } as Partial<Page>);
          //console.log("NAV ROUTE - Update result:", JSON.stringify(updateResult, null, 2));
          
          //console.log(`Successfully updated navigation_route_id to ${navigationRouteUpdate}`);
        } else {
          // For parent pages or "Your Pages", explicitly clear the navigation_route_id
          //console.log(`Clearing navigation_route_id for parent page or "Your Pages"`);
          
          //console.log("PARENT PAGE - About to clear navigation_route_id");
          const updateResult = await onUpdatePage(page.id, {
            navigation_route_id: "" // Use empty string instead of null
          } as Partial<Page>);
          //console.log("PARENT PAGE - Update result:", JSON.stringify(updateResult, null, 2));
          
          //console.log(`Successfully cleared navigation_route_id`);
        }
        
        // Force a refresh to ensure the UI reflects the changes
        const refreshedPage = await pageService.getPage(page.id);
        //console.log('Refreshed page data:', refreshedPage);
      } catch (updateError) {
        console.error('Error updating page:', updateError);
        throw updateError;
      }
      
      //console.log(`Final page update:`, {
      //  parent_type: hierarchyUpdate.parent_type,
      //  parent_route: hierarchyUpdate.parent_route,
      //  navigation_route_id: navigationRouteUpdate
      //});

      // Don't fetch the updated page data - instead use our local state
      // This ensures the UI reflects what the user selected, not what's in the database
      // which might not have been updated yet due to async operations
      
      // Log what we're using for the UI update
      //console.log('Using local state for UI update:', {
      //  parentType,
      //  parentRoute,
       // selectedNavigationRoute,
       // fullPath
      //});
      
      // Force the UI to update with our local state values
      // This ensures the dropdown shows what the user selected
      if (parentType === 'dashboard' || parentType === 'plugin-studio' || parentType === 'settings') {
        //console.log(`Forcing UI to show core route: ${parentType}`);
        // For core routes, ensure navigation_route_id is cleared
        setSelectedNavigationRoute('');
      } else if (selectedNavigationRoute) {
        //console.log(`Forcing UI to show navigation route: ${selectedNavigationRoute}`);
        // For navigation routes, ensure parent_type and parent_route are cleared
        setParentType('page');
        setParentRoute('');
      } else if (parentRoute) {
        //console.log(`Forcing UI to show parent page: ${parentRoute}`);
        // For parent pages, ensure navigation_route_id is cleared
        setSelectedNavigationRoute('');
      } else {
        //console.log('Forcing UI to show "Your Pages" (default)');
        // For "Your Pages", ensure everything is cleared
        setParentType('page');
        setParentRoute('');
        setSelectedNavigationRoute('');
      }

      // Refresh the page hierarchy to update the sidebar
      refreshPages();

      // Also refresh the sidebar using the global function if available
      if (window.refreshSidebar) {
        // @ts-ignore
        window.refreshSidebar();
      }

      setSuccess('Page updated successfully');
      // Close the dialog after successful save
      onClose();
    } catch (err: any) {
      setError(`Failed to update page: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const copyPageUrl = () => {
    const baseUrl = window.location.origin;
    const pageUrl = `${baseUrl}/${fullPath}`;
    navigator.clipboard.writeText(pageUrl);
    setSuccess('Page URL copied to clipboard');
  };

  const getSelectedNavigationRouteName = () => {
    if (!selectedNavigationRoute) return 'None';
    const route = navigationRoutes.find(r => r.id === selectedNavigationRoute);
    return route ? route.name : 'Unknown';
  };

  const handleEasyPublish = async () => {
    try {
      setLoading(true);
      setError(null);

      // Name field is now read-only, so no validation needed

      // 1. Set the page to use the default "Your Pages" location
      setSelectedNavigationRoute('');
      setParentType('page');
      setParentRoute('');

      // 2. Update the page with the new settings
      await onUpdatePage(page.id, {
        description
      } as Partial<Page>);

      // Update hierarchy info
      await pageService.updatePageHierarchy(page.id, {
        parent_route: '',
        parent_type: 'page',
        is_parent_page: false
      });

      // Clear any navigation route association by setting it to null
      // We need to use a type assertion here because the API expects null, not an empty string
      await onUpdatePage(page.id, {
        navigation_route_id: null as unknown as string
      } as Partial<Page>);

      // 3. Publish the page if it's not already published
      if (!isPublished) {
        await onPublish(page.id, true);
        setIsPublished(true);
      }

      // Refresh the page hierarchy to update the sidebar
      refreshPages();

      // Also refresh the sidebar using the global function if available
      if (window.refreshSidebar) {
        // @ts-ignore
        window.refreshSidebar();
      }

      setSuccess('Page published to "Your Pages" successfully');
      // Close the dialog after successful publish
      onClose();
    } catch (err: any) {
      setError(`Failed to publish page: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        refreshPages(); // Refresh pages when closing the dialog
        onClose();
      }}
      fullScreen={fullScreen}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        Page Management
        <IconButton
          aria-label="close"
          onClick={() => {
            refreshPages(); // Refresh pages when closing the dialog
            onClose();
          }}
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
        value={tabValue}
        onChange={handleTabChange}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="General" />
        <Tab label="Publishing" />
        <Tab label="Backup & Restore" />
      </Tabs>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <TabPanel value={tabValue} index={0}>
          <TextField
            label="Page Name"
            value={name}
            fullWidth
            margin="normal"
            InputProps={{ readOnly: true }}
            sx={{
              "& .MuiInputBase-input.Mui-readOnly": {
                backgroundColor: theme.palette.action.disabledBackground,
                opacity: 0.8
              }
            }}
          />

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            margin="normal"
            multiline
            rows={3}
          />

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleEasyPublish}
              disabled={loading || isPublished}
              startIcon={<PublishIcon />}
            >
              Easy Publish
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2, flex: 1 }}>
              Instantly publish this page to "Your Pages" section
            </Typography>
          </Box>

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSaveChanges}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
            >
              Save Changes
            </Button>
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Publishing Status
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={isPublished}
                  onChange={handlePublishToggle}
                  disabled={loading}
                />
              }
              label={isPublished ? "Published" : "Not Published"}
            />
            {isPublished && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Published on: {page.publish_date ? new Date(page.publish_date).toLocaleString() : 'N/A'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  <TextField
                    label="Page URL"
                    value={`${window.location.origin}/${fullPath}`}
                    fullWidth
                    variant="outlined"
                    size="small"
                    InputProps={{
                      readOnly: true
                    }}
                  />
                  <Tooltip title="Copy URL">
                    <IconButton onClick={copyPageUrl} size="small" sx={{ ml: 1 }}>
                      <ContentCopyIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="h6" gutterBottom>
            Page Routing
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth margin="normal">
                <InputLabel id="page-routing-label">Route Location</InputLabel>
                <Select
                  labelId="page-routing-label"
                  value={
                    // Explicitly check for core routes first
                    parentType === 'dashboard' || parentType === 'plugin-studio' || parentType === 'settings'
                      ? parentType
                      : selectedNavigationRoute 
                        ? `nav-${selectedNavigationRoute}` 
                        : parentRoute || 'none'
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    
                    // Handle different routing options
                    if (value === 'none') {
                      // Default option - Your Pages
                      //console.log('Selected "Your Pages" option');
                      setSelectedNavigationRoute('');
                      setParentType('page');
                      setParentRoute('');
                    } else if (value === 'dashboard' || value === 'plugin-studio' || value === 'settings') {
                      // Core routes
                      //console.log(`Selected core route: ${value}`);
                      setParentType(value);
                      setParentRoute('');
                      // Explicitly set to empty string to clear any existing value
                      setSelectedNavigationRoute('');
                    } else if (value.startsWith('nav-')) {
                      // Navigation routes (prefixed with 'nav-')
                      const routeId = value.substring(4);
                      //console.log(`Selected user route with ID: ${routeId}`);
                      setSelectedNavigationRoute(routeId);
                      // Explicitly clear parent_type and parent_route
                      setParentType('page');
                      setParentRoute('');
                    } else {
                      // Parent pages
                      //console.log(`Selected parent page with route: ${value}`);
                      setParentType('page');
                      setParentRoute(value);
                      // Explicitly clear navigation_route_id
                      setSelectedNavigationRoute('');
                    }
                    
                    // Log the current state after selection
                    //console.log('Current state after selection:', {
                     // selectedValue: value,
                    //  parentType: value === 'dashboard' || value === 'plugin-studio' || value === 'settings' ? value : 'page',
                    //  parentRoute: value !== 'none' && value !== 'dashboard' && value !== 'plugin-studio' && value !== 'settings' && !value.startsWith('nav-') ? value : '',
                     // navigationRouteId: value.startsWith('nav-') ? value.substring(4) : ''
                    //});
                  }}
                  label="Route Location"
                  renderValue={(selected) => {
                    // Default option
                    if (selected === 'none') return 'Your Pages (Default)';
                    
                    // Core routes
                    if (selected === 'dashboard') return 'Your BrainDrive';
                    if (selected === 'plugin-studio') return 'BrainDrive Studio';
                    if (selected === 'settings') return 'Settings';
                    
                    // Navigation routes
                    if (typeof selected === 'string' && selected.startsWith('nav-')) {
                      const routeId = selected.substring(4);
                      const route = navigationRoutes.find(r => r.id === routeId);
                      return route ? `${route.name} (User Route)` : 'Unknown Route';
                    }
                    
                    // Parent pages
                    const parentPage = parentPages.find(p => p.route === selected);
                    return parentPage ? `${parentPage.name} (Parent Page)` : selected;
                  }}
                >
                  <MenuItem value="none">
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <RouteIcon sx={{ mr: 1 }} />
                      Your Pages (Default)
                    </Box>
                  </MenuItem>
                  
                  <ListSubheader>Core Routes</ListSubheader>
                  <MenuItem value="dashboard">
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <DashboardIcon sx={{ mr: 1 }} />
                      Your BrainDrive
                    </Box>
                  </MenuItem>
                  <MenuItem value="plugin-studio">
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <ExtensionIcon sx={{ mr: 1 }} />
                      BrainDrive Studio
                    </Box>
                  </MenuItem>
                  <MenuItem value="settings">
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <SettingsIcon sx={{ mr: 1 }} />
                      Settings
                    </Box>
                  </MenuItem>
                  
                  <ListSubheader>User Routes</ListSubheader>
                  {navigationRoutes
                    .filter(route => 
                      // Filter out core routes to avoid duplication
                      route.route !== 'dashboard' && 
                      route.route !== 'plugin-studio' && 
                      route.route !== 'settings'
                    )
                    .map(route => (
                    <MenuItem key={route.id} value={`nav-${route.id}`}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {route.icon ? (
                          <IconResolver icon={route.icon} sx={{ mr: 1 }} />
                        ) : (
                          <RouteIcon sx={{ mr: 1 }} />
                        )}
                        {route.name}
                      </Box>
                    </MenuItem>
                  ))}
                  
                  <ListSubheader>Parent Pages</ListSubheader>
                  {parentPages.map(page => (
                    <MenuItem key={page.id} value={page.route || ''}>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <PageIcon sx={{ mr: 1 }} />
                        {page.name}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  Select where this page should appear in navigation. Choose "Your Pages" to add it to the default collection.
                </FormHelperText>
              </FormControl>
            </Grid>
          </Grid>

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Full Path Preview:
            </Typography>
            <Chip 
              icon={<LinkIcon />} 
              label={fullPath} 
              variant="outlined" 
              sx={{ mt: 1 }}
            />
          </Box>

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={handleSaveChanges}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
            >
              Save Routing Changes
            </Button>
          </Box>

          <Divider sx={{ my: 1 }} />

        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Backup
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Create a backup of the current page state. This will save the current layout and content.
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                onClick={handleBackup}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : <SaveIcon />}
              >
                Create Backup
              </Button>
            </Box>
            {page.backup_date && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Last backup: {new Date(page.backup_date).toLocaleString()}
              </Typography>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              Restore
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Restore the page from the last backup. This will replace the current layout and content.
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                onClick={handleRestore}
                disabled={loading || !page.backup_date}
                startIcon={loading ? <CircularProgress size={20} /> : <RestoreIcon />}
                color="warning"
              >
                Restore from Backup
              </Button>
            </Box>
          </Box>
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={() => {
            refreshPages(); // Refresh pages when closing the dialog
            onClose();
          }}
          color="primary"
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
