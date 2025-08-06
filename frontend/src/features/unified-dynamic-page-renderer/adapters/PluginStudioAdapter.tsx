import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box } from '@mui/material';
import { UnifiedPageRenderer } from '../components/UnifiedPageRenderer';
import { ResponsiveContainer } from '../components/ResponsiveContainer';
import { LayoutEngine } from '../components/LayoutEngine';
import { PageProvider } from '../contexts/PageContext';
import { RenderMode, PageData, ResponsiveLayouts, LayoutItem, ModuleConfig } from '../types';

// Import Plugin Studio types and components
import {
  Page as PluginStudioPage,
  Layouts as PluginStudioLayouts,
  GridItem as PluginStudioGridItem,
  ModuleDefinition as PluginStudioModuleDefinition
} from '../../plugin-studio/types';
import { GridToolbar } from '../../plugin-studio/components/grid-toolbar/GridToolbar';

/**
 * Plugin Studio Adapter Props
 */
export interface PluginStudioAdapterProps {
  // Plugin Studio data
  page: PluginStudioPage | null;
  layouts: PluginStudioLayouts | null;
  
  // Studio functionality
  onLayoutChange?: (layout: any[], newLayouts: PluginStudioLayouts) => void;
  onPageLoad?: (page: PageData) => void;
  onError?: (error: Error) => void;
  
  // UI state
  previewMode?: boolean;
  selectedItem?: { i: string } | null;
  onItemSelect?: (itemId: string | null) => void;
  
  // Migration options
  enableUnifiedFeatures?: boolean;
  fallbackToLegacy?: boolean;
  performanceMonitoring?: boolean;
}

/**
 * Plugin Studio Adapter
 * 
 * This adapter bridges the Plugin Studio system with the Unified Dynamic Page Renderer.
 * It handles data conversion, maintains backward compatibility, and enables enhanced features.
 */
