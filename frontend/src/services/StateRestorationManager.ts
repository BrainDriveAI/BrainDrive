import { AbstractBaseService } from './base/BaseService';
import { EnhancedPluginStateConfig } from './StateConfigurationManager';
import { databasePersistenceManager, DatabaseStateRecord } from './DatabasePersistenceManager';
import { sessionStorageManager } from './SessionStorageManager';

export interface RestorationOptions {
  preferDatabase?: boolean;
  fallbackToSession?: boolean;
  pageSpecific?: boolean;
  pageId?: string; // Page ID for page-specific state
  stateKey?: string; // State key for namespaced state
  includeInactive?: boolean;
  maxAge?: number; // Maximum age in milliseconds
}

export interface RestorationResult {
  success: boolean;
  data?: any;
  source: 'database' | 'session' | 'default' | 'none';
  partial?: boolean;
  errors?: string[];
  metadata?: {
    lastAccessed?: string;
    version?: number;
    deviceId?: string;
    stateSize?: number;
  };
}

export interface StateRestorationManagerInterface {
  // Core restoration methods
  restorePluginState(pluginId: string, config: EnhancedPluginStateConfig, options?: RestorationOptions): Promise<RestorationResult>;
  restorePartialState(pluginId: string, keys: string[], config: EnhancedPluginStateConfig, options?: RestorationOptions): Promise<RestorationResult>;
  
  // Fallback and recovery methods
  restoreWithFallback(pluginId: string, config: EnhancedPluginStateConfig, fallbackData?: any): Promise<RestorationResult>;
  recoverFromCorruption(pluginId: string, config: EnhancedPluginStateConfig): Promise<RestorationResult>;
  
  // Migration and sync methods
  migrateSessionToDatabase(pluginId: string, config: EnhancedPluginStateConfig): Promise<boolean>;
  syncStateAcrossDevices(pluginId: string, config: EnhancedPluginStateConfig): Promise<RestorationResult>;
  
  // Validation and cleanup
  validateRestoredState(state: any, config: EnhancedPluginStateConfig): boolean;
  cleanupStaleStates(maxAge: number): Promise<number>;
}

