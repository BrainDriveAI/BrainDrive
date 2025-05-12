import { useState, useCallback } from 'react';
import { DragData } from '../../types';
import { VIEW_MODE_LAYOUTS } from '../../constants';

/**
 * Custom hook for handling drag and drop operations
 * @returns Drag state and handlers
 */
export const usePluginDrag = () => {
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    data: DragData | null;
  }>({
    isDragging: false,
    data: null
  });
  
  /**
   * Handle drag start
   * @param data The drag data
   */
  const handleDragStart = useCallback((data: DragData) => {
    setDragState({
      isDragging: true,
      data
    });
  }, []);
  
  /**
   * Handle drag end
   */
  const handleDragEnd = useCallback(() => {
    setDragState({
      isDragging: false,
      data: null
    });
  }, []);
  
  /**
   * Calculate default size for a module
   * @param data The drag data
   * @param viewMode The current view mode
   * @returns The default size
   */
  const getDefaultSize = useCallback((data: DragData, viewMode: string) => {
    const defaultLayout = VIEW_MODE_LAYOUTS[viewMode as keyof typeof VIEW_MODE_LAYOUTS];
    
    return {
      w: data.layout?.defaultWidth || data.layout?.minWidth || defaultLayout.defaultItemSize.w,
      h: data.layout?.defaultHeight || data.layout?.minHeight || defaultLayout.defaultItemSize.h,
      minW: data.layout?.minWidth,
      minH: data.layout?.minHeight
    };
  }, []);
  
  return {
    dragState,
    handleDragStart,
    handleDragEnd,
    getDefaultSize
  };
};