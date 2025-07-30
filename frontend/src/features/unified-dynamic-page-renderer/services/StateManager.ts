import { StateService, StateChangeHandler } from '../types/services';

export interface StateManagerConfig {
  persistenceStrategy: 'memory' | 'localStorage' | 'sessionStorage' | 'indexedDB';
  syncStrategy: 'immediate' | 'debounced' | 'manual';
  debugMode: boolean;
  maxHistorySize: number;
}

export interface StateSnapshot {
  timestamp: Date;
  moduleStates: Record<string, any>;
  pageStates: Record<string, any>;
  globalState: Record<string, any>;
}

export interface StateDebugInfo {
  currentSnapshot: StateSnapshot;
  history: StateSnapshot[];
  subscriptions: Record<string, number>;
  persistenceStatus: 'idle' | 'saving' | 'loading' | 'error';
  lastSync: Date | null;
}

/**
 * Unified State Management Service
 * Handles module, page, and global state with persistence and synchronization
 */
export class StateManager implements StateService {
  private static instance: StateManager;
  
  private moduleStates = new Map<string, any>();
  private pageStates = new Map<string, any>();
  private globalState = new Map<string, any>();
  
  private subscriptions = new Map<string, Set<StateChangeHandler<any>>>();
  private stateHistory: StateSnapshot[] = [];
  private config: StateManagerConfig;
  
  private persistenceTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private isInitialized = false;

