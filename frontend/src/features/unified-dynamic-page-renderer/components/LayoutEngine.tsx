import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { RenderMode, ResponsiveLayouts, LayoutItem, ModuleConfig } from '../types';
import { ModuleRenderer } from './ModuleRenderer';
import { LegacyModuleAdapter } from '../adapters/LegacyModuleAdapter';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { GridItemControls } from '../../plugin-studio/components/canvas/GridItemControls';
import { useUnifiedLayoutState } from '../hooks/useUnifiedLayoutState';
import { LayoutChangeOrigin } from '../utils/layoutChangeManager';
import { useControlVisibility } from '../../../hooks/useControlVisibility';

const ResponsiveGridLayout = WidthProvider(Responsive);

export interface LayoutEngineProps {
  layouts: ResponsiveLayouts;
  modules: ModuleConfig[];
  mode: RenderMode;
  lazyLoading?: boolean;
  preloadPlugins?: string[];
  pageId?: string; // Add pageId to detect page changes
  onLayoutChange?: (layouts: ResponsiveLayouts) => void;
  onItemAdd?: (item: LayoutItem) => void;
  onItemRemove?: (itemId: string) => void;
  onItemSelect?: (itemId: string) => void;
  onItemConfig?: (itemId: string) => void;
}

const defaultGridConfig = {
  cols: { xxl: 12, xl: 12, lg: 12, sm: 8, xs: 4 },
  rowHeight: 60,
  margin: [10, 10] as [number, number],
  containerPadding: [10, 10] as [number, number],
  breakpoints: { xxl: 1600, xl: 1400, lg: 1024, sm: 768, xs: 0 },
};

