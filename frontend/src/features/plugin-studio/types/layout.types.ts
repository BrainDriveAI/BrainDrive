import { Layout } from 'react-grid-layout';
import { GridItem } from './plugin.types';

/**
 * Device types for responsive layouts
 */
export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/**
 * View mode state for the canvas
 */
export interface ViewModeState {
  type: DeviceType | 'custom';
}

/**
 * Breakpoints for different device types
 */
export interface DeviceBreakpoints {
  tablet?: number;  // Default: 768
  mobile?: number;  // Default: 480
}

/**
 * Default breakpoints that will be used if not specified in the page
 */
export const DEFAULT_BREAKPOINTS: Required<DeviceBreakpoints> = {
  mobile: 480,
  tablet: 768,
};

/**
 * Layout item for a module in the grid
 */
export interface LayoutItem {
  moduleUniqueId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  configOverrides?: Record<string, any>;
  i: string; // Required by react-grid-layout
}

/**
 * Layouts for different device types
 */
export interface Layouts {
  desktop: (GridItem | LayoutItem)[];     // Required base layout
  tablet?: (GridItem | LayoutItem)[];     // Optional tablet-specific layout
  mobile?: (GridItem | LayoutItem)[];     // Optional mobile-specific layout
}

/**
 * Configuration for different view modes
 */
export interface ViewModeConfig {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  padding: [number, number];
  defaultItemSize: {
    w: number;
    h: number;
  };
}

/**
 * Configuration for all view modes
 */
export interface ViewModeConfigs {
  mobile: ViewModeConfig;
  tablet: ViewModeConfig;
  desktop: ViewModeConfig;
  custom: ViewModeConfig;
}