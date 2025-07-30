import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { RenderMode, ResponsiveLayouts, LayoutItem, ModuleConfig } from '../types';
import { ModuleRenderer } from './ModuleRenderer';
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

  // Handle layout change
  const handleLayoutChange = useCallback((layout: LayoutItem[], allLayouts: ResponsiveLayouts) => {
    setCurrentLayouts(allLayouts);
    onLayoutChange?.(allLayouts);
  }, [onLayoutChange]);

  // Handle drag start
  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  // Handle drag stop
  const handleDragStop = useCallback((layout: LayoutItem[]) => {
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
    const currentLayout = currentLayouts[currentBreakpoint] || currentLayouts.desktop || [];
    
    return currentLayout.map((item) => {
      const module = moduleMap[item.moduleId];
      if (!module) return null;

      const isSelected = selectedItem === item.i;
      const isStudioMode = mode === RenderMode.STUDIO;

      return (
        <div
          key={item.i}
          className={`layout-item ${isSelected ? 'layout-item--selected' : ''} ${isStudioMode ? 'layout-item--studio' : ''}`}
          onClick={() => handleItemClick(item.i)}
          data-grid={item}
        >
          <ModuleRenderer
            pluginId={item.pluginId}
            moduleId={item.moduleId}
            instanceId={item.i}
            config={item.config}
            layoutConfig={{
              position: 'relative',
              display: 'block',
              breakpointBehavior: {},
            }}
            mode={mode}
            breakpoint={{
              name: currentBreakpoint,
              width: 0,
              height: 0,
              orientation: 'landscape',
              pixelRatio: 1,
            }}
            lazyLoading={lazyLoading}
            preload={preloadPlugins.includes(item.pluginId)}
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

  // Grid layout props
  const gridProps = useMemo(() => ({
    className: `layout-engine layout-engine--${mode}`,
    layouts: currentLayouts,
    onLayoutChange: handleLayoutChange,
    onDragStart: handleDragStart,
    onDragStop: handleDragStop,
    isDraggable: mode === RenderMode.STUDIO,
    isResizable: mode === RenderMode.STUDIO,
    ...defaultGridConfig,
  }), [currentLayouts, mode, handleLayoutChange, handleDragStart, handleDragStop]);

  return (
    <div className={`layout-engine-container ${isDragging ? 'layout-engine-container--dragging' : ''}`}>
      <ResponsiveGridLayout {...gridProps}>
        {renderGridItems()}
      </ResponsiveGridLayout>
    </div>
  );
};

export default LayoutEngine;