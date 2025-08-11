import { DynamicPluginRenderer } from './DynamicPluginRenderer';
import { LoadedModule } from '../types/remotePlugin';
import { getPluginConfigForInstance, getModuleConfigForInstance, plugins, onPluginRegistryChange } from '../plugins';
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import { debounce } from 'lodash';
import ComponentErrorBoundary from './ComponentErrorBoundary';
import { Box, Typography, CircularProgress } from '@mui/material';
import { remotePluginService } from '../services/remotePluginService';
import { eventBus } from '../plugin/eventBus';
import { ServiceContext } from '../contexts/ServiceContext';
import { createServiceBridges, ServiceError } from '../utils/serviceBridge';

// Import the ModuleStateContext
import ModuleStateContext, { useModuleState } from '../contexts/ModuleStateContext';

/**
 * Component for rendering individual plugin modules anywhere in the application
 */
interface PluginModuleRendererProps {
  pluginId: string;
  moduleId?: string;  // New: Unique identifier for the module
  moduleName?: string;  // Optional for local plugins with single component
  moduleProps?: Record<string, any>;
  fallback?: React.ReactNode;
  // isLocal prop is optional as we can determine it from the plugin config
  isLocal?: boolean;  // Override the automatic detection if needed
}

export const PluginModuleRenderer: React.FC<PluginModuleRendererProps> = ({
  pluginId,
  moduleId,
  moduleName,
  moduleProps = {},
  fallback,
  isLocal
}) => {
  const [module, setModule] = useState<LoadedModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serviceErrors, setServiceErrors] = useState<ServiceError[]>([]);
  
  // Get the service context - this is a reference to the function, not calling the hook
  const serviceContext = useContext(ServiceContext);
  
  // Simple polling approach to check for plugin availability
  const [pluginsAvailable, setPluginsAvailable] = useState(false);
  const [pluginConfig, setPluginConfig] = useState<any>(null);
  
  // Poll for plugin availability every 100ms until plugins are loaded
  useEffect(() => {
    const checkPluginAvailability = () => {
      const currentPlugins = Object.keys(plugins);
      const currentPluginConfig = getPluginConfigForInstance(pluginId);
      
      console.log(`[PluginModuleRenderer] Checking plugin availability for ${pluginId}:`, {
        totalPlugins: currentPlugins.length,
        availablePluginIds: currentPlugins,
        pluginConfigFound: !!currentPluginConfig,
        pluginsAvailable: currentPlugins.length > 0 && !!currentPluginConfig
      });
      
      if (currentPlugins.length > 0 && currentPluginConfig) {
        console.log(`[PluginModuleRenderer] Plugin ${pluginId} is now available!`);
        setPluginsAvailable(true);
        setPluginConfig(currentPluginConfig);
        return true; // Stop polling
      }
      
      return false; // Continue polling
    };
    
    // Check immediately
    if (checkPluginAvailability()) {
      return;
    }
    
    // Poll every 50ms until plugins are available (more frequent)
    const pollInterval = setInterval(() => {
      if (checkPluginAvailability()) {
        clearInterval(pollInterval);
      }
    }, 50);
    
    // Cleanup after 15 seconds to prevent infinite polling
    const timeout = setTimeout(() => {
      clearInterval(pollInterval);
      console.warn(`[PluginModuleRenderer] Timeout waiting for plugin ${pluginId}`);
    }, 15000);
    
    return () => {
      clearInterval(pollInterval);
      clearTimeout(timeout);
    };
  }, [pluginId, plugins]); // Add plugins as dependency to re-run when plugins change
  
  // Get the module state context for state persistence
  const { saveModuleState } = useModuleState();
  
  // Use a ref to track if we're currently updating to prevent infinite loops
  const isUpdatingRef = useRef<boolean>(false);
  
  // Create a getService function that doesn't use hooks directly
  const getService = useCallback((name: string) => {
    if (!serviceContext) {
      throw new Error('Service context not available');
    }
    
    // Special handling for pluginState service - create plugin-specific instance
    if (name === 'pluginState' && pluginId) {
      try {
        const pluginStateFactory = serviceContext.getService('pluginStateFactory') as any;
        
        if (!pluginStateFactory) {
          console.error(`[PluginModuleRenderer] pluginStateFactory service is null/undefined`);
          return null;
        }
        
        // Try to get existing service first, create if it doesn't exist
        let pluginStateService = pluginStateFactory.getPluginStateService(pluginId);
        if (!pluginStateService) {
          pluginStateService = pluginStateFactory.createPluginStateService(pluginId);
        }
        
        return pluginStateService;
      } catch (error) {
        console.error(`[PluginModuleRenderer] Failed to get plugin state service for ${pluginId}:`, error);
        return null;
      }
    }
    
    return serviceContext.getService(name);
  }, [serviceContext, pluginId]);
  
  // Extract state persistence props
  const { initialState, onStateChange, savedState, moduleUniqueId, stateTimestamp } = moduleProps;
  
  // Create a stable reference to moduleProps
  const stableModulePropsRef = useRef(moduleProps);
  
  // Use savedState from props if available (injected by DynamicPageRenderer)
  const initialModuleState = savedState || initialState || null;
  
  // Update the ref when moduleProps changes
  useEffect(() => {
    stableModulePropsRef.current = moduleProps;
  }, [moduleProps]);
  
  // State for the module
  const [moduleState, setModuleState] = useState<any>(initialModuleState);
  
  // Update state when savedState changes (for navigation restoration)
  useEffect(() => {
    if (savedState && !isUpdatingRef.current) {
      isUpdatingRef.current = true;
      setModuleState(savedState);
      
      // Reset the updating flag after a short delay
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [savedState, stateTimestamp, pluginId, moduleId, moduleName]);
  
  
  // Create a stable module ID
  const getStableModuleId = useCallback(() => {
    return `${pluginId}-${moduleId || moduleName}`;
  }, [pluginId, moduleId, moduleName]);
  
  // Store the stable ID in a ref to prevent it from causing re-renders
  const stableModuleIdRef = useRef(getStableModuleId());
  
  // Update the ref when dependencies change
  useEffect(() => {
    stableModuleIdRef.current = getStableModuleId();
  }, [getStableModuleId]);
  
  // Create a debounced version of saveModuleState
  const debouncedSaveModuleState = useCallback(
    debounce((moduleId: string, state: any) => {
      if (!isUpdatingRef.current) {
        isUpdatingRef.current = true;
        
        saveModuleState(moduleId, state);
        
        // Reset the updating flag after a short delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    }, 300),
    [saveModuleState]
  );
  
  // Create a debounced version of onStateChange
  const debouncedOnStateChange = useCallback(
    debounce((state: any) => {
      if (onStateChange && !isUpdatingRef.current) {
        isUpdatingRef.current = true;
        
        onStateChange(state);
        
        // Reset the updating flag after a short delay
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    }, 300),
    [onStateChange]
  );
  
  // Update parent when state changes - with safeguards against infinite loops
  useEffect(() => {
    // Skip if moduleState is null or we're already updating
    if (moduleState === null || isUpdatingRef.current) return;
    
    // Get the stable module ID
    const fullModuleId = stableModuleIdRef.current;
    
    // Save to ModuleStateContext with debounce
    debouncedSaveModuleState(fullModuleId, moduleState);
    
    // Also call the onStateChange prop if provided
    if (onStateChange) {
      debouncedOnStateChange(moduleState);
    }
    
    // If we have a moduleUniqueId, also save the state with that ID
    // This helps with page-specific module state persistence
    if (moduleUniqueId) {
      debouncedSaveModuleState(moduleUniqueId, moduleState);
    }
  }, [moduleState, debouncedSaveModuleState, debouncedOnStateChange, moduleUniqueId]);

  // Use refs to stabilize objects that shouldn't change between renders
  const pluginIdRef = useRef(pluginId);
  const moduleIdRef = useRef(moduleId);
  const moduleNameRef = useRef(moduleName);
  // Create a stable reference to the current module to compare later
  const prevModuleRef = useRef<LoadedModule | null>(module);
  
  // Update refs when props change
  useEffect(() => {
    pluginIdRef.current = pluginId;
    moduleIdRef.current = moduleId;
    moduleNameRef.current = moduleName;
  }, [pluginId, moduleId, moduleName]);
  
  // Memoize the service bridge creation function with stable reference
  const createServiceBridgesWithMemo = useCallback((requiredServices: any) => {
    return createServiceBridges(requiredServices, getService);
  }, [getService]);

  // Create module messaging using eventBus - memoized to prevent recreation on every render
  const moduleMessaging = useMemo(() => {
    const targetId = moduleIdRef.current ? `${pluginIdRef.current}:${moduleIdRef.current}` : pluginIdRef.current;
    
    return {
      messages: [], // No stored messages with event-based approach
      sendMessage: (message: any, to?: string) => {
        const targetModuleId = to || targetId;
        eventBus.emitMessage(targetModuleId, message);
        return message;
      },
      addConnection: (to: string, messageTypes: string[] = []) => {
        return true;
      },
      removeConnection: (to: string) => {
        return true;
      }
    };
  }, []); // Empty dependency array to ensure stable reference

  useEffect(() => {
    // Use a flag to prevent multiple service bridge creations
    let isMounted = true;
    
    const loadModule = async () => {
      console.log(`[PluginModuleRenderer] Starting loadModule for ${pluginId}, moduleId: ${moduleId}, moduleName: ${moduleName}`);
      try {
        if (!isMounted) return;
        console.log(`[PluginModuleRenderer] Setting loading to true for ${pluginId}`);
        setLoading(true);
        setError(null);
        
        
        // First try to get the plugin from the remote service
        const remotePlugin = remotePluginService.getLoadedPlugin(pluginId);
        
        // Determine if the plugin is local (use the override if provided)
        const isLocalPlugin = isLocal !== undefined ? isLocal : !remotePlugin || remotePlugin.islocal === true;
        
        if (isLocalPlugin) {
          // Handle local plugin
          const pluginConfig = getPluginConfigForInstance(pluginId);
          
          if (!pluginConfig) {
            throw new Error(`Local plugin ${pluginId} not found`);
          }
          
          // Check if the plugin has modules
          if (pluginConfig.modules && pluginConfig.modules.length > 0) {
            // Extract the base moduleId from the custom moduleId (e.g., "component-display" from "component-display-2")
            const baseModuleId = moduleId ? moduleId.replace(/-\d+$/, '') : null;
            
            // Find the module by ID first, then by base ID, then by name
            const targetModule = moduleId 
              ? pluginConfig.modules.find(m => m.id === moduleId) ||
                (baseModuleId ? pluginConfig.modules.find(m => m.id === baseModuleId) : null)
              : moduleName
                ? pluginConfig.modules.find(m => m.name === moduleName)
                : pluginConfig.modules[0]; // Default to first module
            
            if (!targetModule) {
              throw new Error(`Module ${moduleId || moduleName} not found in plugin ${pluginId}`);
            }
            
            // Check for required services and create service bridges
            let serviceBridges = {};
            if (targetModule.requiredServices) {
              const { serviceBridges: bridges, errors } = createServiceBridgesWithMemo(
                targetModule.requiredServices
              );
              
              if (errors.length > 0) {
                setServiceErrors(errors);
              } else {
                serviceBridges = bridges;
              }
            }
            
            // For legacy GridItems, add the moduleId to the props
            // Use the custom moduleId if provided, otherwise use the target module's id
            const effectiveModuleId = moduleId || targetModule.id || targetModule.name;
            
            // Extract default values from configFields
            const defaultConfigValues: Record<string, any> = {};
            if (targetModule.configFields) {
              Object.entries(targetModule.configFields).forEach(([key, field]) => {
                if ('default' in field) {
                  defaultConfigValues[key] = field.default;
                }
              });
            }
            
            // Create merged props with proper precedence:
            // 1. Default values from configFields (lowest priority)
            // 2. Module's props object from manifest
            // 3. Saved configuration from module definition's config property (via moduleProps)
            // 4. Layout-specific overrides (via moduleProps)
            const props = {
              ...defaultConfigValues,
              ...(targetModule.props || {}),
              ...moduleProps,
              moduleId: effectiveModuleId,
              // Add services if available
              ...(Object.keys(serviceBridges).length > 0 ? { services: serviceBridges } : {}),
              // Add messaging functions using eventBus
              messages: [],
              sendMessage: moduleMessaging.sendMessage,
              addConnection: moduleMessaging.addConnection,
              removeConnection: moduleMessaging.removeConnection,
              // Add eventBus subscription methods
              subscribe: (callback: (message: any) => void) => {
                const fullId = `${pluginId}:${effectiveModuleId}`;
                eventBus.subscribe(fullId, callback);
                return () => eventBus.unsubscribe(fullId, callback);
              }
            };
            
            // For local modules, we need to use the plugin's component and pass the module name
            const newModule = {
              id: targetModule.id || targetModule.name,
              name: targetModule.name,
              displayName: targetModule.displayName || targetModule.name,
              description: targetModule.description,
              icon: targetModule.icon,
              category: targetModule.category,
              tags: targetModule.tags,
              configFields: targetModule.configFields,
              messages: targetModule.messages,
              priority: targetModule.priority,
              dependencies: targetModule.dependencies,
              layout: targetModule.layout,
              type: targetModule.type,
              component: targetModule.component || (() => <div>Component not found</div>),
              props: {
                ...targetModule.props,
                ...props,
                moduleName: targetModule.name,
                moduleId: effectiveModuleId
              }
            };
            
            // Only update state if the module has changed to prevent re-renders
            if (!prevModuleRef.current || 
                prevModuleRef.current.id !== newModule.id || 
                JSON.stringify(prevModuleRef.current.props) !== JSON.stringify(newModule.props)) {
              prevModuleRef.current = newModule;
              setModule(newModule);
            }
          } else if (pluginConfig.modules && pluginConfig.modules[0] && pluginConfig.modules[0].component) {
            // Legacy plugin with single component in first module
            const firstModule = pluginConfig.modules[0];
            const newModule = {
              id: pluginConfig.id,
              name: moduleName || pluginConfig.id,
              displayName: pluginConfig.name,
              description: pluginConfig.description,
              icon: pluginConfig.icon,
              category: pluginConfig.category,
              // For legacy plugins, use an empty configFields object instead of plugin-level configFields
              configFields: {},
              messages: firstModule.messages,
              priority: firstModule.priority,
              dependencies: firstModule.dependencies,
              layout: firstModule.layout,
              type: firstModule.type,
              component: firstModule.component || (() => <div>Component not found</div>),
              props: {
                // Extract default values from configFields if available
                ...(firstModule.configFields ? Object.entries(firstModule.configFields).reduce((acc, [key, field]) => {
                  if ('default' in field) {
                    acc[key] = field.default;
                  }
                  return acc;
                }, {} as Record<string, any>) : {}),
                // Add module props
                ...(firstModule.props || {}),
                // Add moduleProps (highest priority)
                ...moduleProps,
                // Add messaging functions from context
                ...(moduleMessaging ? {
                  messages: moduleMessaging.messages || [],
                  sendMessage: moduleMessaging.sendMessage,
                  addConnection: moduleMessaging.addConnection,
                  removeConnection: moduleMessaging.removeConnection
                } : {
                  messages: [],
                  sendMessage: () => {},
                  addConnection: () => {},
                  removeConnection: () => {}
                })
              }
            };
            
            // Only update state if the module has changed to prevent re-renders
            if (!prevModuleRef.current || 
                prevModuleRef.current.id !== newModule.id || 
                JSON.stringify(prevModuleRef.current.props) !== JSON.stringify(newModule.props)) {
              prevModuleRef.current = newModule;
              setModule(newModule);
            }
          } else {
            throw new Error(`Plugin ${pluginId} has no component or modules`);
          }
        } else {
          // Handle remote plugin
          if (!remotePlugin) {
            throw new Error(`Remote plugin ${pluginId} not found or not loaded`);
          }
          
          if (!remotePlugin.loadedModules || remotePlugin.loadedModules.length === 0) {
            throw new Error(`Plugin ${pluginId} has no modules`);
          }
          
          // Extract the actual module ID from complex generated IDs
          // Format: PluginName_actualModuleId_timestamp or similar patterns
          let actualModuleId = moduleId;
          let foundModule: LoadedModule | undefined;
          
          if (moduleId) {
            console.log(`[PluginModuleRenderer] Looking for module with ID: "${moduleId}"`);
            console.log(`[PluginModuleRenderer] Available modules:`, remotePlugin.loadedModules.map(m => ({ id: m.id, name: m.name })));
            
            // Try exact match first
            foundModule = remotePlugin.loadedModules.find(m => m.id === moduleId);
            
            if (!foundModule) {
              // Try to extract actual module ID from complex generated ID
              // Pattern: PluginName_actualModuleId_timestamp
              const parts = moduleId.split('_');
              if (parts.length >= 2) {
                // Try the second part (actual module ID)
                actualModuleId = parts[1];
                console.log(`[PluginModuleRenderer] Trying extracted module ID: "${actualModuleId}"`);
                foundModule = remotePlugin.loadedModules.find(m => m.id === actualModuleId);
              }
            }
            
            if (!foundModule) {
              // Try simple pattern removal (original logic)
              const baseModuleId = moduleId.replace(/-\d+$/, '');
              console.log(`[PluginModuleRenderer] Trying base module ID: "${baseModuleId}"`);
              foundModule = remotePlugin.loadedModules.find(m => m.id === baseModuleId);
            }
            
            if (!foundModule) {
              // Try to match by plugin name
              const pluginNameFromId = moduleId.split('_')[0];
              console.log(`[PluginModuleRenderer] Trying plugin name match: "${pluginNameFromId}"`);
              foundModule = remotePlugin.loadedModules.find(m =>
                m.id === pluginNameFromId ||
                m.name === pluginNameFromId ||
                (m.id && m.id.includes(pluginNameFromId))
              );
            }
          } else if (moduleName) {
            foundModule = remotePlugin.loadedModules.find(m => m.name === moduleName);
          } else {
            // Default to first module
            foundModule = remotePlugin.loadedModules[0];
          }
          
          if (!foundModule && remotePlugin.loadedModules.length > 0) {
            // Final fallback: use the first available module
            console.log(`[PluginModuleRenderer] No exact match found, using first available module as fallback`);
            foundModule = remotePlugin.loadedModules[0];
          }
          
          if (!foundModule) {
            throw new Error(`Module ${moduleId || moduleName} not found in plugin ${pluginId}`);
          }
          
          console.log(`[PluginModuleRenderer] Successfully found module:`, {
            id: foundModule.id,
            name: foundModule.name,
            hasComponent: !!foundModule.component,
            componentType: typeof foundModule.component
          });
          
          // Debug the foundModule object - only log in development
          
          // Check for required services and create service bridges
          let serviceBridges = {};
          if (foundModule.requiredServices) {
            
            const { serviceBridges: bridges, errors } = createServiceBridgesWithMemo(
              foundModule.requiredServices
            );
            
            if (process.env.NODE_ENV === 'development') {
            }
            
            if (errors.length > 0) {
              setServiceErrors(errors);
            } else {
              serviceBridges = bridges;
            }
          }
          
          // Use the custom moduleId if provided, otherwise use the found module's id
          const effectiveModuleId = moduleId || foundModule.id;
          
          // Extract default values from configFields
          const defaultConfigValues: Record<string, any> = {};
          if (foundModule.configFields) {
            Object.entries(foundModule.configFields).forEach(([key, field]) => {
              if ('default' in field) {
                defaultConfigValues[key] = field.default;
              }
            });
          }
          
          // Create merged props with proper precedence:
          // 1. Default values from configFields (lowest priority)
          // 2. Module's props object from manifest
          // 3. Saved configuration from module definition's config property (via moduleProps)
          // 4. Layout-specific overrides (via moduleProps)
          const mergedProps = {
            ...defaultConfigValues,
            ...(foundModule.props || {}),
            ...moduleProps,
            // Always include the instance ID in the props
            id: pluginId,
            instanceId: pluginId, // Add explicit instanceId prop
            // Use the effective moduleId
            moduleId: effectiveModuleId,
            // Add services if available
            ...(Object.keys(serviceBridges).length > 0 ? { services: serviceBridges } : {}),
              // Add messaging functions using eventBus
              messages: [],
              sendMessage: moduleMessaging.sendMessage,
              addConnection: moduleMessaging.addConnection,
              removeConnection: moduleMessaging.removeConnection,
              // Add eventBus subscription methods
              subscribe: (callback: (message: any) => void) => {
                const fullId = `${pluginId}:${effectiveModuleId}`;
                eventBus.subscribe(fullId, callback);
                return () => eventBus.unsubscribe(fullId, callback);
              }
          };
          
          
          // Check if the module has actually changed before updating state
          const newModule = {
            ...foundModule,
            props: mergedProps
          };
          
          // Only update state if the module has changed to prevent re-renders
          // Use a more targeted comparison to avoid unnecessary updates
          const shouldUpdate = !prevModuleRef.current ||
              prevModuleRef.current.id !== newModule.id ||
              // Compare only essential props to avoid unnecessary updates
              JSON.stringify(getEssentialProps(prevModuleRef.current.props)) !==
              JSON.stringify(getEssentialProps(newModule.props));
              
          if (shouldUpdate) {
            console.log(`[PluginModuleRenderer] Updating module for ${pluginId}:`, {
              moduleId: newModule.id,
              moduleName: newModule.name,
              hasComponent: !!newModule.component,
              componentType: typeof newModule.component,
              componentName: newModule.component?.name
            });
            prevModuleRef.current = newModule;
            setModule(newModule);
          } else {
            console.log(`[PluginModuleRenderer] Skipping module update for ${pluginId} (no changes detected)`);
          }
        }
      } catch (err) {
        console.error(`[PluginModuleRenderer] Error loading module for ${pluginId}:`, err);
        setError(err instanceof Error ? err.message : 'Unknown error loading module');
      } finally {
        console.log(`[PluginModuleRenderer] Setting loading to false for ${pluginId}`);
        setLoading(false);
      }
    };

    // Helper function to extract only essential props for comparison
    // This helps prevent unnecessary re-renders due to non-essential prop changes
    const getEssentialProps = (props: any) => {
      if (!props) return {};
      
      // Extract only the properties we care about for comparison
      // Exclude functions, event handlers, and other non-serializable props
      const {
        sendMessage, addConnection, removeConnection, subscribe,
        services, moduleMessaging, ...essentialProps
      } = props;
      
      return essentialProps;
    };
    
    loadModule();
    
    // Cleanup function to prevent updates after unmount
    return () => {
      isMounted = false;
    };
  }, [pluginId, moduleId, moduleName, isLocal, createServiceBridgesWithMemo]);
  
  // Helper function to extract only essential props for comparison
  const getEssentialPropsStable = (props: any) => {
    if (!props) return {};
    const result: Record<string, any> = {};
    
    // Only include primitive values and simple objects
    Object.entries(props).forEach(([key, value]) => {
      if (
        typeof value !== 'function' &&
        key !== 'services' &&
        key !== 'moduleMessaging' &&
        !key.startsWith('on') && // Skip event handlers
        key !== 'sendMessage' &&
        key !== 'addConnection' &&
        key !== 'removeConnection' &&
        key !== 'subscribe'
      ) {
        result[key] = value;
      }
    });
    
    return result;
  };
  
  // Use a separate effect with a more stable comparison to prevent infinite loops
  useEffect(() => {
    // Skip initial render and only run when module is loaded
    if (!module || !prevModuleRef.current) return;
    
    // Only check for changes every 500ms to prevent rapid updates
    const checkPropsChanges = () => {
      // Ensure prevModuleRef.current is not null before accessing properties
      if (!prevModuleRef.current) return;
      
      const currentProps = getEssentialPropsStable(stableModulePropsRef.current);
      const prevProps = getEssentialPropsStable(prevModuleRef.current.props);
      
      // Use a more reliable comparison that's less likely to cause false positives
      let hasChanged = false;
      const currentKeys = Object.keys(currentProps);
      const prevKeys = Object.keys(prevProps);
      
      // If different number of keys, something changed
      if (currentKeys.length !== prevKeys.length) {
        hasChanged = true;
      } else {
        // Check each key for changes
        for (const key of currentKeys) {
          if (JSON.stringify(currentProps[key]) !== JSON.stringify(prevProps[key])) {
            hasChanged = true;
            break;
          }
        }
      }
      
      if (hasChanged && prevModuleRef.current) {
        // Only update if there's a significant change and prevModuleRef.current is not null
        prevModuleRef.current = {
          ...prevModuleRef.current,
          props: {
            ...prevModuleRef.current.props,
            ...stableModulePropsRef.current
          }
        };
      }
    };
    
    // Run the check once
    checkPropsChanges();
    
    // Don't include moduleProps in dependencies to prevent infinite loops
  }, [module, pluginId, moduleId, moduleName]);
  // Removed moduleProps from dependencies to prevent infinite loops
  // WARNING: This could cause stale props if moduleProps changes but effect doesn't re-run

  // Show loading state if plugins aren't available yet
  if (!pluginsAvailable && !pluginConfig) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%" p={2}>
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ ml: 1 }}>
          Loading plugins...
        </Typography>
      </Box>
    );
  }

  if (loading) {
    console.log(`[PluginModuleRenderer] Still loading for ${pluginId}, showing fallback`);
    return fallback || <Box display="flex" justifyContent="center" alignItems="center" height="100%"><CircularProgress /></Box>;
  }

  if (serviceErrors.length > 0) {
    return fallback || (
      <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" height="100%" p={2}>
        <Typography variant="h6" color="error">Failed to initialize module services:</Typography>
        {serviceErrors.map(({ serviceName, error }, index) => (
          <Typography key={index} variant="body2" color="error">
            {serviceName}: {error}
          </Typography>
        ))}
      </Box>
    );
  }

  if (error || !module) {
    console.log(`[PluginModuleRenderer] Rendering error state for ${pluginId}:`, { error, hasModule: !!module });
    return fallback || (
      <Box display="flex" justifyContent="center" alignItems="center" height="100%">
        <Typography variant="h6" color="error">Error: {error || 'No module found'}</Typography>
      </Box>
    );
  }

  console.log(`[PluginModuleRenderer] Rendering module for ${pluginId}:`, {
    moduleId: module.id,
    moduleName: module.name,
    hasComponent: !!module.component,
    componentType: typeof module.component,
    componentName: module.component?.name,
    propsKeys: Object.keys(module.props || {})
  });

  return (
    <ComponentErrorBoundary>
      <DynamicPluginRenderer
        module={{
          ...module,
          props: {
            ...module.props,
            // Pass module-specific messaging if available
            moduleMessaging: moduleMessaging || undefined,
            // No state management needed
          }
        }}
        fallback={fallback}
      />
    </ComponentErrorBoundary>
  );
};
