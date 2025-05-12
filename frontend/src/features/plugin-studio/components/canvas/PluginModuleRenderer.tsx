import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import { usePlugins } from '../../hooks';
import { ErrorBoundary } from '../common';
import { createServiceBridges } from '../../../../utils/serviceBridge';
import { ServiceContext } from '../../../../contexts/ServiceContext';
import { remotePluginService } from '../../../../services/remotePluginService';
import { normalizeObjectKeys, snakeToCamel } from '../../../../utils/caseConversion';

interface PluginModuleRendererProps {
  pluginId: string;
  moduleId: string;
  uniqueId: string;
  config?: Record<string, any>;
  layoutConfig?: Record<string, any>;
  currentDeviceType?: string;
}

/**
 * Component that renders the actual plugin module content
 * @param props The component props
 * @returns The plugin module renderer component
 */
export const PluginModuleRenderer: React.FC<PluginModuleRendererProps> = ({
  pluginId = '',
  moduleId = '',
  uniqueId,
  config = {},
  layoutConfig = {},
  currentDeviceType = 'desktop'
}) => {
  // Early return with placeholder if we don't have enough information
  // This prevents unnecessary rendering and error loops
  if (!uniqueId || (!pluginId && !moduleId)) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        p: 2,
        color: 'text.secondary'
      }}>
        <Typography variant="body2" align="center">
          Empty module placeholder
        </Typography>
      </Box>
    );
  }

  const { getModuleById, availablePlugins } = usePlugins();
  const serviceContext = useContext(ServiceContext);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ModuleComponent, setModuleComponent] = useState<React.ComponentType<any> | null>(null);
  const [attemptedLoad, setAttemptedLoad] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [serviceBridges, setServiceBridges] = useState<Record<string, any>>({});
  
  // Store the previous config and layoutConfig to detect changes
  const prevConfigRef = useRef<Record<string, any>>({});
  const prevLayoutConfigRef = useRef<Record<string, any>>({});
  
  // Enhanced function to check if config has changed by comparing stringified versions
  const hasConfigChanged = useCallback(() => {
    // Create clean copies without internal tracking properties
    const cleanConfig = { ...config };
    delete cleanConfig._lastUpdated;
    delete cleanConfig._moduleUpdated;
    delete cleanConfig._configUpdated;
    
    const cleanPrevConfig = { ...prevConfigRef.current };
    delete cleanPrevConfig._lastUpdated;
    delete cleanPrevConfig._moduleUpdated;
    delete cleanPrevConfig._configUpdated;
    
    // Compare the clean versions
    const prevConfigStr = JSON.stringify(cleanPrevConfig);
    const currentConfigStr = JSON.stringify(cleanConfig);
    const configChanged = prevConfigStr !== currentConfigStr;
    
    // Do the same for layout config
    const cleanLayoutConfig = { ...layoutConfig };
    const cleanPrevLayoutConfig = { ...prevLayoutConfigRef.current };
    
    const prevLayoutConfigStr = JSON.stringify(cleanPrevLayoutConfig);
    const currentLayoutConfigStr = JSON.stringify(cleanLayoutConfig);
    const layoutConfigChanged = prevLayoutConfigStr !== currentLayoutConfigStr;
    
    // Check for special timestamp properties that indicate updates
    const hasUpdateTimestamp = config._configUpdated || config._lastUpdated || config._moduleUpdated;
    const forceUpdate = !!hasUpdateTimestamp;
    
    return configChanged || layoutConfigChanged || forceUpdate;
  }, [config, layoutConfig]);
  
  // Memoize the getService function
  const getService = useCallback((name: string) => {
    if (!serviceContext) {
      throw new Error('Service context not available');
    }
    return serviceContext.getService(name);
  }, [serviceContext]);
  
  // Function to load the module
  const loadModule = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Try to get moduleId from config if not provided directly
      const effectiveModuleId = moduleId || config.moduleId;
      
      // Try to extract information from uniqueId if it's in the format pluginId_moduleId_timestamp
      let effectivePluginId = pluginId;
      let extractedModuleId = effectiveModuleId;
      
      if (uniqueId && (!effectivePluginId || !extractedModuleId)) {
        const parts = uniqueId.split('_');
        if (parts.length >= 2) {
          if (!effectivePluginId && parts[0]) effectivePluginId = parts[0];
          if (!extractedModuleId && parts[1]) extractedModuleId = parts[1];
        }
      }
      
      // If we still don't have valid IDs, show an error
      if (!effectivePluginId || !extractedModuleId) {
        throw new Error(`Missing plugin or module ID information`);
      }
      
      // Try to get the module from the remote plugin service first
      const remoteModule = remotePluginService.getLoadedModule(effectivePluginId, extractedModuleId);
      
      // Get the module definition from either the remote module or the plugin registry
      let module;
      let component;
      
      if (remoteModule && remoteModule.component) {
        module = remoteModule;
        component = remoteModule.component;
      } else {
        // If not found in remote service, try the plugin registry
        module = getModuleById(effectivePluginId, extractedModuleId);
        
        if (!module) {
          throw new Error(`Module ${extractedModuleId} not found in plugin ${effectivePluginId}`);
        }
        
        component = module.component;
      }
      
      // Create service bridges for the module
      let bridges = {};
      if (module.requiredServices) {
        try {
          // Create service bridges using the memoized getService function
          const { serviceBridges, errors } = createServiceBridges(module.requiredServices, getService);
          
          if (errors.length > 0) {
            // Handle service errors silently
          } else {
            bridges = serviceBridges;
            setServiceBridges(bridges);
          }
        } catch (error) {
          // Handle service bridge creation errors silently
        }
      }
      
      // Extract default values from configFields
      if (module.configFields) {
        // Extract default values from configFields
        const defaultConfigValues: Record<string, any> = {};
        Object.entries(module.configFields).forEach(([key, field]) => {
          // Add type assertion for field
          const configField = field as Record<string, any>;
          if ('default' in configField) {
            defaultConfigValues[key] = configField.default;
          }
        });
        
        // Merge default values with config and layout-specific config
        // Important: layoutConfig should have the highest precedence
        // CRITICAL FIX: Ensure proper merging order with layoutConfig having highest priority
        // Create a deep clone of the default values to avoid reference issues
        const mergedConfig = JSON.parse(JSON.stringify({
          ...defaultConfigValues,
          ...(module.props || {}),
          ...config
        }));
        
        // Apply layout-specific overrides if they exist - these should override everything else
        if (Object.keys(layoutConfig).length > 0) {
          // CRITICAL FIX: Explicitly copy each property from layoutConfig to mergedConfig
          // This ensures layout-specific overrides take precedence
          Object.entries(layoutConfig).forEach(([key, value]) => {
            // Use JSON.parse(JSON.stringify()) to create a new reference for objects
            mergedConfig[key] = typeof value === 'object' && value !== null
              ? JSON.parse(JSON.stringify(value))
              : value;
          });
        }
        
        // Normalize config to ensure consistent camelCase property names
        config = normalizeObjectKeys(mergedConfig);
        
        // Normalize layoutConfig separately to ensure it's properly applied when rendering
        if (Object.keys(layoutConfig).length > 0) {
          // Create a normalized copy of layoutConfig
          const normalizedLayoutConfig: Record<string, any> = {};
          
          Object.entries(layoutConfig).forEach(([key, value]) => {
            const normalizedKey = key.includes('_') ? snakeToCamel(key) : key;
            normalizedLayoutConfig[normalizedKey] = value;
          });
          
          // Replace the original layoutConfig with the normalized version
          layoutConfig = normalizedLayoutConfig;
          
        }
      }
      
      if (!component) {
        // Try to reload the plugin if component is missing
        
        // Find the plugin in available plugins
        const plugin = availablePlugins.find(p => p.id === effectivePluginId);
        
        if (plugin) {
          // Try to reload the plugin
          const reloadedPlugin = await remotePluginService.loadRemotePlugin(plugin);
          
          if (reloadedPlugin) {
            // Try to get the module again
            const reloadedModule = reloadedPlugin.loadedModules.find(
              m => m.id === extractedModuleId || m.name === extractedModuleId
            );
            
            if (reloadedModule && reloadedModule.component) {
              component = reloadedModule.component;
            }
          }
        }
        
        if (!component) {
          throw new Error(`Component not found for module ${extractedModuleId}`);
        }
      }
      
      setModuleComponent(() => component);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error loading module');
    } finally {
      setIsLoading(false);
      setAttemptedLoad(true);
      setIsRetrying(false);
    }
  };
  // Load the module when the component mounts or when retrying
  useEffect(() => {
    // Check if config has changed
    const configChanged = hasConfigChanged();
    
    // Check for special timestamp properties that indicate updates
    const hasConfigTimestamp = config._configUpdated || config._lastUpdated || config._moduleUpdated;
    
    // Only reload if this is the first load, we're retrying, or the config has actually changed
    const shouldReload = !attemptedLoad || isRetrying || configChanged;
    
    if (shouldReload) {
      
      // Only reset the module component if we're actually reloading
      if (configChanged) {
        setModuleComponent(null);
      }
      
      // Create a clean copy of config without internal tracking properties
      const cleanConfig = { ...config };
      delete cleanConfig._lastUpdated;
      delete cleanConfig._moduleUpdated;
      delete cleanConfig._configUpdated;
      
      // Store the clean config in the ref for future comparisons
      prevConfigRef.current = cleanConfig;
      prevLayoutConfigRef.current = { ...layoutConfig };
      
      loadModule();
    } else {
      // Make sure we're not in a loading state if we're skipping the reload
      setIsLoading(false);
      setIsRetrying(false);
    }
  }, [pluginId, moduleId, uniqueId, config, layoutConfig, currentDeviceType, getService, hasConfigChanged, attemptedLoad, isRetrying]);
  
  
  // Force reload when config changes
  useEffect(() => {
    // Skip initial render
    if (!attemptedLoad) return;
    
    // Check if config has changed
    const configChanged = hasConfigChanged();
    
    if (configChanged && !isLoading) {
      setIsRetrying(true);
    }
  }, [config, layoutConfig, moduleId, uniqueId, attemptedLoad, isLoading, hasConfigChanged]);
  
  // Function to retry loading the module
  const handleRetry = () => {
    setIsRetrying(true);
    setAttemptedLoad(false);
  };
  
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  
  if (error || !ModuleComponent) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        p: 2,
        color: 'error.main'
      }}>
        <ErrorIcon sx={{ mb: 1 }} />
        <Typography variant="body2" align="center" sx={{ mb: 2 }}>
          {error || 'Failed to load module'}
        </Typography>
        <Button
          variant="outlined"
          color="primary"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={handleRetry}
          disabled={isRetrying}
        >
          {isRetrying ? 'Retrying...' : 'Retry'}
        </Button>
      </Box>
    );
  }
  
  return (
    <ErrorBoundary
      fallback={
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100%',
          p: 2,
          color: 'error.main'
        }}>
          <ErrorIcon sx={{ mb: 1 }} />
          <Typography variant="body2" align="center" sx={{ mb: 2 }}>
            Error rendering module
          </Typography>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={handleRetry}
          >
            Retry
          </Button>
        </Box>
      }
    >
      
      {/* CRITICAL FIX: Create a merged config object where layoutConfig overrides config */}
      {(() => {
        // Create a deep clone of the config
        const mergedConfig = JSON.parse(JSON.stringify(config));
        
        // Apply layout-specific overrides
        if (Object.keys(layoutConfig).length > 0) {
          Object.entries(layoutConfig).forEach(([key, value]) => {
            // Use JSON.parse(JSON.stringify()) to create a new reference for objects
            mergedConfig[key] = typeof value === 'object' && value !== null
              ? JSON.parse(JSON.stringify(value))
              : value;
          });
        }
        
        // Generate a more reliable key that will change when config changes
        // Use a hash of the config instead of Date.now() to avoid unnecessary re-renders
        const configKey = JSON.stringify(mergedConfig);
        const configHash = configKey.split('').reduce((hash, char) => {
          return ((hash << 5) - hash) + char.charCodeAt(0) | 0;
        }, 0);
        const componentKey = `${uniqueId}-${configHash}-${configKey.length}`;
        
        return (
          <ModuleComponent
            id={uniqueId}
            key={componentKey}
            {...mergedConfig}
            services={serviceBridges}
          />
        );
      })()}
    </ErrorBoundary>
  );
};