import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RenderMode, ModuleConfig, BreakpointInfo } from '../types';
import { LayoutConfig, ModuleDimensions } from '../types/layout';
import { serviceBridgeV2 } from '../services/ServiceBridgeV2';
import { pluginLoader, PluginLoadResult } from '../services/PluginLoader';
import { configurationManager, ConfigurationContext } from '../services/ConfigurationManager';

export interface ModuleRendererProps {
  // Module identification
  pluginId: string;
  moduleId: string;
  instanceId: string;
  
  // Configuration
  config: ModuleConfig;
  layoutConfig: LayoutConfig;
  
  // Rendering context
  mode: RenderMode;
  breakpoint: BreakpointInfo;
  
  // State management
  initialState?: any;
  onStateChange?: (state: any) => void;
  
  // Service integration
  services?: string[];
  
  // Performance options
  lazyLoading?: boolean;
  preload?: boolean;
  priority?: 'high' | 'normal' | 'low';
  
  // Event handlers
  onLoad?: (module: any) => void;
  onError?: (error: Error) => void;
  onResize?: (dimensions: ModuleDimensions) => void;
  onPerformanceIssue?: (issue: any) => void;
}

export const ModuleRenderer: React.FC<ModuleRendererProps> = ({
  pluginId,
  moduleId,
  instanceId,
  config,
  layoutConfig,
  mode,
  breakpoint,
  initialState,
  onStateChange,
  services = [],
  lazyLoading = true,
  preload = false,
  priority = 'normal',
  onLoad,
  onError,
  onResize,
  onPerformanceIssue,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [moduleComponent, setModuleComponent] = useState<React.ComponentType<any> | null>(null);
  const [moduleState, setModuleState] = useState(initialState);
  const [loadResult, setLoadResult] = useState<PluginLoadResult | null>(null);
  const [resolvedConfig, setResolvedConfig] = useState<ModuleConfig>(config);
  const [serviceBridges, setServiceBridges] = useState<Record<string, any>>({});
  
  // Performance monitoring
  const performanceRef = useRef<{ startTime: number; loadTime?: number }>({ startTime: 0 });
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve configuration with hierarchy
  useEffect(() => {
    const context: ConfigurationContext = {
      moduleId,
      pageId: undefined, // Would be provided by parent
      mode,
      breakpoint
    };

    const resolved = configurationManager.resolveConfiguration(context);
    setResolvedConfig(resolved);
  }, [config, mode, breakpoint, moduleId]);

  // Setup service bridges
  useEffect(() => {
    if (services.length === 0) return;

    const setupServices = async () => {
      try {
        const resolution = serviceBridgeV2.resolveDependencies(services);
        
        if (resolution.missing.length > 0) {
          console.warn(`[ModuleRenderer] Missing services for ${moduleId}:`, resolution.missing);
        }
        
        if (resolution.errors.length > 0) {
          console.error(`[ModuleRenderer] Service errors for ${moduleId}:`, resolution.errors);
        }
        
        setServiceBridges(resolution.resolved);
      } catch (error) {
        console.error(`[ModuleRenderer] Failed to setup services for ${moduleId}:`, error);
      }
    };

    setupServices();
  }, [services, moduleId]);

  // Load module component
  useEffect(() => {
    const loadModule = async () => {
      if (!mountedRef.current) return;

      try {
        setIsLoading(true);
        setError(null);
        performanceRef.current.startTime = performance.now();

        // Load plugin using the new plugin loader
        const result = await pluginLoader.loadPlugin(pluginId, moduleId, {
          priority,
          bypassCache: false
        });

        if (!mountedRef.current) return;

        if (result.success && result.component) {
          setModuleComponent(() => result.component!);
          setLoadResult(result);
          performanceRef.current.loadTime = result.loadTime;
          
          // Monitor performance
          if (result.loadTime && result.loadTime > 1000) { // > 1 second
            onPerformanceIssue?.({
              type: 'slow-load',
              moduleId,
              loadTime: result.loadTime,
              threshold: 1000
            });
          }
          
          onLoad?.(result.component);
        } else {
          const error = result.error || new Error('Failed to load module component');
          setError(error);
          onError?.(error);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        
        const error = err instanceof Error ? err : new Error('Failed to load module');
        setError(error);
        onError?.(error);
      } finally {
        if (mountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    if (preload || !lazyLoading) {
      loadModule();
    }
  }, [pluginId, moduleId, mode, preload, lazyLoading, priority, onLoad, onError, onPerformanceIssue]);

  // Handle state changes
  const handleStateChange = useCallback((newState: any) => {
    setModuleState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  // Get responsive config from resolved configuration
  const responsiveConfig = useMemo(() => {
    return configurationManager.getResponsiveConfig(resolvedConfig, breakpoint);
  }, [resolvedConfig, breakpoint]);

  // Get mode-specific config
  const modeConfig = useMemo(() => {
    return configurationManager.getModeConfig(responsiveConfig, mode);
  }, [responsiveConfig, mode]);

  // Final merged configuration
  const finalConfig = useMemo(() => {
    return { ...modeConfig, ...layoutConfig };
  }, [modeConfig, layoutConfig]);

  // Enhanced loading state with performance info
  if (isLoading) {
    return (
      <div className="module-renderer module-renderer--loading">
        <div className="module-renderer__loading-indicator">
          <div className="module-renderer__spinner" />
          <span className="module-renderer__loading-text">
            Loading {pluginId}...
            {priority === 'high' && <span className="module-renderer__priority-badge">High Priority</span>}
          </span>
        </div>
      </div>
    );
  }

  // Enhanced error state with retry and debug info
  if (error) {
    return (
      <div className="module-renderer module-renderer--error">
        <div className="module-renderer__error-container">
          <h4 className="module-renderer__error-title">Module Error</h4>
          <p className="module-renderer__error-message">{error.message}</p>
          <div className="module-renderer__error-details">
            <p>Plugin: {pluginId}</p>
            <p>Module: {moduleId}</p>
            <p>Mode: {mode}</p>
            <p>Breakpoint: {breakpoint.name}</p>
          </div>
          <div className="module-renderer__error-actions">
            <button
              className="module-renderer__retry-button"
              onClick={() => {
                setError(null);
                setIsLoading(true);
                // Clear cache and retry
                pluginLoader.clearCache(pluginId);
              }}
            >
              Retry
            </button>
            {mode === 'studio' && (
              <button
                className="module-renderer__debug-button"
                onClick={() => {
                  const context: ConfigurationContext = {
                    moduleId,
                    mode,
                    breakpoint
                  };
                  const debugInfo = configurationManager.getDebugInfo(context);
                  console.log('Module Debug Info:', debugInfo);
                }}
              >
                Debug
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render module with enhanced props
  if (!moduleComponent) {
    return (
      <div className="module-renderer module-renderer--empty">
        <p>No module component available</p>
        {mode === 'studio' && (
          <div className="module-renderer__debug-info">
            <p>Load Result: {loadResult ? 'Success' : 'Failed'}</p>
            <p>Load Time: {performanceRef.current.loadTime?.toFixed(2)}ms</p>
          </div>
        )}
      </div>
    );
  }

  const ModuleComponent = moduleComponent;

  return (
    <div
      className={`module-renderer module-renderer--${mode}`}
      data-plugin-id={pluginId}
      data-module-id={moduleId}
      data-instance-id={instanceId}
      data-breakpoint={breakpoint.name}
      data-load-time={performanceRef.current.loadTime}
    >
      <ModuleComponent
        {...finalConfig}
        moduleId={moduleId}
        instanceId={instanceId}
        mode={mode}
        breakpoint={breakpoint}
        state={moduleState}
        onStateChange={handleStateChange}
        onResize={onResize}
        services={serviceBridges}
        metadata={loadResult?.metadata}
      />
      
      {mode === 'studio' && (
        <div className="module-renderer__debug-overlay">
          <div className="module-renderer__debug-info">
            <span>Load: {performanceRef.current.loadTime?.toFixed(0)}ms</span>
            <span>Services: {Object.keys(serviceBridges).length}</span>
            <span>Config: {Object.keys(finalConfig).length} props</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModuleRenderer;