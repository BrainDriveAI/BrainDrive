import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { debounce } from 'lodash';
import { ModuleRenderer } from '../components/ModuleRenderer';
import { serviceBridgeV2 } from '../services/ServiceBridgeV2';
import { RenderMode, ModuleConfig, BreakpointInfo, LayoutConfig } from '../types';

// Import legacy components and services
import ComponentErrorBoundary from '../../../components/ComponentErrorBoundary';
import { PluginModuleRenderer } from '../../../components/PluginModuleRenderer';
import { ServiceContext } from '../../../contexts/ServiceContext';
import { createServiceBridges, ServiceError } from '../../../utils/serviceBridge';
import { remotePluginService } from '../../../services/remotePluginService';
import { getPluginConfigForInstance } from '../../../plugins';

/**
 * Universal Legacy Module Adapter
 * 
 * This adapter provides backward compatibility for any legacy module renderer
 * while using the new unified renderer system internally. It's designed to be
 * reusable across different migration scenarios.
 * 
 * Features:
 * - Automatic fallback to legacy renderer on errors
 * - Props conversion between legacy and unified formats
 * - Service bridge integration
 * - Performance monitoring
 * - Migration warnings in development
 */

export interface LegacyModuleAdapterProps {
  // Legacy interface compatibility
  pluginId: string;
  moduleId?: string;
  moduleName?: string;
  moduleProps?: Record<string, any>;
  fallback?: React.ReactNode;
  isLocal?: boolean;
  
  // Unified renderer options
  useUnifiedRenderer?: boolean;
  mode?: 'studio' | 'published' | 'preview' | 'embed';
  breakpoint?: BreakpointInfo;
  lazyLoading?: boolean;
  priority?: 'high' | 'normal' | 'low';
  
  // Migration options
  enableMigrationWarnings?: boolean;
  fallbackStrategy?: 'immediate' | 'on-error' | 'never';
  performanceMonitoring?: boolean;
}

export interface LegacyAdapterConfig {
  // Adapter behavior
  defaultMode: RenderMode;
  enableFallback: boolean;
  enableWarnings: boolean;
  
  // Performance settings
  maxLoadTime: number;
  enablePerformanceLogging: boolean;
  
  // Service integration
  serviceTimeout: number;
  retryAttempts: number;
}

const defaultAdapterConfig: LegacyAdapterConfig = {
  defaultMode: 'published' as RenderMode,
  enableFallback: true,
  enableWarnings: process.env.NODE_ENV === 'development',
  maxLoadTime: 5000,
  enablePerformanceLogging: process.env.NODE_ENV === 'development',
  serviceTimeout: 3000,
  retryAttempts: 2
};