  static getInstance(config?: Partial<StateManagerConfig>): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager(config);
    }
    return StateManager.instance;
  }

  constructor(config: Partial<StateManagerConfig> = {}) {
    this.config = {
      persistenceStrategy: 'localStorage',
      syncStrategy: 'debounced',
      debugMode: false,
      maxHistorySize: 50,
      ...config
    };

    this.initialize();
  }

  /**
   * Get module state
   */
  getModuleState<T = any>(moduleId: string): T | null {
    const state = this.moduleStates.get(moduleId);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Get module state for ${moduleId}:`, state);
    }
    
    return state || null;
  }

  /**
   * Set module state
   */
  setModuleState<T = any>(moduleId: string, state: T): void {
    const oldState = this.moduleStates.get(moduleId);
    this.moduleStates.set(moduleId, state);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Set module state for ${moduleId}:`, { oldState, newState: state });
    }
    
    // Notify subscribers
    this.notifySubscribers(`module:${moduleId}`, state, oldState);
    
    // Schedule persistence
    this.schedulePersistence();
    
    // Add to history
    this.addToHistory();
  }

  /**
   * Get page state
   */
  getPageState<T = any>(pageId: string): T | null {
    const state = this.pageStates.get(pageId);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Get page state for ${pageId}:`, state);
    }
    
    return state || null;
  }

  /**
   * Set page state
   */
  setPageState<T = any>(pageId: string, state: T): void {
    const oldState = this.pageStates.get(pageId);
    this.pageStates.set(pageId, state);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Set page state for ${pageId}:`, { oldState, newState: state });
    }
    
    // Notify subscribers
    this.notifySubscribers(`page:${pageId}`, state, oldState);
    
    // Schedule persistence
    this.schedulePersistence();
    
    // Add to history
    this.addToHistory();
  }

  /**
   * Get global state
   */
  getGlobalState<T = any>(key: string): T | null {
    const state = this.globalState.get(key);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Get global state for ${key}:`, state);
    }
    
    return state || null;
  }

  /**
   * Set global state
   */
  setGlobalState<T = any>(key: string, value: T): void {
    const oldValue = this.globalState.get(key);
    this.globalState.set(key, value);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Set global state for ${key}:`, { oldValue, newValue: value });
    }
    
    // Notify subscribers
    this.notifySubscribers(`global:${key}`, value, oldValue);
    
    // Schedule persistence
    this.schedulePersistence();
    
    // Add to history
    this.addToHistory();
  }

  /**
   * Persist state to storage
   */
  async persist(): Promise<void> {
    try {
      const snapshot = this.createSnapshot();
      
      switch (this.config.persistenceStrategy) {
        case 'localStorage':
          localStorage.setItem('unified-renderer-state', JSON.stringify(snapshot));
          break;
          
        case 'sessionStorage':
          sessionStorage.setItem('unified-renderer-state', JSON.stringify(snapshot));
          break;
          
        case 'indexedDB':
          await this.persistToIndexedDB(snapshot);
          break;
          
        case 'memory':
          // Already in memory, nothing to do
          break;
      }
      
      if (this.config.debugMode) {
        console.log('[StateManager] State persisted successfully');
      }
      
    } catch (error) {
      console.error('[StateManager] Failed to persist state:', error);
      throw error;
    }
  }

  /**
   * Restore state from storage
   */
  async restore(): Promise<void> {
    try {
      let snapshot: StateSnapshot | null = null;
      
      switch (this.config.persistenceStrategy) {
        case 'localStorage':
          const localData = localStorage.getItem('unified-renderer-state');
          if (localData) {
            snapshot = JSON.parse(localData);
          }
          break;
          
        case 'sessionStorage':
          const sessionData = sessionStorage.getItem('unified-renderer-state');
          if (sessionData) {
            snapshot = JSON.parse(sessionData);
          }
          break;
          
        case 'indexedDB':
          snapshot = await this.restoreFromIndexedDB();
          break;
          
        case 'memory':
          // Nothing to restore from memory
          break;
      }
      
      if (snapshot) {
        this.applySnapshot(snapshot);
        
        if (this.config.debugMode) {
          console.log('[StateManager] State restored successfully:', snapshot);
        }
      }
      
    } catch (error) {
      console.error('[StateManager] Failed to restore state:', error);
      throw error;
    }
  }

  /**
   * Subscribe to state changes
   */
  subscribe<T = any>(key: string, handler: StateChangeHandler<T>): () => void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }
    
    this.subscriptions.get(key)!.add(handler);
    
    if (this.config.debugMode) {
      console.log(`[StateManager] Subscribed to ${key}, total subscribers: ${this.subscriptions.get(key)!.size}`);
    }
    
    // Return unsubscribe function
    return () => {
      const handlers = this.subscriptions.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscriptions.delete(key);
        }
      }
      
      if (this.config.debugMode) {
        console.log(`[StateManager] Unsubscribed from ${key}`);
      }
    };
  }

  /**
   * Get debug information
   */
  getDebugInfo(): StateDebugInfo {
    return {
      currentSnapshot: this.createSnapshot(),
      history: [...this.stateHistory],
      subscriptions: Object.fromEntries(
        Array.from(this.subscriptions.entries()).map(([key, handlers]) => [key, handlers.size])
      ),
      persistenceStatus: 'idle', // Would track actual status in real implementation
      lastSync: new Date()
    };
  }

  /**
   * Clear all state
   */
  clearAll(): void {
    this.moduleStates.clear();
    this.pageStates.clear();
    this.globalState.clear();
    this.stateHistory = [];
    
    if (this.config.debugMode) {
      console.log('[StateManager] All state cleared');
    }
  }

  /**
   * Get state snapshot for a specific point in time
   */
  getHistorySnapshot(index: number): StateSnapshot | null {
    return this.stateHistory[index] || null;
  }

  /**
   * Restore state from a historical snapshot
   */
  restoreFromHistory(index: number): boolean {
    const snapshot = this.getHistorySnapshot(index);
    if (!snapshot) {
      return false;
    }
    
    this.applySnapshot(snapshot);
    return true;
  }

  /**
   * Initialize the state manager
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      // Restore state from persistence
      await this.restore();
      
      // Setup sync timer if needed
      if (this.config.syncStrategy === 'debounced') {
        this.setupSyncTimer();
      }
      
      this.isInitialized = true;
      
      if (this.config.debugMode) {
        console.log('[StateManager] Initialized successfully');
      }
      
    } catch (error) {
      console.error('[StateManager] Failed to initialize:', error);
    }
  }

  /**
   * Create a snapshot of current state
   */
  private createSnapshot(): StateSnapshot {
    return {
      timestamp: new Date(),
      moduleStates: Object.fromEntries(this.moduleStates),
      pageStates: Object.fromEntries(this.pageStates),
      globalState: Object.fromEntries(this.globalState)
    };
  }

  /**
   * Apply a snapshot to current state
   */
  private applySnapshot(snapshot: StateSnapshot): void {
    // Clear current state
    this.moduleStates.clear();
    this.pageStates.clear();
    this.globalState.clear();
    
    // Apply snapshot
    for (const [key, value] of Object.entries(snapshot.moduleStates)) {
      this.moduleStates.set(key, value);
    }
    
    for (const [key, value] of Object.entries(snapshot.pageStates)) {
      this.pageStates.set(key, value);
    }
    
    for (const [key, value] of Object.entries(snapshot.globalState)) {
      this.globalState.set(key, value);
    }
  }

  /**
   * Add current state to history
   */
  private addToHistory(): void {
    const snapshot = this.createSnapshot();
    this.stateHistory.push(snapshot);
    
    // Limit history size
    if (this.stateHistory.length > this.config.maxHistorySize) {
      this.stateHistory.shift();
    }
  }

  /**
   * Notify subscribers of state changes
   */
  private notifySubscribers<T>(key: string, newState: T, oldState: T): void {
    const handlers = this.subscriptions.get(key);
    if (!handlers) return;
    
    for (const handler of handlers) {
      try {
        handler(newState, oldState);
      } catch (error) {
        console.error(`[StateManager] Error in subscriber for ${key}:`, error);
      }
    }
  }

  /**
   * Schedule persistence based on strategy
   */
  private schedulePersistence(): void {
    if (this.config.syncStrategy === 'immediate') {
      this.persist().catch(console.error);
    } else if (this.config.syncStrategy === 'debounced') {
      if (this.persistenceTimer) {
        clearTimeout(this.persistenceTimer);
      }
      
      this.persistenceTimer = setTimeout(() => {
        this.persist().catch(console.error);
      }, 1000); // 1 second debounce
    }
    // 'manual' strategy requires explicit persist() calls
  }

  /**
   * Setup sync timer for periodic synchronization
   */
  private setupSyncTimer(): void {
    this.syncTimer = setInterval(() => {
      this.persist().catch(console.error);
    }, 30000); // Sync every 30 seconds
  }

  /**
   * Persist to IndexedDB
   */
  private async persistToIndexedDB(snapshot: StateSnapshot): Promise<void> {
    // IndexedDB implementation would go here
    // For now, fallback to localStorage
    localStorage.setItem('unified-renderer-state', JSON.stringify(snapshot));
  }

  /**
   * Restore from IndexedDB
   */
  private async restoreFromIndexedDB(): Promise<StateSnapshot | null> {
    // IndexedDB implementation would go here
    // For now, fallback to localStorage
    const data = localStorage.getItem('unified-renderer-state');
    return data ? JSON.parse(data) : null;
  }
}

// Export singleton instance
export const stateManager = StateManager.getInstance();