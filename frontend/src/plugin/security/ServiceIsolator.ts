import { BaseService } from '../../services/base/BaseService';

type ServiceMethod = (...args: any[]) => any;

interface IsolationContext {
  pluginId: string;
  serviceName: string;
  methodName: string;
}

/**
 * Provides service isolation and error boundaries for plugins
 */
export class ServiceIsolator {
  private contexts: Map<string, Set<string>>;
  private errorHandlers: Map<string, (error: Error, context: IsolationContext) => void>;

  constructor() {
    this.contexts = new Map();
    this.errorHandlers = new Map();
  }

  /**
   * Create an isolated service instance for a plugin
   */
  isolateService<T extends BaseService>(pluginId: string, service: T): T {
    const serviceName = service.getName();
    
    // Initialize context tracking
    if (!this.contexts.has(pluginId)) {
      this.contexts.set(pluginId, new Set());
    }
    this.contexts.get(pluginId)!.add(serviceName);

    // Create proxy with isolation boundary
    return new Proxy(service, {
      get: (target: T, prop: string | symbol) => {
        const value = Reflect.get(target, prop);
        
        // Only wrap methods
        if (typeof value !== 'function' || prop === 'getName' || prop === 'getVersion') {
          return value;
        }

        return (...args: any[]) => {
          const context: IsolationContext = {
            pluginId,
            serviceName,
            methodName: prop.toString(),
          };

          try {
            // Execute method in isolation
            const result = this.executeInIsolation(
              () => value.apply(target, args),
              context
            );

            return result;
          } catch (error) {
            // Handle errors within isolation boundary
            this.handleError(error as Error, context);
            throw error;
          }
        };
      },
    });
  }

  /**
   * Register an error handler for a plugin
   */
  registerErrorHandler(
    pluginId: string,
    handler: (error: Error, context: IsolationContext) => void
  ): void {
    this.errorHandlers.set(pluginId, handler);
  }

  /**
   * Clean up isolation contexts for a plugin
   */
  cleanup(pluginId: string): void {
    this.contexts.delete(pluginId);
    this.errorHandlers.delete(pluginId);
  }

  /**
   * Execute a function within an isolation boundary
   */
  private executeInIsolation<T>(
    fn: () => T,
    context: IsolationContext
  ): T {
    // Here we could add additional isolation mechanisms:
    // - Memory isolation using Workers
    // - CPU usage monitoring
    // - Timeout enforcement
    // - Context validation
    
    try {
      return fn();
    } catch (error) {
      this.handleError(error as Error, context);
      throw error;
    }
  }

  /**
   * Handle errors within the isolation boundary
   */
  private handleError(error: Error, context: IsolationContext): void {
    // Add isolation context to error
    const isolatedError = new Error(
      `[Plugin: ${context.pluginId}] [Service: ${context.serviceName}] [Method: ${context.methodName}] ${error.message}`
    );
    isolatedError.name = error.name;
    isolatedError.stack = error.stack;

    // Call plugin-specific error handler if registered
    const handler = this.errorHandlers.get(context.pluginId);
    if (handler) {
      try {
        handler(isolatedError, context);
      } catch (handlerError) {
        console.error('Error in plugin error handler:', handlerError);
      }
    }

    // Log error for monitoring
    console.error(isolatedError);
  }
}