export const LegacyModuleAdapter: React.FC<LegacyModuleAdapterProps> = ({
  pluginId,
  moduleId,
  moduleName,
  moduleProps = {},
  fallback,
  isLocal,
  useUnifiedRenderer = true,
  mode = 'published',
  breakpoint,
  lazyLoading = true,
  priority = 'normal',
  enableMigrationWarnings = process.env.NODE_ENV === 'development',
  fallbackStrategy = 'on-error',
  performanceMonitoring = process.env.NODE_ENV === 'development'
}) => {
  // State management
  const [shouldUseUnified, setShouldUseUnified] = useState(
    useUnifiedRenderer && fallbackStrategy !== 'immediate'
  );
  const [unifiedError, setUnifiedError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [performanceMetrics, setPerformanceMetrics] = useState<{
    startTime: number;
    loadTime?: number;
    renderTime?: number;
  }>({ startTime: Date.now() });

  // Refs for performance tracking
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const serviceContext = useContext(ServiceContext);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Migration warnings
  useEffect(() => {
    if (enableMigrationWarnings && process.env.NODE_ENV === 'development') {
      console.warn(
        `[LegacyModuleAdapter] Plugin "${pluginId}" is using legacy adapter. ` +
        `Consider migrating to native unified renderer for better performance.`
      );
    }
  }, [pluginId, enableMigrationWarnings]);

  // Default breakpoint if not provided
  const defaultBreakpoint: BreakpointInfo = useMemo(() => ({
    name: 'desktop',
    width: 1024,
    height: 768,
    orientation: 'landscape' as const,
    pixelRatio: 1,
    containerWidth: 1200,
    containerHeight: 800
  }), []);

  const currentBreakpoint = breakpoint || defaultBreakpoint;

  // Generate instance ID for the unified renderer
  const instanceId = useMemo(() => {
    return `legacy-${pluginId}-${moduleId || moduleName}-${Date.now()}`;
  }, [pluginId, moduleId, moduleName]);

  // Convert legacy props to unified renderer format
  const convertToUnifiedConfig = useCallback((): ModuleConfig | null => {
    try {
      const startTime = performance.now();
      
      // Try to get plugin configuration
      const remotePlugin = remotePluginService.getLoadedPlugin(pluginId);
      const isLocalPlugin = isLocal !== undefined ? isLocal : !remotePlugin || remotePlugin.islocal === true;
      
      let targetModule: any = null;
      
      if (isLocalPlugin) {
        const pluginConfig = getPluginConfigForInstance(pluginId);
        if (!pluginConfig) return null;
        
        if (pluginConfig.modules && pluginConfig.modules.length > 0) {
          const baseModuleId = moduleId ? moduleId.replace(/-\d+$/, '') : null;
          targetModule = moduleId 
            ? pluginConfig.modules.find(m => m.id === moduleId) ||
              (baseModuleId ? pluginConfig.modules.find(m => m.id === baseModuleId) : null)
            : moduleName
              ? pluginConfig.modules.find(m => m.name === moduleName)
              : pluginConfig.modules[0];
        }
      } else if (remotePlugin && remotePlugin.loadedModules) {
        const baseModuleId = moduleId ? moduleId.replace(/-\d+$/, '') : null;
        if (moduleId) {
          targetModule = remotePlugin.loadedModules.find(m => m.id === moduleId);
          if (!targetModule && baseModuleId) {
            targetModule = remotePlugin.loadedModules.find(m => m.id === baseModuleId);
          }
        } else if (moduleName) {
          targetModule = remotePlugin.loadedModules.find(m => m.name === moduleName);
        } else {
          targetModule = remotePlugin.loadedModules[0];
        }
      }

      console.log(`[LegacyModuleAdapter] Target module found:`, targetModule);
      if (!targetModule) {
        console.log(`[LegacyModuleAdapter] No target module found for ${pluginId}/${moduleId || moduleName}`);
        return null;
      }

      // Extract default values from configFields
      const defaultConfigValues: Record<string, any> = {};
      if (targetModule.configFields) {
        Object.entries(targetModule.configFields).forEach(([key, field]: [string, any]) => {
          if ('default' in field) {
            defaultConfigValues[key] = field.default;
          }
        });
      }

      // Create unified module configuration
      const unifiedConfig: ModuleConfig = {
        id: moduleId || targetModule.id || targetModule.name,
        pluginId,
        type: targetModule.type || 'component',
        ...defaultConfigValues,
        ...(targetModule.props || {}),
        ...moduleProps,
        responsive: {
          [currentBreakpoint.name]: {
            ...defaultConfigValues,
            ...(targetModule.props || {}),
            ...moduleProps
          }
        },
        services: Array.isArray(targetModule.requiredServices) ? targetModule.requiredServices : [],
        lazy: lazyLoading,
        priority,
        metadata: {
          displayName: targetModule.displayName || targetModule.name,
          description: targetModule.description,
          category: targetModule.category,
          tags: targetModule.tags || [],
          priority: targetModule.priority || 0,
          isLegacyAdapter: true,
          conversionTime: performance.now() - startTime
        }
      };

      if (performanceMonitoring) {
        console.log(`[LegacyModuleAdapter] Config conversion took ${performance.now() - startTime}ms`);
      }

      return unifiedConfig;
    } catch (error) {
      console.error('[LegacyModuleAdapter] Failed to convert config:', error);
      return null;
    }
  }, [pluginId, moduleId, moduleName, moduleProps, isLocal, currentBreakpoint, lazyLoading, priority, performanceMonitoring]);

  // Layout configuration for the unified renderer
  const layoutConfig = useMemo((): LayoutConfig => ({
    position: 'relative',
    display: 'block',
    breakpointBehavior: {
      mobile: { hidden: false, order: 0 },
      tablet: { hidden: false, order: 0 },
      desktop: { hidden: false, order: 0 },
      wide: { hidden: false, order: 0 }
    }
  }), []);

  // Handle unified renderer errors and fallback to legacy
  const handleUnifiedError = useCallback((error: Error) => {
    console.warn('[LegacyModuleAdapter] Unified renderer failed, falling back to legacy:', error);
    setUnifiedError(error);
    
    if (fallbackStrategy === 'on-error' || fallbackStrategy === 'immediate') {
      setShouldUseUnified(false);
    }
    
    // Track error metrics
    if (performanceMonitoring) {
      setPerformanceMetrics(prev => ({
        ...prev,
        renderTime: Date.now() - prev.startTime,
        error: error.message
      }));
    }
  }, [fallbackStrategy, performanceMonitoring]);

  // Handle state changes from unified renderer
  const handleStateChange = useCallback((state: any) => {
    // Pass through to moduleProps.onStateChange if available
    if (moduleProps.onStateChange) {
      moduleProps.onStateChange(state);
    }
  }, [moduleProps]);

  // Handle module load from unified renderer
  const handleModuleLoad = useCallback((module: any) => {
    setIsLoading(false);
    
    // Track performance metrics
    if (performanceMonitoring) {
      setPerformanceMetrics(prev => ({
        ...prev,
        loadTime: Date.now() - prev.startTime
      }));
    }
    
    // Pass through to moduleProps.onModuleLoad if available
    if (moduleProps.onModuleLoad) {
      moduleProps.onModuleLoad(module);
    }
  }, [moduleProps, performanceMonitoring]);

  // Retry mechanism for failed unified renderer
  const handleRetry = useCallback(() => {
    if (retryCountRef.current < defaultAdapterConfig.retryAttempts) {
      retryCountRef.current++;
      setUnifiedError(null);
      setShouldUseUnified(true);
      setPerformanceMetrics({ startTime: Date.now() });
    } else {
      console.warn('[LegacyModuleAdapter] Max retry attempts reached, using legacy renderer');
      setShouldUseUnified(false);
    }
  }, []);

  // Try unified renderer first, fallback to legacy if needed
  if (shouldUseUnified && !unifiedError && fallbackStrategy !== 'never') {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[LegacyModuleAdapter] Attempting unified render for ${pluginId}/${moduleId || moduleName}`);
    }
    const unifiedConfig = convertToUnifiedConfig();
    
    if (unifiedConfig) {
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[LegacyModuleAdapter] Using unified renderer for ${pluginId}/${moduleId || moduleName}`);
      }
      return (
        <ComponentErrorBoundary
          fallback={
            <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" p={2}>
              <Typography variant="body2" color="error" gutterBottom>
                Unified renderer failed, falling back to legacy...
              </Typography>
              {retryCountRef.current < defaultAdapterConfig.retryAttempts && (
                <button onClick={handleRetry} style={{ marginTop: 8 }}>
                  Retry ({retryCountRef.current + 1}/{defaultAdapterConfig.retryAttempts})
                </button>
              )}
            </Box>
          }
        >
          <ModuleRenderer
            pluginId={pluginId}
            moduleId={moduleId || moduleName || 'default'}
            
            
            moduleName={moduleName}
            isLocal={isLocal}
            additionalProps={{
              layoutConfig,
              mode: mode as RenderMode,
              breakpoint: currentBreakpoint,
              initialState: moduleProps.initialState,
              onStateChange: handleStateChange,
              services: unifiedConfig?.services,
              lazyLoading: false,
              priority,
              onLoad: handleModuleLoad
            }}
            onError={handleUnifiedError}
          />
          
          {/* Performance overlay in development */}
          {performanceMonitoring && process.env.NODE_ENV === 'development' && (
            <div style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '4px 8px',
              fontSize: '10px',
              borderRadius: '0 0 0 4px',
              zIndex: 9999
            }}>
              Unified ({performanceMetrics.loadTime || 0}ms)
            </div>
          )}
        </ComponentErrorBoundary>
      );
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[LegacyModuleAdapter] Unified config is null, falling back to legacy for ${pluginId}/${moduleId || moduleName}`);
      }
    }
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[LegacyModuleAdapter] Skipping unified renderer: shouldUseUnified=${shouldUseUnified}, unifiedError=${!!unifiedError}, fallbackStrategy=${fallbackStrategy}`);
    }
  }

  // Fallback to legacy PluginModuleRenderer
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[LegacyModuleAdapter] Using legacy renderer for ${pluginId}/${moduleId || moduleName}`);
  }
  return (
    <ComponentErrorBoundary>
      <div style={{ position: 'relative' }}>
        <PluginModuleRenderer
          pluginId={pluginId}
          moduleId={moduleId}
          moduleName={moduleName}
          moduleProps={moduleProps}
          fallback={fallback}
          isLocal={isLocal}
        />
        
        {/* Legacy indicator in development */}
        {enableMigrationWarnings && process.env.NODE_ENV === 'development' && (
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            background: 'rgba(255,165,0,0.8)',
            color: 'white',
            padding: '4px 8px',
            fontSize: '10px',
            borderRadius: '0 0 0 4px',
            zIndex: 9999
          }}>
            Legacy ({performanceMetrics.renderTime || 0}ms)
          </div>
        )}
      </div>
    </ComponentErrorBoundary>
  );
};

export default LegacyModuleAdapter;