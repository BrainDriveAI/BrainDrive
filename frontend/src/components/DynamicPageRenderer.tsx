import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';

// Import the unified renderer system
import { UnifiedPageRenderer } from '../features/unified-dynamic-page-renderer';
import { RenderMode, PageData, ResponsiveLayouts, ModuleConfig } from '../features/unified-dynamic-page-renderer/types';

// Import legacy services and types
import { Page } from '../pages';
import { pageService } from '../services/pageService';
import { defaultPageService } from '../services/defaultPageService';
import { usePageState } from '../contexts/PageStateContext';
import { useModuleState } from '../contexts/ModuleStateContext';
import { pageContextService } from '../services/PageContextService';
import { clearPageCache } from '../utils/clearPageCache';

// Declare global interface for backward compatibility
declare global {
  interface Window {
    currentPageTitle?: string;
    isStudioPage?: boolean;
  }
}

interface DynamicPageRendererProps {
  pageId?: string;
  route?: string;
  allowUnpublished?: boolean;
}

/**
 * Custom hook that loads pages using existing services and converts to unified format
 */
function useUnifiedPageLoader(options: {
  pageId?: string;
  route?: string;
  mode: RenderMode;
  allowUnpublished?: boolean;
}) {
  const { pageId, route, mode, allowUnpublished = false } = options;
  const location = useLocation();
  
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Get page state functions from context
  const { getCachedPage, cachePage } = usePageState();
  const { getModuleState } = useModuleState();

  // Generate cache key
  const getCacheKey = useCallback(() => {
    if (pageId) return pageId;
    if (route) return `route:${route}`;
    
    let urlPath = location.pathname;
    if (urlPath.startsWith('/pages/')) {
      urlPath = urlPath.substring(7);
    } else if (urlPath.startsWith('/')) {
      urlPath = urlPath.substring(1);
    }
    
    return `route:${urlPath}`;
  }, [pageId, route, location.pathname]);

  // Convert legacy Page to unified PageData
  const convertLegacyPageToPageData = useCallback((legacyPage: Page): PageData => {
    // Convert layouts from legacy format to unified format
    const layouts: ResponsiveLayouts = {
      mobile: [],
      tablet: [],
      desktop: [],
      wide: [],
    };

    // Helper function to extract pluginId from complex moduleIds
    const extractPluginIdFromModuleId = (moduleId: string): string | null => {
      if (!moduleId) return null;
      
      // Try direct extraction patterns
      const patterns = [
        /^([A-Za-z][A-Za-z0-9]*?)_/,  // Extract before first underscore
        /^([A-Za-z][A-Za-z0-9]*?)(?:_|\d)/,  // Extract before underscore or digit
        /^([A-Za-z][A-Za-z0-9]*)/,  // Extract leading alphabetic part
      ];
      
      for (const pattern of patterns) {
        const match = moduleId.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
      
      return null;
    };

    // Helper function to convert a layout item
    const convertLayoutItem = (item: any) => {
      // The layout item key is a unique instance id; use it to look up the module definition
      const layoutKey = ('moduleUniqueId' in item) ? item.moduleUniqueId : item.i;
      const moduleDef = legacyPage.modules?.[layoutKey];
      
      // Check if item has args property (new format from database)
      const hasArgs = item.args && typeof item.args === 'object';
      
      // Prefer pluginId from item directly, then from args, then from module definition
      let pluginId = item.pluginId || (hasArgs ? item.pluginId : undefined) || moduleDef?.pluginId;
      if (!pluginId && layoutKey) {
        pluginId = extractPluginIdFromModuleId(layoutKey) || undefined as any;
      }
      if (!pluginId || pluginId === 'unknown') {
        console.warn(`[DynamicPageRenderer] Skipping layout item with missing pluginId:`, { item, layoutKey, pluginId });
        return null;
      }
      
      // Extract moduleId from args if available, otherwise use module definition or layout key
      let baseModuleId;
      if (hasArgs && item.args.moduleId) {
        baseModuleId = item.args.moduleId;
        console.log('[DynamicPageRenderer] Using moduleId from args:', baseModuleId);
      } else {
        baseModuleId = moduleDef?.moduleId || moduleDef?.moduleName || layoutKey;
        console.log('[DynamicPageRenderer] Using moduleId from moduleDef or layoutKey:', baseModuleId);
      }
      
      // Merge config from module definition and args
      // IMPORTANT: Include moduleId in config for LayoutEngine to use
      const config = {
        ...(moduleDef?.config || {}),
        ...(hasArgs ? item.args : {}),
        moduleId: baseModuleId  // Ensure moduleId is in config
      };
      
      console.log('[DynamicPageRenderer] Converted layout item:', {
        itemId: item.i,
        pluginId,
        moduleId: baseModuleId,
        hasArgs,
        args: item.args,
        config
      });
      
      return {
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        minW: item.minW,
        maxW: ('maxW' in item) ? item.maxW : undefined,
        minH: item.minH,
        maxH: ('maxH' in item) ? item.maxH : undefined,
        static: ('static' in item) ? item.static : false,
        isDraggable: ('isDraggable' in item) ? item.isDraggable !== false : true,
        isResizable: ('isResizable' in item) ? item.isResizable !== false : true,
        moduleId: baseModuleId,
        pluginId,
        config,
      };
    };

    // Convert layouts
    if (legacyPage.layouts?.desktop) {
      layouts.desktop = legacyPage.layouts.desktop.map(convertLayoutItem).filter((item: any): item is NonNullable<typeof item> => item !== null);
    }
    if (legacyPage.layouts?.tablet) {
      layouts.tablet = legacyPage.layouts.tablet.map(convertLayoutItem).filter((item: any): item is NonNullable<typeof item> => item !== null);
    }
    if (legacyPage.layouts?.mobile) {
      layouts.mobile = legacyPage.layouts.mobile.map(convertLayoutItem).filter((item: any): item is NonNullable<typeof item> => item !== null);
    }

    // Convert modules to unified format
    const modules: ModuleConfig[] = [];
    if (legacyPage.modules) {
      Object.entries(legacyPage.modules).forEach(([layoutKey, moduleDefinition]) => {
        // Prefer the plugin's declared module id or name for unified ids
        const unifiedModuleId = moduleDefinition.moduleId || moduleDefinition.moduleName || layoutKey;
        modules.push({
          id: unifiedModuleId,
          pluginId: moduleDefinition.pluginId,
          type: 'component',
          ...moduleDefinition.config,
          // Add legacy adapter metadata
          _legacy: {
            moduleId: moduleDefinition.moduleId,
            moduleName: moduleDefinition.moduleName,
            originalConfig: moduleDefinition.config,
          },
        });
      });
    }

    // Create unified PageData
    const pageData: PageData = {
      id: legacyPage.id,
      name: legacyPage.name,
      route: legacyPage.route || '',
      layouts,
      modules,
      metadata: {
        title: legacyPage.name,
        description: legacyPage.description,
        lastModified: new Date(),
      },
      isPublished: legacyPage.is_published !== false,
    };

    return pageData;
  }, []);

  useEffect(() => {
    const loadPage = async () => {
      try {
        setLoading(true);
        setError(null);

        const cacheKey = getCacheKey();
        
        // TEMPORARY: Clear cache for AI Chat page to ensure fresh data
        if (route === 'ai-chat-1756310855' || location.pathname.includes('ai-chat')) {
          clearPageCache('0c8f4dc670a4409c87030c3000779e14');
          clearPageCache('ai-chat');
          console.log('[DynamicPageRenderer] Cleared cache for AI Chat page');
        }
        
        // Check cache first
        const cachedPage = getCachedPage(cacheKey);
        if (cachedPage) {
          const convertedPageData = convertLegacyPageToPageData(cachedPage);
          setPageData(convertedPageData);
          setLoading(false);
          return;
        }

        // Load page using existing services
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

        if (!loadedPage) {
          throw new Error('Page not found');
        }

        if (!loadedPage.is_published && !loadedPage.is_local && !allowUnpublished) {
          throw new Error('Page is not published');
        }

        // Process the page and restore module states
        let processedPage = { ...loadedPage };
        
        // Restore module states from context
        if (processedPage.modules) {
          Object.entries(processedPage.modules).forEach(([moduleId, moduleConfig]) => {
            const fullModuleId = `${moduleConfig.pluginId}-${moduleConfig.moduleId || moduleConfig.moduleName}`;
            const savedState = getModuleState(fullModuleId);
            
            if (savedState) {
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

        // Extract layouts and modules if needed (backward compatibility)
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

        // Cache the processed page
        cachePage(cacheKey, processedPage);

        // Convert to unified PageData format
        const convertedPageData = convertLegacyPageToPageData(processedPage);
        setPageData(convertedPageData);

      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to load page');
        setError(error);
        console.error('Page loading error:', error);
      } finally {
        setLoading(false);
      }
    };

    if (pageId || route || location.pathname) {
      loadPage();
    } else {
      setLoading(false);
      setError(new Error('No page ID or route provided'));
    }
  }, [pageId, route, location.pathname, mode, allowUnpublished, getCacheKey, getCachedPage, cachePage, getModuleState, convertLegacyPageToPageData]);

  return { pageData, loading, error };
}

export const DynamicPageRenderer: React.FC<DynamicPageRendererProps> = ({ 
  pageId, 
  route, 
  allowUnpublished = false 
}) => {
  const location = useLocation();
  
  // Determine render mode based on current path
  const renderMode = useMemo((): RenderMode => {
    // Only Plugin Studio routes should use STUDIO mode
    if (location.pathname.startsWith('/plugin-studio')) {
      return RenderMode.STUDIO;
    }
    // All other routes, including /pages/, should use PUBLISHED mode
    return RenderMode.PUBLISHED;
  }, [location.pathname]);

  // Use the custom page loader
  const { pageData, loading, error } = useUnifiedPageLoader({
    pageId,
    route,
    mode: renderMode,
    allowUnpublished,
  });

  // Update global variables and page context when page changes
  useEffect(() => {
    if (pageData) {
      window.currentPageTitle = pageData.name;
      window.isStudioPage = renderMode === RenderMode.STUDIO;

      // Update the page context service
      const pageContextData = {
        pageId: pageData.id,
        pageName: pageData.name,
        pageRoute: pageData.route || location.pathname,
        isStudioPage: renderMode === RenderMode.STUDIO
      };
      
      pageContextService.setPageContext(pageContextData);

      console.log('DynamicPageRenderer - Page context updated:', pageContextData);
    }

    // Cleanup on unmount
    return () => {
      window.currentPageTitle = undefined;
      window.isStudioPage = false;
    };
  }, [pageData, renderMode, location.pathname]);

  // Handle page load events
  const handlePageLoad = useCallback((loadedPageData: PageData) => {
    console.log('DynamicPageRenderer - Page loaded:', loadedPageData.name);
  }, []);

  // Handle mode changes
  const handleModeChange = useCallback((newMode: RenderMode) => {
    console.log('DynamicPageRenderer - Mode changed:', newMode);
  }, []);

  // Handle errors
  const handleError = useCallback((error: Error) => {
    console.error('DynamicPageRenderer - Error:', error);
  }, []);

  // Loading state
  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '200px',
        flexDirection: 'column',
        gap: 2
      }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Loading page...
        </Typography>
      </Box>
    );
  }

  // Error state
  if (error || !pageData) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="error" gutterBottom>
          Failed to load page
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {error?.message || 'Page not found or failed to load'}
        </Typography>
      </Box>
    );
  }

  // Render using UnifiedPageRenderer with pre-loaded data
  return (
    <UnifiedPageRenderer
      pageId={pageData.id}
      route={pageData.route}
      mode={renderMode}
      allowUnpublished={allowUnpublished}
      responsive={true}
      lazyLoading={true}
      onPageLoad={handlePageLoad}
      onModeChange={handleModeChange}
      onError={handleError}
    />
  );
};

export default DynamicPageRenderer;
