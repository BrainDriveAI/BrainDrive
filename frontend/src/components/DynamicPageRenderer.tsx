import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Typography, useMediaQuery, useTheme } from '@mui/material';

// Declare a global interface for the Window object
declare global {
  interface Window {
    currentPageTitle?: string;
    isStudioPage?: boolean;
  }
}
import { debounce, throttle } from 'lodash';
import ComponentErrorBoundary from './ComponentErrorBoundary';
import { usePageState } from '../contexts/PageStateContext';
import { useModuleState } from '../contexts/ModuleStateContext';
import { Page, DeviceType } from '../pages';
import { pageService } from '../services/pageService';
import { defaultPageService } from '../services/defaultPageService';
import { PluginModuleRenderer } from './PluginModuleRenderer';
import { PluginProvider } from '../contexts/PluginContext';
import { getAvailablePlugins } from '../plugins';
import { pageContextService } from '../services/PageContextService';

interface DynamicPageRendererProps {
  pageId?: string;  // Optional: directly specify page ID
  route?: string;   // Optional: specify route instead of ID
  allowUnpublished?: boolean; // Optional: allow rendering unpublished pages (for default pages in navigation routes)
}

export const DynamicPageRenderer: React.FC<DynamicPageRendererProps> = ({ pageId, route, allowUnpublished = false }) => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  
  // State
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moduleStates, setModuleStates] = useState<Record<string, any>>({});
  
  // Get page state functions from context with enhanced capabilities
  const {
    cachePage,
    getCachedPage,
    getScrollPosition,
    setScrollPosition,
    getModuleStatesForPage,
    savePageToSessionStorage
  } = usePageState();
  
  // Force re-render when container size changes
  const [, forceUpdate] = useReducer(x => x + 1, 0);
  
  // Determine device type based on screen size
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  
  // Get a unique identifier for the current page
  const getPageId = useCallback(() => {
    if (pageId) return pageId;
    if (route) return `route:${route}`;
    
    // Extract route from URL
    let urlPath = location.pathname;
    
    // Handle paths under /pages/ differently
    if (urlPath.startsWith('/pages/')) {
      urlPath = urlPath.substring(7); // Remove '/pages/' prefix
    } else if (urlPath.startsWith('/')) {
      urlPath = urlPath.substring(1); // Remove leading slash
    }
    
    return `route:${urlPath}`;
  }, [pageId, route, location.pathname]);
  
  // Use a ref to track if we're currently updating to prevent infinite loops
  const isUpdatingRef = useRef<boolean>(false);
  
  // Save scroll position and module states when unmounting or navigating away
  useEffect(() => {
    return () => {
      if (page && !isUpdatingRef.current) {
        isUpdatingRef.current = true;
        
        const currentPageId = getPageId();
        
        // Save scroll position
        setScrollPosition(currentPageId, window.scrollY);
        
        // Save page to session storage
        savePageToSessionStorage();
        
        // Reset global variables when unmounting
        window.currentPageTitle = undefined;
        window.isStudioPage = false;
        
        console.log('DynamicPageRenderer - Unmounting, reset global variables');
        
        // Reset the updating flag after a short delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    };
  }, [page, getPageId, setScrollPosition, savePageToSessionStorage]);
  
  const deviceType: DeviceType = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
  
  // Determine if this is a studio page and update global variables
  const isStudioPage = useMemo(() => {
    const studioPage = location.pathname.startsWith('/plugin-studio') ||
                      location.pathname.startsWith('/pages/');
    return studioPage;
  }, [location.pathname]);

  // Get module state functions from context
  const { getModuleState, saveModuleState, saveAllModuleStates } = useModuleState();
  
  // Use a ref to track the current page ID to prevent duplicate loads
  const pageIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef<boolean>(false);
  
  // Memoize the current page ID to prevent unnecessary recalculations
  const currentId = useMemo(() => getPageId(), [pageId, route, location.pathname]);

  // Update global variables and page context when page or studio status changes
  useEffect(() => {
    if (page) {
      window.currentPageTitle = page.name;
      window.isStudioPage = isStudioPage;

      // Update the page context service
      const pageContextData = {
        pageId: page.id || currentId,
        pageName: page.name || 'Unknown Page',
        pageRoute: page.route || location.pathname,
        isStudioPage
      };
      
      pageContextService.setPageContext(pageContextData);

      console.log('DynamicPageRenderer - Current path:', location.pathname);
      console.log('DynamicPageRenderer - Is studio page:', isStudioPage);
      console.log('DynamicPageRenderer - Page name:', page.name);
      console.log('DynamicPageRenderer - Page context updated:', pageContextData);
      console.log('DynamicPageRenderer - Global variables:', {
        currentPageTitle: window.currentPageTitle,
        isStudioPage: window.isStudioPage
      });
    }
  }, [page, currentId, isStudioPage, location.pathname]);
  
  // Function to handle module state changes
  const handleModuleStateChange = useCallback((moduleId: string, state: any) => {
    if (isUpdatingRef.current) return;
    
    setModuleStates(prev => {
      const newStates = {
        ...prev,
        [moduleId]: state
      };
      return newStates;
    });
    
    // Save to ModuleStateContext with the full module ID
    if (page && page.modules && page.modules[moduleId]) {
      const moduleConfig = page.modules[moduleId];
      const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
      saveModuleState(fullModuleId, state);
      
      // Also update the page cache with this new state
      const pageId = currentId;
      const cachedPage = getCachedPage(pageId);
      
      if (cachedPage) {
        const updatedPage = JSON.parse(JSON.stringify(cachedPage));
        
        if (updatedPage.modules && updatedPage.modules[moduleId]) {
          updatedPage.modules[moduleId] = {
            ...updatedPage.modules[moduleId],
            config: {
              ...(updatedPage.modules[moduleId].config || {}),
              savedState: state
            }
          };
          
          // Update the cache
          cachePage(pageId, updatedPage);
        }
      }
    }
  }, [page, currentId, saveModuleState, getCachedPage, cachePage]);
  
  // Function to save all module states before navigation
  const saveAllModuleStatesBeforeNavigation = useCallback(() => {
    if (isUpdatingRef.current || !page || !page.modules) return;
    
    isUpdatingRef.current = true;
    
    // Create a copy of the current module states
    const currentModuleStates = {...moduleStates};
    const moduleCount = Object.keys(currentModuleStates).length;
    
    // Save all module states to ModuleStateContext
    let savedCount = 0;
    Object.entries(page.modules).forEach(([moduleId, moduleConfig]) => {
      const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
      const currentState = moduleStates[moduleId];
      
      if (currentState) {
        // Save to ModuleStateContext
        saveModuleState(fullModuleId, currentState);
        savedCount++;
      }
    });
    
    // Save all module states at once
    saveAllModuleStates();
    
    // Create a deep copy of the page to avoid modifying the original
    const pageWithStates = JSON.parse(JSON.stringify(page));
    
    // Add the saved states to the page modules
    let embeddedStateCount = 0;
    Object.entries(pageWithStates.modules).forEach(([moduleId, moduleConfig]: [string, any]) => {
      const currentState = currentModuleStates[moduleId];
      
      if (currentState) {
        // Add saved state to module config
        pageWithStates.modules[moduleId] = {
          ...moduleConfig,
          config: {
            ...(moduleConfig.config || {}),
            savedState: currentState
          }
        };
        embeddedStateCount++;
      }
    });
    
    // Save the page with module states
    cachePage(currentId, pageWithStates);
    
    // Save scroll position
    setScrollPosition(currentId, window.scrollY);
    
    // Save to session storage
    savePageToSessionStorage();
    
    // Reset the updating flag after a short delay
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 0);
  }, [currentId, page, moduleStates, saveModuleState, saveAllModuleStates, cachePage, setScrollPosition, savePageToSessionStorage]);
  
  // Create a debounced version of the save function
  const debouncedSaveAllStates = useCallback(
    debounce(() => {
      saveAllModuleStatesBeforeNavigation();
    }, 300),
    [saveAllModuleStatesBeforeNavigation]
  );
  
  // Add event listeners for navigation
  useEffect(() => {
    // Create a throttled version of the save function for beforeunload
    const throttledSaveAllStates = throttle(() => {
      saveAllModuleStatesBeforeNavigation();
    }, 500, { leading: true, trailing: true });
    
    // Save states before unload
    const handleBeforeUnload = () => {
      throttledSaveAllStates();
    };
    
    // Add event listener
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Listen for navigation events
    const unlisten = navigate && typeof navigate === 'function' ?
      () => {
        // This is a placeholder since React Router v6 doesn't have a direct listen method
        // We'll rely on the cleanup function in the main effect
      } :
      () => {};
    
    // Clean up
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unlisten();
      
      // Save state when unmounting
      debouncedSaveAllStates();
    };
  }, [debouncedSaveAllStates, navigate, saveAllModuleStatesBeforeNavigation]);
  
  // Load the page only once on mount or when the ID changes
  useEffect(() => {
    // Skip if we're already on this page
    if (pageIdRef.current === currentId && page) {
      return;
    }
    
    // Save state for the previous page before loading the new one
    if (pageIdRef.current && page) {
      saveAllModuleStatesBeforeNavigation();
    }
    
    // Update the ref to track the current page ID
    pageIdRef.current = currentId;
    
    // Define the page loading function with safeguards against infinite loops
    const loadPageData = async () => {
      // Skip if already loading
      if (isLoadingRef.current) {
        return;
      }
      
      try {
        // Set loading state
        isLoadingRef.current = true;
        setLoading(true);
        setError(null);
        
        // Check for cached page first
        const cachedPage = getCachedPage(currentId);
        console.log('[DynamicPageRenderer] Checking cache for key:', currentId);
        console.log('[DynamicPageRenderer] Cached page found:', !!cachedPage);
        if (cachedPage) {
          console.log('[DynamicPageRenderer] Using cached page with modules:', Object.keys(cachedPage.modules || {}));
          // Get module states for this page
          const cachedModuleStates = getModuleStatesForPage(currentId);
          
          // Apply saved states to the page modules
          if (cachedPage.modules && Object.keys(cachedModuleStates).length > 0) {
            // Create a deep copy of the page to avoid modifying the cached version
            const pageWithStates = JSON.parse(JSON.stringify(cachedPage));
            
            // Apply the saved states to each module
            Object.entries(pageWithStates.modules).forEach(([moduleId, moduleConfig]: [string, any]) => {
              const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
              const savedState = cachedModuleStates[moduleId] || getModuleState(fullModuleId);
              
              if (savedState) {
                // Add saved state to module config
                pageWithStates.modules[moduleId] = {
                  ...moduleConfig,
                  config: {
                    ...(moduleConfig.config || {}),
                    savedState
                  }
                };
              }
            });
            
            // Set the page with restored states
            setPage(pageWithStates);
            
            // Set module states
            setModuleStates(cachedModuleStates);
          } else {
            setPage(cachedPage);
          }
          
          setLoading(false);
          
          // Restore scroll position after a short delay
          setTimeout(() => {
            window.scrollTo(0, getScrollPosition(currentId));
            isLoadingRef.current = false;
          }, 0);
          
          return;
        }
        
        // Load the page based on the available information
        let loadedPage: Page | null = null;
        
        if (pageId) {
          loadedPage = allowUnpublished
            ? await defaultPageService.getDefaultPage(pageId)
            : await pageService.getPage(pageId);
        } else if (route) {
          loadedPage = await pageService.getPageByRoute(route);
        } else {
          // Extract route from URL
          let urlPath = location.pathname;
          if (urlPath.startsWith('/pages/')) {
            urlPath = urlPath.substring(7);
          } else if (urlPath.startsWith('/')) {
            urlPath = urlPath.substring(1);
          }
          
          if (urlPath === '' || urlPath === 'pages') {
            throw new Error('No page specified');
          }
          
          loadedPage = await pageService.getPageByRoute(urlPath);
        }
        
        // Validate the loaded page
        if (!loadedPage) {
          throw new Error('Page not found');
        }
        
        if (!loadedPage.is_published && !loadedPage.is_local && !allowUnpublished) {
          throw new Error('Page is not published');
        }
        
        // Process the page data
        let processedPage = { ...loadedPage };
        
        // Initialize module states
        const initialModuleStates: Record<string, any> = {};
        
        // If we have modules, check for saved state for each one
        if (processedPage.modules) {
          Object.entries(processedPage.modules).forEach(([moduleId, moduleConfig]: [string, any]) => {
            const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
            const savedState = getModuleState(fullModuleId);
            
            if (savedState) {
              initialModuleStates[moduleId] = savedState;
              
              // Add saved state to module config
              processedPage.modules![moduleId] = {
                ...moduleConfig,
                config: {
                  ...(moduleConfig.config || {}),
                  savedState
                }
              };
            }
          });
        }
        
        // Set module states
        if (Object.keys(initialModuleStates).length > 0) {
          setModuleStates(initialModuleStates);
        }
        
        // Extract layouts and modules if needed
        if (!processedPage.layouts && processedPage.content?.layouts) {
          processedPage.layouts = processedPage.content.layouts;
        }
        
        if (!processedPage.modules && processedPage.content?.modules) {
          processedPage.modules = processedPage.content.modules;
        }
        
        // Ensure layouts exist
        if (!processedPage.layouts) {
          processedPage.layouts = { desktop: [], tablet: [], mobile: [] };
        }
        
        // Sanitize and update
        const sanitizedPage = sanitizePageData(processedPage);
        setPage(sanitizedPage);
        
        // Set global variables for the Header component
        window.currentPageTitle = sanitizedPage.name;
        window.isStudioPage = location.pathname.startsWith('/plugin-studio') ||
                             location.pathname.startsWith('/pages/');
        
        console.log('DynamicPageRenderer - Setting global variables:', {
          currentPageTitle: window.currentPageTitle,
          isStudioPage: window.isStudioPage
        });
        
        // Cache the page with module states
        cachePage(currentId, sanitizedPage);
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load page');
      } finally {
        setLoading(false);
        isLoadingRef.current = false;
      }
    };
    
    // Execute the load function
    loadPageData();
    
  }, [
    pageId,
    route,
    location.pathname,
    currentId,
    getCachedPage,
    getModuleState,
    cachePage,
    getScrollPosition,
    getModuleStatesForPage,
    saveAllModuleStatesBeforeNavigation,
    allowUnpublished
  ]); // Dependencies
  
  // Use ResizeObserver for more precise container size monitoring
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver(() => {
      // Force re-render when container size changes
      forceUpdate();
    });
    
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [containerRef.current]);

  // Force an initial layout calculation after the component has mounted
  useEffect(() => {
    // Wait for the DOM to be fully rendered
    requestAnimationFrame(() => {
      // Force a re-render to ensure container width is correctly calculated
      forceUpdate();
    });
  }, []);
  
  // Function to sanitize page data
  function sanitizePageData(page: Page): Page {
    // Deep clone to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(page)) as Page;
    
    // Remove any potentially dangerous properties
    if (!sanitized.is_local) {
      delete sanitized.creator_id;
    }
    
    // Sanitize module configurations
    if (sanitized.modules) {
      Object.keys(sanitized.modules).forEach(moduleId => {
        const module = sanitized.modules![moduleId];
        
        // Remove any dangerous config properties
        if (module.config) {
          delete module.config.apiKeys;
          delete module.config.credentials;
          // Add other sensitive fields as needed
        }
      });
    }
    
    return sanitized;
  }
  
  // Render a grid item with the module
  const renderGridItem = (item: any, containerWidth: number) => {
    if (!page || !page.modules) return null;
    
    // For backward compatibility, handle both old GridItem and new LayoutItem formats
    const moduleUniqueId = item.moduleUniqueId || item.i;
    
    // Try to get the module definition with different moduleUniqueId formats
    let moduleDefinition = page.modules[moduleUniqueId];
    let actualModuleKey = moduleUniqueId;

    // If not found, try various format variations for Plugin Studio compatibility
    if (!moduleDefinition) {
      // Try all possible module keys to find a match
      const moduleKeys = Object.keys(page.modules);
      
      for (const key of moduleKeys) {
        // Try exact match first
        if (key === moduleUniqueId) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        // Try case-insensitive match
        if (key.toLowerCase() === moduleUniqueId.toLowerCase()) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        // Try matching the base part (before timestamp)
        const keyBase = key.split('_').slice(0, -1).join('_');
        const moduleIdBase = moduleUniqueId.split('_').slice(0, -1).join('_');
        if (keyBase.toLowerCase() === moduleIdBase.toLowerCase()) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        // Try Plugin Studio format compatibility: handle underscore differences
        // Convert "BrainDriveBasicAIChat_a8e..." to "BrainDriveBasicAIChatA8e..."
        const normalizedModuleId = moduleUniqueId.replace(/([A-Za-z])_([a-f0-9]{32})/, '$1$2');
        if (key === normalizedModuleId) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        // Try the reverse: convert "BrainDriveBasicAIChatA8e..." to "BrainDriveBasicAIChat_A8e..."
        const normalizedKey = key.replace(/([A-Za-z])([a-f0-9]{32})/, '$1_$2');
        if (normalizedKey === moduleUniqueId) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        // Try case-insensitive version of the normalized formats
        if (normalizedModuleId.toLowerCase() === key.toLowerCase()) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
        
        if (normalizedKey.toLowerCase() === moduleUniqueId.toLowerCase()) {
          moduleDefinition = page.modules[key];
          actualModuleKey = key;
          break;
        }
      }
      
      // If still not found, try with underscores removed (legacy compatibility)
      if (!moduleDefinition) {
        const moduleUniqueIdWithoutUnderscores = moduleUniqueId.replace(/_/g, '');
        for (const key of moduleKeys) {
          const keyWithoutUnderscores = key.replace(/_/g, '');
          if (keyWithoutUnderscores === moduleUniqueIdWithoutUnderscores) {
            moduleDefinition = page.modules[key];
            actualModuleKey = key;
            break;
          }
        }
      }
    }

    // If still not found, log the issue and return null
    if (!moduleDefinition) {
      console.warn(`[DynamicPageRenderer] Module not found for ID: ${moduleUniqueId}`);
      console.warn(`[DynamicPageRenderer] Available module keys:`, Object.keys(page.modules));
      return null;
    }
    
    // Merge the default config with any layout-specific overrides
    const mergedConfig = {
      ...moduleDefinition.config,
      ...(item.configOverrides || {})
    };
    
    // Get the current state for this module using the actual module key
    const currentModuleState = moduleStates[actualModuleKey] || moduleStates[moduleUniqueId];
    
    // Check if we have a saved state in the module config (from cache)
    const savedStateFromConfig = moduleDefinition.config?.savedState;
    
    // Use the most up-to-date state available
    const effectiveState = currentModuleState || savedStateFromConfig || null;
    
    if (effectiveState) {
      // If we have state from config but not in local state, update local state
      if (savedStateFromConfig && !currentModuleState) {
        setModuleStates(prev => ({
          ...prev,
          [actualModuleKey]: savedStateFromConfig
        }));
      }
    }
    
    // Add state persistence props
    const stateProps = {
      initialState: effectiveState,
      onStateChange: (state: any) => handleModuleStateChange(actualModuleKey, state),
      savedState: effectiveState,
      // Add a timestamp to force the component to recognize the state change
      stateTimestamp: Date.now(),
      // Add the module unique ID to help with debugging
      moduleUniqueId
    };
    
    // Calculate grid parameters
    const cols = deviceType === 'mobile' ? 4 : deviceType === 'tablet' ? 8 : 12;
    
    // Calculate grid cell dimensions
    const colSpan = item.w;
    const rowSpan = item.h;
    const colStart = item.x + 1; // Grid is 1-based
    const rowStart = item.y + 1; // Grid is 1-based
    
    return (
      <Box
        key={moduleUniqueId}
        sx={{
          gridColumn: `${colStart} / span ${colSpan}`,
          gridRow: `${rowStart} / span ${rowSpan}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: rowSpan * 100, // Set minimum height based on row span
          height: rowSpan * 100, // Set fixed height based on row span
          maxHeight: rowSpan * 100, // Prevent container from expanding
          overflow: 'hidden', // Let the plugin handle its own scrolling
          borderRadius: 1,
          bgcolor: 'background.paper',
          boxShadow: 0
        }}
      >
        <Box sx={{ width: '100%', p: 1, flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <ComponentErrorBoundary>
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <PluginModuleRenderer
                pluginId={moduleDefinition.pluginId}
                moduleId={moduleDefinition.moduleId}
                moduleName={moduleDefinition.moduleName}
                moduleProps={{
                  ...mergedConfig,
                  ...stateProps,
                  moduleUniqueId, // Pass the unique ID to help with state management
                  containerHeight: rowSpan * 100 // Pass the container height to the module
                }}
                isLocal={false}
              />
            </Box>
          </ComponentErrorBoundary>
        </Box>
      </Box>
    );
  };
  
  // Loading state
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  
  // Error state
  if (error || !page) {
    // If we're allowing unpublished pages and the error is about publication, show a different message
    if (allowUnpublished && error && error.includes('not published')) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h5" color="warning.main" gutterBottom>
            Unpublished Default Page
          </Typography>
          <Typography variant="body1">
            This page is set as the default for a navigation route but is not published.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            To view this page, you need to publish it or modify the DynamicPageRenderer to bypass the publication check.
          </Typography>
        </Box>
      );
    }
    
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" color="error" gutterBottom>
          Error Loading Page
        </Typography>
        <Typography variant="body1">
          {error || 'Page not found'}
        </Typography>
      </Box>
    );
  }
  
  // Get the appropriate layout based on device type
  const layout = page.layouts[deviceType] || page.layouts.desktop || [];
  
  // We don't need to calculate exact container width for positioning anymore
  // since we're using percentage-based responsive layout
  const containerWidth = containerRef.current?.getBoundingClientRect().width || window.innerWidth;
  
  // Prevent infinite loop by checking if layout is valid
  if (!Array.isArray(layout)) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" color="error" gutterBottom>
          Invalid Page Layout
        </Typography>
        <Typography variant="body1">
          The page layout is not in the expected format. Please check the page configuration.
        </Typography>
      </Box>
    );
  }
  
  return (
    <PluginProvider plugins={getAvailablePlugins()}>
      <Box
        ref={containerRef}
        sx={{
          position: 'relative',
          width: '100%',
          height: 'auto',
          minHeight: '100vh',
          overflow: 'visible', // Changed to visible to prevent scrollbars
          p: 0,
          bgcolor: 'background.default',
          boxSizing: 'border-box' // Ensure padding is included in width calculations
        }}
      >
        {/* Page title - only show if not a studio page */}
        {!isStudioPage && (
          <Typography variant="h4" gutterBottom sx={{ pl: 2, pt: 2 }}>
            {page.name}
          </Typography>
        )}

        {/* Description if available */}
        {page.description && (
          <Typography variant="body1" color="text.secondary" paragraph sx={{ pl: 2 }}>
            {page.description}
          </Typography>
        )}
        
        {/* Render the layout using CSS Grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${deviceType === 'mobile' ? 4 : deviceType === 'tablet' ? 8 : 12}, 1fr)`,
          gridAutoRows: '100px', // Fixed row height of 100px
          gap: 2,
          width: '100%',
          height: 'auto',
          marginBottom: '50px',
          pl: 2,
          pr: 2,
          overflow: 'visible',
          // Calculate the minimum height based on the maximum y + h value in the layout
          minHeight: `${Math.max(...layout.map(item => (item.y + item.h) * 100)) + 50}px`
        }}>
          {layout.map(item => renderGridItem(item, containerWidth))}
        </Box>
      </Box>
    </PluginProvider>
  );
};
