import { ServiceRequirement } from '../types';

export interface ServiceError {
  serviceName: string;
  error: string;
  severity: 'error' | 'warning';
  timestamp: number;
}

export interface ServiceAvailabilityCheck {
  serviceName: string;
  isAvailable: boolean;
  version?: string;
  capabilities?: string[];
  lastChecked: number;
}

/**
 * Enhanced service bridge with comprehensive error handling and availability checks
 */
export class ServiceBridgeManager {
  private static instance: ServiceBridgeManager;
  private serviceAvailability: Map<string, ServiceAvailabilityCheck> = new Map();
  private errorHistory: ServiceError[] = [];
  private maxErrorHistory = 100;

  static getInstance(): ServiceBridgeManager {
    if (!ServiceBridgeManager.instance) {
      ServiceBridgeManager.instance = new ServiceBridgeManager();
    }
    return ServiceBridgeManager.instance;
  }

  /**
   * Check if a service is available and meets requirements
   */
  checkServiceAvailability(serviceName: string, getService: (name: string) => any): ServiceAvailabilityCheck {
    const timestamp = Date.now();
    
    try {
      let service;
      
      // Special handling for pluginState service - check if pluginStateFactory is available
      if (serviceName === 'pluginState') {
        try {
          const pluginStateFactory = getService('pluginStateFactory');
          service = pluginStateFactory; // If factory exists, pluginState is available
        } catch (error) {
          service = null;
        }
      } else {
        service = getService(serviceName);
      }
      
      if (!service) {
        const check: ServiceAvailabilityCheck = {
          serviceName,
          isAvailable: false,
          lastChecked: timestamp
        };
        this.serviceAvailability.set(serviceName, check);
        return check;
      }

      // Get service metadata if available
      const version = service.getVersion ? service.getVersion() : undefined;
      const capabilities = service.getCapabilities ? service.getCapabilities() : undefined;

      const check: ServiceAvailabilityCheck = {
        serviceName,
        isAvailable: true,
        version: version ? `${version.major}.${version.minor}.${version.patch}` : undefined,
        capabilities,
        lastChecked: timestamp
      };

      this.serviceAvailability.set(serviceName, check);
      return check;
    } catch (error) {
      const check: ServiceAvailabilityCheck = {
        serviceName,
        isAvailable: false,
        lastChecked: timestamp
      };
      this.serviceAvailability.set(serviceName, check);
      
      this.addError({
        serviceName,
        error: error instanceof Error ? error.message : 'Unknown error during availability check',
        severity: 'error',
        timestamp
      });
      
      return check;
    }
  }

  /**
   * Get cached service availability information
   */
  getServiceAvailability(serviceName: string): ServiceAvailabilityCheck | null {
    return this.serviceAvailability.get(serviceName) || null;
  }

  /**
   * Get all service availability information
   */
  getAllServiceAvailability(): ServiceAvailabilityCheck[] {
    return Array.from(this.serviceAvailability.values());
  }

  /**
   * Add an error to the history
   */
  private addError(error: ServiceError): void {
    this.errorHistory.unshift(error);
    if (this.errorHistory.length > this.maxErrorHistory) {
      this.errorHistory = this.errorHistory.slice(0, this.maxErrorHistory);
    }
  }

