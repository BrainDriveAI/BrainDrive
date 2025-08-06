import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { RenderMode, ResponsiveLayouts, LayoutItem, ModuleConfig } from '../types';
import { ModuleRenderer } from './ModuleRenderer';
import { LegacyModuleAdapter } from '../adapters/LegacyModuleAdapter';
import { useBreakpoint } from '../hooks/useBreakpoint';

const ResponsiveGridLayout = WidthProvider(Responsive);

export interface LayoutEngineProps {
  layouts: ResponsiveLayouts;
  modules: ModuleConfig[];
  mode: RenderMode;
  lazyLoading?: boolean;
  preloadPlugins?: string[];
  onLayoutChange?: (layouts: ResponsiveLayouts) => void;
  onItemAdd?: (item: LayoutItem) => void;
  onItemRemove?: (itemId: string) => void;
  onItemSelect?: (itemId: string) => void;
}

const defaultGridConfig = {
  cols: { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 },
  rowHeight: 60,
  margin: [10, 10] as [number, number],
  containerPadding: [10, 10] as [number, number],
  breakpoints: { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
};

export const LayoutEngine: React.FC<LayoutEngineProps> = ({
  layouts,
  modules,
  mode,
  lazyLoading = true,
  preloadPlugins = [],
  onLayoutChange,
  onItemAdd,
  onItemRemove,
  onItemSelect,
}) => {
  const [currentLayouts, setCurrentLayouts] = useState<ResponsiveLayouts>(layouts);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const { currentBreakpoint } = useBreakpoint();

  // Update layouts when props change
  useEffect(() => {
    setCurrentLayouts(layouts);
  }, [layouts]);

  // Handle layout change - convert from react-grid-layout format to our format
  const handleLayoutChange = useCallback((layout: any[], allLayouts: any) => {
    // Convert react-grid-layout layouts back to our ResponsiveLayouts format
    const convertedLayouts: ResponsiveLayouts = {
      mobile: [],
      tablet: [],
      desktop: [],
      wide: [],
    };

    // Map react-grid-layout breakpoints back to our breakpoint names
    const breakpointMap: Record<string, keyof ResponsiveLayouts> = {
      xs: 'mobile',
      sm: 'tablet',
      lg: 'desktop',
      xl: 'wide',
      xxl: 'wide'
    };

    Object.entries(allLayouts).forEach(([gridBreakpoint, gridLayout]: [string, any]) => {
      const ourBreakpoint = breakpointMap[gridBreakpoint];
      if (ourBreakpoint && Array.isArray(gridLayout)) {
        convertedLayouts[ourBreakpoint] = gridLayout as LayoutItem[];
      }
    });

    setCurrentLayouts(convertedLayouts);
    onLayoutChange?.(convertedLayouts);
  }, [onLayoutChange]);

  // Handle drag start
  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  // Handle drag stop
  const handleDragStop = useCallback((layout: any[]) => {
    setIsDragging(false);
  }, []);

  // Handle item selection
  const handleItemClick = useCallback((itemId: string) => {
    if (mode === RenderMode.STUDIO) {
      setSelectedItem(itemId);
      onItemSelect?.(itemId);
    }
  }, [mode, onItemSelect]);

  // Create module map for quick lookup
  const moduleMap = useMemo(() => {
    return modules.reduce((map, module) => {
      map[module.id] = module;
      return map;
    }, {} as Record<string, ModuleConfig>);
  }, [modules]);

  // Render grid items
  const renderGridItems = useCallback(() => {
    const currentLayout = currentLayouts[currentBreakpoint as keyof ResponsiveLayouts] || currentLayouts.desktop || [];
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LayoutEngine] Rendering ${currentLayout.length} items for breakpoint: ${currentBreakpoint}`, {
        availableModules: Object.keys(moduleMap),
        availableModuleDetails: Object.entries(moduleMap).map(([id, mod]) => ({ id, pluginId: mod.pluginId })),
        layoutItems: currentLayout.map(item => ({ i: item.i, moduleId: item.moduleId, pluginId: item.pluginId }))
      });
    }
    
    return currentLayout.map((item: LayoutItem) => {
      // Try to find the module by moduleId with multiple strategies
      let module = moduleMap[item.moduleId];
      
      // If direct lookup fails, try alternative matching strategies
      if (!module) {
        // Strategy 1: Try without underscores (sanitized version)
        const sanitizedModuleId = item.moduleId.replace(/_/g, '');
        module = moduleMap[sanitizedModuleId];
        
        if (module) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[LayoutEngine] Found module using sanitized ID: ${sanitizedModuleId} for original: ${item.moduleId}`);
          }
        } else {
          // Strategy 2: Try finding by pluginId match
          for (const [moduleId, moduleConfig] of Object.entries(moduleMap)) {
            if (moduleConfig.pluginId === item.pluginId) {
              module = moduleConfig;
              if (process.env.NODE_ENV === 'development') {
                console.log(`[LayoutEngine] Found module by pluginId match: ${moduleId} for ${item.moduleId}`);
              }
              break;
            }
          }
        }
      }
      
      if (!module) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[LayoutEngine] Module not found for moduleId: ${item.moduleId}`, {
            availableModules: Object.keys(moduleMap),
            availableModuleDetails: Object.entries(moduleMap).map(([id, mod]) => ({ id, pluginId: mod.pluginId })),
            layoutItem: item,
            searchedModuleId: item.moduleId,
            itemPluginId: item.pluginId
          });
        }
        
        // Instead of returning null, try to render with the layout item data directly
        // This allows the LegacyModuleAdapter to handle the module loading
        const isSelected = selectedItem === item.i;
        const isStudioMode = mode === RenderMode.STUDIO;

        // Try to extract pluginId from moduleId if item.pluginId is 'unknown'
        let fallbackPluginId = item.pluginId;
        if (!fallbackPluginId || fallbackPluginId === 'unknown') {
          // Try to extract plugin ID from the module ID pattern
          // e.g., "BrainDriveChat_1830586da8834501bea1ef1d39c3cbe8_BrainDriveChat_BrainDriveChat_1754404718788"
          const moduleIdParts = item.moduleId.split('_');
          if (moduleIdParts.length > 0) {
            const potentialPluginId = moduleIdParts[0];
            // Check if this matches any available plugin
            const availablePluginIds = ['BrainDriveBasicAIChat', 'BrainDriveChat', 'BrainDriveSettings'];
            if (availablePluginIds.includes(potentialPluginId)) {
              fallbackPluginId = potentialPluginId;
              if (process.env.NODE_ENV === 'development') {
                console.log(`[LayoutEngine] Extracted pluginId '${fallbackPluginId}' from moduleId '${item.moduleId}'`);
              }
            }
          }
        }

        return (
          <div
            key={item.i}
            className={`layout-item ${isSelected ? 'layout-item--selected' : ''} ${isStudioMode ? 'layout-item--studio' : ''}`}
            onClick={() => handleItemClick(item.i)}
            data-grid={item}
          >
            <LegacyModuleAdapter
              pluginId={fallbackPluginId}
              moduleId={item.moduleId}
              moduleName={undefined}
              moduleProps={item.config || {}}
              useUnifiedRenderer={true}
              mode={mode === RenderMode.STUDIO ? 'studio' : 'published'}
              breakpoint={{
                name: currentBreakpoint,
                width: 0,
                height: 0,
                orientation: 'landscape',
                pixelRatio: 1,
                containerWidth: 1200,
                containerHeight: 800,
              }}
              lazyLoading={lazyLoading}
              priority={preloadPlugins.includes(item.pluginId) ? 'high' : 'normal'}
              enableMigrationWarnings={process.env.NODE_ENV === 'development'}
              fallbackStrategy="on-error"
              performanceMonitoring={process.env.NODE_ENV === 'development'}
            />
            
            {isStudioMode && (
              <div className="layout-item__controls">
                <button
                  className="layout-item__control layout-item__control--configure"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Handle configure
                  }}
                  title="Configure"
                >
                  ⚙️
                </button>
                <button
                  className="layout-item__control layout-item__control--remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onItemRemove?.(item.i);
                  }}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        );
      }

      const isSelected = selectedItem === item.i;
      const isStudioMode = mode === RenderMode.STUDIO;

      return (
        <div
          key={item.i}
          className={`layout-item ${isSelected ? 'layout-item--selected' : ''} ${isStudioMode ? 'layout-item--studio' : ''}`}
          onClick={() => handleItemClick(item.i)}
          data-grid={item}
        >
          <LegacyModuleAdapter
            pluginId={item.pluginId}
            moduleId={module._legacy?.moduleId || item.moduleId}
            moduleName={module._legacy?.moduleName}
            moduleProps={module._legacy?.originalConfig || item.config}
            useUnifiedRenderer={true}
            mode={mode === RenderMode.STUDIO ? 'studio' : 'published'}
            breakpoint={{
              name: currentBreakpoint,
              width: 0,
              height: 0,
              orientation: 'landscape',
              pixelRatio: 1,
              containerWidth: 1200,
              containerHeight: 800,
            }}
            lazyLoading={lazyLoading}
            priority={preloadPlugins.includes(item.pluginId) ? 'high' : 'normal'}
            enableMigrationWarnings={process.env.NODE_ENV === 'development'}
            fallbackStrategy="on-error"
            performanceMonitoring={process.env.NODE_ENV === 'development'}
          />
          
          {isStudioMode && (
            <div className="layout-item__controls">
              <button
                className="layout-item__control layout-item__control--configure"
                onClick={(e) => {
                  e.stopPropagation();
                  // Handle configure
                }}
                title="Configure"
              >
                ⚙️
              </button>
              <button
                className="layout-item__control layout-item__control--remove"
                onClick={(e) => {
                  e.stopPropagation();
                  onItemRemove?.(item.i);
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      );
    });
  }, [
    currentLayouts,
    currentBreakpoint,
    moduleMap,
    selectedItem,
    mode,
    lazyLoading,
    preloadPlugins,
    handleItemClick,
    onItemRemove,
  ]);

  // Grid layout props - convert ResponsiveLayouts to react-grid-layout Layouts format
  const gridProps = useMemo(() => {
    // Convert ResponsiveLayouts to the format expected by react-grid-layout
    const reactGridLayouts: any = {};
    Object.entries(currentLayouts).forEach(([breakpoint, layout]) => {
      if (layout && layout.length > 0) {
        // Map breakpoint names to react-grid-layout breakpoint names
        const breakpointMap: Record<string, string> = {
          mobile: 'xs',
          tablet: 'sm',
          desktop: 'lg',
          wide: 'xl',
          ultrawide: 'xxl'
        };
        const gridBreakpoint = breakpointMap[breakpoint] || breakpoint;
        reactGridLayouts[gridBreakpoint] = layout;
      }
    });

    return {
      className: `layout-engine layout-engine--${mode}`,
      layouts: reactGridLayouts,
      onLayoutChange: handleLayoutChange,
      onDragStart: handleDragStart,
      onDragStop: handleDragStop,
      isDraggable: mode === RenderMode.STUDIO,
      isResizable: mode === RenderMode.STUDIO,
      ...defaultGridConfig,
    };
  }, [currentLayouts, mode, handleLayoutChange, handleDragStart, handleDragStop]);

  return (
    <div className={`layout-engine-container ${isDragging ? 'layout-engine-container--dragging' : ''}`}>
      <ResponsiveGridLayout {...gridProps}>
        {renderGridItems()}
      </ResponsiveGridLayout>
    </div>
  );
};

export default LayoutEngine;