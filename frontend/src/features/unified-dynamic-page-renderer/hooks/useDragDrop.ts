import { useCallback, useEffect, useRef } from 'react';
import { 
  DragData, 
  DropZone, 
  DropZoneValidation,
  UseDragDropReturn,
  DragDropConfig 
} from '../types/studio';
import { useDragDropContext } from '../components/DragDropProvider';

export interface UseDragDropOptions {
  // Drop zone configuration
  dropZoneId?: string;
  accepts?: string[];
  validation?: (data: DragData) => DropZoneValidation;
  
  // Drag source configuration
  dragData?: DragData;
  dragEnabled?: boolean;
  
  // Event handlers
  onDrop?: (data: DragData, position: { x: number; y: number }) => void;
  onDragStart?: (data: DragData) => void;
  onDragEnd?: () => void;
  onDragEnter?: (data: DragData) => void;
  onDragLeave?: () => void;
}

/**
 * Hook for implementing drag and drop functionality
 * Provides both drag source and drop zone capabilities
 */
export const useDragDrop = (options: UseDragDropOptions = {}): UseDragDropReturn => {
  const {
    dropZoneId,
    accepts = [],
    validation,
    dragData,
    dragEnabled = true,
    onDrop,
    onDragStart,
    onDragEnd,
    onDragEnter,
    onDragLeave
  } = options;

  const context = useDragDropContext();
  const dropZoneRef = useRef<HTMLElement | null>(null);
  const dragSourceRef = useRef<HTMLElement | null>(null);

  // Register drop zone
  const registerDropZone = useCallback((element: HTMLElement) => {
    if (!dropZoneId) return () => {};

    dropZoneRef.current = element;
    
    const zone: DropZone = {
      id: dropZoneId,
      element,
      bounds: element.getBoundingClientRect(),
      accepts,
      validation
    };

    const cleanup = context.registerDropZone(zone);

    // Update bounds on resize
    const updateBounds = () => {
      zone.bounds = element.getBoundingClientRect();
    };

    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(element);

    // Add drop zone classes
    element.classList.add('drag-drop-zone');
    if (accepts.length > 0) {
      element.setAttribute('data-accepts', accepts.join(','));
    }

    return () => {
      cleanup();
      resizeObserver.disconnect();
      element.classList.remove('drag-drop-zone', 'drag-drop-zone--active');
    };
  }, [dropZoneId, accepts, validation, context]);

  // Register drag source
  const registerDragSource = useCallback((element: HTMLElement) => {
    if (!dragData || !dragEnabled) return () => {};

    dragSourceRef.current = element;

    const handleMouseDown = (event: MouseEvent) => {
      if (!dragEnabled || event.button !== 0) return; // Only left mouse button

      const startPos = { x: event.clientX, y: event.clientY };
      let isDragging = false;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (isDragging) return;

        const currentPos = { x: moveEvent.clientX, y: moveEvent.clientY };
        const distance = Math.sqrt(
          Math.pow(currentPos.x - startPos.x, 2) + 
          Math.pow(currentPos.y - startPos.y, 2)
        );

        // Start drag if moved beyond threshold
        if (distance > context.config.dragThreshold) {
          isDragging = true;
          context.startDrag(dragData, moveEvent as any);
          onDragStart?.(dragData);
          
          // Clean up mouse listeners
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    // Add drag source classes and attributes
    element.classList.add('drag-drop-source');
    element.setAttribute('draggable', 'true');
    element.style.cursor = 'grab';

    element.addEventListener('mousedown', handleMouseDown);

    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
      element.classList.remove('drag-drop-source');
      element.removeAttribute('draggable');
      element.style.cursor = '';
    };
  }, [dragData, dragEnabled, context, onDragStart]);

  // Handle drop events
  const handleDrop = useCallback((data: DragData, position: { x: number; y: number }) => {
    onDrop?.(data, position);
  }, [onDrop]);

  // Start drag programmatically
  const startDrag = useCallback((data: DragData, event: DragEvent) => {
    if (!dragEnabled) return;
    context.startDrag(data, event);
    onDragStart?.(data);
  }, [dragEnabled, context, onDragStart]);

  // End drag programmatically
  const endDrag = useCallback(() => {
    context.endDrag();
    onDragEnd?.();
  }, [context, onDragEnd]);

  // Monitor drag state changes for drop zone events
  useEffect(() => {
    if (!dropZoneId) return;

    const { dragDropState } = context;
    const isActiveDropZone = dragDropState.activeDropZone === dropZoneId;
    const wasActiveDropZone = useRef(false);

    // Handle drag enter/leave events
    if (isActiveDropZone && !wasActiveDropZone.current) {
      wasActiveDropZone.current = true;
      if (dragDropState.dragData) {
        onDragEnter?.(dragDropState.dragData);
      }
    } else if (!isActiveDropZone && wasActiveDropZone.current) {
      wasActiveDropZone.current = false;
      onDragLeave?.();
    }

    return () => {
      wasActiveDropZone.current = false;
    };
  }, [context.dragDropState, dropZoneId, onDragEnter, onDragLeave]);

  // Create validation function
  const createValidation = useCallback((
    acceptedTypes: string[],
    customValidation?: (data: DragData) => DropZoneValidation
  ) => {
    return (data: DragData): DropZoneValidation => {
      // Check accepted types
      if (acceptedTypes.length > 0 && !acceptedTypes.includes(data.type)) {
        return {
          isValid: false,
          reason: `This drop zone only accepts: ${acceptedTypes.join(', ')}`,
          suggestions: [`Try dragging a ${acceptedTypes[0]} instead`]
        };
      }

      // Run custom validation
      if (customValidation) {
        return customValidation(data);
      }

      return { isValid: true };
    };
  }, []);

  // Utility function to check if currently dragging
  const isDragActive = context.dragDropState.isDragging;

  // Utility function to check if this is the active drop zone
  const isActiveDropZone = dropZoneId ? context.dragDropState.activeDropZone === dropZoneId : false;

  return {
    dragDropState: context.dragDropState,
    startDrag,
    endDrag,
    handleDrop,
    registerDropZone,
    registerDragSource: registerDragSource,
    isDragActive,
    isActiveDropZone,
    createValidation
  };
};

export default useDragDrop;