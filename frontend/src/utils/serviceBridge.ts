import { ServiceRequirement } from '../types';

export interface ServiceError {
  serviceName: string;
  error: string;
}

/**
 * Creates service bridges based on required services and a service provider function
 * @param requiredServices Map of service names to their requirements
 * @param getService Function to retrieve a service by name
 * @returns Object containing service bridges and any errors encountered
 */
export function createServiceBridges(
  requiredServices: Record<string, ServiceRequirement> | undefined,
  getService: (name: string) => any
): { serviceBridges: Record<string, any>; errors: ServiceError[] } {
  const errors: ServiceError[] = [];
  const serviceBridges: Record<string, any> = {};
  
  // console.log('[ServiceBridge] Creating service bridges for:', requiredServices);
  
  if (!requiredServices) {
    console.warn('[ServiceBridge] No required services provided');
    return { serviceBridges, errors };
  }
  
  Object.entries(requiredServices).forEach(([serviceName, requirements]) => {
    // console.log(`[ServiceBridge] Processing service: ${serviceName}`, requirements);
    
    try {
      // Get the service instance - this should be a pre-initialized service object, not a hook
      const service = getService(serviceName);
      
      // console.log(`[ServiceBridge] Service ${serviceName} retrieved:`, service ? 'Found' : 'Not Found');
      
      if (!service) {
        throw new Error(`Service not found`);
      }

      // Validate required methods if specified
      if (requirements.methods) {
        // console.log(`[ServiceBridge] Validating methods for ${serviceName}:`, requirements.methods);
        
        const missingMethods = requirements.methods.filter(
          method => typeof service[method] !== 'function'
        );
        
        if (missingMethods.length > 0) {
          console.error(`[ServiceBridge] Missing methods for ${serviceName}:`, missingMethods);
          throw new Error(
            `Missing required methods: ${missingMethods.join(', ')}`
          );
        } else {
          // console.log(`[ServiceBridge] All required methods found for ${serviceName}`);
        }
      }

      // Create a service bridge object with methods that call the actual service
      if (requirements.methods) {
        // Create a new object with just the required methods
        const bridge = requirements.methods.reduce((acc, method) => {
          // Store a reference to the method to avoid capturing 'this'
          const serviceMethod = service[method];
          // console.log(`[ServiceBridge] Creating bridge for method: ${method}`);
          
          // Create a wrapper function that calls the service method
          acc[method] = function(...args: any[]) {
            // console.log(`[ServiceBridge] Calling bridged method ${serviceName}.${method} with args:`, args);
            return serviceMethod.apply(service, args);
          };
          return acc;
        }, {} as Record<string, any>);
        
        serviceBridges[serviceName] = bridge;
        // console.log(`[ServiceBridge] Service bridge created for ${serviceName}:`, Object.keys(bridge));
      } else {
        // If no specific methods are required, use the entire service
        serviceBridges[serviceName] = service;
        // console.log(`[ServiceBridge] Full service used for ${serviceName} (no specific methods required)`);
      }
    } catch (error) {
      console.error(`[ServiceBridge] Error creating bridge for ${serviceName}:`, error);
      errors.push({
        serviceName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
  
  // console.log('[ServiceBridge] Final service bridges:', Object.keys(serviceBridges));
  // console.log('[ServiceBridge] Errors:', errors);
  
  return { serviceBridges, errors };
}
