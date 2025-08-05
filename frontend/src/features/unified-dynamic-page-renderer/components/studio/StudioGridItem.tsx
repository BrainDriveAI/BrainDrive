import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ModuleConfig, LayoutItem, RenderMode } from '../../types';
import { BreakpointInfo } from '../../types/responsive';
import { StudioModuleConfig } from '../../utils/PluginStudioAdapter';
import { ModuleRenderer } from '../ModuleRenderer';

export interface StudioGridItemProps {
  // Module configuration
  moduleConfig: StudioModuleConfig;
  layoutItem: LayoutItem;
  
  // WYSIWYG state
  isSelected?: boolean;
  isHovered?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  
  // Event handlers
  onSelect?: (moduleId: string, addToSelection?: boolean) => void;
  onConfigure?: (moduleId: string) => void;
  onRemove?: (moduleId: string) => void;
  onDuplicate?: (moduleId: string) => void;
  
  // Layout event handlers
  onLayoutChange?: (moduleId: string, layout: Partial<LayoutItem>) => void;
  onResize?: (moduleId: string, size: { w: number; h: number }) => void;
  
  // Studio configuration
  showControls?: boolean;
  showDebugInfo?: boolean;
  enableDragDrop?: boolean;
  enableResize?: boolean;
  
  // Children
  children?: React.ReactNode;
}

/**
 * StudioGridItem - Enhanced WYSIWYG grid item component
 * 
 * This component provides the WYSIWYG editing experience for modules in Plugin Studio.
 * It preserves all existing drag-and-drop functionality while adding enhanced controls
 * and visual feedback.
 * 
 * Based on the proven patterns from the existing GridItem.tsx (332 lines) and
 * enhanced with container queries and advanced visual feedback.
 */
