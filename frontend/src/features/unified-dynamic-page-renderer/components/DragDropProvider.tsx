import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  DragDropState, 
  DragData, 
  DropZone, 
  DropZoneValidation,
  DragPreview,
  DragDropConfig 
} from '../types/studio';
import { BreakpointInfo } from '../types/responsive';

export interface DragDropProviderProps {
  config?: Partial<DragDropConfig>;
  breakpoint: BreakpointInfo;
  onDrop?: (data: DragData, position: { x: number; y: number }, dropZone?: DropZone) => void;
  onDragStart?: (data: DragData) => void;
  onDragEnd?: () => void;
  children: React.ReactNode;
}

const defaultConfig: DragDropConfig = {
  enabled: true,
  dragThreshold: 5,
  dropZoneHighlight: true,
  visualFeedback: true,
  constrainToParent: true,
  snapToGrid: false,
  snapThreshold: 10
};

export const DragDropProvider: React.FC<DragDropProviderProps> = ({
  config = {},
  breakpoint,
  onDrop,
  onDragStart,
  onDragEnd,
  children
}) => {
  const finalConfig = { ...defaultConfig, ...config };
  
  // State
  const [dragDropState, setDragDropState] = useState<DragDropState>({
    isDragging: false,
    dragData: null,
    dropZones: [],
    activeDropZone: null,
    dragPreview: null
  });

  // Refs
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const dropZonesRef = useRef<Map<string, DropZone>>(new Map());

  // Register a drop zone
  const registerDropZone = useCallback((zone: DropZone): (() => void) => {
    dropZonesRef.current.set(zone.id, zone);
    
    setDragDropState(prev => ({
      ...prev,
      dropZones: Array.from(dropZonesRef.current.values())
    }));

    // Return cleanup function
    return () => {
      dropZonesRef.current.delete(zone.id);
      setDragDropState(prev => ({
        ...prev,
        dropZones: Array.from(dropZonesRef.current.values())
      }));
    };
  }, []);

  // Start drag operation
  const startDrag = useCallback((data: DragData, event: DragEvent) => {
    if (!finalConfig.enabled) return;

    const startPos = { x: event.clientX, y: event.clientY };
    dragStartPos.current = startPos;

    setDragDropState(prev => ({
      ...prev,
      isDragging: true,
      dragData: data
    }));

    // Create drag preview if visual feedback is enabled
    if (finalConfig.visualFeedback) {
      createDragPreview(data, startPos);
    }

    onDragStart?.(data);
  }, [finalConfig.enabled, finalConfig.visualFeedback, onDragStart]);

  // End drag operation
  const endDrag = useCallback(() => {
    setDragDropState(prev => ({
      ...prev,
      isDragging: false,
      dragData: null,
      activeDropZone: null,
      dragPreview: null
    }));

    // Clean up drag preview
    if (dragPreviewRef.current) {
      document.body.removeChild(dragPreviewRef.current);
      dragPreviewRef.current = null;
    }

    dragStartPos.current = null;
    onDragEnd?.();
  }, [onDragEnd]);

  // Handle drop
  const handleDrop = useCallback((data: DragData, position: { x: number; y: number }) => {
    if (!finalConfig.enabled) return;

    // Find the active drop zone
    const activeZone = dragDropState.activeDropZone 
      ? dropZonesRef.current.get(dragDropState.activeDropZone)
      : null;

    // Validate drop if zone has validation
    if (activeZone?.validation) {
      const validation = activeZone.validation(data);
      if (!validation.isValid) {
        console.warn('[DragDropProvider] Drop validation failed:', validation.reason);
        endDrag();
        return;
      }
    }

    // Apply grid snapping if enabled
    let finalPosition = position;
    if (finalConfig.snapToGrid) {
      const gridSize = finalConfig.snapThreshold;
      finalPosition = {
        x: Math.round(position.x / gridSize) * gridSize,
        y: Math.round(position.y / gridSize) * gridSize
      };
    }

    onDrop?.(data, finalPosition, activeZone || undefined);
    endDrag();
  }, [finalConfig.enabled, finalConfig.snapToGrid, finalConfig.snapThreshold, dragDropState.activeDropZone, onDrop, endDrag]);

  // Create drag preview element
  const createDragPreview = useCallback((data: DragData, position: { x: number; y: number }) => {
    const preview = document.createElement('div');
    preview.className = 'drag-drop-preview';
    preview.style.cssText = `
      position: fixed;
      top: ${position.y}px;
      left: ${position.x}px;
      z-index: 10000;
      pointer-events: none;
      background: rgba(25, 118, 210, 0.1);
      border: 2px dashed rgba(25, 118, 210, 0.5);
      border-radius: 4px;
      padding: 8px 12px;
      font-size: 12px;
      color: rgba(25, 118, 210, 1);
      backdrop-filter: blur(4px);
      transform: translate(-50%, -50%);
      transition: transform 0.1s ease-out;
    `;
    
    preview.textContent = data.displayName || data.moduleName || 'Module';
    document.body.appendChild(preview);
    dragPreviewRef.current = preview;

    setDragDropState(prev => ({
      ...prev,
      dragPreview: {
        element: preview,
        offset: { x: 0, y: 0 },
        style: preview.style
      }
    }));
  }, []);

  // Update drag preview position
  const updateDragPreview = useCallback((position: { x: number; y: number }) => {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.style.left = `${position.x}px`;
      dragPreviewRef.current.style.top = `${position.y}px`;
    }
  }, []);

  // Find drop zone at position
  const findDropZoneAtPosition = useCallback((position: { x: number; y: number }): DropZone | null => {
    for (const zone of dropZonesRef.current.values()) {
      const rect = zone.bounds;
      if (position.x >= rect.left && 
          position.x <= rect.right && 
          position.y >= rect.top && 
          position.y <= rect.bottom) {
        return zone;
      }
    }
    return null;
  }, []);

  // Global mouse move handler for drag operations
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragDropState.isDragging || !dragStartPos.current) return;

      const currentPos = { x: event.clientX, y: event.clientY };
      
      // Update drag preview position
      if (finalConfig.visualFeedback) {
        updateDragPreview(currentPos);
      }

      // Check for drop zone changes
      const dropZone = findDropZoneAtPosition(currentPos);
      const newActiveZone = dropZone?.id || null;

      if (newActiveZone !== dragDropState.activeDropZone) {
        setDragDropState(prev => ({
          ...prev,
          activeDropZone: newActiveZone
        }));

        // Update drop zone highlighting
        if (finalConfig.dropZoneHighlight) {
          // Remove highlight from previous zone
          if (dragDropState.activeDropZone) {
            const prevZone = dropZonesRef.current.get(dragDropState.activeDropZone);
            if (prevZone) {
              prevZone.element.classList.remove('drag-drop-zone--active');
            }
          }

          // Add highlight to new zone
          if (dropZone) {
            dropZone.element.classList.add('drag-drop-zone--active');
          }
        }
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (!dragDropState.isDragging || !dragDropState.dragData) return;

      const dropPosition = { x: event.clientX, y: event.clientY };
      handleDrop(dragDropState.dragData, dropPosition);
    };

    if (dragDropState.isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dragDropState.isDragging, 
    dragDropState.activeDropZone, 
    dragDropState.dragData,
    finalConfig.visualFeedback, 
    finalConfig.dropZoneHighlight,
    updateDragPreview, 
    findDropZoneAtPosition, 
    handleDrop
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dragPreviewRef.current) {
        document.body.removeChild(dragPreviewRef.current);
      }
    };
  }, []);

  // Context value
  const contextValue = {
    dragDropState,
    config: finalConfig,
    breakpoint,
    registerDropZone,
    startDrag,
    endDrag,
    handleDrop
  };

  return (
    <DragDropContext.Provider value={contextValue}>
      <div 
        className={`drag-drop-provider ${dragDropState.isDragging ? 'drag-drop-provider--dragging' : ''}`}
        data-breakpoint={breakpoint.name}
      >
        {children}
      </div>
    </DragDropContext.Provider>
  );
};

// Context
export interface DragDropContextValue {
  dragDropState: DragDropState;
  config: DragDropConfig;
  breakpoint: BreakpointInfo;
  registerDropZone: (zone: DropZone) => () => void;
  startDrag: (data: DragData, event: DragEvent) => void;
  endDrag: () => void;
  handleDrop: (data: DragData, position: { x: number; y: number }) => void;
}

const DragDropContext = React.createContext<DragDropContextValue | null>(null);

// Hook to use drag drop context
export const useDragDropContext = (): DragDropContextValue => {
  const context = React.useContext(DragDropContext);
  if (!context) {
    throw new Error('useDragDropContext must be used within a DragDropProvider');
  }
  return context;
};

export default DragDropProvider;