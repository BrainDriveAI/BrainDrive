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
import { usePluginConfig, usePluginsReady } from '../../../contexts/PluginLoadingContext';

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

// Custom comparison function for React.memo to prevent unnecessary re-renders
const arePropsEqual = (prevProps: LegacyModuleAdapterProps, nextProps: LegacyModuleAdapterProps) => {
  const moduleKey = `${nextProps.pluginId}/${nextProps.moduleId}`;
  
  // Compare primitive props
  if (
    prevProps.pluginId !== nextProps.pluginId ||
    prevProps.moduleId !== nextProps.moduleId ||
    prevProps.moduleName !== nextProps.moduleName ||
    prevProps.useUnifiedRenderer !== nextProps.useUnifiedRenderer ||
    prevProps.fallbackStrategy !== nextProps.fallbackStrategy ||
    prevProps.mode !== nextProps.mode ||
    prevProps.lazyLoading !== nextProps.lazyLoading ||
    prevProps.priority !== nextProps.priority ||
    prevProps.isLocal !== nextProps.isLocal
  ) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - Primitive props changed for ${moduleKey}`);
    }
    return false;
  }

  // Deep compare moduleProps if they exist
  if (prevProps.moduleProps !== nextProps.moduleProps) {
    // If both are objects, do a shallow comparison of keys and values
    if (typeof prevProps.moduleProps === 'object' && typeof nextProps.moduleProps === 'object' &&
        prevProps.moduleProps !== null && nextProps.moduleProps !== null) {
      
      const prevKeys = Object.keys(prevProps.moduleProps);
      const nextKeys = Object.keys(nextProps.moduleProps);
      
      if (prevKeys.length !== nextKeys.length) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - moduleProps keys length changed for ${moduleKey}`);
        }
        return false;
      }
      
      for (const key of prevKeys) {
        if (prevProps.moduleProps[key] !== nextProps.moduleProps[key]) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - moduleProps.${key} changed for ${moduleKey}`);
          }
          return false;
        }
      }
    } else {
      // Different types or one is null
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - moduleProps type changed for ${moduleKey}`);
      }
      return false;
    }
  }

  // Compare breakpoint object if it exists
  if (prevProps.breakpoint !== nextProps.breakpoint) {
    if (typeof prevProps.breakpoint === 'object' && typeof nextProps.breakpoint === 'object' &&
        prevProps.breakpoint !== null && nextProps.breakpoint !== null) {
      
      // Compare essential breakpoint properties
      if (prevProps.breakpoint.name !== nextProps.breakpoint.name ||
          prevProps.breakpoint.containerWidth !== nextProps.breakpoint.containerWidth ||
          prevProps.breakpoint.containerHeight !== nextProps.breakpoint.containerHeight) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - breakpoint changed for ${moduleKey}`);
        }
        return false;
      }
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] MEMO COMPARISON FAILED - breakpoint type changed for ${moduleKey}`);
      }
      return false;
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[LegacyModuleAdapter] MEMO COMPARISON SUCCESS - Props are equal for ${moduleKey}, preventing re-render`);
  }
  return true;
};

export const LegacyModuleAdapter: React.FC<LegacyModuleAdapterProps> = React.memo(({
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
  // Debug: Log all props received with render count
  const renderCountRef = useRef(0);
  renderCountRef.current++;
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`[LegacyModuleAdapter] RENDER #${renderCountRef.current} - Props received for ${pluginId}/${moduleId || moduleName}:`, {
      pluginId,
      moduleId,
      moduleName,
      useUnifiedRenderer,
      fallbackStrategy,
      mode,
      enableMigrationWarnings,
      performanceMonitoring,
      lazyLoading,
      priority,
      modulePropsKeys: Object.keys(moduleProps || {}),
      modulePropsLength: Object.keys(moduleProps || {}).length
    });
    
    // Track what's causing re-renders
    console.log(`[LegacyModuleAdapter] RENDER #${renderCountRef.current} - Stack trace:`, new Error().stack);
  }

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

  // Refs for performance tracking and caching
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const configCacheRef = useRef<{ key: string; config: ModuleConfig | null } | null>(null);
  const serviceContext = useContext(ServiceContext);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Migration warnings are now shown only when actually using legacy renderer (see legacy fallback section)

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

  // Generate stable instance ID for the unified renderer - avoid Date.now() to prevent re-renders
  const instanceId = useMemo(() => {
    return `legacy-${pluginId}-${moduleId || moduleName}`;
  }, [pluginId, moduleId, moduleName]);

  // Convert legacy props to unified renderer format - memoize to prevent infinite loops
  const convertToUnifiedConfig = useCallback((): ModuleConfig | null => {
    // Create a cache key based on the essential props
    const cacheKey = `${pluginId}-${moduleId || moduleName}-${JSON.stringify(moduleProps)}`;
    
    // Check if we have a cached result
    if (configCacheRef.current && configCacheRef.current.key === cacheKey) {
      return configCacheRef.current.config;
    }
    
    try {
      const startTime = performance.now();
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] Converting config for ${pluginId}/${moduleId || moduleName}`);
      }
      
      // Try to get plugin configuration
      const remotePlugin = remotePluginService.getLoadedPlugin(pluginId);
      const isLocalPlugin = isLocal !== undefined ? isLocal : !remotePlugin || remotePlugin.islocal === true;
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] Plugin lookup: remotePlugin=${!!remotePlugin}, isLocalPlugin=${isLocalPlugin}`);
      }
      
      let targetModule: any = null;
      
      if (isLocalPlugin) {
        const pluginConfig = getPluginConfigForInstance(pluginId);
        if (process.env.NODE_ENV === 'development') {
          console.log(`[LegacyModuleAdapter] Local plugin config:`, pluginConfig);
        }
        if (!pluginConfig) {
          if (process.env.NODE_ENV === 'development') {
            console.log(`[LegacyModuleAdapter] No local plugin config found for ${pluginId}`);
          }
          return null;
        }
        
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
        if (process.env.NODE_ENV === 'development') {
          console.log(`[LegacyModuleAdapter] Remote plugin modules:`, remotePlugin.loadedModules);
        }
        
        if (moduleId) {
          // Try exact match first
          targetModule = remotePlugin.loadedModules.find(m => m.id === moduleId);
          
          if (!targetModule) {
            // Enhanced module ID extraction for complex generated IDs
            // Format: PluginName_actualModuleId_timestamp
            const parts = moduleId.split('_');
            if (parts.length >= 2) {
              const extractedModuleId = parts[1]; // Get the actual module ID
              targetModule = remotePlugin.loadedModules.find(m => m.id === extractedModuleId);
              
              if (process.env.NODE_ENV === 'development') {
                console.log(`[LegacyModuleAdapter] Trying extracted module ID: "${extractedModuleId}" from complex ID: "${moduleId}"`);
                if (targetModule) {
                  console.log(`[LegacyModuleAdapter] Successfully found module with extracted ID:`, {
                    id: targetModule.id,
                    name: targetModule.name,
                    hasComponent: !!targetModule.component
                  });
                }
              }
            }
          }
          
          if (!targetModule) {
            // Try simple pattern removal (original logic)
            const baseModuleId = moduleId.replace(/-\d+$/, '');
            targetModule = remotePlugin.loadedModules.find(m => m.id === baseModuleId);
            
            if (process.env.NODE_ENV === 'development' && targetModule) {
              console.log(`[LegacyModuleAdapter] Found module with base ID: "${baseModuleId}"`);
            }
          }
          
          if (!targetModule) {
            // For complex generated IDs like "BrainDriveChat_1830586da8834501bea1ef1d39c3cbe8_BrainDriveChat_BrainDriveChat_1754404718788"
            // Try to extract the plugin name (first part before underscore)
            const pluginNameFromId = moduleId.split('_')[0];
            targetModule = remotePlugin.loadedModules.find(m =>
              m.id === pluginNameFromId ||
              m.name === pluginNameFromId ||
              (m.id && m.id.includes(pluginNameFromId))
            );
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[LegacyModuleAdapter] Trying plugin name extraction: "${pluginNameFromId}" from moduleId: "${moduleId}"`);
            }
          }
          
          if (!targetModule) {
            // Try to match by plugin ID directly
            targetModule = remotePlugin.loadedModules.find(m =>
              m.id === pluginId ||
              m.name === pluginId ||
              (m.id && m.id.includes(pluginId))
            );
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[LegacyModuleAdapter] Trying plugin ID match: "${pluginId}"`);
            }
          }
          
          if (!targetModule) {
            // Final fallback: use the first module from the plugin
            targetModule = remotePlugin.loadedModules[0];
            
            if (process.env.NODE_ENV === 'development') {
              console.log(`[LegacyModuleAdapter] Using first available module as fallback:`, {
                id: targetModule.id,
                name: targetModule.name,
                hasComponent: !!targetModule.component,
                componentType: typeof targetModule.component,
                componentName: targetModule.component?.name
              });
            }
          }
        } else if (moduleName) {
          targetModule = remotePlugin.loadedModules.find(m => m.name === moduleName);
        } else {
          targetModule = remotePlugin.loadedModules[0];
        }
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] Target module found:`, targetModule);
      }
      if (!targetModule) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[LegacyModuleAdapter] No target module found for ${pluginId}/${moduleId || moduleName}`);
        }
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

      // Cache the result
      configCacheRef.current = { key: cacheKey, config: unifiedConfig };
      
      return unifiedConfig;
    } catch (error) {
      console.error('[LegacyModuleAdapter] Failed to convert config:', error);
      // Cache the null result to prevent repeated failures
      configCacheRef.current = { key: cacheKey, config: null };
      return null;
    }
  }, [pluginId, moduleId, moduleName, isLocal, currentBreakpoint, lazyLoading, priority, performanceMonitoring]);

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
      console.log(`[LegacyModuleAdapter] Attempting unified render for ${pluginId}/${moduleId || moduleName}`);
    }
    const unifiedConfig = convertToUnifiedConfig();
    
    if (unifiedConfig) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] Using unified renderer for ${pluginId}/${moduleId || moduleName}`);
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
          <PluginModuleRenderer
            pluginId={pluginId}
            moduleId={moduleId}
            moduleName={moduleName}
            moduleProps={{
              ...moduleProps,
              mode: mode as RenderMode,
              breakpoint: currentBreakpoint,
              initialState: moduleProps.initialState,
              onStateChange: handleStateChange,
              services: unifiedConfig?.services,
              lazyLoading: false,
              priority,
              onLoad: handleModuleLoad
            }}
            isLocal={isLocal}
            fallback={
              <Box display="flex" justifyContent="center" alignItems="center" height="100%" p={2}>
                <Typography variant="body2" color="text.secondary">
                  Loading unified module...
                </Typography>
              </Box>
            }
          />
          
          {/* Performance overlay in development */}
          {performanceMonitoring && process.env.NODE_ENV === 'development' && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '4px 8px',
              fontSize: '10px',
              borderRadius: '0 4px 0 0',
              zIndex: 9999
            }}>
              Unified ({performanceMetrics.loadTime || 0}ms)
            </div>
          )}
        </ComponentErrorBoundary>
      );
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[LegacyModuleAdapter] Unified config is null, falling back to legacy for ${pluginId}/${moduleId || moduleName}`);
      }
    }
  } else {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LegacyModuleAdapter] Skipping unified renderer: shouldUseUnified=${shouldUseUnified}, unifiedError=${!!unifiedError}, fallbackStrategy=${fallbackStrategy}`);
    }
  }

  // Fallback to legacy PluginModuleRenderer
  if (process.env.NODE_ENV === 'development') {
    console.log(`[LegacyModuleAdapter] Using legacy renderer for ${pluginId}/${moduleId || moduleName}`);
    
    // Show migration warning only when actually using legacy renderer
    if (enableMigrationWarnings) {
      console.warn(
        `[LegacyModuleAdapter] Plugin "${pluginId}" is using legacy adapter. ` +
        `Consider migrating to native unified renderer for better performance.`
      );
    }
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
}, arePropsEqual);

export default LegacyModuleAdapter;