export const StudioGridItem: React.FC<StudioGridItemProps> = ({
  moduleConfig,
  layoutItem,
  isSelected = false,
  isHovered = false,
  isDragging = false,
  isResizing = false,
  onSelect,
  onConfigure,
  onRemove,
  onDuplicate,
  onLayoutChange,
  onResize,
  showControls = true,
  showDebugInfo = false,
  enableDragDrop = true,
  enableResize = true,
  children,
}) => {
  const [localHovered, setLocalHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  
  const itemRef = useRef<HTMLDivElement>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout>();
  
  // Determine if controls should be visible
  const controlsVisible = showControls && (isSelected || isHovered || localHovered) && !isDragging;
  
  // Handle mouse events for hover state
  const handleMouseEnter = useCallback(() => {
    setLocalHovered(true);
    
    // Show tooltip after delay
    tooltipTimeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 1000);
  }, []);
  
  const handleMouseLeave = useCallback(() => {
    setLocalHovered(false);
    setShowTooltip(false);
    
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
  }, []);
  
  // Handle selection
  const handleClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const addToSelection = event.ctrlKey || event.metaKey;
    onSelect?.(moduleConfig.instanceId, addToSelection);
  }, [onSelect, moduleConfig.instanceId]);
  
  // Handle context menu
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setContextMenuVisible(true);
  }, []);
  
  // Handle keyboard events
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!isSelected) return;
    
    switch (event.key) {
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        onRemove?.(moduleConfig.instanceId);
        break;
      case 'Enter':
        event.preventDefault();
        onConfigure?.(moduleConfig.instanceId);
        break;
      case 'Escape':
        event.preventDefault();
        onSelect?.(moduleConfig.instanceId, false); // Deselect
        break;
    }
  }, [isSelected, onRemove, onConfigure, onSelect, moduleConfig.instanceId]);
  
  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);
  
  // Calculate container classes
  const containerClasses = [
    'studio-grid-item',
    isSelected && 'studio-grid-item--selected',
    (isHovered || localHovered) && 'studio-grid-item--hovered',
    isDragging && 'studio-grid-item--dragging',
    isResizing && 'studio-grid-item--resizing',
    !enableDragDrop && 'studio-grid-item--no-drag',
    !enableResize && 'studio-grid-item--no-resize',
  ].filter(Boolean).join(' ');
  
  return (
    <div
      ref={itemRef}
      className={containerClasses}
      data-module-id={moduleConfig.instanceId}
      data-plugin-id={moduleConfig.pluginId}
      data-layout-x={layoutItem.x}
      data-layout-y={layoutItem.y}
      data-layout-w={layoutItem.w}
      data-layout-h={layoutItem.h}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="gridcell"
      aria-selected={isSelected}
      aria-label={`Module ${moduleConfig.pluginId}/${moduleConfig.moduleId}`}
      style={{
        // Container query support for true responsive WYSIWYG
        containerType: 'inline-size',
        position: 'relative',
        width: '100%',
        height: '100%',
        outline: 'none',
        // Visual feedback styles
        border: isSelected 
          ? '2px solid var(--studio-primary-color, #1976d2)' 
          : (isHovered || localHovered) 
            ? '2px solid var(--studio-hover-color, #42a5f5)' 
            : '1px solid var(--studio-border-color, #e0e0e0)',
        borderRadius: '4px',
        backgroundColor: isDragging 
          ? 'var(--studio-drag-bg, rgba(25, 118, 210, 0.1))' 
          : 'var(--studio-item-bg, #ffffff)',
        boxShadow: isSelected 
          ? '0 4px 12px rgba(25, 118, 210, 0.3)' 
          : (isHovered || localHovered) 
            ? '0 2px 8px rgba(0, 0, 0, 0.1)' 
            : 'none',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: isDragging ? 'scale(1.02)' : 'scale(1)',
        zIndex: isDragging ? 1000 : isSelected ? 100 : 1,
      }}
    >
      {/* WYSIWYG Controls Overlay */}
      {controlsVisible && (
        <div className="studio-grid-item__controls">
          {/* Top Controls Bar */}
          <div className="studio-grid-item__controls-top">
            {/* Drag Handle */}
            {enableDragDrop && (
              <button
                className="studio-grid-item__drag-handle react-grid-dragHandleExample"
                title="Drag to move"
                aria-label="Drag to move module"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                </svg>
              </button>
            )}
            
            {/* Configure Button */}
            <button
              className="studio-grid-item__configure-btn"
              onClick={(e) => {
                e.stopPropagation();
                onConfigure?.(moduleConfig.instanceId);
              }}
              title="Configure module"
              aria-label="Configure module"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.82,11.69,4.82,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
              </svg>
            </button>
            
            {/* Duplicate Button */}
            <button
              className="studio-grid-item__duplicate-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate?.(moduleConfig.instanceId);
              }}
              title="Duplicate module"
              aria-label="Duplicate module"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
            </button>
            
            {/* Remove Button */}
            <button
              className="studio-grid-item__remove-btn"
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.(moduleConfig.instanceId);
              }}
              title="Remove module"
              aria-label="Remove module"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
          
          {/* Resize Handles */}
          {enableResize && (
            <>
              <div className="studio-grid-item__resize-handle studio-grid-item__resize-handle--se" />
              <div className="studio-grid-item__resize-handle studio-grid-item__resize-handle--s" />
              <div className="studio-grid-item__resize-handle studio-grid-item__resize-handle--e" />
            </>
          )}
        </div>
      )}
      
      {/* Module Content */}
      <div className="studio-grid-item__content">
        {children || (
          <ModuleRenderer
            pluginId={moduleConfig.pluginId}
            moduleId={moduleConfig.moduleId}
            instanceId={moduleConfig.instanceId}
            config={moduleConfig.config || {}}
            layoutConfig={moduleConfig.layoutConfig || {}}
            mode={RenderMode.STUDIO}
            breakpoint={{
              name: 'desktop',
              width: 1200,
              height: 800,
              orientation: 'landscape',
              pixelRatio: 1
            } as BreakpointInfo}
            services={moduleConfig.services || []}
          />
        )}
      </div>
      
      {/* Module Info Overlay */}
      {(controlsVisible || showDebugInfo) && (
        <div className="studio-grid-item__info">
          <div className="studio-grid-item__info-content">
            <span className="studio-grid-item__info-title">
              {moduleConfig.pluginId}/{moduleConfig.moduleId}
            </span>
            {showDebugInfo && (
              <div className="studio-grid-item__debug-info">
                <span>Size: {layoutItem.w}×{layoutItem.h}</span>
                <span>Pos: ({layoutItem.x}, {layoutItem.y})</span>
                {moduleConfig.layoutHints && (
                  <span>Hints: {Object.keys(moduleConfig.layoutHints).length}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Tooltip */}
      {showTooltip && (
        <div className="studio-grid-item__tooltip">
          <div className="studio-grid-item__tooltip-content">
            <strong>{moduleConfig.pluginId}</strong>
            <br />
            {moduleConfig.moduleId}
            {moduleConfig.layoutHints?.defaultWidth && (
              <>
                <br />
                <small>Default: {moduleConfig.layoutHints.defaultWidth}×{moduleConfig.layoutHints.defaultHeight}</small>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Context Menu */}
      {contextMenuVisible && (
        <div 
          className="studio-grid-item__context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            zIndex: 10000,
          }}
          onBlur={() => setContextMenuVisible(false)}
        >
          <button onClick={() => { onConfigure?.(moduleConfig.instanceId); setContextMenuVisible(false); }}>
            Configure
          </button>
          <button onClick={() => { onDuplicate?.(moduleConfig.instanceId); setContextMenuVisible(false); }}>
            Duplicate
          </button>
          <hr />
          <button onClick={() => { onRemove?.(moduleConfig.instanceId); setContextMenuVisible(false); }}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

export default StudioGridItem;