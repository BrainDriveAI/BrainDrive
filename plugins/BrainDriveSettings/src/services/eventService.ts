/**
 * Interface for event messages that are sent between plugins
 */
export interface EventMessage<T = any> {
  type: string;
  source: {
    pluginId: string;
    moduleId: string;
    isRemote: boolean;
  };
  target: {
    pluginId?: string;
    moduleId: string;
    isRemote: boolean;
  };
  content: T;
  timestamp: string;
  id: string; // Unique message ID
}

/**
 * Options for sending and subscribing to messages
 */
export interface EventOptions {
  remote: boolean;
  persist?: boolean;
}

/**
 * Interface for the EventService bridge that plugins can use
 * This keeps the plugin decoupled from the actual service implementation
 */
interface EventServiceBridge {
  sendMessage: <T>(targetModuleId: string, message: T, options?: { remote: boolean, persist?: boolean }) => void;
  subscribeToMessages: <T>(moduleId: string, callback: (message: T) => void, options?: { remote: boolean, persist?: boolean }) => void;
  unsubscribeFromMessages: <T>(moduleId: string, callback: (message: T) => void, options?: { remote: boolean, persist?: boolean }) => void;
}

/**
 * This is a wrapper around the EventService bridge that provides plugin-specific context
 * It automatically sets the source plugin and module IDs for messages
 */
class PluginEventService {
  private pluginId: string;
  private moduleId: string;
  private serviceBridge?: EventServiceBridge;
  
  constructor(pluginId: string, moduleId: string) {
    this.pluginId = pluginId;
    this.moduleId = moduleId;
  }
  
  /**
   * Set the service bridge
   * @param bridge The EventService bridge
   */
  setServiceBridge(bridge: EventServiceBridge) {
    this.serviceBridge = bridge;
  }
  
  /**
   * Send a message to a target module
   * @param targetModuleId The ID of the target module
   * @param message The message to send
   * @param options Options for sending the message
   */
  sendMessage<T>(targetModuleId: string, message: T, options: EventOptions = { remote: false }) {
    if (!this.serviceBridge) {
      console.error('EventService bridge not set');
      return;
    }
    
    // Add source information to the message
    const messageWithSource = {
      ...message,
      _source: {
        pluginId: this.pluginId,
        moduleId: this.moduleId
      }
    };
    
    console.log(`PluginEventService - sendMessage - from ${this.pluginId}/${this.moduleId} to ${targetModuleId}`, messageWithSource);
    
    // Use the service bridge to send the message
    this.serviceBridge.sendMessage(targetModuleId, messageWithSource, options);
  }
  
  /**
   * Subscribe to messages for this module
   * @param callback The callback function to call when a message is received
   * @param options Options for subscribing to messages
   */
  subscribeToMessages<T>(callback: (message: T) => void, options: EventOptions = { remote: false }) {
    if (!this.serviceBridge) {
      console.error('EventService bridge not set');
      return;
    }
    
    // Use the service bridge to subscribe to messages for this module
    this.serviceBridge.subscribeToMessages(this.moduleId, callback, options);
  }
  
  /**
   * Unsubscribe from messages for this module
   * @param callback The callback function to remove
   * @param options Options for unsubscribing from messages
   */
  unsubscribeFromMessages<T>(callback: (message: T) => void, options: EventOptions = { remote: false }) {
    if (!this.serviceBridge) {
      console.error('EventService bridge not set');
      return;
    }
    
    // Use the service bridge to unsubscribe from messages for this module
    this.serviceBridge.unsubscribeFromMessages(this.moduleId, callback, options);
  }
  
  /**
   * Create a new instance of PluginEventService for a different module
   * @param moduleId The ID of the module
   * @returns A new PluginEventService instance
   */
  forModule(moduleId: string): PluginEventService {
    const service = new PluginEventService(this.pluginId, moduleId);
    if (this.serviceBridge) {
      service.setServiceBridge(this.serviceBridge);
    }
    return service;
  }
}

// Export a factory function to create PluginEventService instances
export const createEventService = (pluginId: string, moduleId: string) => {
  return new PluginEventService(pluginId, moduleId);
};

// Export a default instance for the plugin
export const eventService = new PluginEventService('pluginA', 'default');

// No need to re-export types as they are already defined in this file
