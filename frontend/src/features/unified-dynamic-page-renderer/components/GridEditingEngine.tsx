import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { RenderMode, LayoutItem, ResponsiveLayouts } from '../types/core';
import { BreakpointInfo } from '../types/responsive';
import { 
  GridEditingState, 
  AlignmentGuide, 
  GridAlignment,
  MultiSelectState 
} from '../types/studio';
import { useDragDrop } from '../hooks/useDragDrop';
import { useStudioContext } from './StudioModeController';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

export interface GridEditingEngineProps {
  layouts: ResponsiveLayouts;
  mode: RenderMode;
  breakpoint: BreakpointInfo;
  
  // Grid configuration
  gridConfig: {
    cols: Record<string, number>;
    rowHeight: number;
    margin: [number, number];
    containerPadding: [number, number];
  };
  
  // Event handlers
  onLayoutChange: (layouts: ResponsiveLayouts) => void;
  onItemAdd: (item: LayoutItem) => void;
  onItemRemove: (itemId: string) => void;
  onItemSelect: (itemId: string, multiSelect?: boolean) => void;
  
  // Children renderer
  children: (item: LayoutItem, isSelected: boolean, isEditing: boolean) => React.ReactNode;
}

export const GridEditingEngine: React.FC<GridEditingEngineProps> = ({
  layouts,
  mode,
  breakpoint,
  gridConfig,
  onLayoutChange,
  onItemAdd,
  onItemRemove,
  onItemSelect,
  children
}) => {
  const studioContext = useStudioContext();
  const { features, gridEditingState, multiSelectState, actions } = studioContext;
  
  // Local state
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Drag and drop integration
  const { registerDropZone, isDragActive } = useDragDrop({
    dropZoneId: 'grid-editing-engine',
    accepts: ['module'],
    onDrop: (data, position) => {
      if (data.type === 'module') {
        // Calculate grid position from pixel position
        const gridPosition = pixelToGrid(position);
        
        // Create new layout item
        const newItem: LayoutItem = {
          i: `${data.pluginId}_${data.moduleId}_${Date.now()}`,
          x: gridPosition.x,
          y: gridPosition.y,
          w: data.layout?.defaultWidth || 4,
          h: data.layout?.defaultHeight || 3,
          moduleId: data.moduleId,
          pluginId: data.pluginId,
          config: {},
          minW: data.layout?.minWidth,
          minH: data.layout?.minHeight,
          maxW: data.layout?.maxWidth,
          maxH: data.layout?.maxHeight
        };
        
        onItemAdd(newItem);
      }
    }
  });

  // Register drop zone
  useEffect(() => {
    if (containerRef.current && mode === 'studio') {
      return registerDropZone(containerRef.current);
    }
  }, [registerDropZone, mode]);

  // Convert pixel position to grid position
  const pixelToGrid = useCallback((position: { x: number; y: number }) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    
    const rect = containerRef.current.getBoundingClientRect();
    const relativeX = position.x - rect.left;
    const relativeY = position.y - rect.top;
    
    const colWidth = (rect.width - gridConfig.containerPadding[0] * 2) / gridConfig.cols[breakpoint.name];
    const rowHeight = gridConfig.rowHeight + gridConfig.margin[1];
    
    let gridX = Math.floor(relativeX / (colWidth + gridConfig.margin[0]));
    let gridY = Math.floor(relativeY / rowHeight);
    
    // Apply grid snapping if enabled
    if (gridEditingState.snapToGrid) {
      const snapSize = gridEditingState.gridSize;
      gridX = Math.round(gridX / snapSize) * snapSize;
      gridY = Math.round(gridY / snapSize) * snapSize;
    }
    
    // Ensure within bounds
    gridX = Math.max(0, Math.min(gridX, gridConfig.cols[breakpoint.name] - 1));
    gridY = Math.max(0, gridY);
    
    return { x: gridX, y: gridY };
  }, [breakpoint.name, gridConfig, gridEditingState.snapToGrid, gridEditingState.gridSize]);

  // Handle layout change from react-grid-layout
  const handleLayoutChange = useCallback((currentLayout: Layout[], allLayouts: any) => {
    // Convert react-grid-layout format back to our format
    const convertedLayouts: ResponsiveLayouts = {
      mobile: convertLayoutArray(allLayouts.mobile || [], layouts.mobile),
      tablet: convertLayoutArray(allLayouts.tablet || [], layouts.tablet),
      desktop: convertLayoutArray(allLayouts.desktop || [], layouts.desktop),
      wide: convertLayoutArray(allLayouts.wide || [], layouts.wide),
      ultrawide: convertLayoutArray(allLayouts.ultrawide || [], layouts.ultrawide)
    };
    
    onLayoutChange(convertedLayouts);
  }, [layouts, onLayoutChange]);

  // Convert layout array while preserving item properties
  const convertLayoutArray = useCallback((
    reactLayouts: Layout[], 
    originalItems: LayoutItem[] = []
  ): LayoutItem[] => {
    return reactLayouts.map(layout => {
      const originalItem = originalItems.find(item => item.i === layout.i);
      if (originalItem) {
        return {
          ...originalItem,
          x: layout.x,
          y: layout.y,
          w: layout.w,
          h: layout.h
        };
      }
      // Fallback for new items
      return {
        i: layout.i,
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        moduleId: '',
        pluginId: '',
        config: {}
      } as LayoutItem;
    });
  }, []);

  // Handle item selection
  const handleItemClick = useCallback((itemId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    
    const isMultiSelect = event.ctrlKey || event.metaKey;
    onItemSelect(itemId, isMultiSelect);
    
    if (isMultiSelect && features.multiSelect) {
      actions.selectItem(itemId, true);
    } else {
      actions.selectItem(itemId, false);
    }
  }, [onItemSelect, features.multiSelect, actions]);

  // Handle item removal
  const handleItemRemove = useCallback((itemId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onItemRemove(itemId);
  }, [onItemRemove]);

  // Generate alignment guides during drag/resize
  const generateAlignmentGuides = useCallback((draggedItem: Layout, allItems: Layout[]) => {
    if (!gridEditingState.alignmentGuides) return [];
    
    const guides: AlignmentGuide[] = [];
    const threshold = 5; // pixels
    
    allItems.forEach(item => {
      if (item.i === draggedItem.i) return;
      
      // Horizontal alignment guides
      if (Math.abs(item.x - draggedItem.x) < threshold) {
        guides.push({
          id: `h-${item.i}-left`,
          type: 'vertical',
          position: item.x,
          items: [item.i, draggedItem.i],
          visible: true
        });
      }
      
      if (Math.abs((item.x + item.w) - (draggedItem.x + draggedItem.w)) < threshold) {
        guides.push({
          id: `h-${item.i}-right`,
          type: 'vertical',
          position: item.x + item.w,
          items: [item.i, draggedItem.i],
          visible: true
        });
      }
      
      // Vertical alignment guides
      if (Math.abs(item.y - draggedItem.y) < threshold) {
        guides.push({
          id: `v-${item.i}-top`,
          type: 'horizontal',
          position: item.y,
          items: [item.i, draggedItem.i],
          visible: true
        });
      }
      
      if (Math.abs((item.y + item.h) - (draggedItem.y + draggedItem.h)) < threshold) {
        guides.push({
          id: `v-${item.i}-bottom`,
          type: 'horizontal',
          position: item.y + item.h,
          items: [item.i, draggedItem.i],
          visible: true
        });
      }
    });
    
    return guides;
  }, [gridEditingState.alignmentGuides]);

  // Handle drag start
  const handleDragStart = useCallback((layout: Layout[], oldItem: Layout, newItem: Layout) => {
    setIsDragging(true);
    if (gridEditingState.alignmentGuides) {
      const guides = generateAlignmentGuides(newItem, layout);
      setAlignmentGuides(guides);
    }
  }, [gridEditingState.alignmentGuides, generateAlignmentGuides]);

  // Handle drag stop
  const handleDragStop = useCallback(() => {
    setIsDragging(false);
    setAlignmentGuides([]);
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  // Handle resize stop
  const handleResizeStop = useCallback(() => {
    setIsResizing(false);
    setAlignmentGuides([]);
  }, []);

  // Get current breakpoint layouts
  const currentLayouts = {
    mobile: layouts.mobile || [],
    tablet: layouts.tablet || [],
    desktop: layouts.desktop || [],
    wide: layouts.wide || [],
    ultrawide: layouts.ultrawide || []
  };

  // Convert to react-grid-layout format
  const reactGridLayouts = Object.entries(currentLayouts).reduce((acc, [key, items]) => {
    acc[key] = items.map(item => ({
      i: item.i,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: item.minW,
      maxW: item.maxW,
      minH: item.minH,
      maxH: item.maxH,
      static: item.static,
      isDraggable: mode === 'studio' ? (item.isDraggable !== false) : false,
      isResizable: mode === 'studio' ? (item.isResizable !== false) : false
    }));
    return acc;
  }, {} as any);

  // Clear selection on container click
  const handleContainerClick = useCallback((event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      actions.clearSelection();
    }
  }, [actions]);

  return (
    <div 
      ref={containerRef}
      className={`grid-editing-engine ${mode === 'studio' ? 'grid-editing-engine--studio' : ''} ${isDragActive ? 'grid-editing-engine--drop-active' : ''}`}
      onClick={handleContainerClick}
    >
      <ResponsiveGridLayout
        className="grid-editing-layout"
        layouts={reactGridLayouts}
        breakpoints={{
          mobile: 480,
          tablet: 768,
          desktop: 1024,
          wide: 1440,
          ultrawide: 1920
        }}
        cols={gridConfig.cols}
        rowHeight={gridConfig.rowHeight}
        margin={gridConfig.margin}
        containerPadding={gridConfig.containerPadding}
        onLayoutChange={handleLayoutChange}
        onDragStart={handleDragStart}
        onDragStop={handleDragStop}
        onResizeStart={handleResizeStart}
        onResizeStop={handleResizeStop}
        isDraggable={mode === 'studio' && features.dragAndDrop}
        isResizable={mode === 'studio' && features.resize}
        compactType={gridEditingState.autoArrange ? 'vertical' : null}
        preventCollision={gridEditingState.collisionDetection}
        useCSSTransforms={true}
        draggableHandle=".grid-item-drag-handle"
      >
        {currentLayouts[breakpoint.name]?.map((item: LayoutItem) => {
          const isSelected = multiSelectState.selectedItems.includes(item.i);
          const isEditing = mode === 'studio';
          
          return (
            <div 
              key={item.i}
              className={`grid-editing-item ${isSelected ? 'grid-editing-item--selected' : ''} ${isEditing ? 'grid-editing-item--editing' : ''}`}
              onClick={(e) => handleItemClick(item.i, e)}
            >
              {/* Drag handle for studio mode */}
              {isEditing && (
                <div className="grid-item-drag-handle">
                  <div className="grid-item-drag-icon">⋮⋮</div>
                </div>
              )}
              
              {/* Item controls */}
              {isEditing && isSelected && (
                <div className="grid-editing-item__controls">
                  <button
                    className="grid-editing-item__control grid-editing-item__control--configure"
                    onClick={(e) => {
                      e.stopPropagation();
                      // TODO: Open configuration dialog
                    }}
                    title="Configure"
                  >
                    ⚙️
                  </button>
                  <button
                    className="grid-editing-item__control grid-editing-item__control--remove"
                    onClick={(e) => handleItemRemove(item.i, e)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              )}
              
              {/* Selection indicator */}
              {isSelected && (
                <div className="grid-editing-item__selection-indicator" />
              )}
              
              {/* Render item content */}
              <div className="grid-editing-item__content">
                {children(item, isSelected, isEditing)}
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>

      {/* Alignment guides */}
      {gridEditingState.alignmentGuides && alignmentGuides.map(guide => (
        <div
          key={guide.id}
          className={`alignment-guide alignment-guide--${guide.type} ${guide.visible ? 'alignment-guide--visible' : ''}`}
          style={{
            [guide.type === 'horizontal' ? 'top' : 'left']: `${guide.position * (gridConfig.rowHeight + gridConfig.margin[1])}px`
          }}
        />
      ))}

      {/* Grid overlay */}
      {mode === 'studio' && features.gridOverlay && gridEditingState.showGrid && (
        <div 
          className="grid-editing-engine__grid-overlay"
          style={{
            backgroundSize: `${gridEditingState.gridSize}px ${gridEditingState.gridSize}px`
          }}
        />
      )}
    </div>
  );
};

export default GridEditingEngine;