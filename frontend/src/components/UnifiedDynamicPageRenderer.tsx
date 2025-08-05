import React from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { UnifiedPageRenderer } from '../features/unified-dynamic-page-renderer';
import { RenderMode } from '../features/unified-dynamic-page-renderer/types';

/**
 * Integration wrapper that replaces DynamicPageRenderer with UnifiedPageRenderer
 * This provides backward compatibility while using the new unified system
 */
interface UnifiedDynamicPageRendererProps {
  pageId?: string;
  route?: string;
  allowUnpublished?: boolean;
}

export const UnifiedDynamicPageRenderer: React.FC<UnifiedDynamicPageRendererProps> = ({
  pageId,
  route,
  allowUnpublished = false
}) => {
  const params = useParams();
  const location = useLocation();

  // Determine the page ID from props or URL
  const resolvedPageId = React.useMemo(() => {
    if (pageId) return pageId;
    if (route) return `route:${route}`;
    
    // Extract route from URL (same logic as original DynamicPageRenderer)
    let urlPath = location.pathname;
    
    if (urlPath.startsWith('/pages/')) {
      urlPath = urlPath.substring(7); // Remove '/pages/' prefix
    } else if (urlPath.startsWith('/')) {
      urlPath = urlPath.substring(1); // Remove leading slash
    }
    
    return `route:${urlPath}`;
  }, [pageId, route, location.pathname]);

  // Determine render mode based on URL and context
  const renderMode = React.useMemo((): RenderMode => {
    const isStudioPath = location.pathname.includes('/studio') || 
                        location.pathname.includes('/plugin-studio');
    
    if (isStudioPath) {
      return 'studio';
    }
    
    // Check if this is a preview mode (could be determined by query params)
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('preview') === 'true') {
      return 'preview';
    }
    
    return 'published';
  }, [location.pathname, location.search]);

  // Handle page load
  const handlePageLoad = React.useCallback((pageData: any) => {
    // Set global variables for backward compatibility
    if (typeof window !== 'undefined') {
      window.currentPageTitle = pageData.title || pageData.name;
      window.isStudioPage = renderMode === 'studio';
    }
    
    console.log('UnifiedDynamicPageRenderer - Page loaded:', {
      pageId: resolvedPageId,
      mode: renderMode,
      title: pageData.title || pageData.name
    });
  }, [resolvedPageId, renderMode]);

  // Handle errors
  const handleError = React.useCallback((error: Error) => {
    console.error('UnifiedDynamicPageRenderer - Error:', error);
  }, []);

  // Handle mode changes
  const handleModeChange = React.useCallback((newMode: RenderMode) => {
    console.log('UnifiedDynamicPageRenderer - Mode changed:', newMode);
    
    // Update global variables
    if (typeof window !== 'undefined') {
      window.isStudioPage = newMode === 'studio';
    }
  }, []);

  return (
    <UnifiedPageRenderer
      pageId={resolvedPageId}
      mode={renderMode}
      allowUnpublished={allowUnpublished}
      responsive={true}
      containerQueries={true}
      lazyLoading={true}
      onPageLoad={handlePageLoad}
      onError={handleError}
      onModeChange={handleModeChange}
    />
  );
};

export default UnifiedDynamicPageRenderer;