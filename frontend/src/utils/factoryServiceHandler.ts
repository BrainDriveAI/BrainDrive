/**
 * Factory Service Handler Implementation
 * 
 * This module provides handlers for factory-based services that require
 * plugin-specific instances.
 */

import {
  FactoryServiceHandler,
  FactoryServiceConfig,
  ServiceBridgeContext,
  FACTORY_SERVICE_CONFIGS,
  PluginContext
} from '../types/serviceFactory';

/**
 * Base implementation for factory service handlers
 */
export abstract class BaseFactoryServiceHandler implements FactoryServiceHandler {
  protected config: FactoryServiceConfig;

  constructor(config: FactoryServiceConfig) {
    this.config = config;
  }

  canHandle(serviceName: string): boolean {
    return serviceName === this.config.pluginServiceName;
  }

  getConfig(): FactoryServiceConfig {
    return this.config;
  }

  abstract createService(serviceName: string, context: ServiceBridgeContext): any;
}

/**
 * Handler for PluginState factory service
 */
export class PluginStateFactoryHandler extends BaseFactoryServiceHandler {
  constructor() {
    super(FACTORY_SERVICE_CONFIGS.pluginState);
  }

  createService(serviceName: string, context: ServiceBridgeContext): any {
    try {
      // Get the factory service from the registry
      const factory = context.getService(this.config.factoryServiceName);
      
      if (!factory) {
        throw new Error(`Factory service '${this.config.factoryServiceName}' not found in registry`);
      }

      // Validate plugin context
      if (!context.pluginId) {
        throw new Error(`Plugin ID is required for creating ${serviceName} service`);
      }

      // Create plugin-specific service instance
      const createMethod = this.config.createMethodName || 'createPluginService';
      
      if (typeof factory[createMethod] !== 'function') {
        throw new Error(`Factory service '${this.config.factoryServiceName}' does not have method '${createMethod}'`);
      }

      console.log(`[FactoryServiceHandler] Creating ${serviceName} service for plugin: ${context.pluginId}`);
      
      // Call the factory method with plugin ID
      const pluginService = factory[createMethod](context.pluginId);
      
      if (!pluginService) {
        throw new Error(`Factory method '${createMethod}' returned null/undefined for plugin: ${context.pluginId}`);
      }

      console.log(`[FactoryServiceHandler] Successfully created ${serviceName} service for plugin: ${context.pluginId}`);
      return pluginService;

    } catch (error) {
      console.error(`[FactoryServiceHandler] Error creating ${serviceName} service:`, error);
      throw error;
    }
  }
}

/**
 * Registry for factory service handlers
 */
export class FactoryServiceRegistry {
  private handlers: Map<string, FactoryServiceHandler> = new Map();
  private static instance: FactoryServiceRegistry;

  private constructor() {
    // Register built-in handlers
    this.registerHandler(new PluginStateFactoryHandler());
  }

  static getInstance(): FactoryServiceRegistry {
    if (!FactoryServiceRegistry.instance) {
      FactoryServiceRegistry.instance = new FactoryServiceRegistry();
    }
    return FactoryServiceRegistry.instance;
  }

  /**
   * Register a factory service handler
   */
  registerHandler(handler: FactoryServiceHandler): void {
    const config = handler.getConfig();
    this.handlers.set(config.pluginServiceName, handler);
    console.log(`[FactoryServiceRegistry] Registered handler for service: ${config.pluginServiceName}`);
  }

  /**
   * Get handler for a service name
   */
  getHandler(serviceName: string): FactoryServiceHandler | null {
    return this.handlers.get(serviceName) || null;
  }

  /**
   * Check if a service is handled by a factory
   */
  isFactoryService(serviceName: string): boolean {
    return this.handlers.has(serviceName);
  }

  /**
   * Get all registered factory service names
   */
  getFactoryServiceNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Create a service using the appropriate factory handler
   */
  createFactoryService(serviceName: string, context: ServiceBridgeContext): any {
    const handler = this.getHandler(serviceName);
    
    if (!handler) {
      throw new Error(`No factory handler registered for service: ${serviceName}`);
    }

    if (!handler.canHandle(serviceName)) {
      throw new Error(`Handler for ${serviceName} cannot handle this service`);
    }

    return handler.createService(serviceName, context);
  }
}

/**
 * Utility functions for factory service handling
 */
export const factoryServiceUtils = {
  /**
   * Check if a service name requires factory handling
   */
  isFactoryService(serviceName: string): boolean {
    const registry = FactoryServiceRegistry.getInstance();
    return registry.isFactoryService(serviceName);
  },

  /**
   * Create a factory service with proper error handling
   */
  createFactoryService(serviceName: string, context: ServiceBridgeContext): any {
    const registry = FactoryServiceRegistry.getInstance();
    return registry.createFactoryService(serviceName, context);
  },

  /**
   * Get factory service configuration
   */
  getFactoryConfig(serviceName: string): FactoryServiceConfig | null {
    const registry = FactoryServiceRegistry.getInstance();
    const handler = registry.getHandler(serviceName);
    return handler ? handler.getConfig() : null;
  },

  /**
   * Validate plugin context for factory service creation
   */
  validatePluginContext(context: PluginContext, serviceName: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!context.pluginId) {
      errors.push(`Plugin ID is required for ${serviceName} service`);
    }

    if (context.pluginId && typeof context.pluginId !== 'string') {
      errors.push(`Plugin ID must be a string for ${serviceName} service`);
    }

    if (context.pluginId && context.pluginId.trim().length === 0) {
      errors.push(`Plugin ID cannot be empty for ${serviceName} service`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
};

// Export singleton instance
export const factoryServiceRegistry = FactoryServiceRegistry.getInstance();