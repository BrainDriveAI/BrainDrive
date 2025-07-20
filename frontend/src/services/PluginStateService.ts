import { AbstractBaseService } from './base/BaseService';
import { PluginStateConfig } from './PageContextService';
import { EnhancedPluginStateConfig, stateConfigurationManager } from './StateConfigurationManager';

export interface PluginStateServiceInterface {
  // Configuration management
  configure(config: PluginStateConfig | EnhancedPluginStateConfig): void;
  getConfiguration(): PluginStateConfig | EnhancedPluginStateConfig | null;
  
  // State operations
  saveState(state: any): Promise<void>;
  getState(): Promise<any>;
  clearState(): Promise<void>;
  
  // State validation
  validateState(state: any): boolean;
  sanitizeState(state: any): any;
  
  // Lifecycle hooks
  onSave(callback: (state: any) => void): () => void;
  onRestore(callback: (state: any) => void): () => void;
  onClear(callback: () => void): () => void;
}

class PluginStateServiceImpl extends AbstractBaseService implements PluginStateServiceInterface {
  private config: PluginStateConfig | EnhancedPluginStateConfig | null = null;
  private pageContextService: any = null; // Will be injected
  private saveCallbacks: ((state: any) => void)[] = [];
  private restoreCallbacks: ((state: any) => void)[] = [];
  private clearCallbacks: (() => void)[] = [];
  private static instances: Map<string, PluginStateServiceImpl> = new Map();

