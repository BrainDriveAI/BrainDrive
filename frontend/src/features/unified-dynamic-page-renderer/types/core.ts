import React from 'react';

// Core enums and types
export enum RenderMode {
  STUDIO = 'studio',
  PUBLISHED = 'published',
  PREVIEW = 'preview',
  EMBED = 'embed'
}

// Page data interfaces
export interface PageData {
  id: string;
  name: string;
  route: string;
  layouts: ResponsiveLayouts;
  modules: ModuleConfig[];
  metadata: PageMetadata;
  isPublished: boolean;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  ogImage?: string;
  canonicalUrl?: string;
  robots?: string;
  lastModified?: Date;
  publishedAt?: Date;
}

// Module configuration
export interface ModuleConfig {
  // Basic configuration
  [key: string]: any;
  
  // Responsive overrides
  responsive?: {
    mobile?: Partial<ModuleConfig>;
    tablet?: Partial<ModuleConfig>;
    desktop?: Partial<ModuleConfig>;
    wide?: Partial<ModuleConfig>;
  };
  
  // Performance hints
  lazy?: boolean;
  priority?: 'high' | 'normal' | 'low';
  preload?: boolean;
}

// Layout configuration
export interface LayoutConfig {
  // Position and size
  position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  display: 'block' | 'inline' | 'flex' | 'grid' | 'none';
  
  // Responsive behavior
  breakpointBehavior: {
    mobile?: LayoutBehavior;
    tablet?: LayoutBehavior;
    desktop?: LayoutBehavior;
    wide?: LayoutBehavior;
  };
  
  // Visual properties
  background?: string;
  border?: string;
  borderRadius?: string;
  boxShadow?: string;
  
  // Animation
  transition?: string;
  animation?: string;
}

export interface LayoutBehavior {
  hidden?: boolean;
  order?: number;
  flex?: string;
  alignSelf?: string;
  justifySelf?: string;
}

// Responsive layouts
export interface ResponsiveLayouts {
  mobile: LayoutItem[];
  tablet: LayoutItem[];
  desktop: LayoutItem[];
  wide?: LayoutItem[];
  ultrawide?: LayoutItem[];
}

export interface LayoutItem {
  i: string; // Unique identifier
  x: number;
  y: number;
  w: number;
  h: number;
  
  // Responsive behavior
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  
  // Layout constraints
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  
  // Module information
  moduleId: string;
  pluginId: string;
  config: ModuleConfig;
  
  // Visual properties
  zIndex?: number;
  opacity?: number;
  transform?: string;
}

// Grid configuration
export interface GridConfig {
  cols: Record<string, number>;
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
  
  // Advanced grid features
  autoRows: boolean;
  denseLayout: boolean;
  verticalCompact: boolean;
  preventCollision: boolean;
}

// Module dimensions
export interface ModuleDimensions {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  aspectRatio?: number;
}

// Error types
export interface ModuleError {
  moduleId: string;
  pluginId: string;
  error: Error;
  timestamp: Date;
  recoverable: boolean;
}

export interface LoadedModule {
  moduleId: string;
  pluginId: string;
  component: React.ComponentType<any>;
  config: ModuleConfig;
  loadTime: number;
}

// User context
export interface UserContext {
  id: string;
  permissions: string[];
  preferences: Record<string, any>;
}