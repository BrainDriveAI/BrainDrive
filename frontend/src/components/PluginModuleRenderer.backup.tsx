import React from 'react';
import { ModuleRenderer } from '../features/unified-dynamic-page-renderer';
import { ModuleConfig, RenderMode, BreakpointInfo } from '../features/unified-dynamic-page-renderer/types';
import { useBreakpoint } from '../features/unified-dynamic-page-renderer/hooks/useBreakpoint';

/**
 * Direct replacement of PluginModuleRenderer with the unified ModuleRenderer
 * This maintains the same interface but uses the new unified system
 */
interface PluginModuleRendererProps {
  pluginId: string;
  moduleId?: string;
  moduleName?: string;
  moduleProps?: Record<string, any>;
  fallback?: React.ReactNode;
  isLocal?: boolean;
}

export const PluginModuleRenderer: React.FC<PluginModuleRendererProps> = ({
  pluginId,
  moduleId,
  moduleName,
  moduleProps = {},
  fallback,
  isLocal
}) => {
  // Get current breakpoint information
  const breakpoint = useBreakpoint();
  
  // Create unique identifiers
  const uniqueModuleId = moduleId || `${pluginId}-${moduleName || 'default'}`;
  const instanceId = React.useMemo(() => 
    `${uniqueModuleId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    [uniqueModuleId]
  );

  // Create module configuration from legacy props
  const moduleConfig = React.useMemo((): ModuleConfig => ({
    id: uniqueModuleId,
    type: 'plugin',
    config: {
      pluginId,
      moduleId,
      moduleName,
      props: moduleProps,
      isLocal
    },
    layout: {
      i: uniqueModuleId,
      x: 0,
      y: 0,
      w: 12, // Full width by default
      h: 4   // Default height
    }
  }), [pluginId, moduleId, moduleName, moduleProps, isLocal, uniqueModuleId]);

  // Create layout configuration
  const layoutConfig = React.useMemo(() => ({
    position: 'relative' as const,
    display: 'block' as const,
    breakpointBehavior: {
      mobile: { visible: true, order: 0 },
      tablet: { visible: true, order: 0 },
      desktop: { visible: true, order: 0 }
    }
  }), []);

  // Handle module load
  const handleModuleLoad = React.useCallback((module: any) => {
    console.log('PluginModuleRenderer - Module loaded:', {
      pluginId,
      moduleId: uniqueModuleId,
      mode: 'published'
    });
  }, [pluginId, uniqueModuleId]);

  // Handle errors
  const handleError = React.useCallback((error: Error) => {
    console.error('PluginModuleRenderer - Error loading module:', {
      pluginId,
      moduleId: uniqueModuleId,
      error: error.message
    });
    
    // Show fallback if provided
    if (fallback) {
      return fallback;
    }
  }, [pluginId, uniqueModuleId, fallback]);

  return (
    <ModuleRenderer
      pluginId={pluginId}
      moduleId={uniqueModuleId}
      instanceId={instanceId}
      config={moduleConfig}
      layoutConfig={layoutConfig}
      mode="published"
      breakpoint={breakpoint}
      initialState={moduleProps.initialState}
      onStateChange={moduleProps.onStateChange}
      lazyLoading={true}
      onLoad={handleModuleLoad}
      onError={handleError}
    />
  );
};

export default PluginModuleRenderer;
