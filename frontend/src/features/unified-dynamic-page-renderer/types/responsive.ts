import React from 'react';

// Responsive system types
export interface BreakpointConfig {
  breakpoints: {
    mobile: number;
    tablet: number;
    desktop: number;
    wide: number;
    ultrawide?: number;
  };
  
  // Container query settings
  containerQueries: boolean;
  containerTypes: ('inline-size' | 'block-size' | 'size')[];
  
  // Typography scaling
  fluidTypography: {
    enabled: boolean;
    minSize: number;
    maxSize: number;
    minViewport: number;
    maxViewport: number;
  };
  
  // Spacing system
  adaptiveSpacing: {
    enabled: boolean;
    baseUnit: number;
    scaleRatio: number;
  };
}

export interface BreakpointInfo {
  name: string;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  pixelRatio: number;
  containerWidth?: number;
  containerHeight?: number;
}

export interface ContainerDimensions {
  width: number;
  height: number;
  availableWidth: number;
  availableHeight: number;
}

// Responsive hook options
export interface UseResponsiveOptions {
  // Container query options
  containerRef?: React.RefObject<HTMLElement>;
  containerName?: string;
  
  // Breakpoint configuration
  breakpoints?: BreakpointConfig;
  
  // Performance options
  debounceMs?: number;
  throttleMs?: number;
  
  // Fallback options
  fallbackToViewport?: boolean;
  ssrBreakpoint?: string;
}

export interface ResponsiveState {
  // Current breakpoint info
  breakpoint: string;
  width: number;
  height: number;
  
  // Container dimensions
  containerWidth?: number;
  containerHeight?: number;
  
  // Device characteristics
  orientation: 'portrait' | 'landscape';
  pixelRatio: number;
  touchDevice: boolean;
  
  // Capabilities
  supportsContainerQueries: boolean;
  supportsViewportUnits: boolean;
  supportsClamp: boolean;
}

// Typography configuration
export interface TypographyConfig {
  // Base configuration
  baseSize: number;
  scaleRatio: number;
  
  // Responsive scaling
  responsive: {
    enabled: boolean;
    minSize: number;
    maxSize: number;
    minViewport: number;
    maxViewport: number;
  };
  
  // Container-based adjustments
  containerAdjustments: {
    [breakpoint: string]: {
      scale: number;
      lineHeightAdjustment: number;
    };
  };
}

// Spacing configuration
export interface SpacingConfig {
  // Base unit (typically 4px or 8px)
  baseUnit: number;
  
  // Scale ratios for different breakpoints
  scales: {
    [breakpoint: string]: number;
  };
  
  // Semantic spacing names
  semantic: {
    xs: number;    // 0.25 * baseUnit
    sm: number;    // 0.5 * baseUnit
    md: number;    // 1 * baseUnit
    lg: number;    // 1.5 * baseUnit
    xl: number;    // 2 * baseUnit
    '2xl': number; // 3 * baseUnit
    '3xl': number; // 4 * baseUnit
  };
  
  // Component-specific spacing
  components: {
    [componentName: string]: {
      [spacingType: string]: number;
    };
  };
}

// Responsive values
export interface ResponsiveValues<T> {
  mobile?: T;
  tablet?: T;
  desktop?: T;
  wide?: T;
  ultrawide?: T;
  default: T;
}

// Responsive style configuration
export interface ResponsiveStyleConfig {
  property: string;
  values: ResponsiveValues<string | number>;
  unit?: string;
  important?: boolean;
}