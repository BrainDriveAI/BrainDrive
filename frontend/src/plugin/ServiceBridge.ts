import { BaseService, ServiceCapability } from '../services/base/BaseService';
import { ServiceRegistry } from '../services/ServiceRegistry';

export interface PluginIdentifier {
  typeId: string;    // The plugin type from config (e.g., 'selection-dropdown')
  instanceId: string; // Unique instance ID on the page (e.g., 'dropdown-theme-selector')
}

export interface PluginMetadata {
  identifier: PluginIdentifier;
  version: string;
  requiredCapabilities: string[];
}

export interface ServiceAccessPolicy {
  allowedMethods: string[];
  allowedEvents?: string[];
  rateLimit?: {
    calls: number;
    period: number; // in milliseconds
  };
}

export interface ServiceAccessConfig {
  [serviceName: string]: ServiceAccessPolicy;
}

/**
 * Proxy handler that enforces access controls and monitors service usage
 */
class ServiceProxyHandler implements ProxyHandler<BaseService> {
  private accessPolicy: ServiceAccessPolicy;
  private pluginIdentifier: PluginIdentifier;
  private callCounts: Map<string, { count: number; resetTime: number }>;
  private onChunkCallback?: (chunk: any) => void;

  constructor(
    pluginIdentifier: PluginIdentifier, 
    accessPolicy: ServiceAccessPolicy,
    onChunkCallback?: (chunk: any) => void
  ) {
    this.pluginIdentifier = pluginIdentifier;
    this.accessPolicy = accessPolicy;
    this.callCounts = new Map();
    this.onChunkCallback = onChunkCallback;
  }

  get(target: BaseService, prop: string | symbol, receiver: any): any {
    const methodName = prop.toString();

    // Always allow access to base service methods
    if (['getName', 'getVersion', 'getCapabilities'].includes(methodName)) {
      return Reflect.get(target, prop, receiver);
    }

    // Check if method is allowed
    if (!this.accessPolicy.allowedMethods.includes(methodName)) {
      throw new Error(
        `Plugin ${this.pluginIdentifier.typeId}:${this.pluginIdentifier.instanceId} does not have permission to access method ${methodName}`
      );
    }

    // Check rate limiting
    if (this.accessPolicy.rateLimit) {
      if (!this.checkRateLimit(methodName)) {
        throw new Error(
          `Rate limit exceeded for method ${methodName} in plugin ${this.pluginIdentifier.typeId}:${this.pluginIdentifier.instanceId}`
        );
      }
    }

    // Get the original method
    const method = Reflect.get(target, prop, receiver);
    if (typeof method !== 'function') {
      return method;
    }

    // Return wrapped method to maintain proper 'this' binding and track calls
    return (...args: any[]) => {
      this.trackMethodCall(methodName);
      
      // Special handling for streaming methods
      if (methodName === 'postStreaming' && this.onChunkCallback) {
        // Add the onChunk callback as the third argument
        return method.apply(target, [...args, this.onChunkCallback]);
      }
      
      return method.apply(target, args);
    };
  }

  private checkRateLimit(methodName: string): boolean {
    if (!this.accessPolicy.rateLimit) return true;

    const now = Date.now();
    const callInfo = this.callCounts.get(methodName);

    if (!callInfo || now >= callInfo.resetTime) {
      this.callCounts.set(methodName, {
        count: 1,
        resetTime: now + this.accessPolicy.rateLimit.period,
      });
      return true;
    }

    if (callInfo.count >= this.accessPolicy.rateLimit.calls) {
      return false;
    }

    callInfo.count++;
    return true;
  }

  private trackMethodCall(methodName: string): void {
    // Could be extended to track usage patterns, emit metrics, etc.
    console.debug(`Plugin ${this.pluginIdentifier.typeId}:${this.pluginIdentifier.instanceId} called method ${methodName}`);
  }
}

/**
 * ServiceBridge provides controlled access to services for plugins
 */
export class ServiceBridge {
  private registry: ServiceRegistry;
  private accessConfigs: Map<string, ServiceAccessConfig>;
  private instanceConfigs: Map<string, ServiceAccessConfig>;

  constructor(registry: ServiceRegistry) {
    this.registry = registry;
    this.accessConfigs = new Map();  // For plugin type configs
    this.instanceConfigs = new Map(); // For instance-specific configs
  }

  /**
   * Configure service access for a plugin type
   */
  configurePluginTypeAccess(typeId: string, config: ServiceAccessConfig): void {
    this.accessConfigs.set(typeId, config);
  }

