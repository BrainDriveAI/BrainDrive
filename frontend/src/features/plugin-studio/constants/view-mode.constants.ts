import { DeviceType } from '../types';

/**
 * Default view mode
 */
export const DEFAULT_VIEW_MODE: DeviceType = 'desktop';

/**
 * Fixed widths for each view mode (in pixels)
 */
export const VIEW_MODE_WIDTHS: Record<DeviceType | 'custom', number> = {
  mobile: 480,   // Mobile view is exactly 480px wide
  tablet: 768,   // Tablet view is exactly 768px wide
  desktop: 1200, // Desktop view is 1200px wide
  custom: 0      // Custom view uses the container width
};

/**
 * View mode labels for UI display
 */
export const VIEW_MODE_LABELS: Record<DeviceType | 'custom', string> = {
  mobile: 'Mobile',
  tablet: 'Tablet',
  desktop: 'Desktop',
  custom: 'Custom'
};

/**
 * View mode icons for UI display
 */
export const VIEW_MODE_ICONS: Record<DeviceType | 'custom', string> = {
  mobile: 'SmartphoneIcon',
  tablet: 'TabletIcon',
  desktop: 'DesktopWindowsIcon',
  custom: 'AspectRatioIcon'
};

/**
 * View mode tooltips for UI display
 */
export const VIEW_MODE_TOOLTIPS: Record<DeviceType | 'custom', string> = {
  mobile: 'Mobile View (Double-click for custom)',
  tablet: 'Tablet View (Double-click for custom)',
  desktop: 'Desktop View (Double-click for custom)',
  custom: 'Custom Size (Resize Browser)'
};