  /**
   * Get error history
   */
  getErrorHistory(): ServiceError[] {
    return [...this.errorHistory];
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  /**
   * Create a safe method wrapper with error handling
   */
  private createSafeMethodWrapper(
    serviceName: string,
    methodName: string,
    serviceMethod: Function,
    service: any
  ): Function {
    return function(...args: any[]) {
      try {
        const result = serviceMethod.apply(service, args);
        
        // Handle promises with error catching
        if (result && typeof result.then === 'function') {
          return result.catch((error: Error) => {
            const bridgeManager = ServiceBridgeManager.getInstance();
            bridgeManager.addError({
              serviceName,
              error: `Method ${methodName} failed: ${error.message}`,
              severity: 'error',
              timestamp: Date.now()
            });
            console.error(`[ServiceBridge] Promise rejection in ${serviceName}.${methodName}:`, error);
            throw error;
          });
        }
        
        return result;
      } catch (error) {
        const bridgeManager = ServiceBridgeManager.getInstance();
        bridgeManager.addError({
          serviceName,
          error: `Method ${methodName} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'error',
          timestamp: Date.now()
        });
        console.error(`[ServiceBridge] Error in ${serviceName}.${methodName}:`, error);
        throw error;
      }
    };
  }

  /**
   * Create service bridges with enhanced error handling
   */
  createServiceBridges(
    requiredServices: Record<string, ServiceRequirement> | undefined,
    getService: (name: string) => any
  ): { serviceBridges: Record<string, any>; errors: ServiceError[] } {
    const errors: ServiceError[] = [];
    const serviceBridges: Record<string, any> = {};
    
    if (!requiredServices) {
      console.warn('[ServiceBridge] No required services provided');
      return { serviceBridges, errors };
    }
    
    Object.entries(requiredServices).forEach(([serviceName, requirements]) => {
      
      try {
        // Check service availability first
        const availabilityCheck = this.checkServiceAvailability(serviceName, getService);
        
        if (!availabilityCheck.isAvailable) {
          throw new Error(`Service not available: ${serviceName}`);
        }

        const service = getService(serviceName);

        // Validate required methods if specified
        if (requirements.methods) {
          const missingMethods = requirements.methods.filter(
            method => typeof service[method] !== 'function'
          );
          
          if (missingMethods.length > 0) {
            console.error(`[ServiceBridge] Missing methods for ${serviceName}:`, missingMethods);
            throw new Error(
              `Missing required methods: ${missingMethods.join(', ')}`
            );
          }
        }

        // Create a service bridge object with methods that call the actual service
        if (requirements.methods) {
          // Create a new object with just the required methods
          const bridge = requirements.methods.reduce((acc, method) => {
            const serviceMethod = service[method];
            
            // Create a safe wrapper function
            acc[method] = this.createSafeMethodWrapper(serviceName, method, serviceMethod, service);
            return acc;
          }, {} as Record<string, any>);
          
          serviceBridges[serviceName] = bridge;
        } else {
          // If no specific methods are required, use the entire service
          serviceBridges[serviceName] = service;
        }
      } catch (error) {
        const serviceError: ServiceError = {
          serviceName,
          error: error instanceof Error ? error.message : 'Unknown error',
          severity: 'error',
          timestamp: Date.now()
        };
        
        console.error(`[ServiceBridge] Error creating bridge for ${serviceName}:`, error);
        errors.push(serviceError);
        this.addError(serviceError);
      }
    });
    
    return { serviceBridges, errors };
  }
}

/**
 * Legacy function for backward compatibility
 * Creates service bridges based on required services and a service provider function
 * @param requiredServices Map of service names to their requirements
 * @param getService Function to retrieve a service by name
 * @returns Object containing service bridges and any errors encountered
 */
export function createServiceBridges(
  requiredServices: Record<string, ServiceRequirement> | undefined,
  getService: (name: string) => any
): { serviceBridges: Record<string, any>; errors: ServiceError[] } {
  const bridgeManager = ServiceBridgeManager.getInstance();
  return bridgeManager.createServiceBridges(requiredServices, getService);
}

/**
 * Get service availability information
 */
export function getServiceAvailability(serviceName: string): ServiceAvailabilityCheck | null {
  const bridgeManager = ServiceBridgeManager.getInstance();
  return bridgeManager.getServiceAvailability(serviceName);
}

/**
 * Get all service availability information
 */
export function getAllServiceAvailability(): ServiceAvailabilityCheck[] {
  const bridgeManager = ServiceBridgeManager.getInstance();
  return bridgeManager.getAllServiceAvailability();
}

/**
 * Get service bridge error history
 */
export function getServiceBridgeErrors(): ServiceError[] {
  const bridgeManager = ServiceBridgeManager.getInstance();
  return bridgeManager.getErrorHistory();
}

/**
 * Clear service bridge error history
 */
export function clearServiceBridgeErrors(): void {
  const bridgeManager = ServiceBridgeManager.getInstance();
  bridgeManager.clearErrorHistory();
}