export const LayoutEngine: React.FC<LayoutEngineProps> = React.memo(({
  layouts,
  modules,
  mode,
  lazyLoading = true,
  preloadPlugins = [],
  pageId,
  onLayoutChange,
  onItemAdd,
  onItemRemove,
  onItemSelect,
  onItemConfig,
}) => {
  // Debug: Track component re-renders
  const layoutEngineRenderCount = useRef(0);
  layoutEngineRenderCount.current++;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[LayoutEngine] COMPONENT RENDER #${layoutEngineRenderCount.current}`, {
      layoutsKeys: Object.keys(layouts),
      modulesLength: modules.length,
      mode,
      lazyLoading,
      preloadPluginsLength: preloadPlugins.length,
    });
  }

  // Use unified layout state management with stable reference
  const unifiedLayoutState = useUnifiedLayoutState({
    initialLayouts: layouts,
    debounceMs: 200, // Increase debounce to prevent rapid updates
    onLayoutPersist: (persistedLayouts, origin) => {
      console.log(`[LayoutEngine] Persisting layout change from ${origin.source}`);
      onLayoutChange?.(persistedLayouts);
    },
    onError: (error) => {
      console.error('[LayoutEngine] Layout state error:', error);
    }
  });

  // Create ultra-stable layouts reference using JSON comparison
  const stableLayoutsRef = useRef<ResponsiveLayouts>({
    mobile: [],
    tablet: [],
    desktop: [],
    wide: []
  });
  
  const currentLayouts = useMemo(() => {
    const newLayouts = unifiedLayoutState.layouts || {
      mobile: [],
      tablet: [],
      desktop: [],
      wide: []
    };
    
    // Only update if the actual content has changed (deep comparison)
    const currentHash = JSON.stringify(stableLayoutsRef.current);
    const newHash = JSON.stringify(newLayouts);
    
    if (currentHash !== newHash) {
      stableLayoutsRef.current = newLayouts;
    }
    
    return stableLayoutsRef.current;
  }, [unifiedLayoutState.layouts]);

  // Local UI state
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const { currentBreakpoint } = useBreakpoint();
  
  // Control visibility based on context
  const { showControls } = useControlVisibility(mode);

  // Failsafe: Programmatically remove resize handles when controls should be hidden
  useEffect(() => {
    if (!showControls) {
      const removeResizeHandles = () => {
        const resizeHandles = document.querySelectorAll('.react-resizable-handle');
        resizeHandles.forEach(handle => {
          (handle as HTMLElement).style.display = 'none';
          (handle as HTMLElement).style.visibility = 'hidden';
          (handle as HTMLElement).style.pointerEvents = 'none';
        });
      };

      // Remove immediately
      removeResizeHandles();

      // Also remove after a short delay to catch any dynamically added handles
      const timeoutId = setTimeout(removeResizeHandles, 100);

      // Set up a mutation observer to catch any new resize handles
      const observer = new MutationObserver(() => {
        if (!showControls) {
          removeResizeHandles();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });

      return () => {
        clearTimeout(timeoutId);
        observer.disconnect();
      };
    }
  }, [showControls]);
  
  // Track operation IDs for proper state management
  const currentOperationId = useRef<string | null>(null);
  const pageIdRef = useRef<string | undefined>(pageId);
  
  // Operation deduplication tracking
  const processedOperations = useRef<Set<string>>(new Set());
  const operationCleanupTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Debug logging for bounce detection
  const debugLog = useCallback((message: string, data?: any) => {
    const timestamp = performance.now();
    const stack = new Error().stack?.split('\n').slice(2, 5).join(' -> ') || 'unknown';
    console.log(`[BOUNCE-DEBUG ${timestamp.toFixed(2)}ms] ${message}`, data ? { ...data, stack } : { stack });
  }, []);

  // Handle external layout changes (from props)
  useEffect(() => {
    // Reset layouts when page changes
    if (pageId !== pageIdRef.current) {
      console.log('[LayoutEngine] Page changed, resetting layouts');
      unifiedLayoutState.resetLayouts(layouts);
      pageIdRef.current = pageId;
      return;
    }

    // Skip if layouts are semantically identical
    if (unifiedLayoutState.compareWithCurrent(layouts)) {
      return;
    }

    // Skip during active operations to prevent interference
    if (isDragging || isResizing) {
      debugLog('EXTERNAL SYNC BLOCKED - Active operation in progress', { isDragging, isResizing });
      return;
    }

    // Update from external source
    debugLog('EXTERNAL SYNC TRIGGERED', {
      layoutsKeys: Object.keys(layouts),
      currentOperationId: currentOperationId.current
    });
    unifiedLayoutState.updateLayouts(layouts, {
      source: 'external-sync',
      timestamp: Date.now()
    });
  }, [layouts, pageId, isDragging, isResizing, unifiedLayoutState]);

  // Handle layout change - convert from react-grid-layout format to our format
  const handleLayoutChange = useCallback((layout: any[], allLayouts: any) => {
    const operationId = currentOperationId.current;
    
    debugLog('handleLayoutChange called', {
      operationId,
      isResizing,
      isDragging,
      layoutLength: layout?.length,
      allLayoutsKeys: Object.keys(allLayouts || {}),
      layoutData: layout?.map(item => ({ i: item.i, x: item.x, y: item.y, w: item.w, h: item.h }))
    });
    
    // Check for duplicate processing
    if (operationId && processedOperations.current.has(operationId)) {
      debugLog('Skipping duplicate processing for operation', { operationId });
      return;
    }
    
    // Allow layout changes during active operations OR during resize/drag state
    const hasActiveOperation = !!operationId;
    const isInActiveState = isResizing || isDragging;
    
    if (!hasActiveOperation && !isInActiveState) {
      debugLog('Ignoring layout change - no active operation or state');
      return;
    }

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

    // Determine the origin based on current operation
    const origin: LayoutChangeOrigin = {
      source: isDragging ? 'user-drag' : isResizing ? 'user-resize' : 'external-sync',
      timestamp: Date.now(),
      operationId: currentOperationId.current || `late-${Date.now()}`
    };

    debugLog(`Processing layout change from ${origin.source}`, {
      operationId,
      convertedLayouts: Object.keys(convertedLayouts).map(bp => ({
        breakpoint: bp,
        itemCount: convertedLayouts[bp as keyof ResponsiveLayouts]?.length || 0
      }))
    });
    
    // Update through unified state management
    unifiedLayoutState.updateLayouts(convertedLayouts, origin);
    
    // Mark operation as processed
    if (operationId) {
      processedOperations.current.add(operationId);
      debugLog('Marked operation as processed', { operationId });
    }
  }, [isDragging, isResizing, unifiedLayoutState, debugLog]);

  // Handle drag start
  const handleDragStart = useCallback(() => {
    const operationId = `drag-${Date.now()}`;
    currentOperationId.current = operationId;
    setIsDragging(true);
    unifiedLayoutState.startOperation(operationId);
    console.log('[LayoutEngine] Started drag operation:', operationId);
  }, [unifiedLayoutState]);

  // Handle drag stop
  const handleDragStop = useCallback((layout: any[]) => {
    if (currentOperationId.current) {
      unifiedLayoutState.stopOperation(currentOperationId.current);
      console.log('[LayoutEngine] Stopped drag operation:', currentOperationId.current);
      currentOperationId.current = null;
    }
    setIsDragging(false);
  }, [unifiedLayoutState]);

  // Handle resize start
  const handleResizeStart = useCallback(() => {
    const operationId = `resize-${Date.now()}`;
    currentOperationId.current = operationId;
    setIsResizing(true);
    unifiedLayoutState.startOperation(operationId);
    debugLog('RESIZE START', { operationId, isResizing: true });
  }, [unifiedLayoutState, debugLog]);

  // Handle resize stop
  const handleResizeStop = useCallback(() => {
    if (currentOperationId.current) {
      const operationId = currentOperationId.current;
      unifiedLayoutState.stopOperation(operationId);
      debugLog('RESIZE STOP - Starting grace period', { operationId });
      
      // Schedule cleanup of processed operation tracking
      const cleanupTimer = setTimeout(() => {
        processedOperations.current.delete(operationId);
        operationCleanupTimers.current.delete(operationId);
        debugLog('Cleaned up processed operation tracking', { operationId });
      }, 300); // 300ms - longer than grace period to ensure all related processing is complete
      
      operationCleanupTimers.current.set(operationId, cleanupTimer);
      
      // Keep operation ID active for extended grace period to catch all final layout changes
      setTimeout(() => {
        if (currentOperationId.current === operationId) {
          currentOperationId.current = null;
          debugLog('GRACE PERIOD ENDED', { operationId });
        }
      }, 200); // Extended grace period to catch all React Grid Layout events
    }
    setIsResizing(false);
    debugLog('RESIZE STATE SET TO FALSE');
  }, [unifiedLayoutState, debugLog]);

  // Handle drag over for drop zone functionality
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    
    // Check if the dataTransfer contains module data
    const types = e.dataTransfer.types;
    const hasModuleData = types.includes('module') || types.includes('text/plain');
    
    if (hasModuleData && mode === RenderMode.STUDIO) {
      setIsDragOver(true);
    }
  }, [mode]);

  // Handle drag leave
  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle drop for adding new modules
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (mode !== RenderMode.STUDIO) return;
    
    try {
      // Try to get the module data from the drag event
      let moduleDataStr = e.dataTransfer.getData('module');
      
      // If module data is not available, try text/plain as fallback
      if (!moduleDataStr) {
        moduleDataStr = e.dataTransfer.getData('text/plain');
      }
      
      if (!moduleDataStr) {
        console.error('No module data found in drop event');
        return;
      }
      
      // Parse the module data
      const moduleData = JSON.parse(moduleDataStr);
      console.log('Parsed module data:', moduleData);
      
      // Calculate the drop position relative to the grid
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / 120); // Grid cell width approximation
      const y = Math.floor((e.clientY - rect.top) / 80);   // Grid cell height approximation
      
      // Create a unique ID for the module
      const uniqueId = `${moduleData.pluginId}_${moduleData.moduleId}_${Date.now()}`;
      
      // Default size for new modules
      const defaultWidth = 4;
      const defaultHeight = 3;
      
      // Create the new layout item
      const newItem: LayoutItem = {
        i: uniqueId,
        x: Math.max(0, x),
        y: Math.max(0, y),
        w: defaultWidth,
        h: defaultHeight,
        moduleId: moduleData.moduleId, // Use the actual moduleId from drag data, not the unique ID
        pluginId: moduleData.pluginId,
        config: {
          moduleId: moduleData.moduleId,
          displayName: moduleData.displayName || moduleData.moduleName,
          ...moduleData.config
        },
        isDraggable: true,
        isResizable: true,
        static: false
      };
      
      console.log('Adding new item to layout:', newItem);
      
      // Add the item to the current layouts
      const updatedLayouts = { ...currentLayouts };
      Object.keys(updatedLayouts).forEach(breakpoint => {
        const currentLayout = updatedLayouts[breakpoint as keyof ResponsiveLayouts];
        if (currentLayout) {
          updatedLayouts[breakpoint as keyof ResponsiveLayouts] = [
            ...currentLayout,
            newItem
          ];
        }
      });
      
      // Update through unified state management
      unifiedLayoutState.updateLayouts(updatedLayouts, {
        source: 'drop-add',
        timestamp: Date.now()
      });
      
      onItemAdd?.(newItem);
      
      // Select the newly added item (batched to prevent additional renders)
      setTimeout(() => {
        setSelectedItem(uniqueId);
        onItemSelect?.(uniqueId);
      }, 0);
      
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [mode, unifiedLayoutState, onItemAdd, onItemSelect]);

  // Handle item selection
  const handleItemClick = useCallback((itemId: string) => {
    if (mode === RenderMode.STUDIO) {
      // Don't toggle selection during drag or resize operations
      if (isDragging || isResizing) {
        return;
      }
      setSelectedItem(prev => prev === itemId ? null : itemId);
      onItemSelect?.(itemId);
    }
  }, [mode, onItemSelect, isDragging, isResizing]);

  // Handle item removal
  const handleItemRemove = useCallback((itemId: string) => {
    console.log(`[LayoutEngine] Removing item: ${itemId}`);
    
    // Create new layouts with the item removed from all breakpoints
    const updatedLayouts: ResponsiveLayouts = {
      mobile: currentLayouts.mobile?.filter((item: LayoutItem) => item.i !== itemId) || [],
      tablet: currentLayouts.tablet?.filter((item: LayoutItem) => item.i !== itemId) || [],
      desktop: currentLayouts.desktop?.filter((item: LayoutItem) => item.i !== itemId) || [],
      wide: currentLayouts.wide?.filter((item: LayoutItem) => item.i !== itemId) || []
    };

    // Update through unified state management
    unifiedLayoutState.updateLayouts(updatedLayouts, {
      source: 'user-remove',
      timestamp: Date.now(),
      operationId: `remove-${itemId}-${Date.now()}`
    });

    // Clear selection if the removed item was selected
    if (selectedItem === itemId) {
      setSelectedItem(null);
    }

    // Call the external callback if provided
    onItemRemove?.(itemId);
  }, [currentLayouts, unifiedLayoutState, selectedItem, onItemRemove]);

  // Create ultra-stable module map with deep comparison
  const stableModuleMapRef = useRef<Record<string, ModuleConfig>>({});
  
  const moduleMap = useMemo(() => {
    const newModuleMap = modules.reduce((map, module) => {
      map[module.id] = module;
      return map;
    }, {} as Record<string, ModuleConfig>);
    
    // Only update if the actual content has changed (deep comparison)
    const currentHash = JSON.stringify(stableModuleMapRef.current);
    const newHash = JSON.stringify(newModuleMap);
    
    if (currentHash !== newHash) {
      stableModuleMapRef.current = newModuleMap;
    }
    
    return stableModuleMapRef.current;
  }, [modules]);

  // Render grid items
  const renderGridItems = useCallback(() => {
    const currentLayout = currentLayouts[currentBreakpoint as keyof ResponsiveLayouts] || currentLayouts.desktop || [];
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LayoutEngine] RENDER TRIGGERED - Rendering ${currentLayout.length} items for breakpoint: ${currentBreakpoint}`, {
        availableModules: Object.keys(moduleMap),
        availableModuleDetails: Object.entries(moduleMap).map(([id, mod]) => ({ id, pluginId: mod.pluginId })),
        layoutItems: currentLayout.map((item: LayoutItem) => ({ i: item.i, moduleId: item.moduleId, pluginId: item.pluginId })),
        currentLayouts: Object.keys(currentLayouts),
        currentBreakpoint,
        stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
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
        const isStudioMode = showControls; // Use control visibility instead of just mode check

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

        // Extract simple module ID from complex ID - calculate directly to avoid useMemo in render loop
        // Pattern: BrainDriveBasicAIChat_59898811a4b34d9097615ed6698d25f6_1754507768265
        // We want: 59898811a4b34d9097615ed6698d25f6
        const parts = item.moduleId.split('_');
        const extractedModuleId = parts.length >= 2 ? parts[1] : item.moduleId;

        // Create stable breakpoint object
        const breakpointConfig = {
          name: currentBreakpoint,
          width: 0,
          height: 0,
          orientation: 'landscape' as const,
          pixelRatio: 1,
          containerWidth: 1200,
          containerHeight: 800,
        };

        return (
          <div
            key={item.i}
            className={`layout-item react-grid-item ${isSelected ? 'layout-item--selected selected' : ''} ${isStudioMode ? 'layout-item--studio' : ''}`}
            onClick={() => handleItemClick(item.i)}
            data-grid={item}
            style={{ position: 'relative' }}
          >
            {/* Use the legacy GridItemControls component for consistent behavior */}
            {showControls && (
              <GridItemControls
                isSelected={isSelected}
                onConfig={() => onItemConfig?.(item.i)}
                onRemove={() => handleItemRemove(item.i)}
              />
            )}
            <LegacyModuleAdapter
              pluginId={fallbackPluginId}
              moduleId={extractedModuleId}
              moduleName={undefined}
              moduleProps={item.config || {}}
              useUnifiedRenderer={true}
              mode={mode === RenderMode.STUDIO ? 'studio' : 'published'}
              breakpoint={breakpointConfig}
              lazyLoading={lazyLoading}
              priority={preloadPlugins.includes(item.pluginId) ? 'high' : 'normal'}
              enableMigrationWarnings={process.env.NODE_ENV === 'development'}
              fallbackStrategy="on-error"
              performanceMonitoring={process.env.NODE_ENV === 'development'}
            />
          </div>
        );
      }

      const isSelected = selectedItem === item.i;
      const isStudioMode = showControls; // Use control visibility instead of just mode check

      return (
        <div
          key={item.i}
          className={`layout-item react-grid-item ${isSelected ? 'layout-item--selected selected' : ''} ${isStudioMode ? 'layout-item--studio' : ''}`}
          onClick={() => handleItemClick(item.i)}
          data-grid={item}
          style={{ position: 'relative' }}
        >
          {/* Use the legacy GridItemControls component for consistent behavior */}
          {showControls && (
            <GridItemControls
              isSelected={isSelected}
              onConfig={() => onItemConfig?.(item.i)}
              onRemove={() => handleItemRemove(item.i)}
            />
          )}
          
          <LegacyModuleAdapter
            pluginId={item.pluginId}
            moduleId={module._legacy?.moduleId || (() => {
              // Extract simple module ID from complex ID
              // Pattern: BrainDriveBasicAIChat_59898811a4b34d9097615ed6698d25f6_1754507768265
              // We want: 59898811a4b34d9097615ed6698d25f6
              const parts = item.moduleId.split('_');
              if (parts.length >= 2) {
                // The module ID is typically the second part (after plugin name)
                return parts[1];
              }
              return item.moduleId; // fallback to original if pattern doesn't match
            })()}
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
        </div>
      );
    });
  }, [
    unifiedLayoutState.layouts,
    currentBreakpoint,
    moduleMap,
    selectedItem,
    mode,
    lazyLoading,
    preloadPlugins,
    handleItemClick,
    handleItemRemove,
    onItemConfig,
  ]);

  // Grid layout props - convert ResponsiveLayouts to react-grid-layout Layouts format
  const gridProps = useMemo(() => {
    // Convert ResponsiveLayouts to the format expected by react-grid-layout
    const reactGridLayouts: any = {};
    Object.entries(currentLayouts).forEach(([breakpoint, layout]) => {
      if (layout && Array.isArray(layout) && layout.length > 0) {
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
      onResizeStart: handleResizeStart,
      onResizeStop: handleResizeStop,
      isDraggable: showControls, // Use control visibility instead of mode
      isResizable: showControls, // Use control visibility instead of mode
      resizeHandles: showControls ? ['se' as const] : [], // Only show resize handles when controls are visible
      draggableHandle: '.react-grid-dragHandleExample',
      compactType: 'vertical' as const,
      useCSSTransforms: true,
      preventCollision: false,
      allowOverlap: false,
      measureBeforeMount: false,
      transformScale: 1,
      ...defaultGridConfig,
    };
  }, [currentLayouts, mode, showControls, handleLayoutChange, handleDragStart, handleDragStop, handleResizeStart, handleResizeStop]);

  // Memoize the rendered grid items with minimal stable dependencies
  const gridItems = useMemo(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LayoutEngine] MEMO RECALCULATION - gridItems being recalculated`, {
        currentLayoutsKeys: Object.keys(currentLayouts),
        currentBreakpoint,
        moduleMapSize: Object.keys(moduleMap).length,
        selectedItem,
        mode,
        lazyLoading,
        preloadPluginsLength: preloadPlugins.length,
        stackTrace: new Error().stack?.split('\n').slice(0, 3).join('\n')
      });
    }
    return renderGridItems();
  }, [
    // Only include the most essential dependencies that should trigger re-render
    currentLayouts,
    currentBreakpoint,
    moduleMap,
    selectedItem,
    mode
    // Removed volatile dependencies: lazyLoading, preloadPlugins, callbacks
    // These don't affect the core rendering logic and cause unnecessary recalculations
  ]);

  return (
    <div
      className={`layout-engine-container ${isDragging ? 'layout-engine-container--dragging' : ''} ${isResizing ? 'layout-engine-container--resizing' : ''} ${isDragOver ? 'layout-engine-container--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ResponsiveGridLayout {...gridProps}>
        {gridItems}
      </ResponsiveGridLayout>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for React.memo
  if (process.env.NODE_ENV === 'development') {
    console.log('[LayoutEngine] MEMO COMPARISON - Checking if props are equal');
  }
  
  // Compare primitive props
  if (
    prevProps.mode !== nextProps.mode ||
    prevProps.lazyLoading !== nextProps.lazyLoading ||
    prevProps.pageId !== nextProps.pageId
  ) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[LayoutEngine] MEMO COMPARISON - Primitive props changed, re-rendering');
    }
    return false;
  }
  
  // Compare arrays by length and content
  if (prevProps.modules.length !== nextProps.modules.length) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[LayoutEngine] MEMO COMPARISON - Modules length changed, re-rendering');
    }
    return false;
  }
  
  if ((prevProps.preloadPlugins?.length || 0) !== (nextProps.preloadPlugins?.length || 0)) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[LayoutEngine] MEMO COMPARISON - PreloadPlugins length changed, re-rendering');
    }
    return false;
  }
  
  // Compare layouts using JSON stringify for deep comparison
  const prevLayoutsStr = JSON.stringify(prevProps.layouts);
  const nextLayoutsStr = JSON.stringify(nextProps.layouts);
  
  if (prevLayoutsStr !== nextLayoutsStr) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[LayoutEngine] MEMO COMPARISON - Layouts changed, re-rendering');
    }
    return false;
  }
  
  // Compare modules by ID (assuming modules have stable IDs)
  for (let i = 0; i < prevProps.modules.length; i++) {
    if (prevProps.modules[i].id !== nextProps.modules[i].id) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[LayoutEngine] MEMO COMPARISON - Module IDs changed, re-rendering');
      }
      return false;
    }
  }
  
  // Skip callback function comparison - they change frequently but don't affect rendering
  // This is the key optimization: ignore callback prop changes
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[LayoutEngine] MEMO COMPARISON - Props are equal, preventing re-render');
  }
  
  return true; // Props are equal, prevent re-render
});

export default LayoutEngine;