export const PluginStudioAdapter: React.FC<PluginStudioAdapterProps> = ({
  page,
  layouts,
  onLayoutChange,
  onPageLoad,
  onError,
  previewMode = false,
  selectedItem,
  onItemSelect,
  enableUnifiedFeatures = true,
  fallbackToLegacy = false,
  performanceMonitoring = import.meta.env.MODE === 'development'
}) => {
  // State for converted data
  const [convertedPageData, setConvertedPageData] = useState<PageData | null>(null);
  const [conversionError, setConversionError] = useState<Error | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Performance tracking
  const [performanceMetrics, setPerformanceMetrics] = useState<{
    conversionTime?: number;
    renderTime?: number;
    lastUpdate: number;
  }>({ lastUpdate: Date.now() });


  /**
   * Convert Plugin Studio GridItem to Unified LayoutItem
   */
  const convertGridItemToLayoutItem = useCallback((
    item: PluginStudioGridItem | any,
    moduleDefinitions?: Record<string, PluginStudioModuleDefinition>
  ): LayoutItem => {
    // Extract module definition if available
    const moduleDefinition = moduleDefinitions?.[item.i];
    
    return {
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: item.minW,
      minH: item.minH,
      moduleId: item.i,
      pluginId: item.pluginId || '',
      config: {
        ...item.args,
        ...moduleDefinition?.config,
        // Preserve Plugin Studio specific properties
        _pluginStudioItem: true,
        _originalItem: item
      } as ModuleConfig,
      isDraggable: !previewMode,
      isResizable: !previewMode,
      static: previewMode
    };
  }, [previewMode]);

  /**
   * Convert Plugin Studio Layouts to Unified ResponsiveLayouts
   */
  const convertLayouts = useCallback((
    pluginStudioLayouts: PluginStudioLayouts,
    moduleDefinitions?: Record<string, PluginStudioModuleDefinition>
  ): ResponsiveLayouts => {
    const convertLayoutArray = (items: (PluginStudioGridItem | any)[] = []): LayoutItem[] => {
      return items
        .filter(item => item && item.i && typeof item.x === 'number' && typeof item.y === 'number')
        .map(item => convertGridItemToLayoutItem(item, moduleDefinitions));
    };

    return {
      mobile: convertLayoutArray(pluginStudioLayouts.mobile),
      tablet: convertLayoutArray(pluginStudioLayouts.tablet),
      desktop: convertLayoutArray(pluginStudioLayouts.desktop),
      wide: convertLayoutArray(pluginStudioLayouts.desktop), // Fallback to desktop
      ultrawide: convertLayoutArray(pluginStudioLayouts.desktop) // Fallback to desktop
    };
  }, [convertGridItemToLayoutItem]);

  /**
   * Convert Plugin Studio modules to Unified ModuleConfig array
   */
  const convertModules = useCallback((
    moduleDefinitions: Record<string, PluginStudioModuleDefinition> = {}
  ): ModuleConfig[] => {
    return Object.entries(moduleDefinitions).map(([key, module]) => ({
      id: key,
      pluginId: module.pluginId,
      type: 'component',
      ...module.config,
      // Preserve original module definition
      _pluginStudioModule: true,
      _originalModule: module,
      // Performance hints
      lazy: true,
      priority: 'normal' as const
    }));
  }, []);

  /**
   * Convert Plugin Studio Page to Unified PageData
   */
  const convertPageData = useCallback((
    pluginStudioPage: PluginStudioPage,
    pluginStudioLayouts: PluginStudioLayouts
  ): PageData => {
    const startTime = performance.now();

    try {
      const convertedLayouts = convertLayouts(pluginStudioLayouts, pluginStudioPage.modules);
      const convertedModules = convertModules(pluginStudioPage.modules);

      const pageData: PageData = {
        id: pluginStudioPage.id,
        name: pluginStudioPage.name,
        route: pluginStudioPage.route || `/plugin-studio/${pluginStudioPage.id}`,
        layouts: convertedLayouts,
        modules: convertedModules,
        metadata: {
          title: pluginStudioPage.name,
          description: pluginStudioPage.description,
          lastModified: new Date()
        } as any, // Allow additional properties for Plugin Studio compatibility
        isPublished: pluginStudioPage.is_published || false
      };

      // Track performance
      if (performanceMonitoring) {
        const conversionTime = performance.now() - startTime;
        setPerformanceMetrics(prev => ({
          ...prev,
          conversionTime,
          lastUpdate: Date.now()
        }));
        console.log(`[PluginStudioAdapter] Page conversion took ${conversionTime.toFixed(2)}ms`);
      }

      return pageData;
    } catch (error) {
      console.error('[PluginStudioAdapter] Failed to convert page data:', error);
      throw error;
    }
  }, [convertLayouts, convertModules, performanceMonitoring]);

  /**
   * Convert unified layout changes back to Plugin Studio format
   */
  const handleUnifiedLayoutChange = useCallback((
    unifiedLayouts: ResponsiveLayouts
  ) => {
    if (!onLayoutChange || !layouts) return;

    try {
      // Convert back to Plugin Studio format
      const convertUnifiedToPluginStudio = (items: LayoutItem[] = []): (PluginStudioGridItem | any)[] => {
        return items.map(item => {
          // Try to restore original item properties
          const originalItem = item.config?._originalItem;
          
          return {
            ...originalItem,
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
            minW: item.minW,
            minH: item.minH,
            pluginId: item.pluginId,
            args: {
              ...originalItem?.args,
              ...item.config,
              // Remove internal properties
              _pluginStudioItem: undefined,
              _originalItem: undefined
            }
          };
        });
      };

      const pluginStudioLayouts: PluginStudioLayouts = {
        desktop: convertUnifiedToPluginStudio(unifiedLayouts.desktop),
        tablet: convertUnifiedToPluginStudio(unifiedLayouts.tablet),
        mobile: convertUnifiedToPluginStudio(unifiedLayouts.mobile)
      };

      // Call the original layout change handler
      onLayoutChange(unifiedLayouts.desktop, pluginStudioLayouts);
    } catch (error) {
      console.error('[PluginStudioAdapter] Failed to convert layout changes:', error);
      onError?.(error as Error);
    }
  }, [onLayoutChange, layouts, onError]);

  /**
   * Handle unified page load events
   */
  const handleUnifiedPageLoad = useCallback((pageData: PageData) => {
    if (performanceMonitoring) {
      setPerformanceMetrics(prev => ({
        ...prev,
        renderTime: Date.now() - prev.lastUpdate
      }));
    }
    
    onPageLoad?.(pageData);
  }, [onPageLoad, performanceMonitoring]);

  /**
   * Convert page data when inputs change
   */
  useEffect(() => {
    if (!page || !layouts) {
      setConvertedPageData(null);
      return;
    }

    setIsConverting(true);
    setConversionError(null);

    try {
      const converted = convertPageData(page, layouts);
      setConvertedPageData(converted);
    } catch (error) {
      console.error('[PluginStudioAdapter] Conversion failed:', error);
      setConversionError(error as Error);
      onError?.(error as Error);
    } finally {
      setIsConverting(false);
    }
  }, [page, layouts, convertPageData, onError]);


  /**
   * Determine render mode based on preview state
   */
  const renderMode: RenderMode = useMemo(() => {
    return previewMode ? RenderMode.PREVIEW : RenderMode.STUDIO;
  }, [previewMode]);

  // Show loading state during conversion
  if (isConverting) {
    return (
      <Box 
        display="flex" 
        justifyContent="center" 
        alignItems="center" 
        height="100%" 
        p={3}
      >
        <div>Converting Plugin Studio data...</div>
      </Box>
    );
  }

  // Show error state if conversion failed
  if (conversionError || !convertedPageData) {
    return (
      <Box 
        display="flex" 
        flexDirection="column"
        justifyContent="center" 
        alignItems="center" 
        height="100%" 
        p={3}
        color="error.main"
      >
        <div>Failed to convert Plugin Studio data</div>
        {conversionError && (
          <div style={{ marginTop: 8, fontSize: '0.875rem' }}>
            {conversionError.message}
          </div>
        )}
      </Box>
    );
  }

  // Handle save functionality for the GridToolbar
  const handleSave = async () => {
    if (!page) return;
    
    try {
      // Use the onLayoutChange callback to trigger save
      if (onLayoutChange && layouts) {
        onLayoutChange(layouts.desktop || [], layouts);
      }
    } catch (error) {
      console.error('[PluginStudioAdapter] Save failed:', error);
      onError?.(error as Error);
    }
  };

  return (
    <div
      className="plugin-studio-adapter"
      data-performance-monitoring={performanceMonitoring}
      data-unified-features={enableUnifiedFeatures}
      style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {/* Add the critical Plugin Studio GridToolbar */}
      <GridToolbar onSave={handleSave} />
      
      {/* Use the full UnifiedPageRenderer but hide the mode controller with CSS */}
      <div
        style={{ height: '100%', width: '100%', flex: 1, overflow: 'hidden' }}
      >
        <style>
          {`
            /* Hide the unified renderer mode controller and editing tools */
            .unified-page-renderer .mode-controller,
            .unified-page-renderer .studio-mode-controller,
            .unified-page-renderer .editing-tools,
            .unified-page-renderer .ui-elements,
            .unified-page-renderer [data-testid="mode-controller"],
            .unified-page-renderer [data-testid="studio-toolbar"],
            .unified-page-renderer .studio-toolbar {
              display: none !important;
            }

            /* Enable proper React Grid Layout functionality */
            .unified-page-renderer .react-grid-item {
              cursor: default !important;
            }

            /* Enable resize handles - show on hover */
            .unified-page-renderer .react-grid-item .react-resizable-handle {
              opacity: 0;
              transition: opacity 0.2s ease;
            }

            .unified-page-renderer .react-grid-item:hover .react-resizable-handle {
              opacity: 1;
            }

            /* Style the southeast resize handle */
            .unified-page-renderer .react-grid-item .react-resizable-handle-se {
              background: rgba(0, 0, 0, 0.7);
              border-radius: 3px;
              width: 16px !important;
              height: 16px !important;
              bottom: 3px !important;
              right: 3px !important;
            }

            .unified-page-renderer .react-grid-item .react-resizable-handle-se::after {
              content: '↘';
              color: white;
              font-size: 10px;
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            }

            /* Enable dragging on the entire module except resize handles */
            .unified-page-renderer .react-grid-item > * {
              pointer-events: auto;
            }

            .unified-page-renderer .react-grid-item .react-resizable-handle {
              pointer-events: auto !important;
            }
            
            /* Remove scrollbars and create expandable canvas like legacy */
            .unified-page-renderer,
            .unified-page-renderer .layout-engine,
            .unified-page-renderer .responsive-container {
              height: 100% !important;
              width: 100% !important;
              overflow: visible !important;
            }

            /* Create expandable grid background like legacy Plugin Studio */
            .unified-page-renderer .responsive-container::before {
              content: '';
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background-image:
                linear-gradient(to right, #e0e0e0 1px, transparent 1px),
                linear-gradient(to bottom, #e0e0e0 1px, transparent 1px);
              background-size: 20px 20px;
              background-color: #f5f5f5;
              z-index: -1;
              min-height: 100vh;
              min-width: 100vw;
            }
            
            /* Ensure the grid container can expand beyond viewport */
            .unified-page-renderer .react-grid-layout {
              min-height: 100vh !important;
              position: relative !important;
              width: 100% !important;
            }

            /* Force proper grid layout behavior */
            .unified-page-renderer .react-grid-layout .react-grid-item {
              position: absolute !important;
              transition: all 200ms ease !important;
              transition-property: left, top !important;
            }

            /* Ensure grid items don't stack vertically */
            .unified-page-renderer .react-grid-layout .react-grid-item.react-grid-placeholder {
              background: rgba(0, 123, 255, 0.1) !important;
              border: 2px dashed #007bff !important;
              border-radius: 8px !important;
              z-index: 2 !important;
              user-select: none !important;
            }
            
            /* Remove any container constraints */
            .plugin-studio-adapter > div:last-child {
              overflow: visible !important;
            }
            
            /* Hide ALL unified renderer controls - make it look like legacy */
            .react-grid-item .unified-controls,
            .react-grid-item .module-controls,
            .react-grid-item [class*="control"],
            .react-grid-item [class*="button"],
            .react-grid-item button:not(.module-content button),
            .react-grid-item .config-btn,
            .react-grid-item .delete-btn,
            .react-grid-item .edit-btn,
            .react-grid-item .remove-btn {
              display: none !important;
              visibility: hidden !important;
            }

            /* Legacy-style module appearance - clean and borderless */
            .react-grid-item {
              border: none !important;
              background: white !important;
              border-radius: 8px !important;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
              overflow: visible !important;
              /* Remove transitions and transforms that interfere with grid positioning */
            }

            /* Hover effect like legacy - but without transforms that break positioning */
            .react-grid-item:hover {
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
              /* Removed transform: translateY(-1px) as it breaks grid positioning */
            }

            /* Drag handle - only show on hover like legacy */
            .react-grid-item .react-grid-dragHandleExample {
              display: none !important;
            }

            .react-grid-item:hover .react-grid-dragHandleExample {
              display: flex !important;
              position: absolute !important;
              top: 8px !important;
              right: 8px !important;
              width: 20px !important;
              height: 20px !important;
              background: rgba(0, 0, 0, 0.6) !important;
              color: white !important;
              border-radius: 4px !important;
              align-items: center !important;
              justify-content: center !important;
              cursor: move !important;
              z-index: 1000 !important;
              font-size: 10px !important;
            }

            .react-grid-item .react-grid-dragHandleExample::before {
              content: '⋮⋮' !important;
              line-height: 1 !important;
              letter-spacing: -1px !important;
            }

            /* Placeholder styling during drag */
            .react-grid-item.react-grid-placeholder {
              background: rgba(0, 123, 255, 0.1) !important;
              border: 2px dashed #007bff !important;
              border-radius: 8px !important;
            }

            /* Module content styling to match legacy */
            .react-grid-item > div {
              height: 100% !important;
              border-radius: 8px !important;
              overflow: hidden !important;
            }

            /* Target only the specific unified renderer performance badges */
            .react-grid-item div[style*="position: absolute"][style*="right: 0px"],
            .react-grid-item div[style*="position: absolute"][style*="right:0px"],
            .react-grid-item div[style*="position: absolute"][style*="top: 0px"][style*="right"],
            .react-grid-item div[style*="position: absolute"][style*="top:0px"][style*="right"],
            .react-grid-item > div > div[style*="position: absolute"][style*="background-color"],
            .react-grid-item > div > div[style*="z-index"][style*="position: absolute"]:not([class*="drag"]) {
              display: none !important;
              visibility: hidden !important;
            }

            /* Hide elements that contain "Unified" text specifically */
            .react-grid-item div:contains("Unified"),
            .react-grid-item span:contains("Unified"),
            .react-grid-item div[title*="Unified"],
            .react-grid-item span[title*="Unified"] {
              display: none !important;
              visibility: hidden !important;
            }

            /* More specific targeting for performance badges */
            .react-grid-item div[style*="background-color: rgb(68, 68, 68)"],
            .react-grid-item div[style*="background-color: rgba(68, 68, 68"],
            .react-grid-item div[style*="background: rgb(68, 68, 68)"],
            .react-grid-item div[style*="background: rgba(68, 68, 68"] {
              display: none !important;
              visibility: hidden !important;
            }

            /* Legacy-style module appearance */
            .react-grid-item {
              background: white !important;
              border: 1px solid #e0e0e0 !important;
              border-radius: 8px !important;
              box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1) !important;
              position: relative !important;
              overflow: hidden !important;
            }

            /* Hover effect like legacy */
            .react-grid-item:hover {
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
              border-color: #c0c0c0 !important;
            }

            /* Ensure module content fills properly */
            .react-grid-item > div {
              height: 100% !important;
              width: 100% !important;
            }
          `}
        </style>
        
        <UnifiedPageRenderer
          pageId={convertedPageData.id}
          route={convertedPageData.route}
          mode={renderMode}
          allowUnpublished={true}
          responsive={true}
          lazyLoading={true}
          onPageLoad={handleUnifiedPageLoad}
          onLayoutChange={handleUnifiedLayoutChange}
          onError={onError}
        />
      </div>

      {/* Performance overlay in development */}
      {performanceMonitoring && import.meta.env.MODE === 'development' && (
        <div style={{
          position: 'fixed',
          top: 10,
          right: 10,
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '12px',
          zIndex: 9999,
          fontFamily: 'monospace'
        }}>
          <div>Plugin Studio Adapter</div>
          <div>Conversion: {performanceMetrics.conversionTime?.toFixed(2)}ms</div>
          <div>Render: {performanceMetrics.renderTime?.toFixed(2)}ms</div>
          <div>Mode: {renderMode}</div>
          <div>Items: {convertedPageData.layouts.desktop.length}</div>
        </div>
      )}
    </div>
  );
};

export default PluginStudioAdapter;