  /**
   * Configure service access for a specific plugin instance
   * This allows overriding the default type configuration
   */
  configurePluginInstanceAccess(instanceId: string, config: ServiceAccessConfig): void {
    this.instanceConfigs.set(instanceId, config);
  }

  /**
   * Get a proxied service instance for a plugin
   */
  getServiceForPlugin<T extends BaseService>(
    identifier: PluginIdentifier,
    serviceName: string
  ): T {
    // Check instance-specific configuration first
    let pluginConfig = this.instanceConfigs.get(identifier.instanceId);
    
    // Fall back to type configuration if no instance-specific config exists
    if (!pluginConfig) {
      pluginConfig = this.accessConfigs.get(identifier.typeId);
    }

    if (!pluginConfig) {
      throw new Error(
        `No access configuration found for plugin type ${identifier.typeId} or instance ${identifier.instanceId}`
      );
    }

    // Get service access policy
    const accessPolicy = pluginConfig[serviceName];
    if (!accessPolicy) {
      throw new Error(
        `Plugin ${identifier.typeId}:${identifier.instanceId} does not have access configuration for service ${serviceName}`
      );
    }

    // Get the actual service
    const service = this.registry.getService<T>(serviceName);

    // Create and return proxied service with both type and instance IDs
    return new Proxy(service, new ServiceProxyHandler(identifier, accessPolicy)) as T;
  }

  /**
   * Verify plugin capabilities against service requirements
   */
  verifyPluginCapabilities(metadata: PluginMetadata): void {
    const missingCapabilities: string[] = [];

    for (const capability of metadata.requiredCapabilities) {
      const services = this.registry.findServicesByCapability(capability);
      if (services.length === 0) {
        missingCapabilities.push(capability);
      }
    }

    if (missingCapabilities.length > 0) {
      throw new Error(
        `Plugin ${metadata.identifier.typeId}:${metadata.identifier.instanceId} requires capabilities that are not available: ${missingCapabilities.join(
          ', '
        )}`
      );
    }
  }

  /**
   * Get a proxied service instance for a plugin with streaming support
   * @param identifier The plugin identifier
   * @param serviceName The service name
   * @param onChunk Callback function to handle streaming chunks
   * @returns Proxied service instance with streaming support
   */
  getStreamingServiceForPlugin<T extends BaseService>(
    identifier: PluginIdentifier,
    serviceName: string,
    onChunk: (chunk: any) => void
  ): T {
    // Check instance-specific configuration first
    let pluginConfig = this.instanceConfigs.get(identifier.instanceId);
    
    // Fall back to type configuration if no instance-specific config exists
    if (!pluginConfig) {
      pluginConfig = this.accessConfigs.get(identifier.typeId);
    }

    if (!pluginConfig) {
      throw new Error(
        `No access configuration found for plugin type ${identifier.typeId} or instance ${identifier.instanceId}`
      );
    }

    // Get service access policy
    const accessPolicy = pluginConfig[serviceName];
    if (!accessPolicy) {
      throw new Error(
        `Plugin ${identifier.typeId}:${identifier.instanceId} does not have access configuration for service ${serviceName}`
      );
    }

    // Make sure postStreaming is allowed
    if (!accessPolicy.allowedMethods.includes('postStreaming')) {
      throw new Error(
        `Plugin ${identifier.typeId}:${identifier.instanceId} does not have permission to access method postStreaming`
      );
    }

    // Get the actual service
    const service = this.registry.getService<T>(serviceName);

    // Create and return proxied service with both type and instance IDs, plus the onChunk callback
    return new Proxy(service, new ServiceProxyHandler(identifier, accessPolicy, onChunk)) as T;
  }

  /**
   * Get available capabilities for a plugin
   */
  getAvailableCapabilities(identifier: PluginIdentifier): ServiceCapability[] {
    // Check instance-specific configuration first
    let pluginConfig = this.instanceConfigs.get(identifier.instanceId);
    
    // Fall back to type configuration
    if (!pluginConfig) {
      pluginConfig = this.accessConfigs.get(identifier.typeId);
    }

    if (!pluginConfig) {
      return [];
    }

    const capabilities: ServiceCapability[] = [];
    for (const [serviceName, policy] of Object.entries(pluginConfig)) {
      const service = this.registry.getService(serviceName);
      capabilities.push(...service.getCapabilities());
    }

    return capabilities;
  }
}
