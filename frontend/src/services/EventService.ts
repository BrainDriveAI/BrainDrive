import { eventBus } from '../plugin/eventBus';
import { AbstractBaseService } from './base/BaseService';

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
 * EventService provides a unified API for local and remote plugin communication
 * It wraps the existing EventBus for local communication and adds support for remote plugins
 */
class EventService extends AbstractBaseService {
  private localEventBus = eventBus;
  private remoteConnections = new Map<string, any>(); // Connection handlers for remote plugins
  private messageQueue: EventMessage[] = []; // Queue for messages that need to be delivered later
  private static instance: EventService;
  private options: { persistence: boolean };
  
  private constructor(options = { persistence: false }) {
    super(
      'event',
      { major: 1, minor: 0, patch: 0 },
      [
        {
          name: 'event-messaging',
          description: 'Plugin-to-plugin messaging capabilities',
          version: '1.0.0'
        },
        {
          name: 'remote-messaging',
          description: 'Remote plugin communication',
          version: '1.0.0'
        }
      ]
    );
    
    this.options = options;
  }
  
  public static getInstance(): EventService {
    if (!EventService.instance) {
      EventService.instance = new EventService();
    }
    return EventService.instance;
  }
  
  async initialize(): Promise<void> {
    // Initialize and connect to remote communication channel
    this.setupRemoteEventHandling();
    
    // Bridge local EventBus to EventService
    this.bridgeLocalEventBus();
    
    //console.log('EventService initialized');
  }
  
  async destroy(): Promise<void> {
    // Clean up connections and listeners
    this.remoteConnections.clear();
    this.messageQueue = [];
    //console.log('EventService destroyed');
  }
  
  /**
   * Send a message to a target module (local or remote)
   * @param targetModuleId The ID of the target module
   * @param message The message to send
   * @param options Options for sending the message
   */
  sendMessage<T>(targetModuleId: string, message: T, options: EventOptions = { remote: false }) {
    // Check if the message has _source information
    const hasSourceInfo = typeof message === 'object' && message !== null && '_source' in message;
    
    const eventMessage: EventMessage<T> = {
      type: typeof message === 'object' && message !== null && 'type' in message 
        ? (message as any).type 
        : 'generic.message',
      source: {
        // Use _source information if available, otherwise use default values
        pluginId: hasSourceInfo ? (message as any)._source.pluginId : 'current-plugin-id',
        moduleId: hasSourceInfo ? (message as any)._source.moduleId : 'current-module-id',
        isRemote: false
      },
      target: {
        moduleId: targetModuleId,
        isRemote: options.remote
      },
      content: message,
      timestamp: new Date().toISOString(),
      id: this.generateUniqueId()
    };
    
    if (options.remote) {
      this.sendRemoteMessage(eventMessage);
    } else {
      // Try local first, if not found and remote option not specified, try remote
      const hasLocalSubscribers = this.sendLocalMessage(eventMessage);
      if (!hasLocalSubscribers && !options.remote) {
        this.sendRemoteMessage(eventMessage);
      }
    }

    // Store message in queue if persistence is enabled
    if (options.persist || this.options.persistence) {
      this.messageQueue.push(eventMessage);
    }
  }
  
  /**
   * Subscribe to messages for a specific module
   * @param moduleId The ID of the module to subscribe to
   * @param callback The callback function to call when a message is received
   * @param options Options for subscribing to messages
   */
  subscribeToMessages<T>(moduleId: string, callback: (message: T) => void, options: EventOptions = { remote: false }) {
    if (options.remote) {
      this.subscribeToRemoteMessages(moduleId, callback);
    } else {
      this.subscribeToLocalMessages(moduleId, callback);
    }

    // If persistence is enabled, send any queued messages for this module
    if ((options.persist || this.options.persistence) && this.messageQueue.length > 0) {
      const queuedMessages = this.messageQueue.filter(msg => msg.target.moduleId === moduleId);
      queuedMessages.forEach(msg => {
        callback(msg.content as T);
      });
    }
  }
  
  /**
   * Unsubscribe from messages for a specific module
   * @param moduleId The ID of the module to unsubscribe from
   * @param callback The callback function to remove
   * @param options Options for unsubscribing from messages
   */
  unsubscribeFromMessages<T>(moduleId: string, callback: (message: T) => void, options: EventOptions = { remote: false }) {
    if (options.remote) {
      this.unsubscribeFromRemoteMessages(moduleId, callback);
    } else {
      this.unsubscribeFromLocalMessages(moduleId, callback);
    }
  }
  
  /**
   * Send a message to a local module
   * @param eventMessage The message to send
   * @returns Whether the message was delivered to any subscribers
   */
  private sendLocalMessage<T>(eventMessage: EventMessage<T>): boolean {
    const { target, content } = eventMessage;
    // Use the existing EventBus to emit the message
    try {
      //console.log(`EventService - sendLocalMessage - target.moduleId: ${target.moduleId}`, content);
      this.localEventBus.emitMessage(target.moduleId, content);
      return true;
    } catch (error) {
      //console.error('Error sending local message:', error);
      return false;
    }
  }
  
