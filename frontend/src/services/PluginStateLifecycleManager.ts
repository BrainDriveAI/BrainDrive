import { AbstractBaseService } from './base/BaseService';
import { EnhancedPluginStateConfig } from './StateConfigurationManager';

// Lifecycle event types
export type LifecycleEventType = 'beforeSave' | 'afterSave' | 'beforeLoad' | 'afterLoad' | 'beforeClear' | 'afterClear' | 'onError' | 'onStateChange';

// Lifecycle event data
export interface LifecycleEventData {
  pluginId: string;
  eventType: LifecycleEventType;
  state?: any;
  previousState?: any;
  error?: Error;
  operation?: 'save' | 'load' | 'clear';
  metadata?: {
    timestamp: number;
    source: 'session' | 'database' | 'default';
    deviceId?: string;
    version?: number;
  };
}

// Lifecycle hook callback
export type LifecycleHookCallback = (data: LifecycleEventData) => Promise<any> | any;

// Hook registration options
export interface HookRegistrationOptions {
  priority?: number; // Higher priority hooks run first
  once?: boolean; // Run only once
  condition?: (data: LifecycleEventData) => boolean; // Conditional execution
}

// Hook registration result
export interface HookRegistration {
  id: string;
  pluginId: string;
  eventType: LifecycleEventType;
  callback: LifecycleHookCallback;
  options: HookRegistrationOptions;
  registeredAt: number;
}

// State change event
export interface StateChangeEvent {
  pluginId: string;
  oldState: any;
  newState: any;
  changeType: 'create' | 'update' | 'delete' | 'restore';
  source: 'session' | 'database' | 'default';
  timestamp: number;
}

// Validation callback
export type StateValidationCallback = (state: any, config: EnhancedPluginStateConfig) => Promise<boolean> | boolean;

export interface PluginStateLifecycleManagerInterface {
  // Hook registration
  registerHook(pluginId: string, eventType: LifecycleEventType, callback: LifecycleHookCallback, options?: HookRegistrationOptions): string;
  unregisterHook(hookId: string): boolean;
  unregisterAllHooks(pluginId: string): number;
  
  // Hook execution
  executeHooks(eventType: LifecycleEventType, data: LifecycleEventData): Promise<any[]>;
  executeHooksForPlugin(pluginId: string, eventType: LifecycleEventType, data: LifecycleEventData): Promise<any[]>;
  
  // State change notifications
  notifyStateChange(event: StateChangeEvent): Promise<void>;
  
  // Validation hooks
  registerValidationCallback(pluginId: string, callback: StateValidationCallback): string;
  unregisterValidationCallback(callbackId: string): boolean;
  executeValidation(pluginId: string, state: any, config: EnhancedPluginStateConfig): Promise<boolean>;
  
  // Hook management
  getRegisteredHooks(pluginId?: string): HookRegistration[];
  clearExpiredHooks(): number;
}

class PluginStateLifecycleManagerImpl extends AbstractBaseService implements PluginStateLifecycleManagerInterface {
  private hooks: Map<string, HookRegistration> = new Map();
  private validationCallbacks: Map<string, { pluginId: string; callback: StateValidationCallback; registeredAt: number }> = new Map();
  private hookIdCounter = 0;
  private callbackIdCounter = 0;

