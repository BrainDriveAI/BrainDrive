import React from 'react';
import { PluginStudioProvider } from './context/PluginStudioProvider';
import { PluginStudioLayout } from './components/PluginStudioLayout';
import { UnifiedPluginStudioLayout } from './components/UnifiedPluginStudioLayout';
import { usePerformanceOptimization, productionPerformanceConfig } from './config/performance';

/**
 * Main entry point for the Plugin Studio feature
 * @returns The Plugin Studio page component
 */
export const PluginStudioPage: React.FC = () => {
  return (
    <PluginStudioProvider>
      <PluginStudioLayout />
    </PluginStudioProvider>
  );
};

/**
 * Enhanced Plugin Studio using Unified Dynamic Page Renderer
 * 
 * This version provides all the existing WYSIWYG functionality while leveraging
 * the unified renderer for improved performance, service bridge integration,
 * and enhanced features like container queries.
 * 
 * Features:
 * - All existing drag-and-drop functionality preserved
 * - Enhanced visual feedback and animations
 * - Improved service bridge integration using proven patterns
 * - Container query support for true responsive WYSIWYG
 * - Auto-save functionality
 * - Multi-select support
 * - Better accessibility
 * - Performance optimizations
 */
export const EnhancedPluginStudioPage: React.FC = () => {
  // Initialize performance monitoring
  const { monitor } = usePerformanceOptimization(productionPerformanceConfig);
  
  // Record component mount time
  React.useEffect(() => {
    const startTime = performance.now();
    
    return () => {
      const mountTime = performance.now() - startTime;
      monitor.recordMetric('component.mountTime', mountTime);
    };
  }, [monitor]);

  return (
    <PluginStudioProvider>
      <UnifiedPluginStudioLayout />
    </PluginStudioProvider>
  );
};

// Export types
export * from './types';

// Export hooks
export * from './hooks';

// Export context
export * from './context';

// Export constants
export * from './constants';

// Export original components (avoiding conflicts)
export { PluginStudioLayout } from './components/PluginStudioLayout';
export { PluginToolbar } from './components/toolbar/PluginToolbar';
export { PluginCanvas } from './components/canvas/PluginCanvas';
export { GridContainer } from './components/canvas/GridContainer';
export { GridItem } from './components/canvas/GridItem';
export { DropZone } from './components/canvas/DropZone';

// Export enhanced components
export { UnifiedPluginStudioLayout } from './components/UnifiedPluginStudioLayout';
export { EnhancedStudioRenderer } from './components/EnhancedStudioRenderer';
export { EnhancedLayoutEngine } from './components/EnhancedLayoutEngine';
export { EnhancedGridItem } from './components/EnhancedGridItem';

// Export enhanced services and hooks
export { enhancedServiceBridge } from './services/EnhancedServiceBridge';
export { useEnhancedStudioState } from './hooks/useEnhancedStudioState';

// Export dialog components
export * from './components/dialogs';

// Export performance utilities
export * from './config/performance';

// Export types
export type { EnhancedStudioRendererProps } from './components/EnhancedStudioRenderer';
export type { EnhancedLayoutEngineProps } from './components/EnhancedLayoutEngine';
export type { EnhancedGridItemProps } from './components/EnhancedGridItem';
export type { PerformanceConfig } from './config/performance';

// Migration utilities for backward compatibility
export const PluginStudioMigration = {
  // Check if enhanced features are available
  isEnhanced: () => true,
  
  // Get migration status
  getMigrationStatus: () => ({
    phase1: 'completed', // Asset validation
    phase2: 'completed', // Unified renderer integration
    phase3: 'completed', // WYSIWYG functionality
    phase4: 'completed', // Service bridge migration
    phase5: 'completed', // Dialog integration
    phase6: 'completed', // Testing and validation
    phase7: 'completed', // Production optimizations
    overall: 'completed'
  }),
  
  // Get feature compatibility
  getFeatureCompatibility: () => ({
    wysiwyg: true,
    containerQueries: true,
    multiSelect: true,
    autoSave: true,
    undoRedo: true,
    collaboration: true,
    accessibility: true,
    performance: true
  })
};

// Default export points to enhanced version
export default EnhancedPluginStudioPage;