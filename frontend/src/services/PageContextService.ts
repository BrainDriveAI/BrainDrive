import { AbstractBaseService } from './base/BaseService';
import { StateSerializationUtils } from './StateSerializationUtils';
import { stateConfigurationManager, EnhancedPluginStateConfig } from './StateConfigurationManager';
import { sessionStorageManager } from './SessionStorageManager';
import { databasePersistenceManager } from './DatabasePersistenceManager';
import { stateRestorationManager } from './StateRestorationManager';
import { pluginStateLifecycleManager } from './PluginStateLifecycleManager';

export interface PageContextData {
  pageId: string;
  pageName: string;
  pageRoute: string;
  isStudioPage: boolean;
}

// Plugin state configuration interface
export interface PluginStateConfig {
  pluginId: string;
  stateStrategy: 'none' | 'session' | 'persistent' | 'custom';
  preserveKeys?: string[];
  stateSchema?: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      required?: boolean;
      default?: any;
    };
  };
  serialize?: (state: any) => string;
  deserialize?: (serialized: string) => any;
  maxStateSize?: number;
  ttl?: number;
}

// Enhanced page context data with plugin states
export interface EnhancedPageContextData extends PageContextData {
  pluginStates?: Record<string, any>;
}

export interface PageContextServiceInterface {
  getCurrentPageContext(): PageContextData | null;
  onPageContextChange(callback: (context: PageContextData) => void): () => void;
}

// Enhanced interface with plugin state management
export interface EnhancedPageContextServiceInterface extends PageContextServiceInterface {
  // Plugin state management
  savePluginState(pluginId: string, state: any): Promise<void>;
  getPluginState(pluginId: string): Promise<any>;
  clearPluginState(pluginId: string): Promise<void>;
  
  // Plugin state configuration
  registerPluginStateConfig(config: PluginStateConfig | EnhancedPluginStateConfig): void;
  getPluginStateConfig(pluginId: string): PluginStateConfig | EnhancedPluginStateConfig | null;
  
  // State lifecycle events
  onPluginStateChange(pluginId: string, callback: (state: any) => void): () => void;
  
  // Enhanced Phase 3 methods
  getStorageStats(): any;
  cleanupOldStates(maxAge: number): Promise<number>;
  
  // Phase 4 methods - Database persistence and advanced features
  migrateToDatabase(pluginId: string): Promise<boolean>;
  syncStateAcrossDevices(pluginId: string): Promise<boolean>;
  restoreStateWithFallback(pluginId: string, fallbackData?: any): Promise<any>;
  registerLifecycleHook(pluginId: string, eventType: string, callback: Function): string;
  unregisterLifecycleHook(hookId: string): boolean;
}

class PageContextServiceImpl extends AbstractBaseService implements EnhancedPageContextServiceInterface {
  private currentContext: PageContextData | null = null;
  private listeners: ((context: PageContextData) => void)[] = [];
  private pluginStateConfigs: Map<string, PluginStateConfig> = new Map();
  private pluginStateListeners: Map<string, ((state: any) => void)[]> = new Map();
  private static instance: PageContextServiceImpl;

  private constructor() {
    super(
      'pageContext',
      { major: 1, minor: 1, patch: 0 },
      [
        {
          name: 'page-context-management',
          description: 'Page context tracking and management capabilities',
          version: '1.0.0'
        },
        {
          name: 'page-context-events',
          description: 'Page context change event subscription system',
          version: '1.0.0'
        },
        {
          name: 'plugin-state-management',
          description: 'Plugin state persistence and lifecycle management',
          version: '1.1.0'
        },
        {
          name: 'plugin-state-configuration',
          description: 'Plugin state configuration and validation',
          version: '1.1.0'
        }
      ]
    );
  }

  public static getInstance(): PageContextServiceImpl {
    if (!PageContextServiceImpl.instance) {
      PageContextServiceImpl.instance = new PageContextServiceImpl();
    }
    return PageContextServiceImpl.instance;
  }

  async initialize(): Promise<void> {
    // Initialize the service - no special initialization needed for now
    console.log('[PageContextService] Initialized');
  }

  async destroy(): Promise<void> {
    // Clean up listeners
    this.listeners = [];
    this.currentContext = null;
    console.log('[PageContextService] Destroyed');
  }

  getCurrentPageContext(): PageContextData | null {
    return this.currentContext;
  }

  setPageContext(context: PageContextData): void {
    this.currentContext = context;
    this.listeners.forEach(listener => listener(context));
  }

