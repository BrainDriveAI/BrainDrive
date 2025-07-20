/**
 * State Configuration Manager for Advanced Plugin State Management
 * Provides enhanced configuration options and state filtering capabilities
 */

import { PluginStateConfig } from './PageContextService';
import { StateSerializationUtils, SerializationOptions } from './StateSerializationUtils';

export interface EnhancedPluginStateConfig extends PluginStateConfig {
  // Advanced filtering options
  excludeKeys?: string[];
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  
  // State transformation options
  transformers?: {
    beforeSave?: (state: any) => any;
    afterLoad?: (state: any) => any;
  };
  
  // Validation options
  validation?: {
    strict?: boolean;
    allowUnknownKeys?: boolean;
    customValidators?: Map<string, (value: any) => boolean>;
  };
  
  // Storage optimization
  compression?: {
    enabled?: boolean;
    threshold?: number; // Compress if state size exceeds this
  };
  
  // Lifecycle hooks
  hooks?: {
    beforeSave?: (state: any) => Promise<any> | any;
    afterSave?: (state: any) => Promise<void> | void;
    beforeLoad?: () => Promise<void> | void;
    afterLoad?: (state: any) => Promise<any> | any;
    onError?: (error: Error, operation: 'save' | 'load' | 'clear') => void;
  };
  
  // Performance options
  performance?: {
    debounceMs?: number; // Debounce save operations
    maxRetries?: number; // Retry failed operations
    timeout?: number; // Operation timeout
  };
}

export interface StateFilterOptions {
  preserveKeys?: string[];
  excludeKeys?: string[];
  includePatterns?: RegExp[];
  excludePatterns?: RegExp[];
  maxDepth?: number;
}

export interface StateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedState?: any;
}

export class StateConfigurationManager {
  private configs: Map<string, EnhancedPluginStateConfig> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Register an enhanced plugin state configuration
   */
  registerConfig(config: EnhancedPluginStateConfig): void {
    // Validate configuration
    const validationResult = this.validateConfig(config);
    if (!validationResult.valid) {
      throw new Error(`Invalid configuration: ${validationResult.errors.join(', ')}`);
    }

    // Set defaults
    const enhancedConfig = this.applyDefaults(config);
    
    this.configs.set(config.pluginId, enhancedConfig);
    console.log(`[StateConfigurationManager] Registered enhanced config for plugin ${config.pluginId}`);
  }

  /**
   * Get configuration for a plugin
   */
  getConfig(pluginId: string): EnhancedPluginStateConfig | null {
    return this.configs.get(pluginId) || null;
  }

  /**
   * Filter state based on configuration
   */
  filterState(pluginId: string, state: any): any {
    const config = this.configs.get(pluginId);
    if (!config) {
      return state;
    }

    const filterOptions: StateFilterOptions = {
      preserveKeys: config.preserveKeys,
      excludeKeys: config.excludeKeys,
      includePatterns: config.includePatterns,
      excludePatterns: config.excludePatterns,
      maxDepth: 10 // Default max depth
    };

    return this.applyStateFilter(state, filterOptions);
  }

