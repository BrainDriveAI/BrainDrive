import { useState, useCallback, useEffect } from 'react';
import { ViewModeState, DeviceType } from '../../types';
import { DEVICE_BREAKPOINTS, DEFAULT_VIEW_MODE } from '../../constants';

/**
 * Custom hook for managing view mode
 * @returns View mode management functions and state
 */
export const useViewMode = () => {
  const [viewMode, setViewMode] = useState<ViewModeState>({ type: DEFAULT_VIEW_MODE });
  const [previewMode, setPreviewMode] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  
  /**
   * Handle view mode change
   * @param newMode The new view mode
   */
  const handleViewModeChange = useCallback((newMode: ViewModeState) => {
    setViewMode(newMode);
  }, []);
  
  /**
   * Toggle preview mode
   */
  const togglePreviewMode = useCallback(() => {
    setPreviewMode(prev => !prev);
  }, []);
  
  /**
   * Get effective device type based on container width
   * @param width The container width
   * @returns The effective device type
   */
  const getEffectiveDeviceType = useCallback((width: number): DeviceType => {
    if (width <= DEVICE_BREAKPOINTS.mobile) return 'mobile';
    if (width <= DEVICE_BREAKPOINTS.tablet) return 'tablet';
    return 'desktop';
  }, []);
  
  /**
   * Calculate view width based on view mode
   * @returns The calculated view width
   */
  const calculateViewWidth = useCallback(() => {
    // Default minimum width to ensure grid is always visible
    const MIN_WIDTH = 320;
    
    // Use fixed widths for each view mode to ensure consistency
    switch (viewMode.type) {
      case 'mobile':
        // Mobile view is exactly 480px wide
        return DEVICE_BREAKPOINTS.mobile;
      
      case 'tablet':
        // Tablet view is exactly 768px wide
        return DEVICE_BREAKPOINTS.tablet;
      
      case 'desktop':
        // Desktop view fills the available container width while honoring the minimum
        return Math.max(MIN_WIDTH, containerWidth);
      
      case 'custom':
      default:
        // Custom view uses the container width
        return Math.max(MIN_WIDTH, containerWidth);
    }
  }, [viewMode.type, containerWidth]);
  
  // Calculate the view width whenever the view mode or container width changes
  const [viewWidth, setViewWidth] = useState(calculateViewWidth());
  
  useEffect(() => {
    setViewWidth(calculateViewWidth());
  }, [viewMode, containerWidth, calculateViewWidth]);
  
  return {
    viewMode,
    setViewMode: handleViewModeChange,
    previewMode,
    togglePreviewMode,
    containerWidth,
    setContainerWidth,
    getEffectiveDeviceType,
    calculateViewWidth,
    viewWidth
  };
};