  onPageContextChange(callback: (context: PageContextData) => void): () => void {
    this.listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Plugin state management methods
  async savePluginState(pluginId: string, state: any): Promise<void> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config || config.stateStrategy === 'none') {
        return;
      }

      // Execute before save hook
      await stateConfigurationManager.executeHook(pluginId, 'beforeSave', state);

      // Apply transformations
      let processedState = await stateConfigurationManager.applyTransformations(
        pluginId,
        state,
        'beforeSave'
      );

      // Filter state using enhanced configuration manager
      processedState = stateConfigurationManager.filterState(pluginId, processedState);

      // Validate and sanitize state
      const validationResult = stateConfigurationManager.validateAndSanitizeState(pluginId, processedState);
      if (!validationResult.valid) {
        console.error(`[PageContextService] State validation failed for plugin ${pluginId}:`, validationResult.errors);
        return;
      }

      if (validationResult.warnings.length > 0) {
        console.warn(`[PageContextService] State validation warnings for plugin ${pluginId}:`, validationResult.warnings);
      }

      processedState = validationResult.sanitizedState || processedState;

      // Use enhanced session storage manager
      const storageOptions = {
        compression: stateConfigurationManager.shouldCompress(pluginId, StateSerializationUtils.calculateStateSize(processedState)),
        compressionThreshold: 1024,
        maxSize: config.maxStateSize,
        enableMetrics: true
      };

      const saveResult = await sessionStorageManager.saveState(pluginId, processedState, storageOptions);
      
      if (!saveResult.success) {
        console.error(`[PageContextService] Failed to save state for plugin ${pluginId}:`, saveResult.error);
        return;
      }

      // Execute after save hook
      await stateConfigurationManager.executeHook(pluginId, 'afterSave', processedState);

      // Notify listeners
      const listeners = this.pluginStateListeners.get(pluginId) || [];
      listeners.forEach(listener => listener(processedState));

