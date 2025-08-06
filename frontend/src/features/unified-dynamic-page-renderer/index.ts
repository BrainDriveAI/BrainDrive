// Main exports for Unified Dynamic Page Renderer
export { UnifiedPageRenderer } from './components/UnifiedPageRenderer';
export { ResponsiveContainer } from './components/ResponsiveContainer';
export { LayoutEngine } from './components/LayoutEngine';
export { ModuleRenderer } from './components/ModuleRenderer';
export { ModeController } from './components/ModeController';
export { ErrorBoundary } from './components/ErrorBoundary';

// Context exports
export { PageProvider, usePageContext } from './contexts/PageContext';

// Hook exports
export { useResponsive } from './hooks/useResponsive';
export { useFeatureDetection } from './hooks/useFeatureDetection';
export { usePageLoader } from './hooks/usePageLoader';
export { useErrorHandler } from './hooks/useErrorHandler';
export { useBreakpoint } from './hooks/useBreakpoint';

// Legacy Adapter exports
export { LegacyModuleAdapter, LegacyPluginModuleRenderer } from './adapters';
export type { LegacyModuleAdapterProps, LegacyAdapterConfig } from './adapters';

// Plugin Studio Adapter exports
export { PluginStudioAdapter } from './adapters';
export type { PluginStudioAdapterProps } from './adapters';

// Type exports
export * from './types';

// Default export
export { UnifiedPageRenderer as default } from './components/UnifiedPageRenderer';