class StateRestorationManagerImpl extends AbstractBaseService implements StateRestorationManagerInterface {
  private restorationCache: Map<string, { data: any; timestamp: number; source: string }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super(
      'state-restoration-manager',
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'state-restoration',
          description: 'Plugin state restoration with fallback mechanisms',
          version: '1.0.0'
        },
        {
          name: 'cross-device-sync',
          description: 'Cross-device state synchronization',
          version: '1.0.0'
        },
        {
          name: 'migration-support',
          description: 'Session to database migration support',
          version: '1.0.0'
        }
      ]
    );
  }

  async initialize(): Promise<void> {
    console.log('State restoration manager initialized');
    
    // Start periodic cleanup of cache
    setInterval(() => {
      this.cleanupCache();
    }, this.CACHE_TTL);
  }

  async destroy(): Promise<void> {
    this.restorationCache.clear();
    console.log('State restoration manager destroyed');
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.restorationCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.restorationCache.delete(key);
      }
    }
  }

  private getCacheKey(pluginId: string, pageId?: string, stateKey?: string): string {
    return `${pluginId}:${pageId || 'global'}:${stateKey || 'default'}`;
  }

  private getCachedState(pluginId: string, pageId?: string, stateKey?: string): any {
    const cacheKey = this.getCacheKey(pluginId, pageId, stateKey);
    const cached = this.restorationCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    
    return null;
  }

  private setCachedState(pluginId: string, data: any, source: string, pageId?: string, stateKey?: string): void {
    const cacheKey = this.getCacheKey(pluginId, pageId, stateKey);
    this.restorationCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
      source
    });
  }

  async restorePluginState(
    pluginId: string, 
    config: EnhancedPluginStateConfig, 
    options: RestorationOptions = {}
  ): Promise<RestorationResult> {
    try {
      // Check cache first
      const cachedState = this.getCachedState(pluginId, options.pageSpecific ? options.pageId : undefined, options.stateKey);
      if (cachedState) {
        return {
          success: true,
          data: cachedState,
          source: 'session', // Cache is considered session-level
          metadata: { stateSize: JSON.stringify(cachedState).length }
        };
      }

      // Determine restoration strategy based on config and options
      const preferDatabase = options.preferDatabase ?? (config.stateStrategy === 'persistent');
      const fallbackToSession = options.fallbackToSession ?? true;

      let result: RestorationResult;

      if (preferDatabase) {
        result = await this.restoreFromDatabase(pluginId, config, options);
        
        if (!result.success && fallbackToSession) {
          result = await this.restoreFromSession(pluginId, config, options);
        }
      } else {
        result = await this.restoreFromSession(pluginId, config, options);
        
        if (!result.success && config.stateStrategy === 'persistent') {
          result = await this.restoreFromDatabase(pluginId, config, options);
        }
      }

      // Apply fallback to default values if restoration failed
      if (!result.success) {
        result = this.restoreFromDefaults(config);
      }

      // Validate restored state
      if (result.success && result.data) {
        const isValid = this.validateRestoredState(result.data, config);
        if (!isValid) {
          result = this.restoreFromDefaults(config);
          result.partial = true;
          result.errors = ['State validation failed, using defaults'];
        }
      }

      // Cache successful restoration
      if (result.success && result.data) {
        this.setCachedState(
          pluginId, 
          result.data, 
          result.source,
          options.pageSpecific ? config.pageId : undefined
        );
      }

      return result;

    } catch (error) {
      console.error('State restoration error:', error);
      return {
        success: false,
        source: 'none',
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  private async restoreFromDatabase(
    pluginId: string, 
    config: EnhancedPluginStateConfig, 
    options: RestorationOptions
  ): Promise<RestorationResult> {
    try {
      const loadResult = await databasePersistenceManager.loadState(pluginId, {
        pageId: options.pageSpecific ? options.pageId : undefined,
        includeInactive: options.includeInactive
      });

      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          source: 'database',
          errors: [loadResult.error || 'No database state found']
        };
      }

      // Check age if specified
      if (options.maxAge && loadResult.record) {
        const stateAge = Date.now() - new Date(loadResult.record.last_accessed).getTime();
        if (stateAge > options.maxAge) {
          return {
            success: false,
            source: 'database',
            errors: ['State too old']
          };
        }
      }

      return {
        success: true,
        data: loadResult.data,
        source: 'database',
        metadata: loadResult.record ? {
          lastAccessed: loadResult.record.last_accessed,
          version: loadResult.record.version,
          deviceId: loadResult.record.device_id,
          stateSize: loadResult.record.state_size
        } : undefined
      };

    } catch (error) {
      return {
        success: false,
        source: 'database',
        errors: [error instanceof Error ? error.message : 'Database error']
      };
    }
  }

  private async restoreFromSession(
    pluginId: string, 
    config: EnhancedPluginStateConfig, 
    options: RestorationOptions
  ): Promise<RestorationResult> {
    try {
      const loadResult = await sessionStorageManager.loadState(pluginId, {
        maxAge: options.maxAge
      });

      if (!loadResult.success || !loadResult.data) {
        return {
          success: false,
          source: 'session',
          errors: [loadResult.error || 'No session state found']
        };
      }

      return {
        success: true,
        data: loadResult.data,
        source: 'session',
        metadata: {
          stateSize: JSON.stringify(loadResult.data).length
        }
      };

    } catch (error) {
      return {
        success: false,
        source: 'session',
        errors: [error instanceof Error ? error.message : 'Session error']
      };
    }
  }

  private restoreFromDefaults(config: EnhancedPluginStateConfig): RestorationResult {
    try {
      const defaultState: any = {};

      // Apply schema defaults
      if (config.stateSchema) {
        Object.entries(config.stateSchema).forEach(([key, schema]) => {
          if (schema.default !== undefined) {
            defaultState[key] = schema.default;
          }
        });
      }

      return {
        success: true,
        data: defaultState,
        source: 'default'
      };

    } catch (error) {
      return {
        success: false,
        source: 'default',
        errors: [error instanceof Error ? error.message : 'Default restoration error']
      };
    }
  }

  async restorePartialState(
    pluginId: string, 
    keys: string[], 
    config: EnhancedPluginStateConfig, 
    options: RestorationOptions = {}
  ): Promise<RestorationResult> {
    try {
      // First restore full state
      const fullResult = await this.restorePluginState(pluginId, config, options);
      
      if (!fullResult.success || !fullResult.data) {
        return fullResult;
      }

      // Extract only requested keys
      const partialData: any = {};
      const errors: string[] = [];

      keys.forEach(key => {
        if (fullResult.data.hasOwnProperty(key)) {
          partialData[key] = fullResult.data[key];
        } else {
          // Try to get default value from schema
          if (config.stateSchema?.[key]?.default !== undefined) {
            partialData[key] = config.stateSchema[key].default;
          } else {
            errors.push(`Key '${key}' not found in state`);
          }
        }
      });

      return {
        success: true,
        data: partialData,
        source: fullResult.source,
        partial: true,
        errors: errors.length > 0 ? errors : undefined,
        metadata: fullResult.metadata
      };

    } catch (error) {
      return {
        success: false,
        source: 'none',
        partial: true,
        errors: [error instanceof Error ? error.message : 'Partial restoration error']
      };
    }
  }

  async restoreWithFallback(
    pluginId: string, 
    config: EnhancedPluginStateConfig, 
    fallbackData?: any
  ): Promise<RestorationResult> {
    try {
      // Try normal restoration first
      const result = await this.restorePluginState(pluginId, config);
      
      if (result.success) {
        return result;
      }

      // Use provided fallback data
      if (fallbackData) {
        const isValid = this.validateRestoredState(fallbackData, config);
        return {
          success: true,
          data: isValid ? fallbackData : this.restoreFromDefaults(config).data,
          source: 'default',
          partial: !isValid,
          errors: isValid ? undefined : ['Fallback data validation failed, using defaults']
        };
      }

      // Use schema defaults as final fallback
      return this.restoreFromDefaults(config);

    } catch (error) {
      return {
        success: false,
        source: 'none',
        errors: [error instanceof Error ? error.message : 'Fallback restoration error']
      };
    }
  }

  async recoverFromCorruption(
    pluginId: string, 
    config: EnhancedPluginStateConfig
  ): Promise<RestorationResult> {
    try {
      console.warn(`Attempting corruption recovery for plugin: ${pluginId}`);

      // Try to restore from database history if available
      // This would require additional API endpoints for history access
      
      // For now, clear corrupted state and restore defaults
      await sessionStorageManager.clearState(pluginId);
      
      if (config.stateStrategy === 'persistent') {
        await databasePersistenceManager.clearState(pluginId);
      }

      // Clear cache
      this.restorationCache.delete(this.getCacheKey(pluginId));

      // Restore from defaults
      const result = this.restoreFromDefaults(config);
      result.errors = ['State corruption detected, restored from defaults'];

      return result;

    } catch (error) {
      return {
        success: false,
        source: 'none',
        errors: [error instanceof Error ? error.message : 'Corruption recovery error']
      };
    }
  }

  async migrateSessionToDatabase(
    pluginId: string, 
    config: EnhancedPluginStateConfig
  ): Promise<boolean> {
    try {
      if (config.stateStrategy !== 'persistent') {
        return true; // No migration needed
      }

      return await databasePersistenceManager.migrateFromSession(pluginId);

    } catch (error) {
      console.error('Migration error:', error);
      return false;
    }
  }

  async syncStateAcrossDevices(
    pluginId: string, 
    config: EnhancedPluginStateConfig
  ): Promise<RestorationResult> {
    try {
      if (config.stateStrategy !== 'persistent') {
        return {
          success: false,
          source: 'none',
          errors: ['Cross-device sync requires persistent strategy']
        };
      }

      // Get latest state from database
      const result = await this.restoreFromDatabase(pluginId, config, {
        includeInactive: false
      });

      if (result.success) {
        // Update cache with synced state
        this.setCachedState(pluginId, result.data, 'database');
      }

      return result;

    } catch (error) {
      return {
        success: false,
        source: 'none',
        errors: [error instanceof Error ? error.message : 'Sync error']
      };
    }
  }

  validateRestoredState(state: any, config: EnhancedPluginStateConfig): boolean {
    try {
      if (!state || typeof state !== 'object') {
        return false;
      }

      // Validate against schema if provided
      if (config.stateSchema) {
        for (const [key, schema] of Object.entries(config.stateSchema)) {
          if (schema.required && !(key in state)) {
            return false;
          }

          if (key in state) {
            const value = state[key];
            const expectedType = schema.type;

            // Type validation
            if (expectedType === 'array' && !Array.isArray(value)) {
              return false;
            } else if (expectedType === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
              return false;
            } else if (expectedType !== 'array' && expectedType !== 'object' && typeof value !== expectedType) {
              return false;
            }
          }
        }
      }

      // Custom validation if provided
      if (config.validation?.customValidators) {
        for (const [key, validator] of config.validation.customValidators.entries()) {
          if (key in state && !validator(state[key])) {
            return false;
          }
        }
      }

      return true;

    } catch (error) {
      console.error('State validation error:', error);
      return false;
    }
  }

  async cleanupStaleStates(maxAge: number): Promise<number> {
    try {
      let cleanedCount = 0;

      // Cleanup database states
      cleanedCount += await databasePersistenceManager.cleanupExpiredStates();

      // Cleanup session states (this would need to be implemented in SessionStorageManager)
      // cleanedCount += await sessionStorageManager.cleanupStaleStates(maxAge);

      // Cleanup cache
      this.cleanupCache();

      return cleanedCount;

    } catch (error) {
      console.error('Cleanup error:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const stateRestorationManager = new StateRestorationManagerImpl();
export default stateRestorationManager;