  constructor() {
    super(
      'plugin-state-lifecycle-manager',
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'lifecycle-hooks',
          description: 'Plugin state lifecycle hook management',
          version: '1.0.0'
        },
        {
          name: 'state-validation',
          description: 'Plugin state validation callbacks',
          version: '1.0.0'
        },
        {
          name: 'change-notifications',
          description: 'State change notification system',
          version: '1.0.0'
        }
      ]
    );
  }

  async initialize(): Promise<void> {
    console.log('Plugin state lifecycle manager initialized');
    
    // Start periodic cleanup of expired hooks
    setInterval(() => {
      this.clearExpiredHooks();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  async destroy(): Promise<void> {
    this.hooks.clear();
    this.validationCallbacks.clear();
    console.log('Plugin state lifecycle manager destroyed');
  }

  private generateHookId(): string {
    return `hook_${++this.hookIdCounter}_${Date.now()}`;
  }

  private generateCallbackId(): string {
    return `callback_${++this.callbackIdCounter}_${Date.now()}`;
  }

  registerHook(
    pluginId: string, 
    eventType: LifecycleEventType, 
    callback: LifecycleHookCallback, 
    options: HookRegistrationOptions = {}
  ): string {
    const hookId = this.generateHookId();
    
    const registration: HookRegistration = {
      id: hookId,
      pluginId,
      eventType,
      callback,
      options: {
        priority: options.priority || 0,
        once: options.once || false,
        condition: options.condition
      },
      registeredAt: Date.now()
    };

    this.hooks.set(hookId, registration);
    
    console.log(`[LifecycleManager] Registered ${eventType} hook for plugin ${pluginId} (ID: ${hookId})`);
    
    return hookId;
  }

  unregisterHook(hookId: string): boolean {
    const removed = this.hooks.delete(hookId);
    if (removed) {
      console.log(`[LifecycleManager] Unregistered hook ${hookId}`);
    }
    return removed;
  }

  unregisterAllHooks(pluginId: string): number {
    let removedCount = 0;
    
    for (const [hookId, registration] of this.hooks.entries()) {
      if (registration.pluginId === pluginId) {
        this.hooks.delete(hookId);
        removedCount++;
      }
    }
    
    console.log(`[LifecycleManager] Unregistered ${removedCount} hooks for plugin ${pluginId}`);
    
    return removedCount;
  }

  async executeHooks(eventType: LifecycleEventType, data: LifecycleEventData): Promise<any[]> {
    // Get all hooks for this event type
    const relevantHooks = Array.from(this.hooks.values())
      .filter(hook => hook.eventType === eventType)
      .sort((a, b) => (b.options.priority || 0) - (a.options.priority || 0)); // Higher priority first

    const results: any[] = [];
    const hooksToRemove: string[] = [];

    for (const hook of relevantHooks) {
      try {
        // Check condition if provided
        if (hook.options.condition && !hook.options.condition(data)) {
          continue;
        }

        // Execute hook
        const result = await Promise.resolve(hook.callback(data));
        results.push(result);

        // Mark for removal if it's a one-time hook
        if (hook.options.once) {
          hooksToRemove.push(hook.id);
        }

      } catch (error) {
        console.error(`[LifecycleManager] Error executing hook ${hook.id}:`, error);
        
        // Notify error hooks
        if (eventType !== 'onError') {
          await this.executeHooks('onError', {
            ...data,
            eventType: 'onError',
            error: error instanceof Error ? error : new Error(String(error)),
            operation: this.getOperationFromEventType(eventType)
          });
        }
      }
    }

    // Remove one-time hooks
    hooksToRemove.forEach(hookId => this.hooks.delete(hookId));

    return results;
  }

  async executeHooksForPlugin(
    pluginId: string, 
    eventType: LifecycleEventType, 
    data: LifecycleEventData
  ): Promise<any[]> {
    // Get hooks for specific plugin and event type
    const relevantHooks = Array.from(this.hooks.values())
      .filter(hook => hook.pluginId === pluginId && hook.eventType === eventType)
      .sort((a, b) => (b.options.priority || 0) - (a.options.priority || 0));

    const results: any[] = [];
    const hooksToRemove: string[] = [];

    for (const hook of relevantHooks) {
      try {
        // Check condition if provided
        if (hook.options.condition && !hook.options.condition(data)) {
          continue;
        }

        // Execute hook
        const result = await Promise.resolve(hook.callback(data));
        results.push(result);

        // Mark for removal if it's a one-time hook
        if (hook.options.once) {
          hooksToRemove.push(hook.id);
        }

      } catch (error) {
        console.error(`[LifecycleManager] Error executing plugin hook ${hook.id}:`, error);
        
        // Notify error hooks for this plugin
        if (eventType !== 'onError') {
          await this.executeHooksForPlugin(pluginId, 'onError', {
            ...data,
            eventType: 'onError',
            error: error instanceof Error ? error : new Error(String(error)),
            operation: this.getOperationFromEventType(eventType)
          });
        }
      }
    }

    // Remove one-time hooks
    hooksToRemove.forEach(hookId => this.hooks.delete(hookId));

    return results;
  }

  async notifyStateChange(event: StateChangeEvent): Promise<void> {
    const eventData: LifecycleEventData = {
      pluginId: event.pluginId,
      eventType: 'onStateChange',
      state: event.newState,
      previousState: event.oldState,
      metadata: {
        timestamp: event.timestamp,
        source: event.source
      }
    };

    // Execute global state change hooks
    await this.executeHooks('onStateChange', eventData);
    
    // Execute plugin-specific state change hooks
    await this.executeHooksForPlugin(event.pluginId, 'onStateChange', eventData);
  }

  registerValidationCallback(pluginId: string, callback: StateValidationCallback): string {
    const callbackId = this.generateCallbackId();
    
    this.validationCallbacks.set(callbackId, {
      pluginId,
      callback,
      registeredAt: Date.now()
    });
    
    console.log(`[LifecycleManager] Registered validation callback for plugin ${pluginId} (ID: ${callbackId})`);
    
    return callbackId;
  }

  unregisterValidationCallback(callbackId: string): boolean {
    const removed = this.validationCallbacks.delete(callbackId);
    if (removed) {
      console.log(`[LifecycleManager] Unregistered validation callback ${callbackId}`);
    }
    return removed;
  }

  async executeValidation(pluginId: string, state: any, config: EnhancedPluginStateConfig): Promise<boolean> {
    // Get validation callbacks for this plugin
    const relevantCallbacks = Array.from(this.validationCallbacks.values())
      .filter(cb => cb.pluginId === pluginId);

    // If no custom validation callbacks, return true
    if (relevantCallbacks.length === 0) {
      return true;
    }

    try {
      // Execute all validation callbacks
      const validationResults = await Promise.all(
        relevantCallbacks.map(cb => Promise.resolve(cb.callback(state, config)))
      );

      // All validations must pass
      return validationResults.every(result => result === true);

    } catch (error) {
      console.error(`[LifecycleManager] Error executing validation for plugin ${pluginId}:`, error);
      return false;
    }
  }

  getRegisteredHooks(pluginId?: string): HookRegistration[] {
    const allHooks = Array.from(this.hooks.values());
    
    if (pluginId) {
      return allHooks.filter(hook => hook.pluginId === pluginId);
    }
    
    return allHooks;
  }

  clearExpiredHooks(): number {
    // This could be extended to support TTL for hooks
    // For now, just remove hooks that are marked as 'once' and have been executed
    // (they would have been removed during execution)
    return 0;
  }

  private getOperationFromEventType(eventType: LifecycleEventType): 'save' | 'load' | 'clear' {
    if (eventType.includes('Save')) return 'save';
    if (eventType.includes('Load')) return 'load';
    if (eventType.includes('Clear')) return 'clear';
    return 'save'; // Default
  }

  // Convenience methods for common lifecycle events
  async executeSaveHooks(pluginId: string, state: any, previousState?: any): Promise<any> {
    const beforeResults = await this.executeHooksForPlugin(pluginId, 'beforeSave', {
      pluginId,
      eventType: 'beforeSave',
      state,
      previousState,
      metadata: { timestamp: Date.now(), source: 'session' }
    });

    // If any beforeSave hook returns a modified state, use it
    const modifiedState = beforeResults.find(result => result !== undefined) || state;

    return modifiedState;
  }

  async executeAfterSaveHooks(pluginId: string, state: any): Promise<void> {
    await this.executeHooksForPlugin(pluginId, 'afterSave', {
      pluginId,
      eventType: 'afterSave',
      state,
      metadata: { timestamp: Date.now(), source: 'session' }
    });
  }

  async executeLoadHooks(pluginId: string, state: any): Promise<any> {
    await this.executeHooksForPlugin(pluginId, 'beforeLoad', {
      pluginId,
      eventType: 'beforeLoad',
      metadata: { timestamp: Date.now(), source: 'session' }
    });

    const afterResults = await this.executeHooksForPlugin(pluginId, 'afterLoad', {
      pluginId,
      eventType: 'afterLoad',
      state,
      metadata: { timestamp: Date.now(), source: 'session' }
    });

    // If any afterLoad hook returns a modified state, use it
    return afterResults.find(result => result !== undefined) || state;
  }

  async executeClearHooks(pluginId: string, state?: any): Promise<void> {
    await this.executeHooksForPlugin(pluginId, 'beforeClear', {
      pluginId,
      eventType: 'beforeClear',
      state,
      metadata: { timestamp: Date.now(), source: 'session' }
    });

    await this.executeHooksForPlugin(pluginId, 'afterClear', {
      pluginId,
      eventType: 'afterClear',
      metadata: { timestamp: Date.now(), source: 'session' }
    });
  }
}

// Export singleton instance
export const pluginStateLifecycleManager = new PluginStateLifecycleManagerImpl();
export default pluginStateLifecycleManager;