      console.log(`[PageContextService] Saved state for plugin ${pluginId} (${saveResult.size} bytes)`);
    } catch (error) {
      console.error(`[PageContextService] Error saving state for plugin ${pluginId}:`, error);
      
      // Execute error hook
      await stateConfigurationManager.executeHook(pluginId, 'onError', error, 'save');
    }
  }

  async getPluginState(pluginId: string): Promise<any> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config || config.stateStrategy === 'none') {
        return null;
      }

      // Execute before load hook
      await stateConfigurationManager.executeHook(pluginId, 'beforeLoad');

      // Use enhanced session storage manager
      const storageOptions = {
        maxAge: config.ttl,
        enableMetrics: true
      };

      const loadResult = await sessionStorageManager.loadState(pluginId, storageOptions);
      
      if (!loadResult.success) {
        console.error(`[PageContextService] Failed to load state for plugin ${pluginId}:`, loadResult.error);
        return null;
      }

      if (!loadResult.data) {
        return null;
      }

      // Apply transformations
      let processedState = await stateConfigurationManager.applyTransformations(
        pluginId,
        loadResult.data,
        'afterLoad'
      );

      // Execute after load hook
      processedState = await stateConfigurationManager.executeHook(pluginId, 'afterLoad', processedState) || processedState;

      console.log(`[PageContextService] Retrieved state for plugin ${pluginId}`);
      return processedState;
    } catch (error) {
      console.error(`[PageContextService] Error retrieving state for plugin ${pluginId}:`, error);
      
      // Execute error hook
      await stateConfigurationManager.executeHook(pluginId, 'onError', error, 'load');
      return null;
    }
  }

  async clearPluginState(pluginId: string): Promise<void> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config || config.stateStrategy === 'none') {
        return;
      }

      // Use enhanced session storage manager
      const clearResult = await sessionStorageManager.clearState(pluginId);
      
      if (!clearResult.success) {
        console.error(`[PageContextService] Failed to clear state for plugin ${pluginId}:`, clearResult.error);
        return;
      }

      // Notify listeners
      const listeners = this.pluginStateListeners.get(pluginId) || [];
      listeners.forEach(listener => listener(null));

      console.log(`[PageContextService] Cleared state for plugin ${pluginId}`);
    } catch (error) {
      console.error(`[PageContextService] Error clearing state for plugin ${pluginId}:`, error);
      
      // Execute error hook
      await stateConfigurationManager.executeHook(pluginId, 'onError', error, 'clear');
    }
  }

  registerPluginStateConfig(config: PluginStateConfig | EnhancedPluginStateConfig): void {
    this.pluginStateConfigs.set(config.pluginId, config);
    
    // Also register with the enhanced configuration manager
    if ('validation' in config || 'transformers' in config || 'hooks' in config) {
      stateConfigurationManager.registerConfig(config as EnhancedPluginStateConfig);
    }
    
    console.log(`[PageContextService] Registered state config for plugin ${config.pluginId}`);
  }

  getPluginStateConfig(pluginId: string): PluginStateConfig | EnhancedPluginStateConfig | null {
    return this.pluginStateConfigs.get(pluginId) || null;
  }

  // Enhanced Phase 3 methods
  getStorageStats(): any {
    return sessionStorageManager.getStorageStats();
  }

  async cleanupOldStates(maxAge: number): Promise<number> {
    return await sessionStorageManager.cleanupOldEntries(maxAge);
  }

  onPluginStateChange(pluginId: string, callback: (state: any) => void): () => void {
    if (!this.pluginStateListeners.has(pluginId)) {
      this.pluginStateListeners.set(pluginId, []);
    }
    
    const listeners = this.pluginStateListeners.get(pluginId)!;
    listeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  // Phase 4 methods - Database persistence and advanced features
  async migrateToDatabase(pluginId: string): Promise<boolean> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config || config.stateStrategy !== 'persistent') {
        return true; // No migration needed
      }

      return await stateRestorationManager.migrateSessionToDatabase(pluginId, config as EnhancedPluginStateConfig);
    } catch (error) {
      console.error(`[PageContextService] Error migrating plugin ${pluginId} to database:`, error);
      return false;
    }
  }

  async syncStateAcrossDevices(pluginId: string): Promise<boolean> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config || config.stateStrategy !== 'persistent') {
        return false;
      }

      const result = await stateRestorationManager.syncStateAcrossDevices(pluginId, config as EnhancedPluginStateConfig);
      return result.success;
    } catch (error) {
      console.error(`[PageContextService] Error syncing plugin ${pluginId} across devices:`, error);
      return false;
    }
  }

  async restoreStateWithFallback(pluginId: string, fallbackData?: any): Promise<any> {
    try {
      const config = this.pluginStateConfigs.get(pluginId);
      if (!config) {
        return fallbackData || null;
      }

      const result = await stateRestorationManager.restoreWithFallback(
        pluginId,
        config as EnhancedPluginStateConfig,
        fallbackData
      );
      
      return result.success ? result.data : fallbackData;
    } catch (error) {
      console.error(`[PageContextService] Error restoring plugin ${pluginId} with fallback:`, error);
      return fallbackData || null;
    }
  }

  registerLifecycleHook(pluginId: string, eventType: string, callback: Function): string {
    try {
      return pluginStateLifecycleManager.registerHook(
        pluginId,
        eventType as any,
        callback as any
      );
    } catch (error) {
      console.error(`[PageContextService] Error registering lifecycle hook for plugin ${pluginId}:`, error);
      return '';
    }
  }

  unregisterLifecycleHook(hookId: string): boolean {
    try {
      return pluginStateLifecycleManager.unregisterHook(hookId);
    } catch (error) {
      console.error(`[PageContextService] Error unregistering lifecycle hook ${hookId}:`, error);
      return false;
    }
  }

  // Helper methods
  private validateAndSanitizeState(state: any, schema: PluginStateConfig['stateSchema']): any {
    if (!schema) return state;

    const sanitized: any = {};
    
    for (const [key, fieldSchema] of Object.entries(schema)) {
      const value = state[key];
      
      // Check if required field is missing
      if (fieldSchema.required && (value === undefined || value === null)) {
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        } else {
          throw new Error(`Required field '${key}' is missing`);
        }
        continue;
      }
      
      // Skip undefined/null optional fields
      if (value === undefined || value === null) {
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        }
        continue;
      }
      
      // Type validation
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== fieldSchema.type) {
        console.warn(`[PageContextService] Type mismatch for field '${key}': expected ${fieldSchema.type}, got ${actualType}`);
        if (fieldSchema.default !== undefined) {
          sanitized[key] = fieldSchema.default;
        }
        continue;
      }
      
      sanitized[key] = value;
    }
    
    return sanitized;
  }

  private filterStateKeys(state: any, preserveKeys: string[]): any {
    const filtered: any = {};
    for (const key of preserveKeys) {
      if (state.hasOwnProperty(key)) {
        filtered[key] = state[key];
      }
    }
    return filtered;
  }
}

export const pageContextService = PageContextServiceImpl.getInstance();