import React from 'react';
import { RenderMode, ResponsiveLayouts, LayoutItem, GridConfig } from './core';
import { BreakpointInfo } from './responsive';

// Layout Engine interfaces
export interface LayoutEngineProps {
  layouts: ResponsiveLayouts;
  mode: RenderMode;
  breakpoint: BreakpointInfo;
  
  // Grid configuration
  gridConfig: GridConfig;
  
  // Layout behavior
  autoLayout: boolean;
  snapToGrid: boolean;
  collisionDetection: boolean;
  
  // Event handlers
  onLayoutChange: (layouts: ResponsiveLayouts) => void;
  onItemAdd: (item: LayoutItem) => void;
  onItemRemove: (itemId: string) => void;
  onItemSelect: (itemId: string) => void;
}

// Mode controller interfaces
export interface ModeControllerProps {
  mode: RenderMode;
  onModeChange: (mode: RenderMode) => void;
  
  // Mode-specific features
  studioFeatures: StudioFeatures;
  publishedFeatures: PublishedFeatures;
  previewFeatures: PreviewFeatures;
}

export interface StudioFeatures {
  // Editing capabilities
  dragAndDrop: boolean;
  resize: boolean;
  configure: boolean;
  delete: boolean;
  
  // UI elements
  toolbar: boolean;
  contextMenu: boolean;
  propertyPanel: boolean;
  
  // Advanced features
  undo: boolean;
  redo: boolean;
  copy: boolean;
  paste: boolean;
  
  // Collaboration
  realTimeEditing: boolean;
  comments: boolean;
  versionHistory: boolean;
}

export interface PublishedFeatures {
  // Performance optimizations
  lazyLoading: boolean;
  caching: boolean;
  preloading: boolean;
  
  // SEO features
  metaTags: boolean;
  structuredData: boolean;
  sitemap: boolean;
  
  // Analytics
  pageViews: boolean;
  userInteractions: boolean;
  performanceMetrics: boolean;
}

export interface PreviewFeatures {
  // Preview-specific behavior
  deviceSimulation: boolean;
  interactionSimulation: boolean;
  performanceSimulation: boolean;
  
  // Testing features
  accessibilityCheck: boolean;
  responsiveTest: boolean;
  loadTimeTest: boolean;
}

// Layout configuration for modules
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

// Module dimensions interface
export interface ModuleDimensions {
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  aspectRatio?: number;
  redo: boolean;
  copy: boolean;
  paste: boolean;
  
  // Collaboration
  realTimeEditing: boolean;
  comments: boolean;
  versionHistory: boolean;
}

export interface PublishedFeatures {
  // Performance optimizations
  lazyLoading: boolean;
  caching: boolean;
  preloading: boolean;
  
  // SEO features
  metaTags: boolean;
  structuredData: boolean;
  sitemap: boolean;
  
  // Analytics
  pageViews: boolean;
  userInteractions: boolean;
  performanceMetrics: boolean;
}

export interface PreviewFeatures {
  // Preview-specific behavior
  deviceSimulation: boolean;
  interactionSimulation: boolean;
  performanceSimulation: boolean;
  
  // Testing features
  accessibilityCheck: boolean;
  responsiveTest: boolean;
  loadTimeTest: boolean;
}

// Layout utilities
export interface LayoutUtils {
  calculateOptimalLayout: (items: LayoutItem[], containerWidth: number) => LayoutItem[];
  validateLayout: (layout: LayoutItem[]) => ValidationResult;
  compactLayout: (layout: LayoutItem[], verticalCompact: boolean) => LayoutItem[];
  detectCollisions: (layout: LayoutItem[]) => CollisionInfo[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: LayoutError[];
  warnings: LayoutWarning[];
}

export interface LayoutError {
  itemId: string;
  type: 'overlap' | 'out-of-bounds' | 'invalid-size' | 'missing-data';
  message: string;
  severity: 'error' | 'warning';
}

export interface LayoutWarning {
  itemId: string;
  type: 'performance' | 'accessibility' | 'usability';
  message: string;
  suggestion?: string;
}

export interface CollisionInfo {
  item1: string;
  item2: string;
  overlapArea: number;
  canResolve: boolean;
}

// Animation and transition types
export interface AnimationConfig {
  enabled: boolean;
  duration: number;
  easing: string;
  properties: string[];
}

export interface TransitionConfig {
  layout: AnimationConfig;
  resize: AnimationConfig;
  modeSwitch: AnimationConfig;
  breakpointChange: AnimationConfig;
}

// Layout persistence
export interface LayoutPersistence {
  save: (pageId: string, layouts: ResponsiveLayouts) => Promise<void>;
  load: (pageId: string) => Promise<ResponsiveLayouts | null>;
  backup: (pageId: string, layouts: ResponsiveLayouts) => Promise<void>;
  restore: (pageId: string, backupId: string) => Promise<ResponsiveLayouts | null>;
}

// Layout history for undo/redo
export interface LayoutHistory {
  current: ResponsiveLayouts;
  history: LayoutHistoryEntry[];
  future: LayoutHistoryEntry[];
  maxHistorySize: number;
}

export interface LayoutHistoryEntry {
  layouts: ResponsiveLayouts;
  timestamp: Date;
  action: string;
  description: string;
}

// Layout optimization
export interface LayoutOptimization {
  enabled: boolean;
  strategies: OptimizationStrategy[];
  performance: PerformanceTargets;
}

export interface OptimizationStrategy {
  name: string;
  enabled: boolean;
  priority: number;
  apply: (layouts: ResponsiveLayouts) => ResponsiveLayouts;
}

export interface PerformanceTargets {
  maxRenderTime: number; // milliseconds
  maxMemoryUsage: number; // MB
  maxLayoutShift: number; // CLS score
}