  /**
   * Validate and sanitize state according to configuration
   */
  validateAndSanitizeState(pluginId: string, state: any): StateValidationResult {
    const config = this.configs.get(pluginId);
    if (!config) {
      return { valid: true, errors: [], warnings: [] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];
    let sanitizedState = { ...state };

    // Apply schema validation if present
    if (config.stateSchema) {
      const schemaResult = this.validateAgainstSchema(sanitizedState, config.stateSchema);
      errors.push(...schemaResult.errors);
      warnings.push(...schemaResult.warnings);
      sanitizedState = schemaResult.sanitizedState || sanitizedState;
    }

    // Apply custom validators
    if (config.validation?.customValidators) {
      const customResult = this.applyCustomValidators(
        sanitizedState, 
        config.validation.customValidators
      );
      errors.push(...customResult.errors);
      warnings.push(...customResult.warnings);
    }

    // Check for unknown keys if strict validation is enabled
    if (config.validation?.strict && !config.validation?.allowUnknownKeys && config.stateSchema) {
      const unknownKeys = Object.keys(sanitizedState).filter(
        key => !config.stateSchema!.hasOwnProperty(key)
      );
      if (unknownKeys.length > 0) {
        if (config.validation.strict) {
          errors.push(`Unknown keys not allowed: ${unknownKeys.join(', ')}`);
        } else {
          warnings.push(`Unknown keys found: ${unknownKeys.join(', ')}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedState
    };
  }

  /**
   * Apply state transformations
   */
  async applyTransformations(
    pluginId: string, 
    state: any, 
    phase: 'beforeSave' | 'afterLoad'
  ): Promise<any> {
    const config = this.configs.get(pluginId);
    if (!config?.transformers) {
      return state;
    }

    try {
      const transformer = config.transformers[phase];
      if (transformer) {
        return await transformer(state);
      }
      return state;
    } catch (error) {
      console.error(`[StateConfigurationManager] Transformation error for ${pluginId}:`, error);
      return state;
    }
  }

  /**
   * Execute lifecycle hooks
   */
  async executeHook(
    pluginId: string,
    hookName: keyof NonNullable<EnhancedPluginStateConfig['hooks']>,
    ...args: any[]
  ): Promise<any> {
    const config = this.configs.get(pluginId);
    const hook = config?.hooks?.[hookName] as any;
    
    if (!hook) {
      return;
    }

    try {
      return await hook.apply(null, args);
    } catch (error) {
      console.error(`[StateConfigurationManager] Hook ${hookName} error for ${pluginId}:`, error);
      
      // Call error hook if available
      if (config?.hooks?.onError) {
        try {
          await config.hooks.onError(error as Error, hookName as any);
        } catch (hookError) {
          console.error(`[StateConfigurationManager] Error hook failed:`, hookError);
        }
      }
    }
  }

  /**
   * Get serialization options based on configuration
   */
  getSerializationOptions(pluginId: string): SerializationOptions {
    const config = this.configs.get(pluginId);
    if (!config) {
      return {};
    }

    const options: SerializationOptions = {
      maxSize: config.maxStateSize,
      maxDepth: 10 // Default
    };

    // Add custom serializers if provided
    if (config.serialize) {
      options.customSerializers = new Map([
        ['object', config.serialize]
      ]);
    }

    if (config.deserialize) {
      options.customDeserializers = new Map([
        ['object', config.deserialize]
      ]);
    }

    return options;
  }

  /**
   * Check if compression should be used
   */
  shouldCompress(pluginId: string, stateSize: number): boolean {
    const config = this.configs.get(pluginId);
    if (!config?.compression?.enabled) {
      return false;
    }

    const threshold = config.compression.threshold || 1024; // 1KB default
    return stateSize > threshold;
  }

  /**
   * Get debounce delay for save operations
   */
  getDebounceDelay(pluginId: string): number {
    const config = this.configs.get(pluginId);
    return config?.performance?.debounceMs || 0;
  }

  /**
   * Execute debounced operation
   */
  executeDebouncedSave(pluginId: string, saveOperation: () => Promise<void>): void {
    const delay = this.getDebounceDelay(pluginId);
    
    if (delay <= 0) {
      saveOperation();
      return;
    }

    // Clear existing timer
    const existingTimer = this.debounceTimers.get(pluginId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      saveOperation();
      this.debounceTimers.delete(pluginId);
    }, delay);

    this.debounceTimers.set(pluginId, timer);
  }

  /**
   * Clean up resources for a plugin
   */
  cleanup(pluginId: string): void {
    const timer = this.debounceTimers.get(pluginId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(pluginId);
    }
    
    this.configs.delete(pluginId);
  }

  // Private helper methods

  private validateConfig(config: EnhancedPluginStateConfig): StateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.pluginId) {
      errors.push('pluginId is required');
    }

    if (!['none', 'session', 'persistent', 'custom'].includes(config.stateStrategy)) {
      errors.push('Invalid stateStrategy');
    }

    if (config.maxStateSize && config.maxStateSize < 0) {
      errors.push('maxStateSize must be positive');
    }

    if (config.performance?.debounceMs && config.performance.debounceMs < 0) {
      errors.push('debounceMs must be positive');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private applyDefaults(config: EnhancedPluginStateConfig): EnhancedPluginStateConfig {
    return {
      ...config,
      validation: {
        strict: false,
        allowUnknownKeys: true,
        ...config.validation
      },
      compression: {
        enabled: false,
        threshold: 1024,
        ...config.compression
      },
      performance: {
        debounceMs: 0,
        maxRetries: 3,
        timeout: 5000,
        ...config.performance
      }
    };
  }

  private applyStateFilter(state: any, options: StateFilterOptions): any {
    if (!state || typeof state !== 'object') {
      return state;
    }

    const filtered: any = {};

    for (const [key, value] of Object.entries(state)) {
      // Check exclude keys
      if (options.excludeKeys?.includes(key)) {
        continue;
      }

      // Check exclude patterns
      if (options.excludePatterns?.some(pattern => pattern.test(key))) {
        continue;
      }

      // Check preserve keys (if specified, only include these)
      if (options.preserveKeys && options.preserveKeys.length > 0) {
        if (!options.preserveKeys.includes(key)) {
          continue;
        }
      }

      // Check include patterns (if specified, key must match at least one)
      if (options.includePatterns && options.includePatterns.length > 0) {
        if (!options.includePatterns.some(pattern => pattern.test(key))) {
          continue;
        }
      }

      filtered[key] = value;
    }

    return filtered;
  }

  private validateAgainstSchema(
    state: any, 
    schema: NonNullable<PluginStateConfig['stateSchema']>
  ): { errors: string[]; warnings: string[]; sanitizedState: any } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitizedState: any = {};

    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = state[key];

      // Check required fields
      if (fieldSchema.required && (value === undefined || value === null)) {
        if (fieldSchema.default !== undefined) {
          sanitizedState[key] = fieldSchema.default;
          warnings.push(`Using default value for required field '${key}'`);
        } else {
          errors.push(`Required field '${key}' is missing`);
        }
        continue;
      }

      // Skip undefined/null optional fields
      if (value === undefined || value === null) {
        if (fieldSchema.default !== undefined) {
          sanitizedState[key] = fieldSchema.default;
        }
        continue;
      }

      // Type validation
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== fieldSchema.type) {
        if (fieldSchema.default !== undefined) {
          sanitizedState[key] = fieldSchema.default;
          warnings.push(`Type mismatch for field '${key}', using default value`);
        } else {
          errors.push(`Type mismatch for field '${key}': expected ${fieldSchema.type}, got ${actualType}`);
        }
        continue;
      }

      sanitizedState[key] = value;
    }

    return { errors, warnings, sanitizedState };
  }

  private applyCustomValidators(
    state: any,
    validators: Map<string, (value: any) => boolean>
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const [key, validator] of validators.entries()) {
      if (state.hasOwnProperty(key)) {
        try {
          if (!validator(state[key])) {
            errors.push(`Custom validation failed for field '${key}'`);
          }
        } catch (error) {
          warnings.push(`Custom validator error for field '${key}': ${error}`);
        }
      }
    }

    return { errors, warnings };
  }
}

// Export singleton instance
export const stateConfigurationManager = new StateConfigurationManager();