  /**
   * Send a message to a remote module
   * @param eventMessage The message to send
   */
  private sendRemoteMessage<T>(eventMessage: EventMessage<T>) {
    // Implement remote message sending logic
    // This could use WebSockets, Server-Sent Events, or other transport mechanisms
    //console.log('Sending remote message:', eventMessage);
    
    // For now, we'll use the local event bus for "remote" messages as well
    // This allows components to communicate even without a real remote connection
    try {
      this.localEventBus.emitMessage(eventMessage.target.moduleId, eventMessage.content);
      return true;
    } catch (error) {
      console.error('Error sending remote message via local event bus:', error);
      
      // Fall back to the original remote connection logic
      const connection = this.remoteConnections.get(eventMessage.target.moduleId);
      if (connection) {
        connection.send(JSON.stringify(eventMessage));
      } else {
        console.warn(`No remote connection found for module ${eventMessage.target.moduleId}`);
        // Queue the message for later delivery if persistence is enabled
        if (this.options.persistence) {
          this.messageQueue.push(eventMessage);
        }
      }
      return false;
    }
  }
  
  /**
   * Subscribe to messages from a local module
   * @param moduleId The ID of the module to subscribe to
   * @param callback The callback function to call when a message is received
   */
  private subscribeToLocalMessages<T>(moduleId: string, callback: (message: T) => void) {
    this.localEventBus.subscribe(moduleId, callback);
  }
  
  /**
   * Subscribe to messages from a remote module
   * @param moduleId The ID of the module to subscribe to
   * @param callback The callback function to call when a message is received
   */
  private subscribeToRemoteMessages<T>(moduleId: string, callback: (message: T) => void) {
    // Implement remote message subscription logic
    //console.log('Subscribing to remote messages for module:', moduleId);
    
    // For now, we'll use the local event bus for "remote" subscriptions as well
    // This allows components to communicate even without a real remote connection
    this.localEventBus.subscribe(moduleId, callback);
    
    // Example implementation for actual remote connections (to be replaced with actual implementation)
    // This would typically involve setting up a WebSocket connection or similar
    const handleRemoteMessage = (event: MessageEvent) => {
      try {
        const eventMessage = JSON.parse(event.data) as EventMessage;
        if (eventMessage.target.moduleId === moduleId) {
          callback(eventMessage.content as T);
        }
      } catch (error) {
        console.error('Error handling remote message:', error);
      }
    };
    
    // Store the connection and handler for later use
    // In a real implementation, this would be a WebSocket or similar
    this.remoteConnections.set(moduleId, {
      send: (data: string) => console.log('Would send data:', data),
      onmessage: handleRemoteMessage
    });
  }
  
  /**
   * Unsubscribe from messages from a local module
   * @param moduleId The ID of the module to unsubscribe from
   * @param callback The callback function to remove
   */
  private unsubscribeFromLocalMessages<T>(moduleId: string, callback: (message: T) => void) {
    this.localEventBus.unsubscribe(moduleId, callback);
  }
  
  /**
   * Unsubscribe from messages from a remote module
   * @param moduleId The ID of the module to unsubscribe from
   * @param callback The callback function to remove
   */
  private unsubscribeFromRemoteMessages<T>(moduleId: string, callback: (message: T) => void) {
    // Implement remote message unsubscription logic
    //console.log('Unsubscribing from remote messages for module:', moduleId);
    
    // For now, we'll use the local event bus for "remote" unsubscriptions as well
    // This allows components to communicate even without a real remote connection
    this.localEventBus.unsubscribe(moduleId, callback);
    
    // Example implementation for actual remote connections (to be replaced with actual implementation)
    const connection = this.remoteConnections.get(moduleId);
    if (connection) {
      // In a real implementation, this would remove the event listener
      // or close the WebSocket connection
      this.remoteConnections.delete(moduleId);
    }
  }
  
  /**
   * Set up handlers for remote events
   * This would typically involve WebSocket connections, event listeners, etc.
   */
  private setupRemoteEventHandling() {
    // Set up handlers for remote events
    //console.log('Setting up remote event handling');
    
    // Example implementation (to be replaced with actual implementation)
    // This would typically involve setting up a WebSocket server or client
    // For now, we'll just log that it's been set up
  }
  
  /**
   * Bridge the existing EventBus to the new EventService for backward compatibility
   */
  private bridgeLocalEventBus() {
    // Bridge existing EventBus to new EventService for backward compatibility
    //console.log('Bridging local EventBus to EventService');
    
    // Example implementation (to be replaced with actual implementation)
    // This would typically involve adding event listeners to the EventBus
    // that forward events to the EventService
  }
  
  /**
   * Generate a unique ID for a message
   * @returns A unique ID string
   */
  private generateUniqueId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

// Export a singleton instance
export const eventService = EventService.getInstance();
