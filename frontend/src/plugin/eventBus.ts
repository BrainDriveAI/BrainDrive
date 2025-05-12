import { EventEmitter } from 'events';

// Create a typed event bus for module-level messaging
class EventBus extends EventEmitter {
  emitMessage<T>(moduleId: string, message: T) {
    // console.log(`EventBus - emitMessage - moduleId: ${moduleId}`, message);
    this.emit(moduleId, message);
  }

  subscribe<T>(moduleId: string, callback: (message: T) => void) {
    // console.log(`EventBus - subscribe - moduleId: ${moduleId}`);
    this.on(moduleId, callback);
  }

  unsubscribe<T>(moduleId: string, callback: (message: T) => void) {
    // console.log(`EventBus - unsubscribe - moduleId: ${moduleId}`);
    this.off(moduleId, callback);
  }
}

// Export a singleton instance of EventBus
export const eventBus = new EventBus();