  private constructor(pluginId: string) {
    super(
      `pluginState-${pluginId}`,
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'plugin-state-configuration',
          description: 'Plugin state configuration management',
          version: '1.0.0'
        },
        {
          name: 'plugin-state-operations',
          description: 'Plugin state save, restore, and clear operations',
          version: '1.0.0'
        },
        {
          name: 'plugin-state-validation',
          description: 'Plugin state validation and sanitization',
          version: '1.0.0'
        },
        {
          name: 'plugin-state-lifecycle',
          description: 'Plugin state lifecycle event hooks',
          version: '1.0.0'
        }
      ]
    );
  }

  public static getInstance(pluginId: string): PluginStateServiceImpl {
    if (!PluginStateServiceImpl.instances.has(pluginId)) {
      PluginStateServiceImpl.instances.set(pluginId, new PluginStateServiceImpl(pluginId));
    }
    return PluginStateServiceImpl.instances.get(pluginId)!;
  }

  async initialize(): Promise<void> {
    // Import PageContextService to avoid circular dependency
    const { pageContextService } = await import('./PageContextService');
    this.pageContextService = pageContextService;
    console.log(`[PluginStateService] Initialized for plugin ${this.getPluginId()}`);
  }

  async destroy(): Promise<void> {
    // Clean up enhanced configuration manager
    if (this.config) {
      stateConfigurationManager.cleanup(this.config.pluginId);
    }
    
    // Clean up callbacks
    this.saveCallbacks = [];
    this.restoreCallbacks = [];
    this.clearCallbacks = [];
    this.config = null;
    this.pageContextService = null;
    console.log(`[PluginStateService] Destroyed for plugin ${this.getPluginId()}`);
  }

  private getPluginId(): string {
    return this.getName().replace('pluginState-', '');
  }

  configure(config: PluginStateConfig | EnhancedPluginStateConfig): void {
    this.config = config;
    
    // Register configuration with PageContextService
    if (this.pageContextService) {
      this.pageContextService.registerPluginStateConfig(config);
    }
    
    console.log(`[PluginStateService] Configured for plugin ${config.pluginId}`);
  }

  getConfiguration(): PluginStateConfig | EnhancedPluginStateConfig | null {
    return this.config;
  }

  async saveState(state: any): Promise<void> {
    if (!this.config) {
      throw new Error('Plugin state service not configured. Call configure() first.');
    }

    if (!this.pageContextService) {
      throw new Error('PageContextService not available');
    }

    try {
      // Validate state before saving
      if (!this.validateState(state)) {
        throw new Error('State validation failed');
      }

      // Sanitize state
      const sanitizedState = this.sanitizeState(state);

      // Use debounced save if configured
      const saveOperation = async () => {
        try {
          // Save through PageContextService (which now uses enhanced features)
          await this.pageContextService.savePluginState(this.config!.pluginId, sanitizedState);

          // Notify save callbacks
          this.saveCallbacks.forEach(callback => {
            try {
              callback(sanitizedState);
            } catch (error) {
              console.error(`[PluginStateService] Error in save callback:`, error);
            }
          });

          console.log(`[PluginStateService] State saved for plugin ${this.config!.pluginId}`);
        } catch (error) {
          console.error(`[PluginStateService] Error saving state for plugin ${this.config!.pluginId}:`, error);
          throw error;
        }
      };

      // Check if enhanced config has debouncing
      if ('performance' in this.config && this.config.performance?.debounceMs) {
        stateConfigurationManager.executeDebouncedSave(this.config.pluginId, saveOperation);
      } else {
        await saveOperation();
      }

    } catch (error) {
      console.error(`[PluginStateService] Error saving state for plugin ${this.config.pluginId}:`, error);
      throw error;
    }
  }

  async getState(): Promise<any> {
    if (!this.config) {
      throw new Error('Plugin state service not configured. Call configure() first.');
    }

    if (!this.pageContextService) {
      throw new Error('PageContextService not available');
    }

    try {
      const state = await this.pageContextService.getPluginState(this.config.pluginId);

      // Notify restore callbacks if state was found
      if (state !== null) {
        this.restoreCallbacks.forEach(callback => {
          try {
            callback(state);
          } catch (error) {
            console.error(`[PluginStateService] Error in restore callback:`, error);
          }
        });
      }

      console.log(`[PluginStateService] State retrieved for plugin ${this.config.pluginId}`);
      return state;
    } catch (error) {
      console.error(`[PluginStateService] Error retrieving state for plugin ${this.config.pluginId}:`, error);
      throw error;
    }
  }

  async clearState(): Promise<void> {
    if (!this.config) {
      throw new Error('Plugin state service not configured. Call configure() first.');
    }

    if (!this.pageContextService) {
      throw new Error('PageContextService not available');
    }

    try {
      await this.pageContextService.clearPluginState(this.config.pluginId);

      // Notify clear callbacks
      this.clearCallbacks.forEach(callback => {
        try {
          callback();
        } catch (error) {
          console.error(`[PluginStateService] Error in clear callback:`, error);
        }
      });

      console.log(`[PluginStateService] State cleared for plugin ${this.config.pluginId}`);
    } catch (error) {
      console.error(`[PluginStateService] Error clearing state for plugin ${this.config.pluginId}:`, error);
      throw error;
    }
  }

  validateState(state: any): boolean {
    if (!this.config || !this.config.stateSchema) {
      return true; // No schema means no validation required
    }

    try {
      for (const [key, fieldSchema] of Object.entries(this.config.stateSchema)) {
        const value = state[key];
        
        // Check required fields
        if (fieldSchema.required && (value === undefined || value === null)) {
          console.error(`[PluginStateService] Required field '${key}' is missing`);
          return false;
        }
        
        // Skip validation for undefined/null optional fields
        if (value === undefined || value === null) {
          continue;
        }
        
        // Type validation
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== fieldSchema.type) {
          console.error(`[PluginStateService] Type mismatch for field '${key}': expected ${fieldSchema.type}, got ${actualType}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`[PluginStateService] Error validating state:`, error);
      return false;
    }
  }

  sanitizeState(state: any): any {
    if (!this.config || !this.config.stateSchema) {
      return state; // No schema means no sanitization needed
    }

    const sanitized: any = {};
    
    for (const [key, fieldSchema] of Object.entries(this.config.stateSchema)) {
      const value = state[key];
      
      // Handle missing required fields with defaults
      if (fieldSchema.required && (value === undefined || value === null)) {
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        }
        continue;
      }
      
      // Handle optional fields with defaults
      if (value === undefined || value === null) {
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        }
        continue;
      }
      
      // Type coercion for mismatched types
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== fieldSchema.type) {
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        }
        continue;
      }
      
      sanitized[key] = value;
    }
    
    return sanitized;
  }

  onSave(callback: (state: any) => void): () => void {
    this.saveCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.saveCallbacks.indexOf(callback);
      if (index > -1) {
        this.saveCallbacks.splice(index, 1);
      }
    };
  }

  onRestore(callback: (state: any) => void): () => void {
    this.restoreCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.restoreCallbacks.indexOf(callback);
      if (index > -1) {
        this.restoreCallbacks.splice(index, 1);
      }
    };
  }

  onClear(callback: () => void): () => void {
    this.clearCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.clearCallbacks.indexOf(callback);
      if (index > -1) {
        this.clearCallbacks.splice(index, 1);
      }
    };
  }
}

// Factory function to create plugin-specific instances
export function createPluginStateService(pluginId: string): PluginStateServiceImpl {
  return PluginStateServiceImpl.getInstance(pluginId);
}

// Export the service interface for type checking
export { PluginStateServiceImpl };