/**
 * Service Factory Pattern Types
 * 
 * This module defines the interfaces and types for factory-based services
 * that require plugin-specific instances.
 */

export interface PluginContext {
  pluginId: string;
  moduleId?: string;
  instanceId?: string;
  metadata?: Record<string, any>;
}

export interface ServiceFactory<T = any> {
  /**
   * Create a plugin-specific service instance
   */
  createPluginService(context: PluginContext): T;
  
  /**
   * Get an existing plugin-specific service instance
   */
  getPluginService(pluginId: string): T | null;
  
  /**
   * Destroy a plugin-specific service instance
   */
  destroyPluginService(pluginId: string): Promise<void>;
  
  /**
   * List all active plugin services
   */
  listActivePlugins(): string[];
}

export interface FactoryServiceConfig {
  /**
   * The name of the factory service in the service registry
   */
  factoryServiceName: string;
  
  /**
   * The name that plugins expect to find the service under
   */
  pluginServiceName: string;
  
  /**
   * Method name to call on the factory to create plugin-specific instances
   */
  createMethodName?: string;
  
  /**
   * Whether the service requires plugin context for creation
   */
  requiresContext: boolean;
  
  /**
   * Whether to cache plugin-specific instances
   */
  cacheInstances?: boolean;
  
  /**
   * Maximum number of instances to cache per plugin
   */
  maxCacheSize?: number;
}

export interface ServiceBridgeContext extends PluginContext {
  /**
   * Function to get services from the main registry
   */
  getService: (name: string) => any;
  
  /**
   * Additional context data
   */
  additionalContext?: Record<string, any>;
}

export interface FactoryServiceHandler {
  /**
   * Check if this handler can process the given service name
   */
  canHandle(serviceName: string): boolean;
  
  /**
   * Create a plugin-specific service instance
   */
  createService(serviceName: string, context: ServiceBridgeContext): any;
  
  /**
   * Get configuration for this factory service
   */
  getConfig(): FactoryServiceConfig;
}

/**
 * Built-in factory service configurations
 */
export const FACTORY_SERVICE_CONFIGS: Record<string, FactoryServiceConfig> = {
  pluginState: {
    factoryServiceName: 'pluginStateFactory',
    pluginServiceName: 'pluginState',
    createMethodName: 'createPluginStateService',
    requiresContext: true,
    cacheInstances: true,
    maxCacheSize: 1 // One instance per plugin
  }
};

/**
 * Service bridge enhancement options
 */
export interface ServiceBridgeOptions {
  /**
   * Enable factory service support
   */
  enableFactoryServices?: boolean;
  
  /**
   * Enable service caching
   */
  enableCaching?: boolean;
  
  /**
   * Enable performance monitoring
   */
  enableMonitoring?: boolean;
  
  /**
   * Enable detailed error logging
   */
  enableDetailedLogging?: boolean;
  
  /**
   * Custom factory service handlers
   */
  customFactoryHandlers?: FactoryServiceHandler[];
}

/**
 * Service creation result
 */
export interface ServiceCreationResult {
  service: any;
  isFactoryService: boolean;
  factoryConfig?: FactoryServiceConfig;
  creationTime: number;
  pluginContext?: PluginContext;
}

/**
 * Service bridge metrics
 */
export interface ServiceBridgeMetrics {
  totalServicesCreated: number;
  factoryServicesCreated: number;
  regularServicesCreated: number;
  averageCreationTime: number;
  errorCount: number;
  cacheHitRate: number;
}